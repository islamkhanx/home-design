import type { Apartment, Entity } from './schema.ts'
import { parseApartment } from './schema.ts'
import { pointInPolygon, ringsIntersect } from './math.ts'
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

/** Apply a generated furnishing proposal to existing architecture. Never create room geometry.
 * This validates containment, not circulation, engineering or construction readiness.
 */
export function applyGeneratedInteriors(input: Apartment, proposal: Entity[]): Apartment {
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
    if (
      !footprint.every((p) => pointInPolygon(p, room.polygon!)) ||
      ringsIntersect(footprint, room.polygon)
    )
      throw new Error(`${o.id}: предмет выходит за контур помещения.`)
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
