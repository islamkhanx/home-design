import type { Apartment, Entity, Kind } from './schema.ts'
import type { V3 } from './math.ts'
import { applyGeneratedInteriors } from './auto-design.ts'
import { kitchenFinishes, kitchenInteriors } from './kitchen-interior.ts'

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
  for (const finish of kitchenFinishes)
    if (!a.materials.some(material => material.id === finish.id)) a.materials.push(structuredClone(finish))
  proposal.push(...kitchenInteriors(a))
  const diningX = 1860, diningZ = 4640
  object('living', 'Обеденный стол', 'Table', [diningX, 0, diningZ], [700, 750, 1250], 'oak', {
    params: { fixture: 'roundedTable' },
    note: 'Столешница 1250 × 700 мм со скруглёнными углами, длинная сторона вдоль прохода. Центральная опора оставляет торцы свободными для ног. Два места на торцах; устойчивость основания и точные зазоры проверить при подборе изделия.',
  })
  for (const [id, x, z] of [['Стул 1', 2060, 3925], ['Стул 2', 2050, 5260]] as const) {
    const yaw = Math.atan2(diningX - x, diningZ - z) * 180 / Math.PI
    object('living', id, 'Sofa', [x, 0, z], [460, 820, 460], 'linen', {
      rotation: [0, yaw, 0],
      params: { fixture: 'diningChair' },
      note: 'Торцевое место. Смещение стула от оси освобождает пространство перед кухней; ход отодвигания проверен на 300 мм.',
    })
  }
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
    ['loggia', 1500, -4750],
  ] as const) {
    object(r, 'Основной свет', 'TrackLight', [x, 2730, z], [1000, 120, 80], 'ink', {
      rotation: [0, r === 'kitchen' ? 90 : 0, 0],
      params: { lumens: 1400, group: 'general', color: '#fff0da' },
    })
  }
  for (const [id, x] of [['Основной свет', 2380], ['Трек у ТВ', 830]] as const) {
    object('living', id, 'TrackLight', [x, 2800, 7780], [2000, 50, 23], 'ink', {
      name: id === 'Основной свет' ? 'Трек у дивана' : id,
      rotation: [0, 90, 0],
      params: { lumens: 2160, group: 'general', color: '#ffdfbd', designStyle: 'hitech' },
      note: 'Встроенная шина 2 м, две световые вставки 3000 К. Геометрия модулей условная, ось по обмеру.',
    })
  }
  object('kitchen', 'Подсветка столешницы', 'LEDStrip', [1250, 1540, 3120], [1170, 10, 18], 'light', {
    params: { lumens: 840, group: 'general', color: '#ffdfbd' },
    note: 'Рабочая подсветка 3000 К. Положение и длины профилей по проекту верхних шкафов и вытяжки.',
  })
  object('living', 'Подсветка штор', 'LEDStrip', [1606, 2832, 9510], [2900, 18, 18], 'light', {
    params: { lumens: 1000, group: 'accent', color: '#ffd5a5' },
    note: 'Лента 2700 К в оконной нише. Полотно, профиль карниза и отступ от окна уточнить по обмеру.',
  })
  object('living', 'Подсветка ореховой панели', 'LEDStrip', [75, 2330, 7700], [1500, 15, 18], 'light', {
    rotation: [0, -90, 0],
    params: { lumens: 570, group: 'accent', color: '#ffd5a5', designStyle: 'loft' },
    note: 'Подсветка ТВ-зоны 2700 К. Окончательная ось зависит от развёртки панели и тумбы.',
  })
  object('living', 'Подвес над столом', 'Pendant', [diningX, 1600, diningZ], [350, 1250, 350], 'paint', {
    params: { lumens: 700, group: 'accent', color: '#ffdfbd' },
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
  result.revision = Math.max(result.revision, 19)
  return result
}
