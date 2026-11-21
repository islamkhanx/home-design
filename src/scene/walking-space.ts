import * as T from 'three'
import type { Apartment } from '../domain/schema.ts'
import { geometryManifest } from './canonical.ts'
export const EYE_HEIGHT = 1.6
export const CLEARANCE = 0.14
export function safeWalkingStart(
  p: number[],
  space: { free: (p: number[]) => boolean },
  polygon?: number[][],
) {
  if (space.free(p)) return p
  for (let radius = 0.025; radius <= 0.8; radius += 0.025)
    for (let i = 0; i < 48; i++) {
      const q = [
        p[0] + Math.cos((i * Math.PI) / 24) * radius,
        p[1] + Math.sin((i * Math.PI) / 24) * radius,
      ]
      if ((!polygon || inside(q, polygon)) && space.free(q)) return q
    }
  throw new Error('Нет свободного места для камеры в этой комнате. Проверьте расстановку мебели.')
}
const distance = (a: number[], b: number[]) => Math.hypot(a[0] - b[0], a[1] - b[1])
const mix = (a: number[], b: number[], t: number) => a.map((n, i) => n + (b[i] - n) * t)
// Door poses are a separate presentation copy, exported through the SAME canonical
// factories. Architecture and the saved apartment definition are never modified.
export function prepareWalkthroughApartment(source: Apartment) {
  const a = structuredClone(source)
  for (const e of a.objects)
    if (e.kind === 'Door' && e.attach) {
      const wall = a.objects.find((w) => w.id === e.attach!.wallId)
      if (wall?.sharedWith?.length)
        e.params = { ...e.params, doorAngle: e.id === 'door' ? -90 : 90 }
    }
  return a
}
function inside(p: number[], polygon: number[][]) {
  let yes = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i],
      b = polygon[j]
    if (
      a[1] > p[1] !== b[1] > p[1] &&
      p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]
    )
      yes = !yes
  }
  return yes
}
export function walkingSpace(a: Apartment, root: T.Group) {
  const polygons = a.rooms
    .filter((r) => r.polygon)
    .map((r) => r.polygon!.map((p) => p.map((n) => n / 1000)))
  const portals: { center: number[]; along: number[]; half: number; depth: number }[] = []
  for (const e of a.objects.filter((e) => e.wall)) {
    const group = root.children.find((g) => g.userData.entityId === e.id)!,
      w = e.wall!
    const dx = w.end[0] - w.start[0],
      dz = w.end[1] - w.start[1],
      len = Math.hypot(dx, dz)
    for (const o of w.openings.filter((o) => o.kind === 'door' && o.bottom === 0)) {
      const center = new T.Vector3(
        (w.start[0] + (dx / len) * (o.offset + o.width / 2)) / 1000,
        0,
        (w.start[1] + (dz / len) * (o.offset + o.width / 2)) / 1000,
      ).applyMatrix4(group.matrixWorld)
      const along = new T.Vector3(dx / len, 0, dz / len).transformDirection(group.matrixWorld)
      portals.push({
        center: [center.x, center.z],
        along: [along.x, along.z],
        half: o.width / 2000,
        depth: w.thickness / 2000 + 0.09,
      })
    }
  }
  const entities = new Map(a.objects.map((e) => [e.id, e]))
  const passableKinds = new Set([
    'Floor', 'Ceiling', 'Spotlight', 'TrackLight', 'Pendant', 'LEDStrip', 'Socket', 'Switch',
  ])
  const obstacles = geometryManifest(root).filter((b) => {
    const entity = entities.get(b.entityId)
    return entity?.visible !== false &&
      !passableKinds.has(entity?.kind ?? '') &&
      b.max[1] > 0.12 &&
      b.min[1] < EYE_HEIGHT + 0.15
  })
  function supported(p: number[]) {
    return (
      polygons.some((poly) => inside(p, poly)) ||
      portals.some((q) => {
        const d = [p[0] - q.center[0], p[1] - q.center[1]]
        return (
          Math.abs(d[0] * q.along[0] + d[1] * q.along[1]) < q.half &&
          Math.abs(d[0] * q.along[1] - d[1] * q.along[0]) < q.depth
        )
      })
    )
  }
  function free(p: number[]) {
    if (!supported(p)) return false
    return !obstacles.some(
      (b) =>
        p[0] > b.min[0] - CLEARANCE &&
        p[0] < b.max[0] + CLEARANCE &&
        p[1] > b.min[2] - CLEARANCE &&
        p[1] < b.max[2] + CLEARANCE,
    )
  }
  function segment(a: number[], b: number[]) {
    const count = Math.max(1, Math.ceil(distance(a, b) / 0.025))
    for (let i = 0; i <= count; i++) if (!free(mix(a, b, i / count))) return false
    return true
  }
  return { free, segment, obstacles, polygons }
}
