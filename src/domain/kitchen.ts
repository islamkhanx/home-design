import type { Entity, Evidence } from './schema.ts'
import type { V3 } from './math.ts'
export interface LKitchen {
  id: string
  roomId: string
  origin: V3
  rotationY?: number
  longRun: number
  returnRun: number
  depth: number
  height: number
  counterThickness: number
  moduleWidth: number
  material: string
  counterMaterial: string
  evidence: Evidence
}
/** No hard-coded apartment dimensions. Local L occupies [0,longRun] × [0,returnRun]. */
export function makeLKitchen(p: LKitchen): Entity[] {
  if (
    [p.longRun, p.returnRun, p.depth, p.height, p.counterThickness, p.moduleWidth].some(
      (v) => !Number.isFinite(v) || v <= 0,
    ) ||
    p.longRun <= p.depth ||
    p.returnRun <= p.depth ||
    p.counterThickness >= p.height
  )
    throw new Error('Invalid L-kitchen dimensions')
  const out: Entity[] = [],
    angle = ((p.rotationY ?? 0) * Math.PI) / 180,
    c = Math.cos(angle),
    s = Math.sin(angle)
  function position(x: number, y: number, z: number): V3 {
    return [p.origin[0] + c * x + s * z, p.origin[1] + y, p.origin[2] - s * x + c * z]
  }
  const base = { roomId: p.roomId, evidence: p.evidence, material: p.material }
  // First run owns the corner; the perpendicular run begins beyond the full cabinet depth.
  const n = Math.ceil(p.longRun / p.moduleWidth),
    w = p.longRun / n
  for (let i = 0; i < n; i++)
    out.push({
      ...base,
      id: p.id + '-long-' + i,
      name: 'Кухня · ряд A ' + (i + 1),
      kind: 'KitchenCabinet',
      position: position(w * (i + 0.5), 0, p.depth / 2),
      rotation: [0, p.rotationY ?? 0, 0],
      size: [w, p.height - p.counterThickness, p.depth],
    })
  const length = p.returnRun - p.depth,
    m = Math.ceil(length / p.moduleWidth),
    rw = length / m
  for (let i = 0; i < m; i++)
    out.push({
      ...base,
      id: p.id + '-return-' + i,
      name: 'Кухня · ряд B ' + (i + 1),
      kind: 'KitchenCabinet',
      position: position(p.depth / 2, 0, p.depth + rw * (i + 0.5)),
      rotation: [0, (p.rotationY ?? 0) + 90, 0],
      size: [rw, p.height - p.counterThickness, p.depth],
    })
  out.push({
    ...base,
    id: p.id + '-counter',
    name: 'L-столешница',
    kind: 'Countertop',
    material: p.counterMaterial,
    position: position(0, p.height, 0),
    rotation: [0, p.rotationY ?? 0, 0],
    size: [p.longRun, p.counterThickness, p.returnRun],
    surface: {
      thickness: p.counterThickness,
      polygon: [
        [0, 0],
        [p.longRun, 0],
        [p.longRun, p.depth],
        [p.depth, p.depth],
        [p.depth, p.returnRun],
        [0, p.returnRun],
      ],
    },
  })
  return out
}
