import type { Apartment, Entity, Kind } from './schema.ts'
import type { V3 } from './math.ts'
import { applyGeneratedInteriors } from './auto-design.ts'

/** A furnishing proposal inside the separately traced source architecture. */
export function generateSourceInteriors(input: Apartment): Apartment {
  const a = structuredClone(input),
    proposal: Entity[] = []
  const object = (
    roomId: string,
    id: string,
    kind: Kind,
    position: V3,
    size: V3,
    material = 'oak',
    extra: Partial<Entity> = {},
  ) => {
    proposal.push({
      id: `auto-${roomId}-${id}`,
      name: id,
      roomId,
      kind,
      position,
      size,
      rotation: [0, 0, 0],
      material,
      evidence: 'assumed',
      note: 'Автоматическое предложение интерьера; не утверждено и не для заказа мебели.',
      ...extra,
    })
  }
  object('bedroom', 'Кровать', 'Bed', [1100, 0, -2590], [1600, 950, 2100], 'linen', {
    rotation: [0, 90, 0],
  })
  object('bedroom', 'Шкаф', 'Wardrobe', [1150, 0, -470], [2200, 2550, 600], 'paint', {
    rotation: [0, 180, 0],
    params: { cabinetDoors: 4 },
  })
  object('bedroom', 'Тумба 1', 'Table', [270, 0, -3590], [400, 450, 350])
  object('bedroom', 'Тумба 2', 'Table', [270, 0, -1590], [400, 450, 350])
  object('bedroom', 'ТВ', 'Countertop', [3135, 1050, -2590], [1400, 800, 40], 'ink', {
    rotation: [0, -90, 0], params: { fixture: 'mediaScreen' },
  })
  object('bedroom', 'Панно', 'Countertop', [20, 1250, -2590], [1000, 1050, 25], 'oak', {
    rotation: [0, 90, 0], params: { fixture: 'artwork' },
  })
  object('bedroom', 'Ковёр', 'Countertop', [1500, 2, -2590], [2500, 10, 2200], 'rug', { params: { fixture: 'rug' } })
  object('hall', 'Шкаф у входа', 'Wardrobe', [3860, 0, 2212], [1300, 2400, 350], 'paint', {
    name: 'Неглубокий шкаф для обуви и хранения',
    rotation: [0, 180, 0],
    params: { cabinetDoors: 3 },
  })
  object('hall', 'Зеркало', 'GlassPartition', [3750, 850, 750], [800, 1400, 15], 'mirror')
  object('hall', 'Банкетка', 'Table', [3750, 0, 1030], [800, 450, 330], 'sage', { params: { fixture: 'bench' } })
  // Two non-overlapping rectangular worktops form the L; the oven replaces one cabinet.
  for (let i = 0; i < 3; i++)
    object(
      'kitchen',
      `Нижний ряд ${i + 1}`,
      'KitchenCabinet',
      [350 + i * 600, 0, 3150],
      [600, 870, 600],
      'oak',
      i === 0 ? { params: { fixture: 'blindCorner' }, name: 'Глухой кухонный угол · без заявленного доступа' } : i === 2 ? { params: { fixture: 'sinkBase' } } : {},
    )
  for (let i = 0; i < 3; i++)
    if (i !== 1)
      object(
        'kitchen',
        `Боковой ряд ${i + 1}`,
        'KitchenCabinet',
        [350, 0, 3750 + i * 600],
        [600, 870, 600],
        'oak',
        { rotation: [0, 90, 0] },
      )
  object('kitchen', 'Столешница A', 'Countertop', [950, 870, 3150], [1800, 30, 600], 'stone', {
    params: { sinkCutout: { center: [600, 10], size: [470, 410] } },
  })
  object('kitchen', 'Столешница B', 'Countertop', [350, 870, 4350], [600, 30, 1800], 'stone')
  object('kitchen', 'Духовка', 'Appliance', [350, 0, 4350], [590, 870, 580], 'ink', {
    rotation: [0, 90, 0],
    params: { appliance: 'oven' },
  })
  object('kitchen', 'Варочная панель', 'Countertop', [350, 900, 4350], [480, 12, 550], 'ink', { params: { fixture: 'hob' } })
  object('kitchen', 'Мойка', 'Sink', [1550, 785, 3160], [500, 123, 440], 'white', { params: { fixture: 'dropInSink' } })
  object('kitchen', 'Смеситель', 'Shower', [1550, 900, 2930], [180, 350, 200], 'metal', { params: { fixture: 'kitchenTap' } })
  object('kitchen', 'Вытяжка', 'Appliance', [225, 1550, 4350], [600, 800, 400], 'paint', {
    rotation: [0, 90, 0], params: { fixture: 'extractorHood' },
    note: 'Кандидат: размеры, высоту над панелью, подключение и доступ проверить по паспортам оборудования.',
  })
  object('kitchen', 'Холодильник', 'Appliance', [350, 0, 5650], [650, 2100, 650], 'white', {
    rotation: [0, 90, 0],
    params: { appliance: 'fridge' },
  })
  object('kitchen', 'Верхний шкаф', 'Wardrobe', [950, 1550, 3020], [1600, 950, 300], 'paint', {
    params: { cabinetDoors: 3 },
  })
  object('living', 'Обеденный стол', 'Table', [1900, 0, 4550], [800, 750, 800], 'oak', { params: { fixture: 'roundTable' } })
  object('living', 'Стул 1', 'Sofa', [2101, 0, 3932], [460, 820, 460], 'linen', {
    rotation: [0, -18, 0], params: { fixture: 'diningChair' },
  })
  object('living', 'Стул 2', 'Sofa', [1765, 0, 5186], [460, 820, 460], 'linen', {
    rotation: [0, 168, 0], params: { fixture: 'diningChair' },
  })
  object('living', 'Диван', 'Sofa', [2710, 0, 7700], [2300, 820, 900], 'sage', {
    rotation: [0, -90, 0],
  })
  object('living', 'Ковёр', 'Countertop', [1650, 2, 7700], [2500, 12, 2500], 'rug', { params: { fixture: 'rug' } })
  object('living', 'Журнальный стол', 'Table', [1480, 0, 7700], [650, 370, 800], 'oak', { params: { fixture: 'roundTable' } })
  object('living', 'ТВ-тумба', 'Wardrobe', [210, 120, 7700], [1600, 360, 350], 'oak', {
    rotation: [0, 90, 0],
  })
  object('living', 'ТВ', 'Countertop', [80, 980, 7700], [1450, 850, 45], 'ink', {
    rotation: [0, 90, 0], params: { fixture: 'mediaScreen' },
  })
  object('living', 'Панно', 'Countertop', [3180, 1250, 7700], [1000, 1100, 30], 'oak', {
    rotation: [0, -90, 0], params: { fixture: 'artwork' },
  })
  object('living', 'Рабочий стол', 'Table', [350, 0, 9000], [1200, 750, 600], 'oak', {
    rotation: [0, 90, 0],
  })
  object('living', 'Монитор', 'Countertop', [190, 750, 9000], [650, 500, 240], 'ink', {
    rotation: [0, 90, 0], params: { fixture: 'monitor' },
  })
  object('living', 'Рабочее кресло', 'Sofa', [1040, 0, 9000], [600, 900, 600], 'linen', {
    rotation: [0, -90, 0], params: { fixture: 'officeChair' },
  })
  object('loggia', 'Скамья', 'Table', [275, 0, -4747], [800, 450, 450], 'sage', {
    rotation: [0, 90, 0], params: { fixture: 'bench' },
  })
  object('loggia', 'Кофейный столик', 'Table', [950, 0, -5030], [350, 450, 300], 'oak', { params: { fixture: 'roundTable' } })
  for (const [r, x, z] of [
    ['bedroom', 1600, -2590],
    ['hall', 3300, 1700],
    ['kitchen', 1000, 4200],
    ['living', 1600, 7700],
    ['loggia', 1500, -4750],
  ] as const) {
    object(r, 'Основной свет', 'TrackLight', [x, 2730, z], [1000, 120, 80], 'ink', {
      params: { lumens: 1400, group: 'general', color: '#fff0da' },
    })
  }
  object('living', 'Подвес над столом', 'Pendant', [1900, 1600, 4550], [350, 1250, 350], 'paint', {
    params: { lumens: 700, group: 'accent' },
  })
  object('bedroom', 'Подвес', 'Pendant', [270, 2000, -1590], [200, 850, 200], 'paint', {
    params: { lumens: 450, group: 'accent' },
  })
  // These two source-plan labels share one continuous floor, without a wall.
  // Keep their documented contours while allowing furniture across that seam.
  const result = applyGeneratedInteriors(a, proposal, { living: ['living', 'kitchen'] })
  result.revision = Math.max(result.revision, 11)
  return result
}
