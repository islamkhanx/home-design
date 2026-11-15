import type { Apartment } from '../domain/schema.ts'

type Point = [number, number, number]
export interface DimensionGuide {
  roomId: string
  start: Point
  end: Point
  wallStart: Point
  wallEnd: Point
  label: Point
  millimeters: number
}

/** Derive room-edge dimensions from source polygons; never store duplicate geometry. */
export function dimensionGuides(a: Apartment, room: string, ceiling = false): DimensionGuide[] {
  return a.rooms.filter((r) => r.polygon && (room === 'all' || r.id === room)).flatMap((r) => {
    const ring = r.polygon!
    const signed = ring.reduce((sum, p, i) => {
      const q = ring[(i + 1) % ring.length]
      return sum + p[0] * q[1] - q[0] * p[1]
    }, 0)
    const level = ceiling
      ? (a.objects.find((o) => o.roomId === r.id && o.kind === 'Ceiling')?.position[1] ?? r.height ?? 0) / 1000 - 0.04
      : 0.1
    return ring.flatMap((p, i) => {
      const q = ring[(i + 1) % ring.length], dx = q[0] - p[0], dz = q[1] - p[1]
      const length = Math.hypot(dx, dz)
      if (length < 1) return []
      const side = signed >= 0 ? 1 : -1
      const nx = dz / length * side, nz = -dx / length * side
      const point = (v: number[], offset: number): Point => [v[0] / 1000 + nx * offset, level, v[1] / 1000 + nz * offset]
      return [{ roomId: r.id, start: point(p, 0.23), end: point(q, 0.23),
        wallStart: point(p, 0), wallEnd: point(q, 0),
        label: point([(p[0] + q[0]) / 2, (p[1] + q[1]) / 2], 0.39), millimeters: length }]
    })
  })
}
