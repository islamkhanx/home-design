import type { Apartment, Entity } from './schema.ts'
import type { DesignSpec } from './estimate.ts'
import { number, takeoff } from './estimate.ts'
import type { DocumentSheet, DocumentTable } from './dossier.ts'
import { planSvg, planEntities } from './drawings.ts'
import { roomElectricalPoints } from './electrical.ts'
import { wallMaterialForRoom } from './wall-finishes.ts'
import { apartmentPlanSvg, roomCornersSvg, roomElevationSvg, roomSwitchingSvg, roomTileFloorSvg } from './studio-drawings.ts'

/** The reference supplies the document categories, not the apartment's design or engineering. */
export const STUDIO_REFERENCE = {
  name: 'Земстандарт · состав проекта',
  url: 'https://земстандарт.рф/sheets',
  checkedAt: '2026-11-21',
} as const
export interface StudioCoverage {
  id: string
  section: 'Техническая часть' | 'Вспомогательная информация'
  title: string
  status: 'model' | 'requires-input' | 'excluded'
  sheetIds: string[]
  missing: string[]
}
export const studioStatusLabels: Record<StudioCoverage['status'], string> = {
  model: 'Сформировано из модели',
  'requires-input': 'Требуются исходные данные',
  excluded: 'Исключено решением',
}
const MODEL = 'Предварительно · по модели'
const INPUT = 'Требуются исходные данные'
const mm = (v: number | undefined) => v === undefined ? 'Не задано' : number(v, 0)
const size = (o: Entity) => o.size.map(mm).join(' × ')
const position = (o: Entity) => o.position.map(mm).join(' / ')
const evidence = (o: {evidence: string; generated?: boolean}) => o.evidence === 'measured' ? 'Обмер в модели' : o.evidence === 'manufacturer' ? 'Паспорт изделия' : o.generated ? 'Автоматическое предложение' : 'Условная модель'
const perimeter = (ring: [number, number][] | undefined) => ring ? ring.reduce((sum, p, i) => sum + Math.hypot(p[0] - ring[(i + 1) % ring.length][0], p[1] - ring[(i + 1) % ring.length][1]), 0) / 1000 : null
const lightKinds = new Set(['Spotlight', 'TrackLight', 'Pendant', 'LEDStrip'])
const unknown = 'Не определено'

/** Adds missing studio categories while linking the detailed sheets that already exist. */
export function buildStudioDocuments(a: Apartment, spec: DesignSpec, existing: DocumentSheet[]): {sheets: DocumentSheet[]; coverage: StudioCoverage[]} {
  const sheets: DocumentSheet[] = []
  const coverage: StudioCoverage[] = []
  const add = (id: string, title: string, status: string, paragraphs: string[] = [], table?: DocumentTable, svg?: string) => {
    sheets.push({id, title, status, paragraphs, table, svg})
    return id
  }
  const pages = (id: string, title: string, headers: string[], rows: string[][], notes: string[] = [], status = MODEL, chunk = 7): string[] => {
    const ids: string[] = []
    const data = rows.length ? rows : [headers.map((_, i) => i ? '—' : 'Нет данных в модели')]
    for (let i = 0; i < data.length; i += chunk) ids.push(add(`${id}-${i / chunk + 1}`, title, status, i ? [] : notes, {headers, rows: data.slice(i, i + chunk)}))
    return ids
  }
  const refs = (...prefixes: string[]) => existing.filter(s => prefixes.some(p => s.id === p || s.id.startsWith(p + '-'))).map(s => s.id)
  const category = (id: string, title: string, sheetIds: string[], missing: string[], status: StudioCoverage['status'] = 'model') => {
    coverage.push({id, section: id.startsWith('T') ? 'Техническая часть' : 'Вспомогательная информация', title, status, sheetIds: [...new Set(sheetIds)], missing})
  }
  const roomName = (id: string) => a.rooms.find(r => r.id === id)?.name ?? id
  const material = (o: Entity) => a.materials.find(m => m.id === o.material)?.name ?? o.material
  const rooms = a.rooms.filter(r => r.polygon)
  const walls = a.objects.filter(o => o.wall)
  const electrical = a.objects.filter(o => o.electrical)
  const lights = a.objects.filter(o => lightKinds.has(o.kind) && o.params?.group !== 'night')
  const openings = walls.flatMap(wall => wall.wall!.openings.map(opening => ({wall, opening, leaf: a.objects.find(o => o.attach?.wallId === wall.id && o.attach.openingId === opening.id)})))
  const dims = ['Обмер и отметки чистовых поверхностей', 'Проверка изделий и монтажных привязок']

  const titleId = add('ST-title', 'Титульный лист · комплект квартиры', 'Предварительный выпуск', [
    `${a.name}. Геометрия, размещение, отделка, инженерные задания и ведомости. Подробная смета относится только к санузлу.`,
    'Формат печати: А4, альбомная ориентация. Схемы вписаны в лист; масштаб не фиксирован, размеры читать по надписям. Ответственный за выпуск, контакт и согласующие лица: не назначены.',
    `Состав расширен по перечню ${STUDIO_REFERENCE.name}; сверка ${STUDIO_REFERENCE.checkedAt}. Это собственные документы по модели квартиры, без переноса технических решений студии.`,
  ])
  category('T01', 'Титульный лист', [titleId, ...refs('00')], ['Ответственное лицо и согласование выпуска'])
  category('T02', 'Состав проекта', refs('02'), ['Согласование выпуска; полный индекс листов формируется в HTML/PDF'])
  const roomRegister = pages('ST-rooms', 'Экспликация помещений · площади и высоты', ['ID / помещение', 'Исходник, м²', 'Пол модели, м²', 'Оболочка / потолок, мм', 'Основание'], a.rooms.map(r => [
    `${r.id}\n${r.name}`, number(r.documentedArea, 2), number(takeoff(a, r.id).floor, 3), `${mm(r.height)} / ${a.objects.filter(o => o.roomId === r.id && o.kind === 'Ceiling').map(o => mm(o.position[1])).join(', ') || unknown}`, evidence(r),
  ]), ['Высота оболочки и отметка низа потолка — разные значения. Площади исходного плана не используются для восстановления длин стен.'])
  category('T03', 'Экспликация помещений', [...roomRegister, ...refs('01', 'A-areas')], ['Фактические площади и высоты'])

  const surveyPlan = add('ST-survey', 'Обмерный план · основа для проверки', INPUT, [
    'Показана текущая геометрия модели, а не результат фактического обмера. Размеры стен и проёмов приведены в следующих ведомостях; значения и принадлежность конструкций нужно проверить на объекте.',
    'Стояки, вентканалы, несущие элементы, отклонения и отметки инженерных вводов не подтверждены. Неизвестные элементы не дорисованы.',
  ], undefined, apartmentPlanSvg(a, 'architecture'))
  const wallRegister = pages('ST-walls', 'Реестр стен · геометрия модели', ['ID / помещение', 'Длина, мм', 'Толщина / высота, мм', 'Проёмы, шт.', 'Основание'], walls.map(o => [
    `${o.id}\n${[o.roomId, ...(o.sharedWith ?? [])].map(roomName).join(' / ')}`,
    mm(Math.hypot(o.wall!.end[0] - o.wall!.start[0], o.wall!.end[1] - o.wall!.start[1])),
    `${mm(o.wall!.thickness)} / ${mm(o.wall!.height)}`, String(o.wall!.openings.length), evidence(o),
  ]), ['Длина осевой линии объекта Wall. Толщина не устанавливает материал или несущую функцию. Один объект стены учитывается один раз, даже если разделяет комнаты.'])
  category('T04', 'Обмерный план', [surveyPlan, ...wallRegister, ...refs('01')], ['Натурный обмер, обследование конструкций и инженерии'], 'requires-input')

  const demolition = pages('ST-demolition', 'Демонтажные работы · ведомость обследования', ['Участок', 'Что проверить', 'Площадь / объём / отходы', 'Основание назначения'], [
    ...a.rooms.map(r => [r.name, 'Существующие основания, отделка, перегородки и инженерия', 'Не определено; не равно нулю', 'Обмер, фото и согласованное решение']),
    ['Общая инженерия', 'Допустимость отключения и переноса', 'Не определено', 'Обследование профильным исполнителем'],
  ], ['Модель содержит проектное предложение, но не отдельное обследованное состояние «до ремонта». Автоматически отличить сохраняемое, демонтируемое и новое невозможно. Ни одна стена не назначена к сносу.'], INPUT)
  category('T05', 'Демонтажные работы', demolition, ['Обследованная исходная модель и перечень согласованных работ'], 'requires-input')

  const cornerIds: string[] = []
  for (const room of rooms) cornerIds.push(add(`ST-corners-${room.id}`, `Маркировка углов · ${room.name}`, MODEL, [
    'Углы идут в порядке вершин контура комнаты. Участок C1–C2 читается от первого угла ко второму; те же обозначения используются на развёртках. Смена порядка вершин меняет обозначения и требует нового выпуска.',
  ], undefined, roomCornersSvg(a, room.id)))
  category('T06', 'Маркировка углов', cornerIds, ['Сверка контура после обмера'])

  const construction = pages('ST-construction', 'Геометрия объекта · конструкции и объёмы', ['ID', 'Объект', 'Размеры модели, мм', 'Что не назначено'], a.objects.filter(o => o.wall || ['wc-frame', 'source-service-strip'].includes(o.id)).map(o => [
    o.id, o.name, o.wall ? `${mm(Math.hypot(o.wall.end[0] - o.wall.start[0], o.wall.end[1] - o.wall.start[1]))} × ${mm(o.wall.height)} × ${mm(o.wall.thickness)}` : size(o), 'Существующий / новый; система, состав, крепления',
  ]), ['Это ведомость геометрии, не разрешение возводить или изменять конструкции. Рабочие привязки, материал, армирование и объёмы новых работ назначаются после обследования.'], INPUT)
  category('T07', 'Геометрия объекта. Лист 1', [surveyPlan, ...construction], ['Сохраняемые/новые конструкции, рабочие привязки и спецификация'], 'requires-input')
  const assemblies = pages('ST-assemblies', 'Геометрия объекта · задания на узлы', ['Узел', 'Известное решение', 'Что требуется для рабочего чертежа'], [
    ['Перегородка / перекрытие', 'Только габарит модели', 'Материал, деформационное примыкание, крепления, нагрузки'],
    ['Дверной проём', 'Габарит в стене модели', 'Паспорт дверного блока, усиление и монтажные зазоры'],
    ['Короб инсталляции', spec.confirmed.external_corner_finish, 'Рама, обшивка, гидроизоляция, люк и сервисный доступ'],
    ['Ванна / экран', 'Ванна и прозрачный экран', 'Паспорта, опоры, примыкания и доступ к сифону'],
    ['Мебель / стена', spec.confirmed.furniture_construction, 'Закладные, крепёж, нагрузка, основание и гидрозащита'],
    ['Подвес / потолок', 'Светильники заданы в модели', 'Закладные и доступ к драйверам; согласовать с потолочником'],
  ], ['Узлы не подменены типовыми картинками без сведений об основаниях и изделиях. Ведомость задаёт состав деталировки для исполнителей.'], INPUT)
  category('T08', 'Геометрия объекта. Лист 2', assemblies, ['Конструктивные узлы по обследованным основаниям и паспортам'], 'requires-input')
  const niches = pages('ST-niches', 'Геометрия объекта · ниши и ревизии', ['Зона / объект', 'Что известно', 'Ревизия и незаданные размеры'], [
    ...a.objects.filter(o => ['wc-frame', 'source-service-strip'].includes(o.id)).map(o => [o.id, `${o.name}; ${size(o)} мм`, 'Состав внутри, вырезы и сервисный доступ не определены']),
    ['Узел воды / коллектор', 'Место вводов не обмерено', 'Габарит ниши, дверца и свободное обслуживание не заданы'],
    ['Электрощит / слаботочный шкаф', 'Положение и комплектация не подтверждены', 'Габарит корпуса, место, крепления, вентиляция и доступ'],
    ['Отопление / вентиляция', 'Ниши не назначены', 'Необходимость устанавливается после инженерного решения'],
  ], ['Инженерная зона на схеме — условный габарит, не модель реальных стояков. Отсутствие отдельной ниши в модели не означает, что она не нужна.'], INPUT)
  category('T09', 'Геометрия объекта. Лист 3', niches, ['Паспорта оборудования, габариты ниш и ревизионных люков'], 'requires-input')

  const floorPlan = add('ST-floors', 'Полы и покрытия · план материалов', MODEL, [
    'Цвет обозначает материал текущей модели. Чистовые отметки, стяжка, звукоизоляция, гидроизоляция и сопряжения покрытий не определены толщиной визуальной плиты Floor.',
  ], undefined, apartmentPlanSvg(a, 'floors'))
  const floorTable = pages('ST-floor-build-up', 'Полы · ведомость покрытий и оснований', ['Помещение', 'Материал в модели', 'Пол модели, м²', 'Уровни / состав основания', 'Решение'], a.rooms.map(r => [
    r.name, a.objects.filter(o => o.roomId === r.id && o.kind === 'Floor').map(material).join('; ') || unknown, number(takeoff(a, r.id).floor, 3), 'Не определены', r.id === 'bathroom' ? `${spec.confirmed.floor_finish}; T1. Тёплый пол ${spec.confirmed.underfloor_heating ? 'требует проекта' : 'исключён'}` : 'Отделка и стыки требуют согласования',
  ]), ['Площади не включают закупочный запас. Покрытия под встроенной мебелью, пороги, стыки, направление и старт укладки проверяются отдельно.'])
  category('T10', 'Полы и покрытия', [floorPlan, ...floorTable], ['Обмер отметок, слои основания, гидроизоляция и стыки'])
  const finishes = pages('ST-wall-finishes', 'Отделка стен · стороны помещений', ['Помещение', 'Стены модели', 'Материал стороны комнаты', 'Решение', 'Уточнить'], a.rooms.flatMap(r => {
    const groups = new Map<string, string[]>()
    for (const wall of walls.filter(w => w.visible !== false && (w.roomId === r.id || w.sharedWith?.includes(r.id)))) {
      const id = wallMaterialForRoom(wall, r)
      groups.set(id, [...(groups.get(id) ?? []), wall.id])
    }
    return [...groups].map(([id, ids]) => [r.name, ids.join('; '), a.materials.find(m => m.id === id)?.name ?? id, r.id === 'bathroom' ? `${spec.confirmed.wall_finish}; M1 / T1` : 'Предложение по модели', 'Образцы, зоны, откосы и короба'])
  }), ['Для каждой комнаты показан материал обращённой к ней грани, включая смежные перегородки. Одна перегородка может иметь разные покрытия с двух сторон. Это ведомость назначения материалов; площади для закупки требуют обмера и карты зон.'])
  category('T11', 'Отделка стен', [...finishes, ...refs('08', '09')], ['Карта отделочных зон, основания, образцы и добавочные поверхности'])

  const openingPlan = add('ST-openings', 'Остекление и двери · расположение проёмов', MODEL, ['Габариты проёмов взяты из Wall.openings. Размер проёма не равен заказному размеру рамы или полотна.'], undefined, apartmentPlanSvg(a, 'openings'))
  const openingRows = (kind: 'door' | 'window') => openings.filter(({opening}) => opening.kind === kind).map(({wall, opening}) => [opening.id, `${roomName(wall.roomId)}\n${wall.id}`, `${mm(opening.width)} × ${mm(opening.height)}`, `${mm(opening.offset)} / ${mm(opening.bottom)}`, 'Паспорт / монтажный зазор / открывание не согласованы'])
  const windows = pages('ST-windows', 'Остекление · ведомость оконных проёмов', ['ID', 'Помещение / стена', 'Ш × В проёма, мм', 'От начала стены / низ, мм', 'Комплектация'], openingRows('window'), ['Створки, импосты, профили, стеклопакеты, подоконники, отливы и откосы в заказ не назначены. Существующее остекление сначала обследовать.'])
  category('T12', 'Остекление', [openingPlan, ...windows], ['Обмер проёмов, конфигурация окон и комплектность'], openings.some(v => v.opening.kind === 'window') ? 'model' : 'requires-input')

  const wet = a.objects.filter(o => ['Bathtub', 'Toilet', 'Vanity', 'Sink', 'Shower'].includes(o.kind) || o.params?.fixture === 'hygienicShower' || (o.kind === 'Appliance' && ['washer', 'dishwasher'].includes(o.params?.appliance ?? '')))
  const missingHygienicShower = spec.confirmed.hygienic_shower && !wet.some(o => o.params?.fixture === 'hygienicShower' || o.id === 'hygienic-shower')
  const waterPlan = add('ST-plumbing', 'Сантехника · расположение потребителей', MODEL, [
    'Показаны габариты потребителей в модели. Точка предмета не является выводом воды или канализации. Диаметры, уклоны, трассы и монтажные координаты не назначены.',
  ], undefined, apartmentPlanSvg(a, 'plumbing'))
  const waterFixtures = pages('ST-plumbing-equipment', 'Сантехника · приборы и обслуживание', ['ID / помещение', 'Потребитель', 'Габарит Ш × В × Г, мм', 'Проверить перед подключением'], [...wet.map(o => [
    `${o.id}\n${roomName(o.roomId)}`, o.name, size(o), o.kind === 'Toilet' ? 'Рама, выпуск, ревизия и кнопка' : o.params?.appliance === 'washer' ? 'Шланги, сифон, отключение и извлечение машины' : 'Паспорт, подводка, слив и доступ для обслуживания',
  ]), ...(missingHygienicShower ? [['hygienic-shower · не размещён', 'Гигиенический душ · обязателен по спецификации', 'Не заданы', 'Модель, размещение и подводка']] : [])], ['Перечень включает кухню и санузел. Предметы композиции могут быть частями одного комплекта — это не число оплачиваемых подключений.'])
  const inlet = pages('ST-water-inlet', 'Сантехника · задание на узел воды', ['Узел', 'Задание', 'Неизвестные данные'], [
    ['Вводы ХВС / ГВС', 'Зафиксировать доступ и существующие устройства', 'Место, число вводов, давление и диаметры'],
    ['Защита от протечек', spec.working_leak_protection.valves, 'Артикул, условия монтажа, питание и резерв'],
    ['Коллектор и фильтры', 'Выбрать после обследования и расчёта', 'Состав, диаметры, крепления и размеры ниши'],
    ['Канализация', 'Проверить стояк и возможности подключения', 'Место, отметки выпусков, трассы, диаметры и уклоны'],
    ['Бойлер', spec.confirmed.boiler ? 'Требуется отдельный выбор' : 'Исключён решением пользователя', 'Не добавлять автоматически'],
  ], ['Это задание исполнителю, а не монтажная схема узла. Последовательность арматуры выбирается по фактической системе и паспортам.'], INPUT)
  category('T13', 'Сантехника', [waterPlan, ...waterFixtures, ...inlet, ...refs('11')], ['Обмер вводов, расчёт узла, спецификация и монтажная схема'])
  const outlets = pages('ST-water-outlets', 'Сантехника · ведомость выводов', ['ID потребителя', 'Назначение', 'Положение предмета X / Y / Z, мм', 'Выводы ХВС / ГВС / канализации'], [
    ...wet.map(o => [o.id, o.name, position(o), 'Координаты и состав по паспорту; не заданы']),
    ...(missingHygienicShower ? [['hygienic-shower · не размещён', 'Гигиенический душ · обязателен', 'Не задано', 'Состав и координаты по паспорту; не заданы']] : []),
  ], ['Положение — начало координат предмета в модели; не монтажный вывод и не привязка от чистовой стены. Число выводов не выводится из числа объектов.'], INPUT)
  const leaks = pages('ST-leak-sensors', 'Сантехника · защита от протечек', ['Зона', 'Известное требование', 'Что необходимо уточнить'], [
    ...spec.working_leak_protection.sensors.map(zone => [zone, 'Датчик с доступом для проверки и обслуживания', 'Точный тип, координаты и способ соединения']),
    ['Контроллер', 'Доступный; отключение воды без облака', 'Паспорт, резерв питания и поведение при обесточивании'],
    ['Проверка', 'Сработать должен каждый датчик и каждый кран', 'Протокол испытаний, фото и инструкция владельцу'],
  ], ['Наличие системы подтверждено, места датчиков указаны зонами. Неизвестные координаты не заменены условными точками.'], INPUT)
  category('T14', 'Сантехника. Лист 2', [waterPlan, ...outlets, ...leaks], ['Монтажные выводы и привязки датчиков по обмеру и паспортам'], 'requires-input')

  const heating = pages('ST-heating', 'Отопление · задание на обследование', ['Помещение', 'Пол модели, м²', 'Известное оборудование', 'Мощность / трассы / подключение'], a.rooms.map(r => [
    r.name, number(takeoff(a, r.id).floor, 3), a.objects.filter(o => o.roomId === r.id && o.params?.fixture === 'towelWarmer').map(o => `${o.name}; ${size(o)} мм`).join('; ') || 'Радиаторы в модели не заданы', 'Не рассчитаны',
  ]), ['Нужны сведения о системе дома, теплопотерях, существующих радиаторах и допустимых изменениях. Площадь пола сама по себе не задаёт тепловую мощность.', `Тёплый пол санузла ${spec.confirmed.underfloor_heating ? 'требует проекта' : 'исключён пользователем'}. Электрический полотенцесушитель не подменяет расчёт отопления.`], INPUT)
  category('T15', 'Отопление', heating, ['Система дома, обмер, теплотехнический расчёт и оборудование'], 'requires-input')
  const climate = pages('ST-climate', 'Климат и вентиляция · задание по помещениям', ['Помещение', 'Пол модели, м²', 'Учесть при размещении', 'Неизвестные данные'], a.rooms.map(r => [
    r.name, number(takeoff(a, r.id).floor, 3), r.id === 'bathroom' ? 'Вытяжка с таймером; переток через дверь — рабочая рекомендация' : r.id === 'kitchen' ? 'Кухонная вытяжка и общеобменная вентиляция' : 'Спальные/рабочие места, мебель и направление воздуха', 'Шахты, расход, оборудование, трассы и дренаж',
  ]), ['Положения реальных вентканалов и наружных блоков не подтверждены. Кондиционеры не выбраны. Расчёт и схемы выполняются после обследования; размеры и расходы не назначены по площади.'], INPUT)
  category('T16', 'Климат и вентиляция', [...climate, ...refs('11')], ['Вентканалы, расход, кондиционирование, трассы и дренаж'], 'requires-input')

  const board = pages('ST-electrical-board', 'Электромонтаж · задание на щит и линии', ['Потребители', 'В модели', 'Необходимо рассчитать / согласовать'], [
    ['Розетки', `${electrical.filter(o => o.kind === 'Socket').length} блоков / ${electrical.filter(o => o.kind === 'Socket').reduce((sum, o) => sum + o.electrical!.gangs, 0)} механизмов`, 'Нагрузки, контуры, кабели, защита и схема щита'],
    ['Выключатели', `${electrical.filter(o => o.kind === 'Switch').length} блоков`, 'Тип механизмов, топология соединений и управление'],
    ['Свет', `${lights.length} объектов света`, 'Паспортная мощность, драйверы, диммирование и защита'],
    ['Силовые приборы', 'Варочная панель, духовка и другая техника', 'Паспортные нагрузки, питание и способы отключения'],
    ['Постоянное питание', 'Контроллер протечек и необходимые сервисы', 'Состав постоянно включённых линий и резерв'],
    ['Ввод / щит / слаботочка', 'Не обследованы', 'Выделенная мощность, система заземления, состав/место щитов'],
  ], ['Количество механизмов не определяет число линий или автоматов. Номиналы, сечения, токи защиты и однолинейная схема не сформированы без инженерного расчёта.'], INPUT)
  category('T17', 'Рекомендации по электромонтажу', [...board, ...refs('10')], ['Инженерный расчёт, однолинейная схема и спецификация щита'], 'requires-input')
  const wiring = pages('ST-wiring-details', 'Электромонтаж · задания на схемы соединений', ['Узел', 'Исходное решение', 'Что должен выдать исполнитель'], [
    ['Розеточные блоки', 'Назначения и количество механизмов — по реестру точек', 'Схемы соединений, защита, кабели и доступ к соединениям'],
    ['Управление светом', 'Логические связи — по controls в модели', 'Схемы механизмов и разделение на клавиши'],
    ['Зеркало G2', 'Диммирование; драйвер доступен', 'Совместимость диммера, драйвера и светильников'],
    ['Мокрые зоны / лоджия', 'Условия эксплуатации требуют проверки', 'Исполнение, зоны, защита и монтаж по проекту'],
    ['PE и уравнивание потенциалов', 'Нет обследования и схемы', 'Проектное решение и протоколы измерений'],
    ['Слаботочка', 'TV и рабочее место в модели', 'Состав линий, розеток, стоек и трасс после выбора устройств'],
  ], ['Генератор описывает нужные схемы, но не рисует невыбранную электрическую топологию. Логическая связь управления не означает кабельную трассу.'], INPUT)
  category('T18', 'Рекомендации по электромонтажу. Лист 2', wiring, ['Паспорта механизмов и рабочие схемы соединений'], 'requires-input')
  const pointTable = pages('ST-electrical-locations', 'Электрические точки · привязки модели', ['ID / назначение', 'Стена', 'От начала стены, мм', 'Центр от нуля модели, мм', 'Механизмов'], electrical.map(o => [
    `${o.id}\n${o.electrical!.purpose}`, o.electrical!.wallId, mm(o.electrical!.offset), mm(o.position[1] + o.size[1] / 2), String(o.electrical!.gangs),
  ]), ['Отступ отсчитывается вдоль осевой линии объекта стены. Это координаты модели, не проверенные монтажные размеры от чистовых углов.'])
  category('T19', 'Расположение электроточек', [...refs('E', 'EP', '03-coordination'), ...pointTable], dims, electrical.length ? 'model' : 'requires-input')
  const connections = pages('ST-electrical-connections', 'Подключение электроточек · назначения', ['ID', 'Назначение', 'Помещение', 'Контур / кабель / защита'], electrical.map(o => [o.id, o.electrical!.purpose, roomName(o.roomId), 'Не назначены']), ['Точка сохраняет исходный ID во всех схемах. Подключения варочной панели, полотенцесушителя, вентиляции и контроллера протечек нужно дополнить после выбора изделий; существующий набор точек не является полной ведомостью потребителей.'], INPUT)
  category('T20', 'Подключение электроточек', [...connections, ...board], ['Сопоставление с цепями щита, кабели, исполнение и защита'], 'requires-input')
  const switchIds: string[] = []
  for (const room of rooms) if (roomElectricalPoints(a, room.id).some(o => o.kind === 'Switch')) switchIds.push(add(`ST-switches-${room.id}`, `Подключение выключателей · ${room.name}`, MODEL, [
    'Линии показывают только фактические связи controls в модели. Физическое расположение внешних выключателей сохранено; распределение по клавишам, проводка и тип механизма требуют отдельной схемы.',
  ], undefined, roomSwitchingSvg(a, room.id)))
  const controlRows = electrical.filter(o => o.kind === 'Switch').flatMap(o => o.electrical!.controls.length ? o.electrical!.controls.map(id => [o.id, roomName(o.roomId), id, a.objects.find(v => v.id === id)?.name ?? 'Объект не найден']) : [[o.id, roomName(o.roomId), 'Не назначено', 'Уточнить управление']])
  const controlTable = pages('ST-switch-links', 'Выключатели · реестр связей управления', ['Выключатель', 'Расположен в', 'Управляемый ID', 'Объект'], controlRows, ['Реестр проверяет назначения между комнатами. Одна строка — логическая связь, не отдельная кабельная линия.'])
  category('T21', 'Подключение выключателей', [...switchIds, ...controlTable], ['Схема по клавишам, тип механизмов и электрические соединения'], controlRows.length ? 'model' : 'requires-input')

  const ceilingEquipment = pages('ST-ceiling-equipment', 'Потолочное оборудование · ведомость', ['ID / помещение', 'Оборудование', 'Ш × В × Г, мм', 'X / Y / Z, мм', 'Монтаж'], lights.filter(o => o.params?.group !== 'mirror').map(o => [
    `${o.id}\n${roomName(o.roomId)}`, o.name, size(o), position(o), 'Закладные / драйвер / доступ по паспорту',
  ]), ['Ведомость содержит заданные в модели светильники. Карнизы, решётки, датчики и другие потолочные элементы не выбраны; отсутствие в модели не означает нулевой объём работ.'])
  category('T22', 'Потолочное оборудование', [...ceilingEquipment, ...refs('C', '05', '06')], ['Закладные, драйверы, карнизы, решётки и сервисный доступ'])
  const ceilingRegister = pages('ST-ceilings', 'Потолки · площади, периметры и отметки', ['Помещение', 'Площадь модели, м²', 'Внешний периметр, м', 'Отметка низа, мм', 'Конструкция'], a.rooms.map(r => {
    const slabs = a.objects.filter(o => o.roomId === r.id && o.kind === 'Ceiling' && o.surface)
    return [r.name, number(takeoff(a, r.id).ceiling, 3), slabs.length ? number(slabs.reduce((sum, o) => sum + perimeter(o.surface!.polygon)!, 0), 3) : '—', slabs.map(o => mm(o.position[1])).join(', ') || unknown, 'Матовый натяжной — предложение; узлы уточнить']
  }), ['Периметр по внешнему контуру объектов Ceiling; внутренние отверстия, обходы, закладные и крепления добавляются отдельно. Отметки модели не являются обмеренными высотами.'])
  category('T23', 'План потолков', [...refs('C', '05'), ...ceilingRegister], ['Обмер высот, конструкция, примыкания и закладные'])
  const tileId = add('ST-tile-floor', 'Раскладка керамогранита · пол санузла', 'Формат T1 · монтажная раскладка не утверждена', [
    'Сетка номинального формата дана для оценки композиции. Старт, ширина шва, калибр, раскладка у коробов и подрезки не согласованы. Это не карта реза и не количество плиток к заказу.',
  ], undefined, roomTileFloorSvg(a, 'bathroom', spec.confirmed.floor_tile_mm as [number, number]))
  category('T24', 'Раскладка керамогранита', [tileId, ...refs('07', '09')], ['Монтажная раскладка, старт, швы, подрезки и раскрой'])

  const kitchenItems = a.objects.filter(o => o.roomId === 'kitchen' && (['KitchenCabinet', 'Wardrobe', 'Sink', 'Shower', 'Appliance'].includes(o.kind) || o.kind === 'Countertop' && (o.params?.sinkCutout || ['hob', 'joineryPanel'].includes(o.params?.fixture ?? '') || /Столешница/.test(o.name))))
  const kitchenDetail = (o: Entity) => {
    if (o.params?.fixture === 'blindCorner') return 'Глухой угол; полезный доступ не заявлен'
    if (o.params?.sinkCutout) return `Вырез модели ${o.params.sinkCutout.size.join(' × ')} мм; уточнить по шаблону мойки`
    if (o.params?.integrated) return 'Встроенный прибор за общим мебельным фасадом; вентиляция, петли, извлечение и подключения по паспорту'
    if (o.params?.builtIn) return 'Встроенный прибор в нише колонны; монтажные зазоры, вентиляция и подключение по паспорту'
    if (o.params?.fixture === 'extractorHood') return 'Скрытый вкладыш вытяжки; канал, режим и сервисный доступ уточнить'
    if (o.params?.cabinetVoids?.some(v => v.front === false) && /вытяж/i.test(o.name)) return 'Сервисный объём вытяжки за общим фасадом; не считать полезным хранением'
    if (o.params?.fixture === 'joineryPanel') return `Добор / отделочная панель: ${material(o)}; подрезка и примыкания по обмеру`
    return 'Паспорт, стыки, открывание, сервисные зазоры и комплектация'
  }
  const kitchenModules = pages('ST-kitchen', 'Кухонный гарнитур · модули и техника', ['ID', 'Модуль / прибор', 'Ш × В × Г, мм', 'Особенность / проверить'], kitchenItems.map(o => [
    o.id, o.name, size(o), kitchenDetail(o),
  ]), ['Модульные габариты взяты из модели. Изготовительные размеры, фасады, фурнитура, вырезы, пристенные планки и состав заказа ещё не согласованы.'])
  const kitchenPlan = add('ST-kitchen-plan', 'Кухонный гарнитур · компоновка', MODEL, ['Номера соответствуют текущей экспликации кухни A-kitchen-items. Угловой модуль, техника, мойка и столешницы требуют контрольного обмера и паспортной проверки.'], undefined, planSvg(a, 'kitchen'))
  category('T25', 'Кухонный гарнитур', [kitchenPlan, ...kitchenModules, ...refs('A-kitchen-items')], ['Изготовительные чертежи, паспорта техники и комплектация'], kitchenItems.length ? 'model' : 'requires-input')
  const doors = pages('ST-doors', 'Двери · ведомость проёмов и комплектов', ['ID', 'Помещение / стена', 'Ш × В проёма, мм', 'От начала стены / низ, мм', 'Открывание / комплектация'], openingRows('door'), ['Направление петель, полотно, коробка, доборы, наличники, пороги и фурнитура согласуются по сторонам проёма. Поворот двери в 3D — поза визуализации, а не утверждённая схема заказа.'])
  category('T26', 'Двери', [openingPlan, ...doors], ['Обмер, стороны/направления открывания и дверные комплекты'], openings.some(v => v.opening.kind === 'door') ? 'model' : 'requires-input')
  const skirting = pages('ST-skirting', 'Плинтусы · база для раскладки', ['Помещение', 'Периметр контура, м', 'Материал / высота', 'Необходимые вычеты'], a.rooms.map(r => [
    r.name, number(perimeter(r.polygon), 3), r.id === 'bathroom' ? 'Примыкание плитки; отдельный плинтус не выбран' : 'Не выбраны', 'Проёмы, встроенная мебель, кухня и скрытые участки',
  ]), ['Периметр всего контура — справочная геометрия, НЕ длина плинтуса к закупке. Отсутствует согласованная карта участков установки. Вычеты, торцы, углы и запас не назначены.'], INPUT)
  category('T27', 'Плинтусы', [...skirting, ...refs('A', '03')], ['Карта участков, тип примыканий и чистый метраж'], 'requires-input')
  const furniturePlan = add('ST-furniture', 'Мебель · общая расстановка', MODEL, ['Размещение взято из текущей модели. Заказные и серийные позиции, реальные габариты и зоны открывания необходимо согласовать; готовность компоновки не означает готовности мебели к заказу.'], undefined, apartmentPlanSvg(a, 'furniture'))
  const furnitureBrief = pages('ST-furniture-brief', 'Мебель · задания изготовителям', ['Помещение', 'Известное решение', 'Что требуется к заказу'], a.rooms.map(r => [
    r.name, r.id === 'bathroom' ? `A3 / Д2; ${spec.confirmed.furniture_construction}` : `${planEntities(a, r.id).length} предметов/частей композиции в экспликации`, 'Контрольный замер, паспорт техники, открывание, крепления, материалы и изготовительные чертежи',
  ]), ['Количество предметов/частей композиции не является количеством закупочных комплектов. Тип изготовления остальных помещений не назначен по одним габаритам.'])
  category('T28', 'Мебель', [furniturePlan, ...furnitureBrief, ...refs('A', '03', '04')], ['Серийная/заказная комплектация и изготовительные чертежи'])
  const decor = a.objects.filter(o => ['artwork', 'rug'].includes(o.params?.fixture ?? '') || o.kind === 'GlassPartition' && /зеркал/i.test(o.name))
  const decorPlan = add('ST-decor', 'Декор · размещение элементов', MODEL, ['Показаны только элементы, уже заданные в модели. Высоты и габариты в ведомости относятся к композиции; монтаж по паспорту и после согласования креплений.'], undefined, apartmentPlanSvg(a, 'decor'))
  const decorTable = pages('ST-decor-items', 'Декор · ведомость размещения', ['ID / помещение', 'Предмет', 'Ш × В × Г, мм', 'X / Y / Z, мм', 'Основание'], decor.map(o => [`${o.id}\n${roomName(o.roomId)}`, o.name, size(o), position(o), evidence(o)]), ['Артикулы, количество в комплекте, крепления и окончательные привязки ещё не выбраны.'])
  category('T29', 'Декор', [decorPlan, ...decorTable], ['Артикулы, образцы и крепления'], decor.length ? 'model' : 'requires-input')

  const notes = add('ST-notes', 'Лист для заметок · квартира', 'Бланк', ['Дата __________   Участок / ID __________   Автор __________   Ревизия __________'], undefined, apartmentPlanSvg(a, 'architecture'))
  category('A01', 'Лист для заметок', [notes], [])
  category('A02', 'График производства работ', refs('15', 'budget-schedule', '16', '17'), ['Исполнители, старт, поставки и подробный график квартиры'])
  const elevations: string[] = []
  for (const room of rooms) for (let i = 0; i < room.polygon!.length; i++) {
    const next = (i + 1) % room.polygon!.length
    elevations.push(add(`ST-elevation-${room.id}-${i + 1}`, `Развёртка · ${room.name} · C${i + 1}–C${next + 1}`, MODEL, [
      `Контур ${room.id}-C${i + 1} → ${room.id}-C${next + 1}; маркировка на ST-corners-${room.id}. Проекция модели, не изготовительная или монтажная развёртка.`,
    ], undefined, roomElevationSvg(a, room.id, i)))
  }
  category('A03', 'Развёртки стен', [...cornerIds, ...elevations, ...refs('07')], ['Чистовые отметки, зоны отделки, изделия и монтажные привязки'])

  const coverageRows = coverage.map(c => [c.id, c.title, studioStatusLabels[c.status], c.sheetIds.join(', ') || 'Нет листа', c.missing.join('; ') || '—'])
  const coverageSheets = pages('ST-coverage', 'Состав по студийному образцу · карта готовности', ['Код', 'Документ', 'Что сформировано', 'Листы этого выпуска', 'До рабочего выпуска'], coverageRows, [
    `Сверка состава: ${STUDIO_REFERENCE.url}, ${STUDIO_REFERENCE.checkedAt}. Включены 29 технических и 3 вспомогательных категории. Наличие листа не означает инженерную или монтажную готовность.`,
    '«Сформировано из модели» означает доступность схемы/ведомости по текущим данным. «Требуются исходные данные» — выпущено задание или ведомость обследования; недостающие решения не придуманы.',
  ], 'Реестр предварительного комплекта', 6)
  // The category registry itself is the composition document; stable IDs avoid circular page numbering.
  coverage.find(c => c.id === 'T02')!.sheetIds.push(...coverageSheets)
  coverageRows[coverage.findIndex(c => c.id === 'T02')][3] = coverage.find(c => c.id === 'T02')!.sheetIds.join(', ')
  add('ST-project-support', 'Проверка и сопровождение проекта', 'Формы контроля, не оказанная услуга', [
    'На сайте-образце контроль качества и сопровождение перечислены как услуги. Генератор не заявляет их выполненными: в комплекте сохранены формы приёмки, замечаний, изменений и открытых решений.',
    'Для фактического сопровождения назначить ответственных, порядок согласования изменений и контрольные визиты. Каждый новый обмер или выбранный артикул проверять на всех затронутых листах и в смете.',
  ], {headers: ['Проверка', 'Результат сейчас'], rows: [
    ['Полнота разделов', 'Автоматический реестр 32 категорий'],
    ['Геометрия / обмер', 'Модель сопоставляется с фактическим обмером; не подтверждено'],
    ['Инженерия / изделия', 'Требуются проект, паспорта и проверка совместимости'],
    ['Смета / закупки', 'Подробная смета санузла; цены и комплекты требуют подтверждения'],
    ['Выпуск и изменения', 'Нет подписей и разрешения в работу; использовать журнал изменений'],
  ]})
  return {sheets: [...sheets.filter(s => s.id.startsWith('ST-coverage-')), ...sheets.filter(s => !s.id.startsWith('ST-coverage-'))], coverage}
}
