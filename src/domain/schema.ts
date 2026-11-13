import { polygonArea, selfIntersects, pointInPolygon, ringsIntersect } from './math.ts'
import type { V2, V3, Opening } from './math.ts'
export const kinds = [
  'Wall',
  'Floor',
  'Ceiling',
  'Door',
  'Window',
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
  'DimensionLine',
  'RoomLabel',
] as const
export type Kind = (typeof kinds)[number]
export type Evidence = 'assumed' | 'measured' | 'manufacturer'
export interface MaterialDef {
  id: string
  name: string
  color: string
  roughness: number
  metalness: number
  surface?: 'plain' | 'oak' | 'stone'
  tileSize?: V2
  transmission?: number
  ior?: number
  emissive?: string
  emissiveIntensity?: number
  texture?: string
  normalTexture?: string
  repeat?: V2
}
export interface Entity {
  id: string
  name: string
  kind: Kind
  roomId: string
  position: V3
  rotation: V3
  size: V3
  material: string
  evidence: Evidence
  note?: string
  visible?: boolean
  cutaway?: boolean
  wall?: { start: V2; end: V2; thickness: number; height: number; openings: Opening[] }
  surface?: { polygon: V2[]; holes?: V2[][]; thickness: number }
  attach?: { wallId: string; openingId: string }
  params?: {
    doorAngle?: number
    shelves?: number
    cabinetDoors?: number
    appliance?: 'washer' | 'fridge' | 'oven' | 'dishwasher'
    lumens?: number
    color?: string
    group?: 'general' | 'mirror' | 'night'
    intensity?: number
    text?: string
    end?: V3
    measure?: { entityId: string; axis: 'x' | 'y' | 'z' }
  }
}
export interface Room {
  id: string
  name: string
  documentedArea: number
  polygon?: V2[]
  height?: number
  evidence: Evidence
  note: string
}
export interface Apartment {
  schemaVersion: 1
  id: string
  name: string
  revision: number
  units: 'mm'
  documentedArea: number
  notes: string[]
  rooms: Room[]
  materials: MaterialDef[]
  objects: Entity[]
}
function finite(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n) && Math.abs(n) <= 1e7
}
function vector(v: unknown, n: number): v is number[] {
  return Array.isArray(v) && v.length === n && v.every(finite)
}
function polygon(p: unknown): p is V2[] {
  return (
    Array.isArray(p) &&
    p.length >= 3 &&
    p.length <= 200 &&
    p.every((v) => vector(v, 2)) &&
    new Set(p.map((v) => v.join(','))).size === p.length &&
    polygonArea(p as V2[]) > 0 &&
    !selfIntersects(p as V2[])
  )
}
function slabHoles(outer: V2[], holes: V2[][]): boolean {
  for (let i = 0; i < holes.length; i++) {
    const h = holes[i]
    if (!polygon(h) || !h.every((p) => pointInPolygon(p, outer)) || ringsIntersect(h, outer))
      return false
    for (let j = 0; j < i; j++)
      if (
        ringsIntersect(h, holes[j]) ||
        pointInPolygon(h[0], holes[j]) ||
        pointInPolygon(holes[j][0], h)
      )
        return false
  }
  return true
}
export function validateApartment(input: unknown): string[] {
  const a = input as Apartment,
    errors: string[] = []
  if (
    !a ||
    a.schemaVersion !== 1 ||
    a.units !== 'mm' ||
    typeof a.name !== 'string' ||
    !Number.isInteger(a.revision)
  )
    return ['Unsupported apartment schema (version 1, millimeters required).']
  if (
    !Array.isArray(a.rooms) ||
    !Array.isArray(a.objects) ||
    !Array.isArray(a.materials) ||
    !Array.isArray(a.notes)
  )
    return ['rooms, objects, materials and notes must be arrays.']
  if ([...a.rooms, ...a.materials, ...a.objects].some((v) => !v || typeof v !== 'object'))
    return ['Invalid null or non-object record.']
  for (const list of [a.rooms, a.materials])
    if (
      new Set(list.map((v) => v.id)).size !== list.length ||
      list.some((v) => typeof v.id !== 'string' || !v.id)
    )
      errors.push('Missing or duplicate room/material ID.')
  if (!finite(a.documentedArea) || a.documentedArea <= 0 || a.revision < 0)
    errors.push('Invalid documented area or revision.')
  if (a.objects.length > 2000) errors.push('Maximum 2000 entities.')
  const ids = new Set<string>(),
    rooms = new Set(a.rooms.map((r) => r.id)),
    mats = new Set(a.materials.map((m) => m.id))
  for (const r of a.rooms) {
    if (r.polygon && !polygon(r.polygon)) errors.push(r.id + ': invalid room polygon.')
    if (!['assumed', 'measured', 'manufacturer'].includes(r.evidence))
      errors.push(r.id + ': missing dimensional provenance.')
    if (!finite(r.documentedArea) || r.documentedArea <= 0)
      errors.push(r.id + ': invalid documented area.')
  }
  for (const m of a.materials) {
    if (
      !/^#[0-9a-f]{6}$/i.test(m.color) ||
      !finite(m.roughness) ||
      m.roughness < 0 ||
      m.roughness > 1 ||
      !finite(m.metalness) ||
      m.metalness < 0 ||
      m.metalness > 1
    )
      errors.push(m.id + ': invalid material.')
    if (m.tileSize && (!vector(m.tileSize, 2) || m.tileSize.some((v) => v <= 0)))
      errors.push(m.id + ': invalid metric tile size.')
    for (const path of [m.texture, m.normalTexture])
      if (path && (!path.startsWith('/textures/') || path.includes('..')))
        errors.push(m.id + ': textures must be local /textures/ paths.')
  }
  for (const o of a.objects) {
    if (!o || typeof o.id !== 'string' || ids.has(o.id)) {
      errors.push('Missing or duplicate object ID.')
      continue
    }
    ids.add(o.id)
    if (
      !kinds.includes(o.kind) ||
      !rooms.has(o.roomId) ||
      !mats.has(o.material) ||
      typeof o.name !== 'string'
    )
      errors.push(o.id + ': unknown kind, room or material.')
    if (
      !vector(o.position, 3) ||
      !vector(o.rotation, 3) ||
      !vector(o.size, 3) ||
      o.size.some((n) => n <= 0)
    )
      errors.push(o.id + ': invalid position / rotation / size.')
    if (!['assumed', 'measured', 'manufacturer'].includes(o.evidence))
      errors.push(o.id + ': missing dimensional provenance.')
    if (o.kind === 'Wall') {
      const w = o.wall
      if (
        !w ||
        !vector(w.start, 2) ||
        !vector(w.end, 2) ||
        !finite(w.height) ||
        w.height <= 0 ||
        !finite(w.thickness) ||
        w.thickness <= 0 ||
        !Array.isArray(w.openings)
      ) {
        errors.push(o.id + ': invalid wall.')
        continue
      }
      const length = Math.hypot(w.end[0] - w.start[0], w.end[1] - w.start[1])
      if (length < 1) errors.push(o.id + ': zero wall length.')
      const openings = new Set<string>()
      for (const q of w.openings) {
        if (!q) {
          errors.push(o.id + ': null opening')
          continue
        }
        if (
          typeof q.id !== 'string' ||
          openings.has(q.id) ||
          !['door', 'window'].includes(q.kind) ||
          ![q.offset, q.width, q.bottom, q.height].every(finite) ||
          q.width <= 0 ||
          q.height <= 0 ||
          q.offset < 0 ||
          q.bottom < 0 ||
          q.offset + q.width > length + 0.01 ||
          q.bottom + q.height > w.height + 0.01
        )
          errors.push(o.id + ': invalid opening ' + q.id)
        openings.add(q.id)
      }
    }
    if (o.kind === 'Floor' || o.kind === 'Ceiling' || (o.kind === 'Countertop' && o.surface)) {
      if (
        !o.surface ||
        !polygon(o.surface.polygon) ||
        !finite(o.surface.thickness) ||
        o.surface.thickness <= 0 ||
        (o.surface.holes !== undefined &&
          (!Array.isArray(o.surface.holes) || !slabHoles(o.surface.polygon, o.surface.holes)))
      )
        errors.push(o.id + ': invalid slab polygon or holes.')
    }
    if ((o.kind === 'Door' || o.kind === 'Window') && !o.attach)
      errors.push(o.id + ': opening attachment required.')
    if (o.params?.end && !vector(o.params.end, 3))
      errors.push(o.id + ': invalid annotation endpoint.')
    if (
      o.params?.lumens !== undefined &&
      (!finite(o.params.lumens) || o.params.lumens < 0 || o.params.lumens > 100000)
    )
      errors.push(o.id + ': invalid lumens.')
    for (const k of ['doorAngle', 'shelves', 'cabinetDoors'] as const)
      if (o.params?.[k] !== undefined && !finite(o.params[k])) errors.push(o.id + ': invalid ' + k)
    for (const k of ['shelves', 'cabinetDoors'] as const)
      if (
        o.params?.[k] !== undefined &&
        (!Number.isInteger(o.params[k]) || o.params[k]! < 1 || o.params[k]! > 20)
      )
        errors.push(o.id + ': ' + k + ' must be 1–20.')
    if (o.params?.color && !/^#[0-9a-f]{6}$/i.test(o.params.color))
      errors.push(o.id + ': invalid light color.')
    if (
      o.attach &&
      vector(o.position, 3) &&
      vector(o.rotation, 3) &&
      [...o.position, ...o.rotation].some((n) => n !== 0)
    )
      errors.push(o.id + ': attached openings inherit position and rotation from the host wall.')
    if (
      o.params?.measure &&
      (!['x', 'y', 'z'].includes(o.params.measure.axis) ||
        !a.objects.some((v) => v.id === o.params!.measure!.entityId))
    )
      errors.push(o.id + ': invalid dimension reference.')
  }
  for (const o of a.objects)
    if (o.attach) {
      const w = a.objects.find((v) => v.id === o.attach!.wallId)
      const q = w?.wall?.openings.find((v) => v.id === o.attach!.openingId)
      if (
        !q ||
        (o.kind === 'Door' && q.kind !== 'door') ||
        (o.kind === 'Window' && q.kind !== 'window')
      )
        errors.push(o.id + ': attachment opening does not exist / wrong type.')
    }
  return errors
}
export function parseApartment(input: unknown): Apartment {
  const errors = validateApartment(input)
  if (errors.length) throw new Error(errors.join('\n'))
  return structuredClone(input) as Apartment
}
export function dimensionWarnings(a: Apartment): string[] {
  const result = a.rooms
    .filter((r) => r.polygon && r.evidence !== 'measured')
    .map((r) => r.name + ': размеры условные, нужны обмеры.')
  for (const r of a.rooms)
    if (r.polygon) {
      const area = polygonArea(r.polygon) / 1e6
      if (Math.abs(area - r.documentedArea) > 0.03)
        result.push(
          r.name + ': модель ' + area.toFixed(2) + ' м², исходник ' + r.documentedArea + ' м².',
        )
    }
  return result
}
