import type { Apartment, Entity, Kind } from './schema.ts'
import type { V3 } from './math.ts'

/** One fitted L-shaped kitchen, including the appliance housings and finish panels.
 * Dimensions are a coordinated proposal inside the traced shell, not a shop drawing.
 */
export function kitchenInteriors(a: Apartment): Entity[] {
  const ceiling = a.objects.find((o) => o.roomId === 'kitchen' && o.kind === 'Ceiling')
  if (!ceiling) throw new Error('Для встроенной кухни нужна отметка чистового потолка.')
  const ceilingY = ceiling.position[1], mezzanineY = 2300, scribe = 50
  if (ceilingY <= mezzanineY + scribe) throw new Error('Недостаточная высота верхнего яруса кухни.')
  const result: Entity[] = []
  const object = (id: string, kind: Kind, position: V3, size: V3, extra: Partial<Entity> = {}) => {
    result.push({
      id: `auto-kitchen-${id}`, name: id, kind, roomId: 'kitchen', position, size,
      rotation: [0, 0, 0], material: 'paint', evidence: 'assumed',
      note: 'Единый встроенный гарнитур: согласованные фасады, цоколь и верхняя линия. Размеры предварительные; ниши, вентиляцию, крепления и открывания согласовать по обмеру и паспортам техники.',
      ...extra,
    })
  }
  const west = { rotation: [0, 90, 0] as V3 }
  const panel = (id: string, position: V3, size: V3, material = 'paint') =>
    object(id, 'Countertop', position, size, { material, params: { fixture: 'joineryPanel' } })
  const base = { cabinetPlinth: 100 }
  const tall = { cabinetPlinth: 100, cabinetTopScribe: scribe, cabinetTopTier: ceilingY - scribe - mezzanineY }
  const upperHeight = ceilingY - mezzanineY

  // The corner is a fixed return. It does not pretend to offer a door behind
  // another run. The accessible north bays are a dishwasher and a sink base.
  object('Нижний ряд 1', 'KitchenCabinet', [350, 0, 3150], [600, 870, 600], {
    name: 'Глухой нижний угол гарнитура', params: { ...base, fixture: 'blindCorner' },
  })
  object('Корпус посудомойки', 'KitchenCabinet', [950, 0, 3150], [600, 870, 600], {
    params: { ...base, cabinetVoids: [{ bottom: 0, height: 870 }] },
    note: 'Открытая монтажная ниша ПММ: без дна и фасада корпуса. Прибор на ножках; столешница опирается на боковины. Финальное крепление и сервис по выбранной модели.',
  })
  object('Посудомойка', 'Appliance', [950, 0, 3160], [595, 867, 580], {
    params: { appliance: 'dishwasher', integrated: true, cabinetPlinth: 100 },
    note: 'Встроенная ПММ за общим мебельным фасадом; соседняя с мойкой секция. Типоразмер условный, подключение и открывание по паспорту.',
  })
  object('Нижний ряд 3', 'KitchenCabinet', [1550, 0, 3150], [600, 870, 600], {
    params: { ...base, fixture: 'sinkBase' },
    note: 'Предложение открывания: петли слева при взгляде на мойку, ось X1251,5 мм по внешней кромке фасада. Правая навеска при 90° задевает северный стул; модель фурнитуры и фактическую кинематику подтвердить до производства.',
  })
  object('Боковой ряд 1', 'KitchenCabinet', [350, 0, 3850], [800, 870, 600], {
    ...west, name: 'Широкая секция под варочной панелью', params: { ...base, cabinetDoors: 2 },
  })
  object('Боковой ряд 3', 'KitchenCabinet', [350, 0, 4450], [400, 870, 600], {
    ...west, name: 'Рабочая секция между плитой и колоннами',
    params: { ...base, cabinetDoors: 1, cabinetVoids: [{ bottom: 180, height: 380, front: false }] },
    note: 'Предложение сервисной секции: за открываемым фасадом оставлен доступ через задник на отметках 180–560 мм к E05/E06. Этот объём не считается хранением; полки его не перекрывают. Задний зазор 50 мм, подключения, разъёмы, изгибы кабелей и съёмную защиту проверить по паспортам.',
  })
  object('Столешница A', 'Countertop', [950, 870, 3150], [1800, 30, 600], {
    material: 'stone', params: { sinkCutout: { center: [600, 10], size: [470, 410] } },
  })
  object('Столешница B', 'Countertop', [350, 870, 4050], [600, 30, 1200], { material: 'stone' })
  object('Варочная панель', 'Countertop', [350, 900, 3850], [480, 12, 550], {
    material: 'ink', params: { fixture: 'hob' },
    note: 'Варочная панель перенесена на широкую секцию: от её края до высокой колонны 525 мм. Проверить монтажные и тепловые отступы выбранной модели.',
  })
  object('Мойка', 'Sink', [1550, 785, 3160], [500, 123, 440], {
    material: 'white', params: { fixture: 'dropInSink' },
  })
  object('Смеситель', 'Shower', [1550, 900, 2930], [180, 350, 200], {
    material: 'metal', params: { fixture: 'kitchenTap' },
  })

  // Low-height work-zone cupboards remain shallow. The deeper mezzanine starts
  // above head height and joins the tall units in one continuous front plane.
  object('Глухой верхний угол', 'Wardrobe', [350, 1550, 3025], [600, 750, 350], {
    name: 'Фиксированный верхний угол', params: { fixture: 'blindCorner' },
  })
  object('Возврат верхнего угла', 'Wardrobe', [225, 1550, 3325], [250, 750, 350], {
    ...west, params: { fixture: 'blindCorner' },
  })
  object('Верхний шкаф', 'Wardrobe', [1250, 1550, 3025], [1200, 750, 350], {
    params: { cabinetDoors: 2 },
  })
  object('Корпус скрытой вытяжки', 'Wardrobe', [225, 1550, 3850], [800, 750, 350], {
    ...west, params: { cabinetDoors: 2, cabinetVoids: [{ bottom: 0, height: 750, front: false }] },
    note: 'Скрытая вытяжка и сервисный объём за общим фасадом. Эта секция не считается свободным хранением; канал и доступ уточняются после обмера.',
  })
  object('Вытяжка', 'Appliance', [220, 1553, 3850], [560, 120, 280], {
    ...west, material: 'metal', params: { fixture: 'extractorHood' },
    note: 'Компактный вкладыш скрыт за мебельным фасадом. Над ним зарезервирован сервисный объём до потолка; диаметр, трасса и режим вытяжки не выдуманы.',
  })
  object('Верхний шкаф после вытяжки', 'Wardrobe', [225, 1550, 4450], [400, 750, 350], {
    ...west, params: { cabinetDoors: 1 },
  })
  object('Антресоль угловая', 'Wardrobe', [350, mezzanineY, 3150], [600, upperHeight, 600], {
    params: { fixture: 'blindCorner', cabinetTopScribe: scribe },
  })
  object('Антресоль северная', 'Wardrobe', [1250, mezzanineY, 3150], [1200, upperHeight, 600], {
    params: { cabinetDoors: 2, cabinetTopScribe: scribe },
    note: 'Предложение открывания: обе створки на наружных петлях, ось левой X651,5 мм; навеска левой створки к середине конфликтует с трековым светом. Проверены условные повороты до 90°, окончательная фурнитура и ограничители уточняются.',
  })
  object('Антресоль над вытяжкой', 'Wardrobe', [350, mezzanineY, 3850], [800, upperHeight, 600], {
    ...west, params: { cabinetDoors: 2, cabinetTopScribe: scribe,
      cabinetVoids: [{ bottom: 0, height: upperHeight - scribe, front: false }] },
    note: 'Продолжение общего верхнего фасада. Объём за ним зарезервирован под коммуникации вытяжки, не заявлен как полезное хранение.',
  })
  // Close only the exposed overhang between the shallow lower facade (X400)
  // and upper carcass front (X631); the rear 350 mm stays open for the duct.
  panel('Подшивка над вытяжкой', [515.5, mezzanineY, 3850], [231, 18, 764])
  object('Антресоль рабочей секции', 'Wardrobe', [350, mezzanineY, 4450], [400, upperHeight, 600], {
    ...west, params: { cabinetDoors: 1, cabinetTopScribe: scribe },
  })

  object('Колонна духовки и СВЧ', 'Wardrobe', [350, 0, 5550], [600, ceilingY, 600], {
    ...west, params: { ...tall, cabinetDoors: 1,
      cabinetVoids: [{ bottom: 650, height: 600 }, { bottom: 1330, height: 400 }] },
  })
  object('Духовка', 'Appliance', [360, 653, 5550], [595, 594, 580], {
    ...west, material: 'ink', params: { appliance: 'oven', builtIn: true },
    note: 'Духовка вынесена к открытому торцу гарнитура. За условно опущенным фасадом проверено свободное место 500 × 500 мм; точные открывание, установка и вентиляция зависят от выбранного прибора.',
  })
  object('Микроволновка', 'Appliance', [360, 1333, 5550], [595, 394, 580], {
    ...west, material: 'ink', params: { appliance: 'microwave', builtIn: true },
  })
  object('Колонна холодильника', 'Wardrobe', [350, 0, 4950], [600, ceilingY, 600], {
    ...west, params: { ...tall, cabinetDoors: 1, cabinetVoids: [{ bottom: 100, height: 1950 }] },
  })
  object('Холодильник', 'Appliance', [360, 0, 4950], [595, 2047, 580], {
    ...west, params: { appliance: 'fridge', integrated: true, cabinetPlinth: 100 },
    note: 'Встроенный холодильник за мебельным фасадом в общей колонне. Ниша и воздушный путь предварительные; выбрать модель и проверить вентиляционные сечения, петли и извлечение.',
  })

  // Continuous toe-kick strips sit in front of the individual recessed supports.
  panel('Общий цоколь северный', [950, 0, 3401], [1800, 100, 18])
  panel('Общий цоколь западный', [601, 0, 4630], [18, 100, 2440])
  panel('Торец нижнего ряда', [1859, 0, 3150], [18, 900, 600])
  panel('Торец навесного ряда', [1859, 1550, 3025], [18, 750, 350])
  panel('Торец антресоли', [1859, mezzanineY, 3150], [18, upperHeight, 600])
  panel('Торец колонн', [325, 0, 5859], [650, ceilingY, 18])
  panel('Фартук северный', [950, 900, 2854], [1800, 650, 8], 'stone')
  panel('Фартук западный', [54, 900, 3754], [8, 650, 1792], 'stone')
  return result
}
