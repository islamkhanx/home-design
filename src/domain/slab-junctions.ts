import type { Apartment, Entity } from './schema.ts'
import type { V2 } from './math.ts'
import { polygonArea, selfIntersects } from './math.ts'
import { wallFaceForRoom } from './wall-finishes.ts'

// Tolerance for reconciling the existing raster trace with modeled wall faces.
// It is not a measured construction or installation tolerance.
const TRACE_GAP = 20
const EPS = 1e-6
const add = (a: V2, b: V2): V2 => [a[0] + b[0], a[1] + b[1]]
const sub = (a: V2, b: V2): V2 => [a[0] - b[0], a[1] - b[1]]
const mul = (a: V2, s: number): V2 => [a[0] * s, a[1] * s]
const dot = (a: V2, b: V2) => a[0] * b[0] + a[1] * b[1]
const cross = (a: V2, b: V2) => a[0] * b[1] - a[1] * b[0]
const length = (a: V2) => Math.hypot(...a)
const same = (a: V2, b: V2) => length(sub(a, b)) < EPS
const horizontal = (e: Entity) => Math.abs(e.rotation[0]) < EPS && Math.abs(e.rotation[2]) < EPS
function world(e: Entity, p: V2): V2 {
  const angle = (e.rotation[1] * Math.PI) / 180,
    c = Math.cos(angle),
    s = Math.sin(angle)
  return [p[0] * c + p[1] * s + e.position[0], -p[0] * s + p[1] * c + e.position[2]]
}
function local(e: Entity, p: V2): V2 {
  const q = sub(p, [e.position[0], e.position[2]])
  const angle = (e.rotation[1] * Math.PI) / 180,
    c = Math.cos(angle),
    s = Math.sin(angle)
  return [q[0] * c - q[1] * s, q[0] * s + q[1] * c]
}
type Wall = { entity: Entity; start: V2; along: V2; normal: V2; length: number; half: number }
function wallGeometry(e: Entity): Wall {
  const start = world(e, e.wall!.start),
    delta = sub(world(e, e.wall!.end), start)
  const along = mul(delta, 1 / length(delta))
  return {
    entity: e,
    start,
    along,
    normal: [-along[1], along[0]],
    length: length(delta),
    half: e.wall!.thickness / 2,
  }
}
function clean(ring: V2[]): V2[] {
  const result = ring.filter((p, i) => !same(p, ring[(i + ring.length - 1) % ring.length]))
  if (result.length < 3 || polygonArea(result) < EPS || selfIntersects(result))
    throw new Error('Slab junction would create an invalid surface polygon')
  return result
}
function alignTraceEdges(ring: V2[], walls: Wall[]): V2[] {
  const signedArea = ring.reduce((sum, p, i) => sum + cross(p, ring[(i + 1) % ring.length]), 0)
  const shifted = ring.map((a, i) => {
    const delta = sub(ring[(i + 1) % ring.length], a),
      span = length(delta),
      along = mul(delta, 1 / span)
    const outward: V2 = signedArea > 0 ? [along[1], -along[0]] : [-along[1], along[0]]
    let closest = Infinity
    const candidates = new Map<number, { gap: number; reach: number; spans: V2[] }>()
    for (const w of walls) {
      const end = add(w.start, mul(w.along, w.length))
      const corners = [
        add(w.start, mul(w.normal, -w.half)),
        add(end, mul(w.normal, -w.half)),
        add(end, mul(w.normal, w.half)),
        add(w.start, mul(w.normal, w.half)),
      ]
      for (let j = 0; j < corners.length; j++) {
        const p = corners[j],
          q = corners[(j + 1) % corners.length],
          direction = sub(q, p)
        if (Math.abs(cross(along, mul(direction, 1 / length(direction)))) > EPS) continue
        const gap = dot(sub(p, a), outward)
        if (gap <= EPS || gap > TRACE_GAP) continue
        const key = Math.round(gap / EPS)
        const candidate = candidates.get(key) ?? { gap, reach: 0, spans: [] }
        const u = dot(sub(p, a), along),
          v = dot(sub(q, a), along)
        candidate.spans.push([Math.min(u, v), Math.max(u, v)])
        candidate.reach = Math.max(candidate.reach, w.half + TRACE_GAP)
        candidates.set(key, candidate)
      }
    }
    for (const candidate of candidates.values()) {
      // Collinear end caps and long faces jointly bound a room at a butt joint.
      // Disconnected fragments must not drag an open room boundary toward a wall.
      const intervals: V2[] = []
      for (const interval of candidate.spans.sort((a, b) => a[0] - b[0])) {
        const last = intervals.at(-1)
        if (last && interval[0] <= last[1] + EPS) last[1] = Math.max(last[1], interval[1])
        else intervals.push([...interval])
      }
      if (intervals.some(([lo, hi]) => lo <= candidate.reach && hi >= span - candidate.reach))
        closest = Math.min(closest, candidate.gap)
    }
    return { start: closest < Infinity ? add(a, mul(outward, closest)) : a, delta }
  })
  return clean(
    shifted.map((current, i) => {
      const previous = shifted[(i + shifted.length - 1) % shifted.length]
      const denominator = cross(previous.delta, current.delta)
      if (Math.abs(denominator) < EPS) return current.start
      return add(
        previous.start,
        mul(previous.delta, cross(sub(current.start, previous.start), current.delta) / denominator),
      )
    }),
  )
}
/** Close only the wall-backed part of an edge that is otherwise an open room
 * boundary. Moving its full length would merge semantic rooms or cross a void. */
function alignPartialTraceEdges(ring: V2[], walls: Wall[]): V2[] {
  const signedArea = ring.reduce((sum, p, i) => sum + cross(p, ring[(i + 1) % ring.length]), 0)
  const result = ring.flatMap((a, i): V2[] => {
    const delta = sub(ring[(i + 1) % ring.length], a), span = length(delta), along = mul(delta, 1 / span)
    const outward: V2 = signedArea > 0 ? [along[1], -along[0]] : [-along[1], along[0]]
    const candidates: { lo: number; hi: number; gap: number }[] = []
    for (const w of walls) {
      const end = add(w.start, mul(w.along, w.length))
      const corners = [add(w.start, mul(w.normal, -w.half)), add(end, mul(w.normal, -w.half)), add(end, mul(w.normal, w.half)), add(w.start, mul(w.normal, w.half))]
      for (let j = 0; j < corners.length; j++) {
        const p = corners[j], q = corners[(j + 1) % corners.length], direction = sub(q, p)
        if (Math.abs(cross(along, mul(direction, 1 / length(direction)))) > EPS) continue
        const gap = dot(sub(p, a), outward)
        if (gap <= EPS || gap > TRACE_GAP) continue
        const u = dot(sub(p, a), along), v = dot(sub(q, a), along)
        const lo = Math.max(0, Math.min(u, v)), hi = Math.min(span, Math.max(u, v))
        if (hi - lo > EPS) candidates.push({ lo, hi, gap })
      }
    }
    if (!candidates.length) return [a]
    const cuts = [...new Set([0, span, ...candidates.flatMap(c => [c.lo, c.hi])])].sort((x, y) => x - y)
    const at = (u: number, gap: number) => add(a, add(mul(along, u), mul(outward, gap)))
    const points: V2[] = []
    for (let k = 1; k < cuts.length; k++) {
      const lo = cuts[k - 1], hi = cuts[k], middle = (lo + hi) / 2
      const covering = candidates.filter(c => middle >= c.lo && middle <= c.hi)
      const gap = covering.length ? Math.min(...covering.map(c => c.gap)) : 0
      points.push(at(lo, gap), at(hi, gap))
    }
    return points
  })
  return clean(result)
}
type Slab = { entity: Entity; ring: V2[] }
type EdgeMatch = { slab: Slab; edge: number; a: number; b: number; side: number }
function openingEdge(slab: Slab, w: Wall, lo: number, hi: number): EdgeMatch | undefined {
  for (let i = 0; i < slab.ring.length; i++) {
    const a = sub(slab.ring[i], w.start),
      b = sub(slab.ring[(i + 1) % slab.ring.length], w.start)
    const va = dot(a, w.normal),
      vb = dot(b, w.normal),
      ua = dot(a, w.along),
      ub = dot(b, w.along)
    if (Math.abs(va - vb) > EPS || Math.abs(va) > w.half + TRACE_GAP) continue
    if (Math.min(ua, ub) > lo + EPS || Math.max(ua, ub) < hi - EPS) continue
    return { slab, edge: i, a: ua, b: ub, side: va }
  }
}
function notch(match: EdgeMatch, w: Wall, lo: number, hi: number, target = 0) {
  if (Math.abs(match.side - target) < EPS) return
  const u = match.a < match.b ? [lo, hi] : [hi, lo]
  const at = (along: number, side: number) =>
    add(w.start, add(mul(w.along, along), mul(w.normal, side)))
  const inserted = [at(u[0], match.side), at(u[0], target), at(u[1], target), at(u[1], match.side)]
  match.slab.ring = clean([
    ...match.slab.ring.slice(0, match.edge + 1),
    ...inserted,
    ...match.slab.ring.slice(match.edge + 1),
  ])
}

/**
 * Reconcile presentation slabs with the modeled wall faces without changing
 * traced room polygons, architectural walls, openings, elevations or counts.
 * Small outward trace gaps are closed for floor and ceiling slabs. Only floors
 * extend through ground-level doors; paired finishes meet at the axis. At an
 * exterior door, a sill patch ends at the host wall's outer face, never beyond it.
 * The door lintels already occupy the ceiling-level opening above each door.
 */
export function stitchSlabJunctions(input: Apartment): Apartment {
  const a = structuredClone(input)
  const walls = a.objects
    .filter((e) => e.kind === 'Wall' && e.wall && horizontal(e))
    .map(wallGeometry)
  const slabs: Slab[] = a.objects
    .filter((e) => ['Floor', 'Ceiling'].includes(e.kind) && e.surface && horizontal(e))
    .map((entity) => ({
      entity,
      ring: alignPartialTraceEdges(alignTraceEdges(
        entity.surface!.polygon.map((p) => world(entity, p)), walls,
      ), walls),
    }))
  for (const w of walls) {
    const rooms = new Set([w.entity.roomId, ...(w.entity.sharedWith ?? [])])
    for (const opening of w.entity.wall!.openings) {
      if (opening.kind !== 'door' || Math.abs(opening.bottom) > EPS) continue
      const matches = slabs
        .filter(
          (s) =>
            s.entity.kind === 'Floor' &&
            rooms.has(s.entity.roomId) &&
            Math.abs(s.entity.position[1] - w.entity.position[1]) < EPS,
        )
        .map((s) => openingEdge(s, w, opening.offset, opening.offset + opening.width))
        .filter((m): m is EdgeMatch => !!m)
      if (rooms.size === 1 && matches.length === 1) {
        const room = a.rooms.find(r => r.id === matches[0].slab.entity.roomId)
        const face = room && wallFaceForRoom(w.entity, room)
        if (face) notch(matches[0], w, opening.offset, opening.offset + opening.width,
          face === 'left' ? -w.half : w.half)
        continue
      }
      // Never bridge into an absent room, across a level change or from the
      // same side. A previously stitched side is accepted for idempotence.
      if (
        matches.length !== 2 ||
        matches[0].slab.entity.roomId === matches[1].slab.entity.roomId ||
        matches[0].side * matches[1].side > EPS
      )
        continue
      for (const match of matches) notch(match, w, opening.offset, opening.offset + opening.width)
    }
  }
  for (const s of slabs) s.entity.surface!.polygon = s.ring.map((p) => local(s.entity, p))
  return a
}
