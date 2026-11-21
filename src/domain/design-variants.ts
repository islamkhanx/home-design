import { parseApartment } from './schema.ts'
import type { Apartment, Entity, Kind, MaterialDef, WallFace } from './schema.ts'
import {
  applyConceptComposition,
  architecturalSnapshot,
  sceneGeometrySnapshot,
} from './design-composition.ts'
import type {
  ChangeSummary,
  DesignConcept,
  DesignFeatures,
  MaterialFinish,
  PanelPlacement,
  StudyRoom,
} from './design-composition.ts'
import { DESIGN_STUDIES } from './design-studies.ts'
import { wallFaceForRoom } from './wall-finishes.ts'

const finish = (
  color: string,
  surface: MaterialDef['surface'] = 'plain',
  roughness = 0.8,
  metalness = 0,
  extra: Partial<MaterialFinish> = {},
) => ({ color, surface, roughness, metalness, ...extra })
const LEGACY_CONCEPTS: DesignConcept[] = [
  {
    id: 'loft',
    designStyle: 'loft',
    label: 'Лофт',
    description:
      'Кирпичная композиция на бетонной стене, тёмное дерево, металл и низкая мягкая мебель.',
    swatches: ['#a66b4b', '#99948b', '#4c382c'],
    lighting: { preset: 'day', label: 'Дневной свет + тёплый трек 3000 K' },
    features: {
      walls: 'Кирпич над диваном + фактурный бетон',
      furniture: 'Стальные рамы, тёмное дерево, низкий диван',
      lighting: 'Чёрный трек и промышленный подвес · 3000 K',
      materials: 'Кирпич / бетон / дымчатый дуб / тёмный металл',
    },
    materials: {
      paint: finish('#b5afa5', 'concrete', 0.94),
      oak: finish('#70523b', 'oak', 0.68),
      'floor-oak': finish('#99958b', 'concrete', 0.92),
      linen: finish('#605b54'),
      sage: finish('#9b6645'),
      rug: finish('#8e8475'),
      stone: finish('#a6a19a', 'concrete'),
      metal: finish('#272827', 'plain', 0.48, 0.8),
      ink: finish('#242625', 'plain', 0.48, 0.3),
      light: finish('#fff1d5', 'plain', 0.6, 0, { emissive: '#ffd9a1', emissiveIntensity: 1 }),
    },
    featureMaterial: finish('#ae7556', 'brick', 0.94),
    treatment: 'flat',
    panelWidth: 2700,
    panelDepth: 24,
    panelParts: 1,
    color: '#ffd8a5',
    kelvin: 3000,
    generalLumens: 1900,
    accentLumens: 550,
    generalKind: 'TrackLight',
    generalSize: [1400, 170, 150],
  },
  {
    id: 'hitech',
    designStyle: 'hitech',
    label: 'Хай-тек',
    description:
      'Графитовая композиция крупных панелей, линейный свет, лаконичная мебель и холодный металл.',
    swatches: ['#e8e9e8', '#424c57', '#aab8c2'],
    lighting: { preset: 'day', label: 'Дневной свет + линейные светильники 4000 K' },
    features: {
      walls: 'Три крупные графитовые панели и световые швы',
      furniture: 'Тонкие фасады без ручек, прямые линии, металл',
      lighting: 'Линейный потолочный свет + вертикальные акценты · 4000 K',
      materials: 'Сатинированные панели / светлый камень / хром',
    },
    materials: {
      paint: finish('#e4e7e8', 'plaster', 0.82),
      oak: finish('#d7dcdd', 'plain', 0.26, 0.15),
      'floor-oak': finish('#c7cbca', 'stone', 0.47, 0, { tileSize: [1.2, 1.2] }),
      linen: finish('#a8b1b8', 'plain', 0.83),
      sage: finish('#727f8a', 'plain', 0.82),
      rug: finish('#bdc2c4'),
      stone: finish('#e7e9e7', 'stone', 0.27),
      metal: finish('#aab8c2', 'plain', 0.16, 1),
      ink: finish('#20262d', 'plain', 0.24, 0.35),
      light: finish('#f2f7ff', 'plain', 0.3, 0, { emissive: '#e1ecff', emissiveIntensity: 1 }),
    },
    featureMaterial: finish('#424c57', 'plain', 0.36, 0.3),
    treatment: 'flat',
    panelWidth: 2500,
    panelDepth: 28,
    panelParts: 3,
    color: '#e5efff',
    kelvin: 4000,
    generalLumens: 2100,
    accentLumens: 700,
    generalKind: 'TrackLight',
    generalSize: [1500, 90, 100],
  },
  {
    id: 'classic',
    designStyle: 'classic',
    label: 'Тёплая классика',
    description: 'Рамочные стеновые панели, мебель с филёнками, мягкая обивка, орех и латунь.',
    swatches: ['#e4d9c6', '#77503a', '#b39052'],
    lighting: { preset: 'day', label: 'Дневной свет + люстра 2700 K' },
    features: {
      walls: 'Три объёмные рамки-молдинга на тёплой штукатурке',
      furniture: 'Филёнки, выразительные опоры и мягкие формы',
      lighting: 'Многорожковая люстра и классический подвес · 2700 K',
      materials: 'Штукатурка / орех / сливочная ткань / латунь',
    },
    materials: {
      paint: finish('#e7dfd1', 'plaster', 0.88),
      oak: finish('#76523b', 'oak', 0.48),
      'floor-oak': finish('#ae8961', 'oak', 0.62),
      linen: finish('#d9cdb6'),
      sage: finish('#cfc3ab'),
      rug: finish('#bcaa8c'),
      stone: finish('#e2d8c4', 'stone', 0.38),
      metal: finish('#b49255', 'plain', 0.25, 0.85),
      ink: finish('#4b392d', 'plain', 0.45, 0.2),
      light: finish('#fff0cf', 'plain', 0.68, 0, { emissive: '#ffd39a', emissiveIntensity: 1 }),
    },
    featureMaterial: finish('#dfd2ba', 'plaster', 0.82),
    treatment: 'moulding',
    panelWidth: 2600,
    panelDepth: 36,
    panelParts: 3,
    color: '#ffd0a0',
    kelvin: 2700,
    generalLumens: 1800,
    accentLumens: 600,
    generalKind: 'Pendant',
    generalSize: [650, 500, 650],
  },
  {
    id: 'japandi',
    designStyle: 'japandi',
    label: 'Джапанди',
    description:
      'Вертикальные дубовые рейки, песочная штукатурка, низкая мебель и большой бумажный подвес.',
    swatches: ['#dfd1b7', '#bf9f70', '#b5b39b'],
    lighting: { preset: 'day', label: 'Дневной свет + мягкий подвес 3000 K' },
    features: {
      walls: 'Реечная дубовая композиция на песочной штукатурке',
      furniture: 'Низкие спокойные формы и округлые деревянные опоры',
      lighting: 'Большой рассеивающий подвес · 3000 K',
      materials: 'Светлый дуб / штукатурка / лён / бумажный рассеиватель',
    },
    materials: {
      paint: finish('#e4d9c5', 'plaster', 0.95),
      oak: finish('#bea078', 'oak', 0.78),
      'floor-oak': finish('#c9ad85', 'oak', 0.82),
      linen: finish('#d6cbb7'),
      sage: finish('#b2b69c'),
      rug: finish('#c8b99c'),
      stone: finish('#d0c6b2', 'plaster', 0.92),
      metal: finish('#5d5a4f', 'plain', 0.6, 0.3),
      ink: finish('#514d42', 'plain', 0.7, 0.1),
      light: finish('#fff0d2', 'plain', 0.9, 0, { emissive: '#ffe2b7', emissiveIntensity: 1 }),
    },
    featureMaterial: finish('#bb9b6e', 'oak', 0.78),
    treatment: 'slats',
    panelWidth: 2300,
    panelDepth: 42,
    panelParts: 1,
    color: '#ffddb2',
    kelvin: 3000,
    generalLumens: 1600,
    accentLumens: 500,
    generalKind: 'Pendant',
    generalSize: [620, 650, 620],
  },
]

type Palette = Record<string, string>
type FinishVariant = {
  id: string
  category: 'reference' | 'palette'
  label: string
  description: string
  swatches: string[]
  palette: Palette
  lighting: DesignConcept['lighting']
  features: DesignFeatures
  reference?: undefined
}
type ConceptVariant = DesignConcept & { category: 'concept'; palette: Palette }
export type DesignVariant = FinishVariant | ConceptVariant
export const DEFAULT_DESIGN_VARIANTS = ['current', 'loft', 'hitech', 'classic']
export const FEATURED_DESIGN_STUDIES = ['atelier-walnut', 'walnut-after-dark', 'graphite-bronze']
export const REFERENCE_DESIGN_DEFAULTS = ['current', ...FEATURED_DESIGN_STUDIES]
export const DESIGN_CONCEPTS: ConceptVariant[] = [...LEGACY_CONCEPTS, ...DESIGN_STUDIES].map(
  (concept) => ({
    ...concept,
    category: 'concept',
    palette: Object.fromEntries(
      Object.entries(concept.materials).map(([id, material]) => [id, material.color]),
    ),
  }),
)
const daylight = { preset: 'day', label: 'Дневной свет' } as const
const paletteFeatures = {
  walls: 'Только оттенок краски',
  furniture: 'Та же форма мебели',
  lighting: 'Без изменений',
  materials: 'Только палитра',
}
export const DESIGN_VARIANTS: DesignVariant[] = [
  {
    id: 'current',
    category: 'reference',
    label: 'Текущий проект',
    description: 'Текущая отделка, мебель и свет.',
    swatches: ['#e7e4dc', '#ad8b62', '#87917c'],
    palette: {},
    lighting: daylight,
    features: {
      walls: 'Текущая отделка',
      furniture: 'Текущая мебель',
      lighting: 'Текущий дневной сценарий',
      materials: 'Материалы исходного проекта',
    },
  },
  ...DESIGN_CONCEPTS,
  {
    id: 'warm',
    category: 'palette',
    label: 'Тёплый лён',
    description: 'Молочные стены, светлый дуб и песочный текстиль.',
    swatches: ['#eee8dc', '#b8956d', '#c8b59b'],
    palette: {
      paint: '#eee8dc',
      oak: '#b8956d',
      'floor-oak': '#cfb593',
      linen: '#d5c8b5',
      sage: '#c8b59b',
      rug: '#e3d7c3',
      stone: '#ded5c4',
    },
    lighting: daylight,
    features: paletteFeatures,
  },
  {
    id: 'contrast',
    category: 'palette',
    label: 'Глубокий шалфей',
    description: 'Зелёный текстиль, дымчатый дуб и серо-бежевые стены.',
    swatches: ['#d8d5ce', '#957759', '#536457'],
    palette: {
      paint: '#d8d5ce',
      oak: '#957759',
      'floor-oak': '#b69e7c',
      linen: '#b8b7aa',
      sage: '#536457',
      rug: '#c9c3b5',
      stone: '#c8c5ba',
    },
    lighting: daylight,
    features: paletteFeatures,
  },
]

export function allowedVariants(room: string) {
  return room === 'bathroom' ? ['current'] : DESIGN_VARIANTS.map((v) => v.id)
}

const finishKinds = new Set<Kind>([
  'Floor',
  'KitchenCabinet',
  'Wardrobe',
  'Shelf',
  'Table',
  'Sofa',
  'Bed',
  'Countertop',
])
const wallSides: WallFace[] = ['left', 'right']
const asJson = (value: unknown) => JSON.stringify(value)

function createMaterialCopies(
  apartment: Apartment,
  originalMaterials: ReadonlyMap<string, MaterialDef>,
  variant: DesignVariant,
  scope: string,
  finishes: Record<string, MaterialFinish>,
  changedMaterials: Array<{ from: string; to: string }>,
) {
  const ids = new Map<string, string>()
  for (const [from, finish] of Object.entries(finishes)) {
    const original = originalMaterials.get(from)
    // A product photograph retains its reference finish.
    if (!original || original.texture) continue
    const id = `design-${scope}-${variant.id}-${from}`
    const definition: MaterialDef = {
      ...original,
      ...finish,
      id,
      name: `${original.name} · ${variant.label}`,
    }
    if (finish.surface && finish.surface !== original.surface && !finish.tileSize)
      delete definition.tileSize
    apartment.materials.push(definition)
    ids.set(from, id)
    changedMaterials.push({ from, to: id })
  }
  return ids
}

function styleFurniture(object: Entity, variant: DesignVariant, materials: Map<string, string>) {
  const integratedFront =
    variant.category === 'concept' && object.kind === 'Appliance' && object.params?.integrated
  if (
    object.id === 'source-service-strip' ||
    object.sharedWith?.includes('bathroom') ||
    (!finishKinds.has(object.kind) && !integratedFront)
  )
    return
  object.materialOverrides = { ...object.materialOverrides, ...Object.fromEntries(materials) }
  object.material = materials.get(object.material) ?? object.material
}

/** Prepare an independent preview and its design report. The same model feeds Three and Cycles. */
export function createDesignStudy(source: Apartment, variantId: string, roomId = 'all') {
  const variant = DESIGN_VARIANTS.find((v) => v.id === variantId)
  if (!variant) throw new Error('Неизвестный вариант оформления.')
  if (roomId === 'bathroom' && variant.id !== 'current')
    throw new Error('Подтверждённая отделка санузла защищена: доступен текущий проект.')
  const modelRooms = source.rooms.filter((r): r is StudyRoom => !!r.polygon)
  const rooms =
    roomId === 'all'
      ? modelRooms.filter((r) => r.id !== 'bathroom')
      : modelRooms.filter((r) => r.id === roomId)
  if (!rooms.length) throw new Error('Выберите помещение с геометрией из текущей модели.')

  // Apartment is JSON data. This also accepts a Vue proxy without transferring it to structuredClone.
  const apartment = JSON.parse(asJson(source)) as Apartment
  const changedMaterials: Array<{ from: string; to: string }> = []
  const retainedWallFaces: Array<{
    wallId: string
    face: WallFace
    sharedWith: string[]
    reason: string
  }> = []
  const changeSummary: ChangeSummary = { furniture: 0, lighting: 0, wallPanels: 0, materials: 0 }
  const conceptPlacements: PanelPlacement[] = []
  const removedArtworkIds: string[] = []
  const changes =
    variant.category === 'reference'
      ? ['Исходный проект.']
      : variant.category === 'palette'
        ? ['Предложение по отделке и палитре.']
        : []

  if (variant.category !== 'reference') {
    const originals = new Map(source.materials.map((material) => [material.id, material]))
    const finishes =
      variant.category === 'concept'
        ? variant.materials
        : Object.fromEntries(
            Object.entries(variant.palette).map(([from, color]) => [from, { color }]),
          )
    const sharedMaterials = createMaterialCopies(
      apartment,
      originals,
      variant,
      roomId,
      finishes,
      changedMaterials,
    )
    const materialsByRoom = new Map(
      rooms.map((room) => {
        const overrides = variant.category === 'concept' && variant.roomMaterials?.[room.id]
        const localFinishes = overrides && Object.fromEntries(
          Object.entries(overrides).map(([id, finish]) => [id, { ...finishes[id], ...finish }]),
        )
        const roomMaterials = localFinishes
          ? new Map([
              ...sharedMaterials,
              ...createMaterialCopies(
                apartment,
                originals,
                variant,
                roomId === room.id ? `${room.id}-local` : room.id,
                localFinishes,
                changedMaterials,
              ),
            ])
          : sharedMaterials
        return [room.id, roomMaterials]
      }),
    )

    for (const object of apartment.objects) {
      if (!object.wall) {
        const materials = materialsByRoom.get(object.roomId)
        if (materials?.size) styleFurniture(object, variant, materials)
        continue
      }
      const adjacentRooms = modelRooms.map((room) => ({
        room,
        face: wallFaceForRoom(object, room),
      }))
      for (const face of wallSides) {
        const adjacent = adjacentRooms
          .filter((entry) => entry.face === face)
          .map((entry) => entry.room)
        if (!adjacent.length) continue
        const original = object.wall.materials?.[face] ?? object.material
        const replacements = adjacent.map((room) => materialsByRoom.get(room.id)?.get(original))
        const proposed = replacements.find((id) => !!id)
        if (!proposed) continue
        if (replacements.every((id) => id === proposed)) {
          object.wall.materials = { ...object.wall.materials, [face]: proposed }
        } else {
          retainedWallFaces.push({
            wallId: object.id,
            face,
            sharedWith: adjacent.filter((room) => room.id !== roomId).map((room) => room.id),
            reason: 'Для непрерывной поверхности нескольких комнат сохранена исходная отделка.',
          })
        }
      }
    }

    if (variant.category === 'concept') {
      const featureId = `design-${roomId}-${variant.id}-feature`
      apartment.materials.push({
        roughness: 0.8,
        metalness: 0,
        ...variant.featureMaterial,
        id: featureId,
        name: `${variant.label} · акцентная поверхность`,
      })
      for (const room of rooms) {
        const composition = applyConceptComposition(
          apartment,
          room,
          variant,
          materialsByRoom.get(room.id)!,
          featureId,
        )
        changeSummary.furniture += composition.changeSummary.furniture
        changeSummary.lighting += composition.changeSummary.lighting
        changeSummary.wallPanels += composition.changeSummary.wallPanels
        changes.push(...composition.changes)
        conceptPlacements.push(...composition.conceptPlacements)
        removedArtworkIds.push(...composition.removedArtworkIds)
      }
      apartment.generation = {
        generator: apartment.generation?.generator ?? 'schema-design-concepts',
        version: apartment.generation?.version ?? 1,
        label: `${variant.label} · предложение`,
        note: variant.reference?.lesson ?? 'Концепт из схем: отделка, мебель и свет.',
      }
    }
    changeSummary.materials = apartment.materials.length - source.materials.length
  }

  const geometryUnchanged =
    asJson(sceneGeometrySnapshot(apartment)) === asJson(sceneGeometrySnapshot(source))
  if (variant.category !== 'concept' && !geometryUnchanged)
    throw new Error('Палитра изменила геометрию или параметры проекта.')
  if (asJson(architecturalSnapshot(apartment)) !== asJson(architecturalSnapshot(source)))
    throw new Error('Концепт изменил архитектуру, проёмы или электрические точки.')
  parseApartment(apartment)
  return {
    apartment,
    variant,
    retainedWallFaces,
    geometryUnchanged,
    architectureUnchanged: true,
    sceneDifferences: !geometryUnchanged,
    changes: [...new Set(changes)],
    changeSummary,
    conceptPlacements,
    removedArtworkIds,
    changedMaterials,
  }
}

export function applyDesignStudy(source: Apartment, variantId: string, roomId = 'all'): Apartment {
  return variantId === 'current' ? source : createDesignStudy(source, variantId, roomId).apartment
}
