import type { Apartment, Entity, Kind } from './schema.ts'
import type { V3 } from './math.ts'
import { applyGeneratedInteriors } from './auto-design.ts'
import { kitchenInteriors } from './kitchen-interior.ts'

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
  object('bedroom', 'Шкаф', 'Wardrobe', [975, 0, -445], [1900, 2850, 650], 'paint', {
    rotation: [0, 180, 0],
    params: { cabinetDoors: 2, cabinetTopScribe: 50, cabinetTopTier: 600, cabinetDoorStyle: 'sliding' },
    note: 'Встроенный блок по существующему простенку, с раздвижными фасадами: полезная глубина около 552 мм. Доборы доводят блок до X0…1959, без прежнего выступа 291 мм в сторону входа. Фронт Z−770 и проход до кровати 1020 мм сохранены. Размеры — предложение до обмера.',
  })
  for (const [id, x, width] of [['Левый добор шкафа', 12.5, 25], ['Правый добор шкафа', 1942, 34]] as const)
    object('bedroom', id, 'Countertop', [x, 0, -438], [width, 2850, 664], 'paint', {
      params: { fixture: 'joineryPanel' }, note: 'Боковое примыкание общего встроенного блока к существующему простенку; без изменения стены.',
    })
  object('bedroom', 'Тумба 1', 'Table', [270, 0, -3590], [400, 450, 350])
  object('bedroom', 'Тумба 2', 'Table', [270, 0, -1590], [400, 450, 350])
  object('bedroom', 'ТВ', 'Countertop', [3135, 1050, -2590], [1400, 800, 40], 'ink', {
    rotation: [0, -90, 0],
    params: { fixture: 'mediaScreen' },
  })
  object('bedroom', 'Панно', 'Countertop', [20, 1250, -2590], [1000, 1050, 25], 'oak', {
    rotation: [0, 90, 0],
    params: { fixture: 'artwork' },
  })
  object('bedroom', 'Ковёр', 'Countertop', [1500, 2, -2590], [2500, 10, 2200], 'rug', {
    params: { fixture: 'rug' },
  })
  object('hall', 'Шкаф у входа', 'Wardrobe', [4237, 0, 2217], [800, 2850, 350], 'paint', {
    name: 'Единый блок прихожей · закрытое хранение',
    rotation: [0, 180, 0],
    params: { cabinetDoors: 2, cabinetTopScribe: 50, cabinetTopTier: 450, cabinetDoorStyle: 'sliding' },
    note: 'Часть общего блока с нишей, банкеткой и зеркалом. Раздвижные фасады остаются внутри габарита и не задевают ручку входной двери. Глубина 350 мм, полезная после направляющих около 252 мм — небольшие вещи и обувь поперёк полки; полноценные плечики не заявлены.',
  })
  object('hall', 'Входная ниша', 'Wardrobe', [3537, 0, 2217], [600, 2850, 350], 'paint', {
    rotation: [0, 180, 0],
    params: { cabinetDoors: 1, cabinetTopScribe: 50, cabinetVoids: [{ bottom: 0, height: 2350, keepBack: true }] },
    note: 'Открытая ниша под банкетку и зеркало; хранение только в верхней секции. Общие фасадная плоскость и верх с соседним шкафом.',
  })
  for (const [id, x, width] of [['Левый добор прихожей', 3224.5, 25], ['Правый добор прихожей', 4648, 22]] as const)
    object('hall', id, 'Countertop', [x, 0, 2227], [width, 2850, 370], 'paint', { params: { fixture: 'joineryPanel' } })
  object('hall', 'Зеркало', 'GlassPartition', [3537, 850, 2368], [500, 1250, 10], 'mirror', { rotation: [0, 180, 0] })
  object('hall', 'Банкетка', 'Table', [3537, 0, 2205], [500, 450, 310], 'sage', {
    params: { fixture: 'bench' },
    note: 'Банкетка встроена в общую нишу и не занимает сектор открывания входной двери.',
  })
  proposal.push(...kitchenInteriors(a))
  object('living', 'Обеденный стол', 'Table', [1900, 0, 4550], [800, 750, 800], 'oak', {
    params: { fixture: 'roundTable' },
  })
  object('living', 'Стул 1', 'Sofa', [2101, 0, 3932], [460, 820, 460], 'linen', {
    rotation: [0, -18, 0],
    params: { fixture: 'diningChair' },
  })
  object('living', 'Стул 2', 'Sofa', [2070, 0, 5186], [460, 820, 460], 'linen', {
    rotation: [0, 195, 0],
    params: { fixture: 'diningChair' },
    note: 'Стул развёрнут к прежнему центру стола и смещён к востоку, освобождая место перед открытой духовкой. Восточный маршрут сохраняется при отодвигании на 300 мм.',
  })
  object('living', 'Диван', 'Sofa', [2710, 0, 7700], [2300, 820, 900], 'sage', {
    rotation: [0, -90, 0],
  })
  object('living', 'Ковёр', 'Countertop', [1650, 2, 7700], [2500, 12, 2500], 'rug', {
    params: { fixture: 'rug' },
  })
  object('living', 'Журнальный стол', 'Table', [1480, 0, 7700], [650, 370, 800], 'oak', {
    params: { fixture: 'roundTable' },
  })
  object('living', 'ТВ-тумба', 'Wardrobe', [185, 120, 7700], [1500, 360, 300], 'oak', {
    rotation: [0, 90, 0],
    note: 'Ширина 1500 мм согласована с экраном 1450 мм; торец заканчивается до ножки рабочего стола, без прежнего пересечения.',
  })
  object('living', 'ТВ', 'Countertop', [80, 980, 7700], [1450, 850, 45], 'ink', {
    rotation: [0, 90, 0],
    params: { fixture: 'mediaScreen' },
  })
  object('living', 'Панно', 'Countertop', [3180, 1250, 7700], [1000, 1100, 30], 'oak', {
    rotation: [0, -90, 0],
    params: { fixture: 'artwork' },
  })
  object('living', 'Рабочий стол', 'Table', [350, 0, 9000], [1200, 750, 600], 'oak', {
    rotation: [0, 90, 0],
  })
  object('living', 'Монитор', 'Countertop', [190, 750, 9000], [650, 500, 240], 'ink', {
    rotation: [0, 90, 0],
    params: { fixture: 'monitor' },
  })
  object('living', 'Рабочее кресло', 'Sofa', [1040, 0, 9000], [600, 900, 600], 'linen', {
    rotation: [0, -90, 0],
    params: { fixture: 'officeChair' },
  })
  object('loggia', 'Скамья', 'Table', [275, 0, -4747], [800, 450, 450], 'sage', {
    rotation: [0, 90, 0],
    params: { fixture: 'bench' },
  })
  object('loggia', 'Кофейный столик', 'Table', [950, 0, -5030], [350, 450, 300], 'oak', {
    params: { fixture: 'roundTable' },
  })
  for (const [r, x, z] of [
    ['bedroom', 1600, -2590],
    ['hall', 3300, 1700],
    ['kitchen', 1200, 4200],
    ['living', 1600, 7700],
    ['loggia', 1500, -4750],
  ] as const) {
    object(r, 'Основной свет', 'TrackLight', [x, 2730, z], [1000, 120, 80], 'ink', {
      rotation: [0, r === 'kitchen' ? 90 : 0, 0],
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
  // Built-in fillers may touch a room boundary exactly. The polygon-union
  // validator allows contact while still checking the physical wall solids.
  const result = applyGeneratedInteriors(a, proposal, {
    living: ['living', 'kitchen'], bedroom: ['bedroom'], hall: ['hall'], kitchen: ['kitchen'],
  })
  result.revision = Math.max(result.revision, 14)
  return result
}
