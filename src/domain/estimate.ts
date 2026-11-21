import { polygonArea, wallCells } from './math.ts'
import type { Apartment } from './schema.ts'
import type bathroomSpec from '../../docs/bathroom-spec.json'
import budget from '../data/bathroom-budget.json' with { type: 'json' }

export const bathroomBudget = budget
export const hasBathroomBudget = (a: Apartment) => a.costPlanId === budget.id

export type DesignSpec = typeof bathroomSpec
export type CostCategory = 'Материалы' | 'Работы' | 'Оборудование' | 'Прочее'
export interface CostLine {
  id: string
  name: string
  category: CostCategory
  unit: string
  quantity: number | null
  source: string
  note: string
  waste: number
  pack: number | null
}
export interface LineInput {
  quantity: number | null
  price: number | null
  waste: number
  pack: number | null
  supplier: string
  quoteDate: string
  note: string
  excluded: boolean
}
export interface EstimateDraft {
  version: 1
  projectId: string
  modelKey: string
  reservePercent: number
  inputs: Record<string, LineInput>
  custom: CostLine[]
}
export interface PricedLine extends CostLine {
  input: LineInput
  net: number | null
  order: number | null
  packs: number | null
  amount: number | null
  overridden: boolean
}
export const money = (v: number | null) => v === null ? 'Не рассчитано' : new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(v) + ' ₸'
export const number = (v: number | null, digits = 3) => v === null ? '—' : new Intl.NumberFormat('ru-RU', { maximumFractionDigits: digits }).format(v)
export const round = (n: number, precision = 3) => Math.round((n + Number.EPSILON) * 10 ** precision) / 10 ** precision

// Change detection, not a security signature. Includes geometry, evidence and decisions.
export function modelKey(a: Apartment, spec: DesignSpec): string {
  let h = 2166136261
  for (const c of JSON.stringify([a, spec, hasBathroomBudget(a) ? budget : null])) h = Math.imul(h ^ c.charCodeAt(0), 16777619)
  return `${a.id}-r${a.revision}-${(h >>> 0).toString(16)}`
}
export function takeoff(a: Apartment, roomId: string) {
  const objects = a.objects.filter(o => o.roomId === roomId)
  const surfaces = (kind: string) => objects.filter(o => o.kind === kind && o.surface)
  const area = (kind: string) => {
    const slabs = surfaces(kind)
    return slabs.length ? slabs.reduce((s, o) => s + polygonArea(o.surface!.polygon) - (o.surface!.holes ?? []).reduce((t, h) => t + polygonArea(h), 0), 0) / 1e6 : null
  }
  const walls = objects.filter(o => o.kind === 'Wall' && o.wall).map(o => {
    const w = o.wall!
    const length = Math.hypot(w.end[0] - w.start[0], w.end[1] - w.start[1])
    const net = wallCells(length, w.height, w.openings).reduce((s, c) => s + c.width * c.height, 0) / 1e6
    return { id: o.id, name: o.name, length, height: w.height, gross: length * w.height / 1e6, net, evidence: o.evidence }
  })
  return { floor: area('Floor'), ceiling: area('Ceiling'), walls, wallNet: walls.length ? walls.reduce((s, w) => s + w.net, 0) : null }
}
export function estimateLines(a: Apartment, spec: DesignSpec): CostLine[] {
  if (hasBathroomBudget(a)) return budget.lines.map(l => ({
    id: l.id, name: l.name, category: l.category as CostCategory, unit: l.unit,
    quantity: l.quantity, waste: l.waste, pack: l.pack,
    source: `Расчёт ${budget.date}: 4,44 м² пола; контур 1,859 × 2,412 м; высота 2,85 м; проём 0,9 × 2,3 м; добавочные поверхности 1,5 м². Объёмы предварительные, не автоматический обмер.`,
    note: `${l.status}. ${l.note}`,
  }))
  const q = takeoff(a, 'bathroom')
  const lines: CostLine[] = []
  const add = (id: string, name: string, category: CostCategory, unit: string, quantity: number | null, source: string, note = '', waste = 0) => lines.push({ id, name, category, unit, quantity, source, note, waste, pack: null })
  const assumed = 'Модель санузла; размеры условные. Не закупочный объём.'
  add('tile-wall', 'Керамогранит стен · T1 1200 × 600', 'Материалы', 'м²', q.wallNet, 'Внутренняя сторона стен минус объединение проёмов', 'Базовые плоскости до потолка. Не вычтены закрытые мебелью зоны; короба, экран, откосы и подрезки требуют отдельного расчёта. Запас 10% — редактируемое допущение.', 10)
  add('tile-floor', 'Керамогранит пола · T1 600 × 600', 'Материалы', 'м²', q.floor, 'Полигон Floor минус отверстия', 'Весь контур пола, включая зоны под ванной и мебелью. Уточнить покрытие под коробами. Запас 10% — допущение.', 10)
  add('lay-wall', 'Укладка керамогранита на стены', 'Работы', 'м²', q.wallNet, 'Те же базовые плоскости стен без запаса', assumed)
  add('lay-floor', 'Укладка керамогранита на пол', 'Работы', 'м²', q.floor, 'Чистая геометрическая площадь пола без запаса', assumed)
  add('ceiling', 'Натяжной потолок с монтажом', 'Работы', 'м²', q.ceiling, 'Полигон Ceiling', 'Комплексная цена: полотно и монтаж. Закладные и обходы уточнить; не дублировать отдельной строкой полотно.')
  const unknowns: [string, string, CostCategory, string, string][] = [
    ['site-survey', 'Обмеры и инженерное обследование', 'Работы', 'компл.', 'Уточнить состав и стоимость обследования.'],
    ['dismantle', 'Демонтаж и подготовка существующих оснований', 'Работы', 'компл.', 'Объём зависит от фактического состояния. Наличие работ не подтверждено.'],
    ['wall-level', 'Выравнивание стен', 'Работы', 'м²', 'Нужны отклонения, состав основания и объём.'],
    ['screed', 'Стяжка / выравнивание пола', 'Работы', 'м²', 'Нужны отметки, толщина и состав.'],
    ['waterproof-work', 'Гидроизоляция с примыканиями', 'Работы', 'м²', 'Нужна утверждённая карта зон. Не приравнивается автоматически ко всем стенам.'],
    ['waterproof-material', 'Гидроизоляция и ленты', 'Материалы', 'компл.', 'Система, расход, число слоёв и упаковки по производителю.'],
    ['adhesive', 'Клей, грунт и подготовительные смеси', 'Материалы', 'компл.', 'Нужны артикулы, основания, толщины, нормы расхода.'],
    ['grout-material', 'Эпоксидная затирка', 'Материалы', 'кг', 'Расход после выбора ширины/глубины шва и продукта.'],
    ['grout-work', 'Заполнение швов эпоксидной затиркой', 'Работы', 'м²', 'Уточнить зоны и включение в цену укладки.'],
    ['elastic-joints', 'Эластичные примыкания и деформационные швы', 'Работы', 'м.п.', 'Отдельный узел; не заменять эпоксидной затиркой.'],
    ['boxes', 'Короба, ревизии и экран ванны', 'Работы', 'компл.', 'Конструкция, люки и доступ ещё не определены.'],
    ['extra-tile', 'Дополнительная облицовка коробов, экрана, откосов', 'Материалы', 'м²', 'Не входит в базовые плоскости. Указать только добавочную площадь после исключения перекрытых участков.'],
    ['extra-lay', 'Облицовка коробов, экрана и откосов', 'Работы', 'м²', 'Чистая добавочная площадь, без двойного счёта.'],
    ['mitre', 'Запил 45° · У1', 'Работы', 'м.п.', 'Верхнее переднее и доступное вертикальное ребро WC. Длины после деталировки.'],
    ['plumbing', 'Разводка воды и канализации с материалами', 'Работы', 'компл.', 'Трассы, точки, узлы и состав комплекта определяет инженер.'],
    ['electrical', 'Электромонтаж с кабелем и защитой', 'Работы', 'компл.', 'Группы, трассы, длины и спецификацию определяет электрик.'],
    ['ventilation', 'Вытяжка, канал и монтаж', 'Оборудование', 'компл.', 'Проверить существующий канал и управление.'],
    ['installation', 'Монтаж сантехники, мебели и аксессуаров', 'Работы', 'компл.', 'Уточнить состав; исключить работы, уже включённые в цену изделия.'],
    ['delivery', 'Доставка и подъём', 'Прочее', 'компл.', 'По предложениям поставщиков.'],
    ['waste-removal', 'Вывоз отходов', 'Прочее', 'компл.', 'После определения объёма работ.'],
    ['commission', 'Испытания, уборка и сдача', 'Работы', 'компл.', 'Протоколы и состав финальной уборки согласовать.'],
  ]
  for (const [id, name, category, unit, note] of unknowns) add(id, name, category, unit, null, 'Требуется спецификация / предложение подрядчика', note)
  const equipment = a.objects.filter(o => o.roomId === 'bathroom' && ['Bathtub','Shower','Vanity','Toilet','Wardrobe','Appliance','Spotlight','LEDStrip','Door','GlassPartition'].includes(o.kind) && o.id !== 'flush')
  for (const o of equipment) add(`item-${o.id}`, o.name, 'Оборудование', 'шт.', 1, `Объект ${o.id}; ${o.evidence === 'measured' ? 'обмер' : 'предварительные габариты'}`, o.kind === 'Vanity' ? 'Для сметы комплект: тумба, раковина, смеситель. Разделить дополнительными строками, исключив комплект, если поставщики разные.' : ['LEDStrip','Spotlight'].includes(o.kind) ? 'Предложение G1/G2, не утверждено. Для линий у зеркала цена за один полный светильник с учётом согласованного драйвера.' : 'Модель, артикул и состав поставки требуют выбора. Монтаж отдельно, если не включён в предложение.')
  add('installation-frame', 'Инсталляция WC с кнопкой', 'Оборудование', 'компл.', 1, 'Подвесной WC выбран', 'Рама, бачок и кнопка — отдельная поставка от чаши; проверить комплектность.')
  add('towel-warmer', 'Электрический полотенцесушитель', 'Оборудование', 'шт.', spec.working_towel_warmer.quantity, 'Наличие подтверждено в bathroom-spec.json', 'Место, модель, мощность и подключение не утверждены.')
  add('sockets', 'Розетки · Э1', 'Оборудование', 'шт.', spec.proposals_not_approved.electrical_scheme.socket_count, 'Предложение Э1', '3 механизма: 1 стиралка, 2 у тумбы. Рамки и защита уточняются; точка полотенцесушителя отдельно.')
  add('controls', 'Управление светом, драйверы и комплектующие', 'Оборудование', 'компл.', null, 'Предложение G1/G2', 'Проверить включение драйверов в цены светильников.')
  if (spec.confirmed.leak_protection) add('leak-protection', 'Защита от протечек', 'Оборудование', 'компл.', 1, 'Наличие подтверждено пользователем', 'Комплект и монтаж оценить отдельно; модель и состав по вводам.')
  if (spec.confirmed.boiler) add('water-heater', 'Бойлер', 'Оборудование', 'шт.', 1, 'Выбор в спецификации', 'Модель, питание и установка по проекту.')
  return lines
}
export function blankInput(line: CostLine): LineInput {
  return { quantity: null, price: null, waste: line.waste, pack: line.pack, supplier: '', quoteDate: '', note: '', excluded: false }
}
export function freshDraft(a: Apartment, spec: DesignSpec): EstimateDraft {
  if (hasBathroomBudget(a)) return {
    version: 1, projectId: a.id, modelKey: modelKey(a, spec), reservePercent: budget.reservePercent,
    inputs: Object.fromEntries(estimateLines(a, spec).map((line, i) => [line.id, {
      ...blankInput(line), price: budget.lines[i].price,
      supplier: budget.lines[i].url ?? 'Предварительный расчётный лимит; требуется предложение',
      quoteDate: budget.date, note: budget.lines[i].status,
    }])), custom: [],
  }
  return { version: 1, projectId: a.id, modelKey: modelKey(a, spec), reservePercent: 10, inputs: Object.fromEntries(estimateLines(a, spec).map(l => [l.id, blankInput(l)])), custom: [] }
}
export function priceLines(lines: CostLine[], draft: EstimateDraft): PricedLine[] {
  return [...lines, ...draft.custom].map(line => {
    const input = draft.inputs[line.id] ?? blankInput(line)
    const net = input.quantity ?? line.quantity
    const waste = line.category === 'Материалы' ? input.waste : 0
    const required = net === null ? null : net * (1 + waste / 100)
    const packs = required === null || input.pack === null || line.category !== 'Материалы' ? null : Math.ceil(round(required / input.pack, 9))
    const order = required === null ? null : round(packs !== null ? packs * input.pack! : required, 6)
    const amount = order === null || input.price === null || input.excluded ? null : round(order * input.price, 2)
    return { ...line, input, net, order, packs, amount, overridden: input.quantity !== null }
  })
}
export function estimateTotals(lines: PricedLine[], reservePercent: number) {
  const included = lines.filter(l => !l.input.excluded)
  const priced = included.filter(l => l.amount !== null)
  const subtotal = round(priced.reduce((s, l) => s + l.amount!, 0), 2)
  const reserve = round(subtotal * reservePercent / 100, 2)
  return { included: included.length, priced: priced.length, missing: included.length - priced.length, subtotal: priced.length ? subtotal : null, reserve: priced.length ? reserve : null, withReserve: priced.length ? round(subtotal + reserve, 2) : null, complete: included.length > 0 && priced.length === included.length }
}

/** Strict boundary for file imports and persisted inputs. Never silently turn invalid values into zero. */
export function parseDraft(raw: unknown, a: Apartment, spec: DesignSpec): EstimateDraft {
  if (!raw || typeof raw !== 'object') throw new Error('Файл сметы должен содержать объект.')
  const d = raw as EstimateDraft
  if (d.version !== 1 || d.projectId !== a.id || d.modelKey !== modelKey(a, spec)) throw new Error('Смета относится к другому проекту или ревизии. Сверьте её с текущей моделью; автоматическое применение отключено.')
  const numeric = (n: unknown, max: number, nullable = false) => (nullable && n === null) || (typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= max)
  const str = (s: unknown, limit = 1000) => typeof s === 'string' && s.length <= limit
  if (!numeric(d.reservePercent, 100) || !Array.isArray(d.custom) || d.custom.length > 100 || !d.inputs || Array.isArray(d.inputs) || typeof d.inputs !== 'object') throw new Error('Некорректные параметры сметы.')
  const base = estimateLines(a, spec)
  const ids = new Set(base.map(l => l.id))
  for (const l of d.custom) {
    if (!l || !str(l.id, 100) || !/^custom-[a-zA-Z0-9-]+$/.test(l.id) || ids.has(l.id) || !str(l.name, 200) || !l.name.trim() || !['Материалы','Работы','Оборудование','Прочее'].includes(l.category) || !str(l.unit, 20) || !l.unit.trim() || !numeric(l.quantity, 1e6, true) || !numeric(l.waste, 100) || !numeric(l.pack, 1e6, true) || l.pack === 0 || !str(l.source) || !str(l.note)) throw new Error('Некорректная дополнительная позиция.')
    ids.add(l.id)
  }
  if (Object.keys(d.inputs).some(id => !ids.has(id))) throw new Error('Смета содержит неизвестные позиции.')
  const inputs: Record<string, LineInput> = {}
  for (const l of [...base, ...d.custom]) {
    const v = d.inputs[l.id] ?? blankInput(l)
    if (!v || !numeric(v.quantity, 1e6, true) || !numeric(v.price, 1e9, true) || !numeric(v.waste, 100) || !numeric(v.pack, 1e6, true) || v.pack === 0 || !str(v.supplier, 500) || !str(v.note) || !str(v.quoteDate, 10) || (v.quoteDate !== '' && (!/^\d{4}-\d{2}-\d{2}$/.test(v.quoteDate) || !Number.isFinite(Date.parse(v.quoteDate)) || new Date(v.quoteDate).toISOString().slice(0, 10) !== v.quoteDate)) || typeof v.excluded !== 'boolean') throw new Error(`Некорректные значения в позиции «${l.name}».`)
    if (l.category !== 'Материалы' && (v.waste !== 0 || v.pack !== null)) throw new Error('Запас и упаковки применимы только к материалам.')
    inputs[l.id] = { quantity: v.quantity, price: v.price, waste: v.waste, pack: v.pack, supplier: v.supplier, note: v.note, quoteDate: v.quoteDate, excluded: v.excluded }
  }
  // Explicit projection accepts Vue proxies and keeps imported extra fields out of exports.
  const custom = d.custom.map(l => ({ id: l.id, name: l.name, category: l.category, unit: l.unit, quantity: l.quantity, source: l.source, note: l.note, waste: l.waste, pack: l.pack }))
  return { version: 1, projectId: a.id, modelKey: d.modelKey, reservePercent: d.reservePercent, inputs, custom }
}
export function estimateCsv(lines: PricedLine[]): string {
  const escape = (v: unknown) => {
    let s = v === null || v === undefined ? '' : String(v)
    // Formula injection prevention when a user supplied description is opened in Excel.
    if (/^[\s]*[=+@-]/.test(s)) s = "'" + s
    return '"' + s.replaceAll('"', '""') + '"'
  }
  const rows: unknown[][] = [['ID','Раздел','Позиция','Ед.','Чистый объём','Объём вручную','Запас %','Упаковка (ед.)','Упаковок','К оплате (ед.)','Цена за ед. KZT','Сумма KZT','Исключено','Поставщик / источник цены','Дата цены','Основание объёма','Примечание']]
  for (const l of lines) rows.push([l.id,l.category,l.name,l.unit,l.net,l.overridden ? 'Да' : 'Нет',l.input.waste,l.input.pack,l.packs,l.order,l.input.price,l.amount,l.input.excluded ? 'Да' : 'Нет',l.input.supplier,l.input.quoteDate,l.source,`${l.note} ${l.input.note}`])
  return '\uFEFF' + rows.map(r => r.map(escape).join(';')).join('\r\n')
}
