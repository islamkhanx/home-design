import { deg, pointInPolygon } from './math.ts'
import type { V2, V3 } from './math.ts'
import type { Apartment, DesignStyle, Entity, Kind, MaterialDef, Room, WallFace } from './schema.ts'
import { wallFaceForRoom } from './wall-finishes.ts'

export type MaterialFinish = Partial<Omit<MaterialDef, 'id' | 'name' | 'color'>> &
  Pick<MaterialDef, 'color'>
export type DesignReference = { title: string; studio: string; url: string; lesson: string }
export type DesignFeatures = {
  walls: string
  furniture: string
  lighting: string
  materials: string
}
type EntityParams = NonNullable<Entity['params']>
export type DesignConcept = {
  id: string
  designStyle: DesignStyle
  label: string
  description: string
  swatches: string[]
  lighting: { preset: 'day' | 'evening' | 'clean'; label: string }
  features: DesignFeatures
  reference?: DesignReference
  materials: Record<string, MaterialFinish>
  roomMaterials?: Record<string, Record<string, MaterialFinish>>
  featureMaterial: MaterialFinish
  treatment: NonNullable<EntityParams['treatment']>
  panelWidth: number
  panelDepth: number
  panelParts: number
  panelBottom?: number
  panelHeight?: number
  panelGap?: number
  panelFocus?: 'dining' | 'media' | 'artwork'
  wallLight?: boolean
  panelLighting?: {
    layout: 'underline' | 'flanks' | 'outline'
    rooms?: string[]
    lumensPerMeter?: number
    color?: string
  }
  color: string
  kelvin?: number
  generalLumens: number
  accentLumens: number
  generalKind: 'TrackLight' | 'Pendant' | 'Spotlight'
  generalSize: V3
  fixtureMaterial?: string
  accentSize?: V2
  furnitureForms?: Partial<Record<Kind, EntityParams['furnitureForm']>>
  cabinetFace?: EntityParams['cabinetFace']
  lightForm?: EntityParams['lightForm']
  accentLightForm?: EntityParams['lightForm']
  scene?: (apartment: Apartment, room: Room, materials: ReadonlyMap<string, string>) => void
}
export type StudyRoom = Room & { polygon: V2[] }
export type ChangeSummary = {
  furniture: number
  lighting: number
  wallPanels: number
  materials: number
}
export type PanelPlacement = {
  id: string
  wallId: string
  face: WallFace
  offset: number
  width: number
  bottom: number
  height: number
  depth: number
}
type WallEntity = Entity & { wall: NonNullable<Entity['wall']> }
type Envelope = Pick<Entity, 'position' | 'rotation' | 'size'>
type Box = { min: V3; max: V3; corners: V2[] }
const architectureKinds = new Set<Kind>([
  'Wall',
  'Floor',
  'Ceiling',
  'Door',
  'Window',
  'Socket',
  'Switch',
])
const furnitureKinds = new Set<Kind>([
  'Sofa',
  'Bed',
  'Table',
  'Wardrobe',
  'KitchenCabinet',
  'Shelf',
])
const fixtureKinds = new Set<Kind>(['TrackLight', 'Pendant', 'Spotlight'])

function withoutFinishes({ material, materialOverrides, ...object }: Entity) {
  return { ...object, ...(object.wall ? { wall: { ...object.wall, materials: undefined } } : {}) }
}

export function architecturalSnapshot(apartment: Apartment) {
  const { schemaVersion, id, units, documentedArea, sourcePlan, rooms } = apartment
  const objects = apartment.objects.filter(
    (o) => architectureKinds.has(o.kind) || o.id === 'source-service-strip',
  )
  return {
    schemaVersion,
    id,
    units,
    documentedArea,
    sourcePlan,
    rooms,
    objects: objects.map(withoutFinishes),
  }
}

export function sceneGeometrySnapshot(apartment: Apartment) {
  return { ...apartment, materials: undefined, objects: apartment.objects.map(withoutFinishes) }
}

const degrees = (n: number) => (n * 180) / Math.PI
const round = (n: number) => Math.round(n * 1000) / 1000
function wallFrame(object: WallEntity, face: WallFace) {
  const angle = deg(object.rotation[1]),
    c = Math.cos(angle),
    s = Math.sin(angle)
  const transform = ([x, z]: V2): V2 => [
    object.position[0] + c * x + s * z,
    object.position[2] - s * x + c * z,
  ]
  const start = transform(object.wall.start),
    end = transform(object.wall.end)
  const length = Math.hypot(end[0] - start[0], end[1] - start[1])
  const along: V2 = [(end[0] - start[0]) / length, (end[1] - start[1]) / length]
  const sign = face === 'left' ? 1 : -1
  const inward: V2 = [-along[1] * sign, along[0] * sign]
  return {
    start,
    along,
    length,
    rotation: degrees(Math.atan2(inward[0], inward[1])),
    at: (offset: number, depth: number): V2 => [
      start[0] + along[0] * offset + inward[0] * depth,
      start[1] + along[1] * offset + inward[1] * depth,
    ],
  }
}

export function entityBox(object: Envelope): Box {
  const angle = deg(object.rotation[1]),
    c = Math.cos(angle),
    s = Math.sin(angle)
  const [x, y, z] = object.position,
    [width, height, depth] = object.size
  const corners = [-width / 2, width / 2].flatMap((dx) =>
    [-depth / 2, depth / 2].map((dz): V2 => [x + c * dx + s * dz, z - s * dx + c * dz]),
  )
  return {
    min: [Math.min(...corners.map((p) => p[0])), y, Math.min(...corners.map((p) => p[1]))],
    max: [Math.max(...corners.map((p) => p[0])), y + height, Math.max(...corners.map((p) => p[1]))],
    corners,
  }
}

function intersects(a: Box, b: Box, margin = 0) {
  return a.min.every(
    (minimum, axis) => minimum < b.max[axis] + margin && a.max[axis] > b.min[axis] - margin,
  )
}

function withinRoom(object: Envelope, room: StudyRoom) {
  return entityBox(object).corners.every((point) => pointInPolygon(point, room.polygon))
}

function subtract(intervals: V2[], start: number, end: number): V2[] {
  return intervals.flatMap(([a, b]) => {
    if (end <= a || start >= b) return [[a, b]]
    const remainder: V2[] = [
      [a, Math.min(b, start)],
      [Math.max(a, end), b],
    ]
    return remainder.filter(([x, y]) => y - x > 1)
  })
}

function roomWallIntervals(
  wall: WallEntity,
  frame: ReturnType<typeof wallFrame>,
  room: StudyRoom,
  depth: number,
) {
  const roomOffsets = room.polygon.map((point) => {
    const offset =
      (point[0] - frame.start[0]) * frame.along[0] + (point[1] - frame.start[1]) * frame.along[1]
    return Math.max(0, Math.min(frame.length, offset))
  })
  const cuts = [...new Set([0, frame.length, ...roomOffsets])].sort((a, b) => a - b)
  let intervals = cuts
    .slice(1)
    .map((end, i): V2 => [cuts[i], end])
    .filter(([a, b]) =>
      pointInPolygon(frame.at((a + b) / 2, wall.wall.thickness / 2 + depth + 3), room.polygon),
    )
  for (const opening of wall.wall.openings)
    intervals = subtract(intervals, opening.offset - 100, opening.offset + opening.width + 100)
  return intervals.map(([a, b]): V2 => [a + 100, b - 100]).filter(([a, b]) => b - a >= 500)
}

/** Size the panel on a solid room-facing wall span, clear of openings and furnishings. */
export function featurePanels(
  source: Apartment,
  room: StudyRoom,
  concept: DesignConcept,
  materialId: string,
  overrides: Record<string, string>,
) {
  const artwork = source.objects.find(
    (o) => o.roomId === room.id && o.params?.fixture === 'artwork',
  )
  const targetFixture =
    concept.panelFocus === 'dining'
      ? 'roundTable'
      : concept.panelFocus === 'media'
        ? 'mediaScreen'
        : 'artwork'
  const preferred = source.objects.find(
    (o) =>
      o.roomId === room.id &&
      o.params?.fixture === targetFixture &&
      (concept.panelFocus !== 'dining' || o.size[1] >= 650),
  )
  const focus =
    preferred?.position ??
    artwork?.position ??
    source.objects.find(
      (o) =>
        o.roomId === room.id && ((o.kind === 'Sofa' && !o.params?.fixture) || o.kind === 'Bed'),
    )?.position ??
    room.interiorCamera?.target
  const obstacles = source.objects.filter(
    (o) =>
      (o.roomId === room.id || o.sharedWith?.includes(room.id)) &&
      o.visible !== false &&
      !['Wall', 'Floor', 'Ceiling', 'RoomLabel', 'DimensionLine'].includes(o.kind) &&
      o.params?.fixture !== 'artwork',
  )
  const ceiling =
    source.objects.find((o) => o.roomId === room.id && o.kind === 'Ceiling')?.position[1] ??
    room.height ??
    2850
  const candidates: Array<{
    wall: WallEntity
    face: WallFace
    frame: ReturnType<typeof wallFrame>
    offset: number
    envelope: Envelope
    score: number
  }> = []
  for (const wall of source.objects.filter(
    (o): o is WallEntity => !!o.wall && o.visible !== false,
  )) {
    const face = wallFaceForRoom(wall, room)
    if (!face || source.rooms.some((r) => r.id !== room.id && wallFaceForRoom(wall, r) === face))
      continue
    const frame = wallFrame(wall, face),
      depth = concept.panelDepth
    for (const [a, b] of roomWallIntervals(wall, frame, room, depth)) {
      const target = focus
        ? (focus[0] - frame.start[0]) * frame.along[0] +
          (focus[2] - frame.start[1]) * frame.along[1]
        : (a + b) / 2
      const maximumWidth = Math.min(concept.panelWidth, b - a)
      const bottom = Math.max(0, Math.min(concept.panelBottom ?? 1000, ceiling - 1100))
      const height = Math.min(concept.panelHeight ?? 1650, ceiling - bottom - 200)
      if (height < 200) continue
      const widths = concept.reference
        ? [maximumWidth, maximumWidth * 0.75, maximumWidth * 0.5, 500]
        : [maximumWidth]
      for (const width of widths.filter((w) => w >= 500)) {
        const start = a + width / 2,
          end = b - width / 2
        const centred = Math.max(start, Math.min(end, target))
        const offsets = concept.reference
          ? [...new Set([centred, start, (start + end) / 2, end])]
          : [centred]
        for (const offset of offsets) {
          const position = frame.at(offset, wall.wall.thickness / 2 + depth / 2 + 3)
          const envelope: Envelope = {
            position: [position[0], bottom, position[1]],
            rotation: [0, frame.rotation, 0],
            size: [width, height, depth],
          }
          if (!withinRoom(envelope, room)) continue
          const box = entityBox(envelope)
          if (obstacles.some((o) => intersects(box, entityBox(o), o.electrical ? 75 : 10))) continue
          const distance = focus ? Math.hypot(position[0] - focus[0], position[1] - focus[2]) : 0
          candidates.push({ wall, face, frame, offset, envelope, score: width - distance * 3 })
        }
      }
    }
  }
  candidates.sort((a, b) => b.score - a.score)
  const chosen = candidates[0]
  const objects: Entity[] = [],
    placements: PanelPlacement[] = []
  if (!chosen)
    return {
      objects,
      placements,
      removedArtworkIds: [],
      message: 'Для панелей не нашлось свободного места с нужными зазорами.',
    }
  const [envelopeWidth, envelopeHeight, depth] = chosen.envelope.size
  const panelLighting = concept.panelLighting
  const layout =
    !panelLighting?.rooms || panelLighting.rooms.includes(room.id)
      ? panelLighting?.layout
      : undefined
  const underline = layout === 'underline' || layout === 'outline'
  const flanks = layout === 'flanks' || layout === 'outline'
  const profileWidth = 12,
    profileDepth = Math.min(depth, 14),
    profileGap = 9,
    reservation = profileWidth + profileGap
  const width = envelopeWidth - (flanks ? reservation * 2 : 0)
  const gap = concept.panelGap ?? 90
  const count = Math.max(1, Math.min(concept.panelParts, Math.floor((width + gap) / (500 + gap))))
  const spacing = count > 1 ? gap : 0
  const panelWidth = (width - (count - 1) * spacing) / count
  const bottom = chosen.envelope.position[1] + (underline ? reservation : 0),
    height = envelopeHeight - (underline ? reservation : 0)
  for (let i = 0; i < count; i++) {
    const offset = chosen.offset - width / 2 + panelWidth / 2 + i * (panelWidth + spacing)
    const at = chosen.frame.at(offset, chosen.wall.wall.thickness / 2 + depth / 2 + 3)
    const id = `concept-${room.id}-${concept.id}-wall-${i + 1}`
    objects.push({
      id,
      name: `${concept.label} · стеновая композиция ${i + 1}`,
      roomId: room.id,
      kind: 'WallPanel',
      position: [round(at[0]), bottom, round(at[1])],
      rotation: [0, round(chosen.frame.rotation), 0],
      size: [round(panelWidth), height, depth],
      material: materialId,
      materialOverrides: overrides,
      evidence: 'assumed',
      generated: true,
      note: `Предложение ${concept.label}. Накладная отделка на стене ${chosen.wall.id}, сторона ${chosen.face}.`,
      params: { designStyle: concept.designStyle, treatment: concept.treatment },
    })
    placements.push({
      id,
      wallId: chosen.wall.id,
      face: chosen.face,
      offset,
      width: panelWidth,
      bottom,
      height,
      depth,
    })
  }
  const addPanelLight = ({
    id,
    name,
    offset,
    y,
    size,
    yaw,
    wallDepth,
    lumens,
    color,
  }: {
    id: string
    name: string
    offset: number
    y: number
    size: V3
    yaw: number
    wallDepth: number
    lumens: number
    color: string
  }) => {
    const at = chosen.frame.at(offset, chosen.wall.wall.thickness / 2 + wallDepth)
    const fixture: Entity = {
      id: `concept-${room.id}-${concept.id}-wall-light-${id}`,
      name: `${concept.label} · ${name}`,
      roomId: room.id,
      kind: 'LEDStrip',
      position: [round(at[0]), y, round(at[1])],
      rotation: [0, round(chosen.frame.rotation + yaw), 0],
      size,
      material: overrides.light ?? 'light',
      materialOverrides: overrides,
      evidence: 'assumed',
      generated: true,
      note: 'Предложение акцентного света. Питание и монтаж требуют проекта.',
      params: { designStyle: concept.designStyle, group: 'accent', lumens, color },
    }
    const box = entityBox(fixture)
    if (
      withinRoom(fixture, room) &&
      !obstacles.some((o) => intersects(box, entityBox(o), o.electrical ? 75 : 10))
    )
      objects.push(fixture)
  }

  // Reserve the diffuser and its shadow joint inside the already checked wall envelope.
  // Horizontal profiles wash the wall below. Uprights share the same outward orientation as seams.
  const profileFace = depth + 3 - profileDepth / 2
  const profileColor = panelLighting?.color ?? concept.color
  const profilePower = (length: number) =>
    Math.round((length / 1000) * (panelLighting?.lumensPerMeter ?? 165))
  if (underline) {
    const length = round(envelopeWidth - 0.5)
    addPanelLight({
      id: 'underline',
      name: 'нижняя световая линия',
      offset: chosen.offset,
      y: chosen.envelope.position[1],
      size: [length, profileWidth, profileDepth],
      yaw: 0,
      wallDepth: profileFace,
      lumens: profilePower(length),
      color: profileColor,
    })
  }
  if (flanks) {
    const edgeInset = (envelopeWidth - profileWidth) / 2 - 0.25
    for (const side of [-1, 1]) {
      addPanelLight({
        id: side < 0 ? 'left' : 'right',
        name: 'боковая световая линия',
        offset: chosen.offset + side * edgeInset,
        y: bottom,
        size: [profileDepth, height, profileWidth],
        yaw: -90,
        wallDepth: profileFace,
        lumens: profilePower(height),
        color: profileColor,
      })
    }
  }
  if ((concept.wallLight ?? concept.id === 'hitech') && spacing >= 42 && height > 300) {
    for (let i = 1; i < count; i++) {
      const offset = chosen.offset - width / 2 + i * panelWidth + (i - 0.5) * spacing
      addPanelLight({
        id: String(i),
        name: 'световой шов',
        offset,
        y: bottom + 80,
        size: [12, height - 160, 24],
        yaw: -90,
        wallDepth: depth + 8,
        lumens: 320,
        color: concept.color,
      })
    }
  }
  const envelope = entityBox(chosen.envelope)
  const removedArtworkIds = source.objects
    .filter(
      (o) =>
        o.roomId === room.id &&
        o.params?.fixture === 'artwork' &&
        intersects(entityBox(o), envelope, 80),
    )
    .map((o) => o.id)
  return {
    objects,
    placements,
    removedArtworkIds,
    message: 'Стеновая композиция размещена с учётом проёмов, мебели и электрических точек.',
  }
}

function styleFixture(
  object: Entity,
  apartment: Apartment,
  room: StudyRoom,
  concept: DesignConcept,
  materialIds: ReadonlyMap<string, string>,
) {
  const top = object.position[1] + object.size[1],
    general = object.params?.group !== 'accent'
  const style = concept.designStyle
  const accentDimensions =
    concept.accentSize ??
    (style === 'japandi'
      ? [500, 500]
      : style === 'classic'
        ? [450, 360]
        : style === 'hitech'
          ? [450, 120]
          : [360, 360])
  const proposedSize: V3 = general
    ? [...concept.generalSize]
    : [accentDimensions[0], object.size[1], accentDimensions[1]]
  const replacement: Entity = {
    ...object,
    kind: general ? concept.generalKind : object.kind,
    position: [object.position[0], top - proposedSize[1], object.position[2]],
    size: proposedSize,
  }
  const box = entityBox(replacement)
  const blocked = apartment.objects.some(
    (o) =>
      o.roomId === room.id &&
      o.visible !== false &&
      (furnitureKinds.has(o.kind) || o.kind === 'Appliance') &&
      intersects(box, entityBox(o), 10),
  )
  if (!blocked && withinRoom(replacement, room) && (!general || replacement.position[1] >= 2100))
    Object.assign(object, replacement)
  const fixtureMaterial =
    concept.fixtureMaterial ??
    (style === 'classic' ? 'metal' : style === 'japandi' ? 'light' : 'ink')
  object.material = materialIds.get(fixtureMaterial) ?? object.material
  object.materialOverrides = { ...object.materialOverrides, ...Object.fromEntries(materialIds) }
  object.params = {
    ...object.params,
    designStyle: style,
    color: concept.color,
    lumens: general ? concept.generalLumens : concept.accentLumens,
  }
  const lightForm = general ? concept.lightForm : (concept.accentLightForm ?? concept.lightForm)
  if (object.kind === 'Pendant' && lightForm) object.params.lightForm = lightForm
}

export function applyConceptComposition(
  apartment: Apartment,
  room: StudyRoom,
  concept: DesignConcept,
  materialIds: ReadonlyMap<string, string>,
  featureId: string,
) {
  const overrides = Object.fromEntries(materialIds)
  let furniture = 0,
    lighting = 0
  for (const object of apartment.objects) {
    if (
      object.roomId !== room.id ||
      room.id === 'bathroom' ||
      object.sharedWith?.includes('bathroom')
    )
      continue
    if (furnitureKinds.has(object.kind)) {
      object.params = { ...object.params, designStyle: concept.designStyle }
      const form = concept.furnitureForms?.[object.kind]
      if (form) object.params.furnitureForm = form
      if (concept.cabinetFace && (object.kind === 'Wardrobe' || object.kind === 'KitchenCabinet'))
        object.params.cabinetFace = concept.cabinetFace
      furniture++
    }
    if (fixtureKinds.has(object.kind)) {
      styleFixture(object, apartment, room, concept, materialIds)
      lighting++
    }
  }
  const panels = featurePanels(apartment, room, concept, featureId, overrides)
  apartment.objects = apartment.objects.filter((o) => !panels.removedArtworkIds.includes(o.id))
  apartment.objects.push(...panels.objects)
  concept.scene?.(apartment, room, new Map([...materialIds, ['feature', featureId]]))
  const roomDecor = apartment.objects.filter(
    (o) => o.roomId === room.id && o.id.startsWith(`concept-${room.id}-${concept.id}-`),
  )
  const wallPanels = roomDecor.filter((o) => o.kind === 'WallPanel').length
  lighting += roomDecor.filter((o) => o.kind === 'LEDStrip' || fixtureKinds.has(o.kind)).length
  furniture += roomDecor.filter((o) => furnitureKinds.has(o.kind)).length
  return {
    changeSummary: { furniture, lighting, wallPanels },
    conceptPlacements: panels.placements,
    changes: [
      `Стены: ${concept.features.walls}`,
      `Мебель: ${concept.features.furniture}`,
      `Свет: ${concept.features.lighting}`,
      `Материалы: ${concept.features.materials}`,
      panels.message,
    ],
    removedArtworkIds: panels.removedArtworkIds,
  }
}
