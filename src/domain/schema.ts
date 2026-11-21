import { polygonArea, selfIntersects, pointInPolygon, ringsIntersect } from './math.ts'
import type { V2, V3, Opening } from './math.ts'
export const kinds = [
  'Socket',
  'Switch',
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
  'WallPanel',
] as const
export type Kind = (typeof kinds)[number]
export const designStyles = ['loft', 'hitech', 'classic', 'japandi'] as const
export type DesignStyle = (typeof designStyles)[number]
const materialSurfaces = ['plain', 'oak', 'stone', 'brick', 'concrete', 'plaster', 'cork', 'terrazzo', 'herringbone', 'glazed-tile', 'brushed-metal'] as const
const panelTreatments = ['flat', 'slats', 'moulding', 'arch', 'band'] as const
const furnitureForms = ['low-slung', 'open-frame', 'sculptural', 'club'] as const
const cabinetFaces = ['split', 'recessed'] as const
const lightForms = ['cluster', 'lantern', 'opal', 'ribbed', 'disc'] as const
export type Evidence = 'assumed' | 'measured' | 'manufacturer'
export type WallFace = 'left' | 'right'
export interface WallMaterials {
  /** Following start → end in plan: left is local +Z, right is local −Z. */
  left?: string
  right?: string
  /** Opening reveals, wall ends, top and bottom. Each missing finish uses Entity.material. */
  edge?: string
}
export interface MaterialDef {
  id: string
  name: string
  color: string
  roughness: number
  metalness: number
  surface?: (typeof materialSurfaces)[number]
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
  /** Scoped aliases for component subparts (bedding, timber legs, upholstery).
   * Used by presentation variants without recolouring another room. */
  materialOverrides?: Record<string, string>
  evidence: Evidence
  generated?: boolean
  electrical?: {
    wallId: string
    offset: number
    /** Extra outward distance from the wall face along side, in mm; defaults to 0. */
    surfaceOffset?: number
    side: 1 | -1
    gangs: number
    purpose: string
    controls: string[]
  }
  sharedWith?: string[]
  note?: string
  visible?: boolean
  cutaway?: boolean
  wall?: { start: V2; end: V2; thickness: number; height: number; openings: Opening[]; materials?: WallMaterials }
  surface?: { polygon: V2[]; holes?: V2[][]; thickness: number }
  attach?: { wallId: string; openingId: string }
  params?: {
    /** Optional concept geometry; absent preserves the existing design. */
    designStyle?: DesignStyle
    /** WallPanel is bottom-centred; local +Z faces the room. */
    treatment?: (typeof panelTreatments)[number]
    furnitureForm?: (typeof furnitureForms)[number]
    cabinetFace?: (typeof cabinetFaces)[number]
    lightForm?: (typeof lightForms)[number]
    fixture?: 'hygienicShower' | 'towelWarmer' | 'diningChair' | 'officeChair' | 'armchair' | 'mediaScreen' | 'monitor' | 'roundTable' | 'rug' | 'bench' | 'blindCorner' | 'sinkBase' | 'kitchenTap' | 'hob' | 'extractorHood' | 'dropInSink' | 'artwork' | 'joineryPanel'
    sinkCutout?: { center: [number, number]; size: [number, number] }
    doorAngle?: number
    shelves?: number
    cabinetDoors?: number
    cabinetTopScribe?: number
    cabinetTopTier?: number
    cabinetDoorStyle?: 'hinged' | 'sliding'
    /** Millimetres from the entity base to its recessed plinth top. */
    cabinetPlinth?: number
    /** Clear vertical niches; sides remain. front defaults to true (remove the
     * facade); false retains a furniture facade over the appliance cavity.
     * keepBack defaults to false; true retains the niche backboard. */
    cabinetVoids?: Array<{ bottom: number; height: number; front?: boolean; keepBack?: boolean }>
    builtIn?: boolean
    integrated?: boolean
    appliance?: 'washer' | 'fridge' | 'oven' | 'dishwasher' | 'microwave'
    lumens?: number
    color?: string
    group?: 'general' | 'mirror' | 'accent' | 'night'
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
  interiorCamera?: { position: V3; target: V3 }
  polygon?: V2[]
  height?: number
  evidence: Evidence
  note: string
  generated?: boolean
}
export interface Apartment {
  costPlanId?: string
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
  sourcePlan?: {
    id: string
    page: number
    sha256: string
    method: string
    referenceLengthMm: number
    referencePixels: number
    note: string
  }
  generation?: { generator: string; version: number; label: string; note: string }
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
  if (
    a.generation &&
    (typeof a.generation.generator !== 'string' ||
      !Number.isInteger(a.generation.version) ||
      typeof a.generation.label !== 'string' ||
      typeof a.generation.note !== 'string')
  )
    errors.push('Invalid generation provenance.')
  for (const r of a.rooms) {
    if (
      r.interiorCamera &&
      (!vector(r.interiorCamera.position, 3) || !vector(r.interiorCamera.target, 3))
    )
      errors.push(r.id + ': invalid interior camera.')
    if (r.polygon && !polygon(r.polygon)) errors.push(r.id + ': invalid room polygon.')
    if (!['assumed', 'measured', 'manufacturer'].includes(r.evidence))
      errors.push(r.id + ': missing dimensional provenance.')
    if (!finite(r.documentedArea) || r.documentedArea <= 0)
      errors.push(r.id + ': invalid documented area.')
  }
  for (const m of a.materials) {
    if (m.surface !== undefined && !materialSurfaces.includes(m.surface))
      errors.push(m.id + ': invalid material surface.')
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
    if (['Socket', 'Switch'].includes(o.kind)) {
      const p = o.electrical,
        host = a.objects.find((e) => e.id === p?.wallId)
      if (
        !p ||
        !host?.wall ||
        !finite(p.offset) ||
        ![1, -1].includes(p.side) ||
        !Number.isInteger(p.gangs) ||
        p.gangs < 1 ||
        p.gangs > 4 ||
        typeof p.purpose !== 'string' ||
        !Array.isArray(p.controls) ||
        p.controls.some((id) => !a.objects.some((e) => e.id === id && e.params?.lumens))
      )
        errors.push(o.id + ': invalid electrical point.')
    }
    if (o.electrical?.surfaceOffset !== undefined &&
        (!finite(o.electrical.surfaceOffset) || o.electrical.surfaceOffset < 0 || o.electrical.surfaceOffset > 500))
      errors.push(o.id + ': invalid electrical surface offset.')

    if (o.sharedWith && (!Array.isArray(o.sharedWith) || o.sharedWith.some((id) => !rooms.has(id))))
      errors.push(o.id + ': unknown shared room.')
    if (
      !kinds.includes(o.kind) ||
      !rooms.has(o.roomId) ||
      !mats.has(o.material) ||
      typeof o.name !== 'string'
    )
      errors.push(o.id + ': unknown kind, room or material.')
    if (o.materialOverrides !== undefined && (
      !o.materialOverrides || typeof o.materialOverrides !== 'object' || Array.isArray(o.materialOverrides) ||
      Object.entries(o.materialOverrides).some(([from, to]) => !mats.has(from) || typeof to !== 'string' || !mats.has(to))
    )) errors.push(o.id + ': invalid component material overrides.')
    if (
      !vector(o.position, 3) ||
      !vector(o.rotation, 3) ||
      !vector(o.size, 3) ||
      o.size.some((n) => n <= 0)
    )
      errors.push(o.id + ': invalid position / rotation / size.')
    if (!['assumed', 'measured', 'manufacturer'].includes(o.evidence))
      errors.push(o.id + ': missing dimensional provenance.')
    if (o.params?.designStyle !== undefined && !designStyles.includes(o.params.designStyle))
      errors.push(o.id + ': invalid design style.')
    if (o.params?.treatment !== undefined && (o.kind !== 'WallPanel' || !panelTreatments.includes(o.params.treatment)))
      errors.push(o.id + ': invalid wall panel treatment.')
    if (o.params?.furnitureForm !== undefined && (!['Sofa', 'Bed', 'Table'].includes(o.kind) || !furnitureForms.includes(o.params.furnitureForm)))
      errors.push(o.id + ': invalid furniture form.')
    if (o.params?.cabinetFace !== undefined && (!['KitchenCabinet', 'Wardrobe'].includes(o.kind) || !cabinetFaces.includes(o.params.cabinetFace)))
      errors.push(o.id + ': invalid cabinet face.')
    if (o.params?.lightForm !== undefined && (o.kind !== 'Pendant' || !lightForms.includes(o.params.lightForm)))
      errors.push(o.id + ': invalid pendant form.')
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
      if (w.materials !== undefined && (
        !w.materials || typeof w.materials !== 'object' || Array.isArray(w.materials) ||
        Object.entries(w.materials).some(([face, material]) =>
          !['left', 'right', 'edge'].includes(face) || typeof material !== 'string' || !mats.has(material))
      )) errors.push(o.id + ': invalid wall side material.')
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
    if (o.params?.sinkCutout) {
      const c = o.params.sinkCutout
      if (o.kind !== 'Countertop' || !vector(c.center, 2) || !vector(c.size, 2) ||
          c.size.some(n => n <= 0) || Math.abs(c.center[0]) + c.size[0] / 2 >= o.size[0] / 2 ||
          Math.abs(c.center[1]) + c.size[1] / 2 >= o.size[2] / 2)
        errors.push(o.id + ': invalid sink cutout')
    }
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
    const scribe = o.params?.cabinetTopScribe === undefined ? 0 : o.params.cabinetTopScribe
    const tier = o.params?.cabinetTopTier === undefined ? 0 : o.params.cabinetTopTier
    const plinth = o.params?.cabinetPlinth === undefined ? 0 : o.params.cabinetPlinth
    const cabinet = o.kind === 'KitchenCabinet' || o.kind === 'Wardrobe'
    if (o.params?.cabinetTopScribe !== undefined || o.params?.cabinetTopTier !== undefined ||
        o.params?.cabinetPlinth !== undefined)
      if (!finite(scribe) || !finite(tier) || !finite(plinth) || scribe < 0 || tier < 0 || plinth < 0 ||
          !vector(o.size, 3) || plinth + scribe + tier >= o.size[1])
        errors.push(o.id + ': invalid cabinet top scribe / tier.')
    if (o.params?.cabinetPlinth !== undefined &&
        (!cabinet && !(o.kind === 'Appliance' && o.params.integrated === true)))
      errors.push(o.id + ': cabinet plinth requires a cabinet or integrated appliance.')
    if (o.params?.cabinetDoorStyle !== undefined &&
        (!cabinet || !['hinged', 'sliding'].includes(o.params.cabinetDoorStyle)))
      errors.push(o.id + ': invalid cabinet door style.')
    if (o.params?.cabinetVoids !== undefined) {
      const voids = o.params.cabinetVoids
      if (!cabinet || !Array.isArray(voids) || voids.length > 8 ||
          !vector(o.size, 3) || !finite(scribe) || !finite(plinth) ||
          voids.some((v) => !v || typeof v !== 'object' || Array.isArray(v) ||
            !finite(v.bottom) || !finite(v.height) || v.bottom < 0 || v.height <= 0 ||
            v.bottom + v.height > o.size[1] - scribe ||
            (v.front !== undefined && typeof v.front !== 'boolean') ||
            (v.keepBack !== undefined && typeof v.keepBack !== 'boolean') ||
            (v.bottom !== 0 && v.bottom < plinth))) {
        errors.push(o.id + ': invalid cabinet voids.')
      } else {
        const sorted = [...voids].sort((a, b) => a.bottom - b.bottom)
        if (sorted.some((v, i) => i > 0 && v.bottom < sorted[i - 1].bottom + sorted[i - 1].height))
          errors.push(o.id + ': overlapping cabinet voids.')
      }
    }
    if (o.params?.appliance !== undefined &&
        !['washer', 'fridge', 'oven', 'dishwasher', 'microwave'].includes(o.params.appliance))
      errors.push(o.id + ': invalid appliance type.')
    for (const key of ['builtIn', 'integrated'] as const)
      if (o.params?.[key] !== undefined && typeof o.params[key] !== 'boolean')
        errors.push(o.id + ': invalid ' + key + ' flag.')
    if (o.params?.integrated === true &&
        (o.kind !== 'Appliance' || !['fridge', 'dishwasher'].includes(o.params.appliance ?? '')))
      errors.push(o.id + ': integrated fronts require a fridge or dishwasher appliance.')
    if (o.params?.builtIn === true &&
        (o.kind !== 'Appliance' || !['fridge', 'dishwasher', 'oven', 'microwave'].includes(o.params.appliance ?? '')))
      errors.push(o.id + ': built-in installation requires a supported appliance.')
    if ((o.params?.builtIn === true || o.params?.integrated === true) &&
        (!vector(o.size, 3) || !finite(plinth) || o.size[0] <= 36 || o.size[2] <= 40 || o.size[1] <= plinth))
      errors.push(o.id + ': built-in appliance is too small for its housing / plinth.')
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
