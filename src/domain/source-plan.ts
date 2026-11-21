import type { Apartment, Entity, Kind } from './schema.ts'
import type { V2, Opening } from './math.ts'
import { parseApartment } from './schema.ts'

// Manual trace of page 2 rendered at 3200 × 2261 px. The 2400 mm label spans
// the WINDOW opening (1673…1877), not the apartment. Areas never calibrate scale.
export const PLAN_SCALE = 2400 / 204
export const planPoint = ([x, z]: V2): V2 => [
  Math.round((x - 1625) * PLAN_SCALE),
  Math.round((z - 790) * PLAN_SCALE),
]
export const SOURCE_RINGS: Record<string, V2[]> = {
  bathroom: [
    [1625, 790],
    [1783, 790],
    [1783, 995],
    [1625, 995],
  ],
  bedroom: [
    [1625, 447],
    [1898, 447],
    [1898, 850],
    [1792, 850],
    [1792, 781],
    [1625, 781],
  ],
  loggia: [
    [1625, 344],
    [1898, 344],
    [1898, 429],
    [1625, 429],
  ],
  hall: [
    [1792, 860],
    [1898, 860],
    [1898, 853],
    [2021, 853],
    [2021, 995],
    [1792, 995],
  ],
  kitchen: [
    [1625, 1030],
    [1770, 1030],
    [1770, 1004],
    [1792, 1004],
    [1792, 1300],
    [1625, 1300],
  ],
  living: [
    [1792, 995],
    [1898, 995],
    [1898, 1612],
    [1625, 1612],
    [1625, 1300],
    [1792, 1300],
  ],
}
const NOTE =
  'Контур оцифрован со стр. 2 исходного PDF; масштаб по окну 2400 мм. Линейные размеры приближённые, не обмер. Высота оболочки 3000 мм — визуализация нижней границы из договора; потолок 2850 мм — предложение.'

export function restoreSourcePlan(input: Apartment, bathroom: Entity[]): Apartment {
  const a = structuredClone(input)
  for (const m of [
    { id: 'floor-oak', name: 'Пол · светлый дуб · предложение', color: '#c3a780', roughness: 0.74, metalness: 0, surface: 'oak' as const },
    { id: 'ceiling-white', name: 'Потолок · матовый белый', color: '#f5f3ee', roughness: 0.95, metalness: 0 },
  ]) {
    const i = a.materials.findIndex(existing => existing.id === m.id)
    if (i < 0) a.materials.push(m)
    else a.materials[i] = m
  }
  a.objects = []
  a.revision = 6
  a.sourcePlan = {
    id: 'arena-city-life-b-103',
    page: 2,
    sha256: 'bea0beb32603f61c47fea157e034215b6dd7afac5b4393c0d5966e5f33de7f3d',
    method: 'manual-raster-trace',
    referenceLengthMm: 2400,
    referencePixels: 204,
    note: 'Raster 3200 × 2261; anchor x=1673…1877, origin (1625,790). Rounded to 1 mm for data representation only; no millimeter accuracy claim.',
  }
  a.notes = [
    'Площади проверены на страницах 1–2 исходного PDF. Лоджия 3,10 / учётная 1,55 м²; итог 45,99 м².',
    NOTE,
    'Ревизия 4 отозвана. Ревизия 6 восстанавливает вытянутую планировку с боковым входом, лоджией за спальней и открытой кухней-нишей.',
    'Ванна / тумба / WC / колонна A3, материалы M1 / T1 / Д2 сохранены; привязки адаптированы к приближённому контуру. Свет G1/G2 — предложение; ночного света нет.',
    'Полотенцесушитель выбран; место и модель не выбраны. Инженерия, монтаж, чистовая высота, точные проёмы и комплектация требуют обмера.',
    'Схема в договоре и отдельный PDF имеют разные подписи площадей; для этого эскиза использован явно присланный отдельный PDF, а не смесь двух схем.',
  ]
  a.generation = {
    generator: 'source-plan-interior',
    version: 2,
    label: 'Интерьер сгенерирован автоматически',
    note: NOTE,
  }
  const entity = (id: string, roomId: string, kind: Kind, extra: Partial<Entity>): Entity => {
    const o: Entity = {
      id,
      name: id,
      kind,
      roomId,
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      size: [1, 1, 1],
      material: 'paint',
      evidence: 'assumed',
      note: NOTE,
      ...extra,
    }
    a.objects.push(o)
    return o
  }
  for (const r of a.rooms) {
    r.polygon = SOURCE_RINGS[r.id].map(planPoint)
    r.height = 3000
    r.evidence = 'assumed'
    r.note = NOTE
    delete r.generated
    delete r.interiorCamera
    const xs = r.polygon.map((p) => p[0]),
      zs = r.polygon.map((p) => p[1]),
      w = Math.max(...xs) - Math.min(...xs),
      d = Math.max(...zs) - Math.min(...zs)
    entity(r.id === 'bathroom' ? 'floor' : `source-${r.id}-floor`, r.id, 'Floor', {
      name: `Пол · ${r.name}`,
      size: [w, 70, d],
      surface: { polygon: r.polygon, thickness: 70 },
      material: ['bathroom', 'loggia'].includes(r.id) ? 'stone' : 'floor-oak',
    })
    entity(r.id === 'bathroom' ? 'ceiling' : `source-${r.id}-ceiling`, r.id, 'Ceiling', {
      name: `Потолок · ${r.name}`,
      position: [0, 2850, 0],
      size: [w, 30, d],
      surface: { polygon: r.polygon, thickness: 30 },
      cutaway: true,
      material: 'ceiling-white',
    })
  }
  function wall(
    id: string,
    roomId: string,
    from: V2,
    to: V2,
    thickness: number,
    sharedWith: string[] = [],
    cutaway = false,
    openings: Opening[] = [],
    material = 'paint',
  ) {
    const start = planPoint(from),
      end = planPoint(to)
    entity(id, roomId, 'Wall', {
      name: `Стена · ${id}`,
      size: [Math.hypot(end[0] - start[0], end[1] - start[1]), 3000, thickness],
      material,
      wall: { start, end, thickness, height: 3000, openings },
      sharedWith,
      cutaway,
    })
    for (const q of openings)
      entity(q.id, roomId, q.kind === 'door' ? 'Door' : 'Window', {
        name: q.kind === 'door' ? 'Дверной проём' : 'Оконный проём',
        size: [q.width, q.height, 40],
        attach: { wallId: id, openingId: q.id },
        sharedWith,
        cutaway,
        ...(q.kind === 'door' ? { params: { doorAngle: 0 } } : {}),
      })
  }
  const door = (id: string, offset: number, width = 900): Opening => ({
    id,
    kind: 'door',
    offset,
    width,
    bottom: 0,
    height: 2300,
  })
  // Source structural envelope: red monolith = 250 mm, interior blocks = 100 mm.
  wall('source-loggia-west', 'loggia', [1614.375, 333.375], [1614.375, 438], 250)
  wall('source-bedroom-west', 'bedroom', [1614.375, 438], [1614.375, 785.75], 250)
  wall('wall-west', 'bathroom', [1614.375, 785.75], [1614.375, 999.25], 250, [], false, [], 'stone')
  wall('source-kitchen-west', 'kitchen', [1614.375, 999.25], [1614.375, 1300], 250)
  wall('source-living-west', 'living', [1614.375, 1300], [1614.375, 1622.625], 250)
  wall('source-loggia-east', 'loggia', [1908.625, 333.375], [1908.625, 438], 250, [], true)
  wall('source-bedroom-east', 'bedroom', [1908.625, 438], [1908.625, 845], 250, [], true)
  wall('source-living-east', 'living', [1908.625, 1005.625], [1908.625, 1622.625], 250, [], true)
  wall(
    'source-loggia-glazing',
    'loggia',
    [1614.375, 333.375],
    [1908.625, 333.375],
    250,
    [],
    false,
    [
      {
        id: 'window-courtyard',
        kind: 'window',
        offset: Math.round((1673 - 1614.375) * PLAN_SCALE),
        width: 2400,
        bottom: 0,
        height: 2700,
      },
    ],
  )
  wall(
    'source-living-glazing',
    'living',
    [1614.375, 1622.625],
    [1908.625, 1622.625],
    250,
    [],
    true,
    [
      {
        id: 'window-living',
        kind: 'window',
        offset: Math.round((1665 - 1614.375) * PLAN_SCALE),
        width: 2400,
        bottom: 500,
        height: 2200,
      },
    ],
  )
  // Glazed screen and access from bedroom to loggia. Widths here are trace estimates.
  wall('source-loggia-access', 'bedroom', [1625, 438], [1898, 438], 200, ['loggia'], false, [
    {
      id: 'window-bedroom',
      kind: 'window',
      offset: Math.round((1698 - 1625) * PLAN_SCALE),
      width: 1250,
      bottom: 500,
      height: 2200,
    },
    door('door-loggia', Math.round((1810 - 1625) * PLAN_SCALE), 800),
  ])
  wall(
    'wall-north',
    'bathroom',
    [1625, 785.75],
    [1787.25, 785.75],
    100,
    ['bedroom'],
    false,
    [],
    'stone',
  )
  wall(
    'wall-east',
    'bathroom',
    [1787.25, 785.75],
    [1787.25, 999.25],
    100,
    ['hall'],
    true,
    [door('door', Math.round((866 - 785.75) * PLAN_SCALE))],
    'stone',
  )
  wall(
    'wall-south',
    'bathroom',
    [1625, 999.25],
    [1787.25, 999.25],
    100,
    ['kitchen'],
    true,
    [],
    'stone',
  )
  wall('source-bedroom-entry', 'bedroom', [1787.25, 855], [1898, 855], 100, ['hall'], true, [
    door('door-bedroom', 150),
  ])
  wall('source-hall-north', 'hall', [1908.625, 848.75], [2025.25, 848.75], 100)
  wall('source-entry', 'hall', [2025.25, 848.75], [2025.25, 1005.625], 100, [], true, [
    door('door-entry', 300, 1050),
  ])
  wall('source-hall-south', 'hall', [1908.625, 1005.625], [2025.25, 1005.625], 250, [], true)
  // Service strip shown below the bathroom. No invented wall between kitchen and living.
  const serviceStart = planPoint([1625, 1004]),
    serviceEnd = planPoint([1770, 1030])
  entity('source-service-strip', 'kitchen', 'Countertop', {
    name: 'Инженерная зона по схеме · детализация нужна',
    position: [(serviceStart[0] + serviceEnd[0]) / 2, 0, (serviceStart[1] + serviceEnd[1]) / 2],
    size: [serviceEnd[0] - serviceStart[0], 3000, serviceEnd[1] - serviceStart[1]],
    cutaway: true,
  })
  // Preserve selected bathroom component dimensions/materials; adjust edge anchoring only.
  const [bw, bd] = planPoint([1783, 995])
  for (const old of bathroom) {
    const o = structuredClone(old)
    o.position[2] = Math.round((old.position[2] * bd) / 2470)
    if (['bathtub', 'screen'].includes(o.id)) {
      o.position[0] += Math.round((bw - 1800) / 2)
      o.position[2] = old.position[2]
    }
    if (['laundry-tower', 'washer'].includes(o.id)) {
      o.position[0] = bw - 335
      o.position[2] = o.id === 'washer' ? bd - o.size[2] / 2 - 67 : bd - o.size[2] / 2
    }
    if (o.kind === 'Spotlight') o.position[1] = 2780
    o.note =
      'Выбранная композиция A3/M1/T1/Д2. Привязки адаптированы к оцифрованному контуру, требуют обмера.'
    delete o.sharedWith
    delete o.generated
    a.objects.push(o)
  }
  const cameras: Record<
    string,
    { position: [number, number, number]; target: [number, number, number] }
  > = {
    bathroom: { position: [1050, 1600, 1650], target: [500, 1150, 600] },
    bedroom: { position: [2750, 1600, -1000], target: [900, 1150, -2600] },
    // Stay west of the open balcony door; look down enough to include both seats and floor.
    loggia: { position: [1950, 1600, -4700], target: [300, 800, -4750] },
    // Look across the entrance toward the mirror and bench from the clear circulation area.
    hall: { position: [2200, 1600, 2250], target: [3800, 1150, 1000] },
    kitchen: { position: [1800, 1600, 5800], target: [800, 1200, 3250] },
    living: { position: [1600, 1600, 9250], target: [2100, 1200, 6900] },
  }
  for (const r of a.rooms) r.interiorCamera = cameras[r.id]
  return parseApartment(a)
}
