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
  object('bedroom', 'Кровать', 'Bed', [1550, 0, -2750], [1600, 950, 2100], 'linen', {
    rotation: [0, 90, 0],
  })
  object('bedroom', 'Шкаф', 'Wardrobe', [970, 0, -470], [1800, 2550, 600], 'paint', {
    params: { cabinetDoors: 4 },
  })
  object('bedroom', 'Тумба 1', 'Table', [550, 0, -3750], [400, 450, 350])
  object('bedroom', 'Тумба 2', 'Table', [550, 0, -1750], [400, 450, 350])
  object('bedroom', 'ТВ', 'Countertop', [3160, 1100, -2750], [40, 800, 1400], 'ink')
  object('bedroom', 'Ковёр', 'Countertop', [1750, 2, -2750], [2300, 10, 2200], 'rug')
  object('hall', 'Шкаф у входа', 'Wardrobe', [3910, 0, 2220], [1300, 2400, 300], 'paint', {
    rotation: [0, 180, 0],
    params: { cabinetDoors: 3 },
  })
  object('hall', 'Зеркало', 'GlassPartition', [3650, 900, 775], [700, 1400, 15], 'mirror')
  object('hall', 'Банкетка', 'Table', [3650, 0, 1030], [700, 450, 400], 'sage')
  // Two non-overlapping rectangular worktops form the L; the oven replaces one cabinet.
  for (let i = 0; i < 3; i++)
    object(
      'kitchen',
      `Нижний ряд ${i + 1}`,
      'KitchenCabinet',
      [350 + i * 600, 0, 3150],
      [600, 870, 600],
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
  object('kitchen', 'Столешница A', 'Countertop', [950, 900, 3150], [1800, 30, 600], 'stone')
  object('kitchen', 'Столешница B', 'Countertop', [350, 900, 4350], [600, 30, 1800], 'stone')
  object('kitchen', 'Духовка', 'Appliance', [350, 0, 4350], [590, 870, 580], 'ink', {
    rotation: [0, 90, 0],
    params: { appliance: 'oven' },
  })
  object('kitchen', 'Варочная панель', 'Countertop', [350, 932, 4350], [480, 12, 550], 'ink')
  object('kitchen', 'Мойка', 'Sink', [1250, 930, 3150], [500, 140, 440], 'white')
  object('kitchen', 'Холодильник', 'Appliance', [350, 0, 5650], [650, 2100, 650], 'white', {
    rotation: [0, 90, 0],
    params: { appliance: 'fridge' },
  })
  object('kitchen', 'Верхний шкаф', 'Wardrobe', [950, 1550, 3020], [1600, 950, 300], 'paint', {
    params: { cabinetDoors: 3 },
  })
  object('living', 'Обеденный стол', 'Table', [2535, 0, 4600], [850, 750, 600])
  object('living', 'Стул 1', 'Sofa', [2535, 0, 4050], [430, 700, 430], 'linen')
  object('living', 'Стул 2', 'Sofa', [2535, 0, 5150], [430, 700, 430], 'linen', {
    rotation: [0, 180, 0],
  })
  object('living', 'Диван', 'Sofa', [2690, 0, 7850], [2600, 820, 900], 'sage', {
    rotation: [0, -90, 0],
  })
  object('living', 'Ковёр', 'Countertop', [1600, 2, 7550], [2500, 12, 2700], 'rug')
  object('living', 'Журнальный стол', 'Table', [1600, 0, 7550], [650, 400, 1000])
  object('living', 'ТВ-тумба', 'Wardrobe', [210, 0, 7300], [1300, 450, 350], 'oak', {
    rotation: [0, 90, 0],
  })
  object('living', 'ТВ', 'Countertop', [35, 900, 7300], [40, 850, 1450], 'ink')
  object('living', 'Рабочий стол', 'Table', [350, 0, 9000], [1200, 750, 600], 'oak', {
    rotation: [0, 90, 0],
  })
  object('living', 'Монитор', 'Countertop', [100, 850, 9000], [35, 400, 650], 'ink')
  object('living', 'Рабочее кресло', 'Sofa', [1000, 0, 9000], [550, 780, 550], 'linen', {
    rotation: [0, 90, 0],
  })
  object('loggia', 'Низкий шкаф', 'Wardrobe', [350, 0, -4750], [500, 650, 500], 'paint')
  object('loggia', 'Кресло', 'Sofa', [1050, 0, -4750], [650, 750, 600], 'sage')
  object('loggia', 'Кофейный столик', 'Table', [1750, 0, -4750], [450, 450, 450])
  for (const [r, x, z] of [
    ['bedroom', 1600, -2700],
    ['hall', 3300, 1700],
    ['kitchen', 1000, 4200],
    ['living', 1600, 7300],
    ['loggia', 1500, -4750],
  ] as const) {
    object(r, 'Основной свет', 'TrackLight', [x, 2730, z], [1000, 120, 80], 'metal', {
      params: { lumens: 1400, group: 'general' },
    })
  }
  object('living', 'Подвес над столом', 'Pendant', [2535, 2200, 4600], [300, 500, 300], 'paint', {
    params: { lumens: 700, group: 'accent' },
  })
  object('bedroom', 'Подвес', 'Pendant', [550, 2050, -1750], [200, 650, 200], 'paint', {
    params: { lumens: 450, group: 'accent' },
  })
  return applyGeneratedInteriors(a, proposal)
}
