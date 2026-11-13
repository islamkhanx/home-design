export type V2 = [number, number]
export type V3 = [number, number, number]
export const mm = (n: number) => n / 1000
export const deg = (n: number) => (n * Math.PI) / 180
export const meters = (p: V3): V3 => p.map(mm) as V3
export function polygonArea(p: V2[]): number {
  return (
    Math.abs(
      p.reduce((a, q, i) => {
        const r = p[(i + 1) % p.length]!
        return a + q[0] * r[1] - r[0] * q[1]
      }, 0),
    ) / 2
  )
}
export function pointInPolygon(p: V2, polygon: V2[]): boolean {
  let inside = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i]!,
      b = polygon[j]!
    const cross = (p[0] - a[0]) * (b[1] - a[1]) - (p[1] - a[1]) * (b[0] - a[0])
    if (
      Math.abs(cross) < 1e-6 &&
      p[0] >= Math.min(a[0], b[0]) &&
      p[0] <= Math.max(a[0], b[0]) &&
      p[1] >= Math.min(a[1], b[1]) &&
      p[1] <= Math.max(a[1], b[1])
    )
      return true
    if (
      a[1] > p[1] !== b[1] > p[1] &&
      p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]
    )
      inside = !inside
  }
  return inside
}
export type Opening = {
  id: string
  kind: 'door' | 'window'
  offset: number
  width: number
  bottom: number
  height: number
}
export function ringsIntersect(a: V2[], b: V2[]): boolean {
  const cross = (p: V2, q: V2, r: V2) =>
    (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0])
  const on = (p: V2, q: V2, r: V2) =>
    Math.abs(cross(p, q, r)) < 1e-8 &&
    r[0] >= Math.min(p[0], q[0]) &&
    r[0] <= Math.max(p[0], q[0]) &&
    r[1] >= Math.min(p[1], q[1]) &&
    r[1] <= Math.max(p[1], q[1])
  for (let i = 0; i < a.length; i++)
    for (let j = 0; j < b.length; j++) {
      const p = a[i],
        q = a[(i + 1) % a.length],
        r = b[j],
        s = b[(j + 1) % b.length]
      if (
        (cross(p, q, r) * cross(p, q, s) < 0 && cross(r, s, p) * cross(r, s, q) < 0) ||
        on(p, q, r) ||
        on(p, q, s) ||
        on(r, s, p) ||
        on(r, s, q)
      )
        return true
    }
  return false
}
export type Cell = { x: number; y: number; width: number; height: number }
export function wallCells(length: number, height: number, openings: Opening[]): Cell[] {
  const xs = [
    ...new Set([0, length, ...openings.flatMap((o) => [o.offset, o.offset + o.width])]),
  ].sort((a, b) => a - b)
  const ys = [
    ...new Set([0, height, ...openings.flatMap((o) => [o.bottom, o.bottom + o.height])]),
  ].sort((a, b) => a - b)
  const cells: Cell[] = []
  for (let i = 0; i < xs.length - 1; i++)
    for (let j = 0; j < ys.length - 1; j++) {
      const x = xs[i]!,
        y = ys[j]!,
        width = xs[i + 1]! - x,
        h = ys[j + 1]! - y
      if (width <= 0 || h <= 0) continue
      if (
        !openings.some(
          (o) =>
            x + width / 2 > o.offset &&
            x + width / 2 < o.offset + o.width &&
            y + h / 2 > o.bottom &&
            y + h / 2 < o.bottom + o.height,
        )
      )
        cells.push({ x, y, width, height: h })
    }
  return cells
}
export function selfIntersects(p: V2[]): boolean {
  const cross = (a: V2, b: V2, c: V2) =>
    (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
  const on = (a: V2, b: V2, c: V2) =>
    Math.abs(cross(a, b, c)) < 1e-8 &&
    c[0] >= Math.min(a[0], b[0]) &&
    c[0] <= Math.max(a[0], b[0]) &&
    c[1] >= Math.min(a[1], b[1]) &&
    c[1] <= Math.max(a[1], b[1])
  for (let i = 0; i < p.length; i++)
    for (let j = i + 1; j < p.length; j++) {
      if (j === i + 1 || (i === 0 && j === p.length - 1)) continue
      const a = p[i]!,
        b = p[(i + 1) % p.length]!,
        c = p[j]!,
        d = p[(j + 1) % p.length]!
      if (
        (cross(a, b, c) * cross(a, b, d) < 0 && cross(c, d, a) * cross(c, d, b) < 0) ||
        on(a, b, c) ||
        on(a, b, d) ||
        on(c, d, a) ||
        on(c, d, b)
      )
        return true
    }
  return false
}
