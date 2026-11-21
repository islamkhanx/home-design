import type { Apartment, Entity } from './schema.ts'
import { parseApartment } from './schema.ts'
import { pointInPolygon, ringsIntersect, wallCells } from './math.ts'
import type { V2 } from './math.ts'

const FURNITURE = new Set([
  'Socket',
  'Switch',
  'KitchenCabinet',
  'Countertop',
  'Sink',
  'Appliance',
  'Bathtub',
  'Shower',
  'Toilet',
  'Vanity',
  'GlassPartition',
  'Bed',
  'Sofa',
  'Wardrobe',
  'Shelf',
  'Table',
  'TrackLight',
  'Spotlight',
  'Pendant',
  'LEDStrip',
])

export type PlacementZones = Readonly<Record<string, readonly string[]>>
const EPS = 1e-6 // Numerical tolerance in millimetres, not a placement allowance.

/** Exact polygon-union containment: edge ordering is fixed between successive
 * vertex/intersection x coordinates, so one vertical slice per slab suffices.
 * Unlike corner checks or summed intersection areas this detects enclosed gaps
 * and handles overlapping room polygons without counting their overlap twice.
 */
function containedInUnion(footprint: V2[], polygons: V2[][]): boolean {
  const rings = [footprint, ...polygons]
  const edges = rings.flatMap((ring) => ring.map((p, i) => [p, ring[(i + 1) % ring.length]]))
  const xs = rings.flatMap((ring) => ring.map((p) => p[0]))
  const cross = (a: V2, b: V2) => a[0] * b[1] - a[1] * b[0]
  for (let i = 0; i < edges.length; i++)
    for (let j = i + 1; j < edges.length; j++) {
      const [a, b] = edges[i],
        [c, d] = edges[j]
      const u: V2 = [b[0] - a[0], b[1] - a[1]],
        v: V2 = [d[0] - c[0], d[1] - c[1]]
      const delta: V2 = [c[0] - a[0], c[1] - a[1]],
        denominator = cross(u, v)
      if (Math.abs(denominator) < EPS) continue
      const t = cross(delta, v) / denominator,
        s = cross(delta, u) / denominator
      if (t >= 0 && t <= 1 && s >= 0 && s <= 1) xs.push(a[0] + t * u[0])
    }
  const cuts = [...new Set(xs)].sort((a, b) => a - b)
  const intervals = (ring: V2[], x: number): V2[] => {
    const zs: number[] = []
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i],
        b = ring[(i + 1) % ring.length]
      if (a[0] > x !== b[0] > x) zs.push(a[1] + ((x - a[0]) * (b[1] - a[1])) / (b[0] - a[0]))
    }
    zs.sort((a, b) => a - b)
    return zs.filter((_, i) => i % 2 === 0).map((z, i) => [z, zs[2 * i + 1]])
  }
  for (let i = 0; i < cuts.length - 1; i++) {
    if (cuts[i + 1] - cuts[i] <= EPS) continue
    const x = (cuts[i] + cuts[i + 1]) / 2
    const required = intervals(footprint, x)
    if (!required.length) continue
    const covered: V2[] = []
    for (const span of polygons.flatMap((ring) => intervals(ring, x)).sort((a, b) => a[0] - b[0])) {
      const last = covered[covered.length - 1]
      if (last && span[0] <= last[1] + EPS) last[1] = Math.max(last[1], span[1])
      else covered.push([...span])
    }
    if (required.some(([lo, hi]) => !covered.some(([a, b]) => a <= lo + EPS && b >= hi - EPS)))
      return false
  }
  return true
}

/** Positive-area intersection of convex footprints; touching is permitted. */
function overlaps(a: V2[], b: V2[]): boolean {
  return [a, b].every((ring) =>
    ring.every((p, i) => {
      const q = ring[(i + 1) % ring.length],
        length = Math.hypot(q[0] - p[0], q[1] - p[1])
      const project = (v: V2) => (v[0] * (p[1] - q[1]) + v[1] * (q[0] - p[0])) / length
      const aa = a.map(project),
        bb = b.map(project)
      return (
        Math.min(Math.max(...aa), Math.max(...bb)) - Math.max(Math.min(...aa), Math.min(...bb)) >
        EPS
      )
    }),
  )
}

function intersectsWall(o: Entity, footprint: V2[], host: Entity): boolean {
  const w = host.wall!
  if (host.rotation[0] || host.rotation[2])
    throw new Error(`${host.id}: наклонённая стена требует отдельной проверки зоны.`)
  const dx = w.end[0] - w.start[0],
    dz = w.end[1] - w.start[1],
    length = Math.hypot(dx, dz)
  const angle = (host.rotation[1] * Math.PI) / 180
  const point = (along: number, across: number): V2 => {
    const x = w.start[0] + (dx * along - dz * across) / length
    const z = w.start[1] + (dz * along + dx * across) / length
    return [
      host.position[0] + x * Math.cos(angle) + z * Math.sin(angle),
      host.position[2] - x * Math.sin(angle) + z * Math.cos(angle),
    ]
  }
  return wallCells(length, w.height, w.openings).some((c) => {
    const bottom = host.position[1] + c.y
    if (
      Math.min(o.position[1] + o.size[1], bottom + c.height) - Math.max(o.position[1], bottom) <=
      EPS
    )
      return false
    const half = w.thickness / 2
    return overlaps(footprint, [
      point(c.x, -half),
      point(c.x + c.width, -half),
      point(c.x + c.width, half),
      point(c.x, half),
    ])
  })
}

/** Apply a generated furnishing proposal to existing architecture. Never create room geometry.
 * This validates containment, not circulation, engineering or construction readiness.
 */
export function applyGeneratedInteriors(
  input: Apartment,
  proposal: Entity[],
  placementZones: PlacementZones = {},
): Apartment {
  const a = parseApartment(input)
  if (
    a.rooms.some((r) => r.generated) ||
    a.objects.some((o) => o.generated && !FURNITURE.has(o.kind))
  )
    throw new Error(
      'Автоматическая архитектура отозвана: сначала сверьте контуры с исходным планом.',
    )
  for (const o of proposal) {
    if (!FURNITURE.has(o.kind) || o.wall || o.surface || o.attach)
      throw new Error('Генерация интерьера не может менять стены, проёмы, полы и потолки.')
    const room = a.rooms.find((r) => r.id === o.roomId)
    if (!room?.polygon)
      throw new Error(`Нет исходной геометрии помещения ${o.roomId}; площадь не задаёт контур.`)
    if (o.rotation[0] || o.rotation[2])
      throw new Error('Наклонённые предметы требуют отдельной проверки.')
    const theta = (o.rotation[1] * Math.PI) / 180
    const footprint: V2[] = [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ].map(([x, z]) => {
      const dx = (x * o.size[0]) / 2,
        dz = (z * o.size[2]) / 2
      return [
        o.position[0] + dx * Math.cos(theta) + dz * Math.sin(theta),
        o.position[2] - dx * Math.sin(theta) + dz * Math.cos(theta),
      ]
    })
    const zoneIds = placementZones[o.roomId]
    const zone = zoneIds?.map((id) => a.rooms.find((r) => r.id === id))
    if (zoneIds && (!zoneIds.includes(o.roomId) || zone!.some((r) => !r?.polygon)))
      throw new Error(
        `${o.id}: зона размещения должна включать исходные контуры своего и соседних помещений.`,
      )
    const contained = zone
      ? containedInUnion(
          footprint,
          zone.map((r) => r!.polygon!),
        )
      : footprint.every((p) => pointInPolygon(p, room.polygon!)) &&
        !ringsIntersect(footprint, room.polygon)
    if (!contained) throw new Error(`${o.id}: предмет выходит за контур помещения.`)
    if (
      zone &&
      a.objects.some(
        (wall) => wall.kind === 'Wall' && wall.wall && intersectsWall(o, footprint, wall),
      )
    )
      throw new Error(`${o.id}: предмет пересекает реальную стену зоны размещения.`)
    if (o.position[1] < 0 || (room.height !== undefined && o.position[1] + o.size[1] > room.height))
      throw new Error(`${o.id}: предмет выходит за высоту помещения.`)
  }
  const roomIds = new Set(proposal.map((o) => o.roomId))
  a.objects = a.objects.filter((o) => !o.generated || !roomIds.has(o.roomId) || !!o.electrical)
  a.objects.push(
    ...proposal.map(
      (o): Entity => ({ ...structuredClone(o), generated: true, evidence: 'assumed' }),
    ),
  )
  return parseApartment(a)
}
