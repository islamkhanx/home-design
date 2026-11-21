<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import type { Apartment } from '../domain/schema.ts'
import spec from '../../docs/bathroom-spec.json'
import { blankInput, estimateLines, estimateTotals, freshDraft, modelKey, money, number, parseDraft, priceLines, estimateCsv } from '../domain/estimate.ts'
import { bathroomBudget, hasBathroomBudget } from '../domain/estimate.ts'
import type { CostCategory, EstimateDraft } from '../domain/estimate.ts'
import { acceptanceChecks, buildDossier, dossierHtml, workStages } from '../domain/dossier.ts'
const props = defineProps<{ model: Apartment }>()
const hasBudget = computed(() => hasBathroomBudget(props.model))
const sourcedProducts = bathroomBudget.lines.filter(l => l.url)
const lightingSources = spec.working_lighting.sources.map(url => ({ url, label: new URL(url).hostname }))
const tilePhotos: Record<string, string> = { 'budget-01': '/textures/laparet-noa/wall.jpg', 'budget-02': '/textures/laparet-noa/floor.jpg' }
const draft = ref<EstimateDraft>(freshDraft(props.model,spec))
const tab = ref('estimate'), category = ref('Все'), query = ref(''), onlyMissing = ref(false)
const notice = ref(''), persistence = ref('Изменения сохраняются в этом браузере'), oldDraft = ref('')
const file = ref<HTMLInputElement | null>(null)
const storageKey = `home-design:estimate:${props.model.id}`
try {
  const saved = localStorage.getItem(storageKey)
  if (saved) {
    try { draft.value = parseDraft(JSON.parse(saved),props.model,spec) }
    catch (error) { oldDraft.value = saved; try { localStorage.setItem(`${storageKey}:previous:${Date.now()}`, saved) } catch { /* Download remains available if storage is full. */ } notice.value = `Сохранённый черновик не применён. ${(error as Error).message}` }
  }
} catch { persistence.value = 'Хранилище недоступно: скачайте JSON, чтобы сохранить изменения.' }
watch(draft, value => {
  try {
    const checked = parseDraft(value,props.model,spec)
    localStorage.setItem(storageKey,JSON.stringify(checked))
    persistence.value = 'Сохранено в этом браузере · скачайте JSON для переноса'
  } catch(error) { persistence.value = `Не сохранено: ${(error as Error).message}` }
},{deep:true})
watch(()=>modelKey(props.model,spec),()=>{
  oldDraft.value = JSON.stringify(draft.value)
  draft.value = freshDraft(props.model,spec)
  notice.value = 'Модель изменилась. Создан новый расчёт; предыдущий черновик доступен для скачивания и сверки.'
})
const lines = computed(()=>priceLines(estimateLines(props.model,spec),draft.value))
const totals = computed(()=>estimateTotals(lines.value,draft.value.reservePercent))
const filtered = computed(()=>lines.value.filter(l => (category.value==='Все'||l.category===category.value) && (!onlyMissing.value || (!l.input.excluded && l.amount===null)) && `${l.name} ${l.id}`.toLowerCase().includes(query.value.toLowerCase())))
const dossier = computed(()=>buildDossier(props.model,spec,draft.value))
const drawingSheets = computed(()=>dossier.value.sheets.filter(s=>s.svg))
const drawingQuery = ref(''), sheetQuery = ref(''), coverageId = ref('')
const sheetList = ref<HTMLElement | null>(null)
const coverageStatus = { model: 'Схемы / ведомости из модели', 'requires-input': 'Требуются исходные данные', excluded: 'Исключено решением' }
const filteredDrawings = computed(()=>drawingSheets.value.filter(s=>`${s.id} ${s.title}`.toLowerCase().includes(drawingQuery.value.toLowerCase())))
const selectedCoverage = computed(()=>dossier.value.coverage.find(c=>c.id===coverageId.value))
const filteredSheets = computed(()=>dossier.value.sheets.filter(s=>(!selectedCoverage.value||selectedCoverage.value.sheetIds.includes(s.id))&&`${s.id} ${s.title}`.toLowerCase().includes(sheetQuery.value.toLowerCase())))
const activeDrawing = ref('03-coordination')
const drawing = computed(()=>drawingSheets.value.find(s=>s.id===activeDrawing.value)??drawingSheets.value[0])
const categories: CostCategory[] = ['Материалы','Работы','Оборудование','Прочее']
const categoriesTotals = computed(()=>categories.map(name=>({name,total:estimateTotals(lines.value.filter(l=>l.category===name),0)})))
const newName = ref(''), newCategory = ref<CostCategory>('Работы'), newUnit = ref('компл.')
async function showCoverage(id: string) {
  coverageId.value=id; sheetQuery.value=''
  await nextTick()
  sheetList.value?.scrollIntoView({block:'start',behavior:'smooth'})
}
function showDrawing(id: string) {
  activeDrawing.value=id; drawingQuery.value=''; tab.value='drawings'
}
function input(id: string) { return draft.value.inputs[id] }
function numeric(id: string, key: 'quantity'|'price'|'waste'|'pack', event: Event) {
  const element = event.target as HTMLInputElement
  const v = element.value === '' ? null : Number(element.value)
  const max = key==='waste'?100:key==='price'?1e9:1e6
  if ((v===null && key==='waste') || (v!==null && (!Number.isFinite(v)||v<0||v>max||(key==='pack'&&v===0)))) {
    notice.value = `Допустимо: ${key==='pack'?'больше 0':'от 0'} до ${max}. Пустое поле означает «не задано».`
    element.value = String(input(id)[key]??'')
    return
  }
  if(key==='waste') input(id).waste=v!
  else input(id)[key]=v
  notice.value = ''
}
function reserve(event: Event) {
  const el = event.target as HTMLInputElement, value = Number(el.value)
  if(el.value===''||!Number.isFinite(value)||value<0||value>100) { el.value=String(draft.value.reservePercent);notice.value='Резерв: от 0 до 100%.'; return }
  draft.value.reservePercent=value
}
function textInput(id: string, key: 'supplier'|'quoteDate'|'note', event: Event) {
  input(id)[key] = (event.target as HTMLInputElement).value
}
function addLine() {
  if(!newName.value.trim()) {notice.value='Введите название дополнительной позиции.';return}
  if(draft.value.custom.length>=100) {notice.value='Не более 100 дополнительных позиций.';return}
  const id=`custom-${crypto.randomUUID?.()??Date.now().toString(36)}`
  const line = {id,name:newName.value.trim(),category:newCategory.value,unit:newUnit.value.trim()||'компл.',quantity:null,source:'Добавлено пользователем',note:'Уточнить объём и состав; проверить отсутствие двойного счёта.',waste:0,pack:null}
  draft.value.custom.push(line)
  draft.value.inputs[id]=blankInput(line)
  newName.value=''; query.value=''; category.value='Все'; onlyMissing.value=false
  notice.value='Позиция добавлена в конец сметы.'
}
function download(name: string, content: string, type: string) {
  const url=URL.createObjectURL(new Blob([content],{type})), a=document.createElement('a')
  a.href=url; a.download=name; document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),10000)
}
function exportFile(kind: 'html'|'csv'|'json') {
  try {
    const checked=parseDraft(draft.value,props.model,spec)
    const key=modelKey(props.model,spec)
    if(kind==='json') download(`estimate-${key}.json`,JSON.stringify(checked,null,2),'application/json')
    if(kind==='csv') download(`estimate-${key}.csv`,estimateCsv(lines.value),'text/csv;charset=utf-8')
    if(kind==='html') download(`documents-${key}.html`,dossierHtml(buildDossier(props.model,spec,checked)),'text/html;charset=utf-8')
  } catch(error) { notice.value=(error as Error).message }
}
async function importFile(event: Event) {
  const source=(event.target as HTMLInputElement).files?.[0]
  if(!source)return
  try {
    if(source.size>2_000_000)throw new Error('Файл больше 2 МБ.')
    draft.value=parseDraft(JSON.parse(await source.text()),props.model,spec)
    notice.value='Смета загружена. Геометрия и решения проекта не изменены.'
  }catch(error){ notice.value=`Не удалось загрузить: ${(error as Error).message}` }
  finally { (event.target as HTMLInputElement).value='' }
}
function printPackage() {
  try {
    const checked=parseDraft(draft.value,props.model,spec)
    const frame=document.createElement('iframe')
    frame.title='Печатный комплект ремонта'
    frame.style.cssText='position:fixed;left:-15000px;top:0;width:1120px;height:800px;border:0'
    frame.onload=()=>{
      const win=frame.contentWindow
      if(!win)return
      win.addEventListener('afterprint',()=>frame.remove(),{once:true})
      win.focus();win.print()
    }
    frame.srcdoc=dossierHtml(buildDossier(props.model,spec,checked))
    document.body.append(frame)
  }catch(error){notice.value=`Печать не запущена: ${(error as Error).message}. Скачайте комплект HTML и откройте в браузере.`}
}
</script>
<template>
  <section class="document-workspace" aria-label="Смета и ремонтная документация">
    <div class="doc-hero">
      <div><p class="eyebrow">HOME / ПРОЕКТ И РЕАЛИЗАЦИЯ</p><h2>От проекта<br>к ремонту.</h2><p>Планы, развёртки и ведомости всей квартиры.<br>Детальная смета санузла · A3 / M1 / T1 / Д2.</p></div>
      <div class="doc-actions"><button class="doc-primary" @click="exportFile('html')">Скачать комплект</button><button @click="printPackage">Печать / PDF</button><span>{{ dossier.coverage.length }} типа документов · {{ dossier.sheets.length }} листов · предварительно</span></div>
    </div>
    <div class="doc-caution"><b>Сначала обмеры, затем выпуск в работу.</b><span>Санузел — 4,44 м² по исходному плану. Контур около 1859 × 2412 мм оцифрован, высота отделки 2850 мм предложена; это не обмер. Смета от 15.11.2026 содержит цены витрин и расчётные лимиты, включая все работы и гигиенический душ. Остальные помещения в стоимость не входят.</span></div>
    <div v-if="notice" class="doc-notice" role="status">{{ notice }}<button @click="notice=''" aria-label="Закрыть уведомление">×</button></div>
    <button v-if="oldDraft" class="doc-old" @click="download('previous-estimate.json',oldDraft,'application/json')">Скачать предыдущий неприменённый черновик</button>
    <nav class="doc-tabs" aria-label="Раздел документов"><button v-for="[id,label] in [['estimate','Смета'],['materials','Материалы и поставщики'],['drawings','Чертежи'],['package','Состав комплекта'],['workflow','Работы и приёмка']]" :key="id" :aria-pressed="tab===id" @click="tab=id">{{ label }}</button></nav>
    <div v-if="tab==='estimate'">
      <div class="doc-metrics">
        <div><small>Базовая оценка санузла</small><strong>{{ money(totals.subtotal) }}</strong><span>{{ totals.missing ? 'Бюджет неполный' : 'Оценены все включённые строки' }}</span></div>
        <div><small>Финансовый резерв</small><strong>{{ money(totals.reserve) }}</strong><label><input aria-label="Резерв процентов" type="number" min="0" max="100" :value="draft.reservePercent" @change="reserve"> % от известной части</label></div>
        <div><small>Бюджет с резервом</small><strong>{{ money(totals.withReserve) }}</strong><span>Не является итогом ремонта квартиры</span></div>
        <div><small>Рассчитано позиций</small><strong>{{ totals.priced }} <em>/ {{ totals.included }}</em></strong><span>{{ totals.missing }} требуют объёма или цены</span></div>
      </div>
      <div class="doc-category-totals"><span v-for="c in categoriesTotals" :key="c.name">{{ c.name }} <b>{{ money(c.total.subtotal) }}</b></span></div>
      <div class="doc-estimate-toolbar">
        <input v-model="query" type="search" placeholder="Найти позицию…" aria-label="Поиск по смете">
        <select v-model="category" aria-label="Раздел сметы"><option>Все</option><option v-for="c in categories" :key="c">{{ c }}</option></select>
        <label><input type="checkbox" v-model="onlyMissing"> Только без расчёта</label>
        <button @click="exportFile('csv')">CSV для Excel</button><button @click="exportFile('json')">Сохранить JSON</button><button @click="file?.click()">Загрузить JSON</button>
        <input ref="file" type="file" accept=".json,application/json" hidden @change="importFile">
      </div>
      <p class="doc-hint">Цены в ₸ за единицу строки, с согласованными налогами. Для материалов: объём × (1 + запас), затем округление до упаковки. Работы — без запаса. Пусто означает «нет данных»; 0 — явно заданный ноль.</p>
      <div class="doc-table-scroll"><table class="doc-estimate-table"><thead><tr><th>Учесть</th><th>Позиция / основание</th><th>Ед.</th><th>Чистый объём</th><th>Запас, %</th><th>Ед. в упаковке</th><th>К оплате</th><th>Цена за ед., ₸</th><th>Сумма, ₸</th></tr></thead><tbody>
        <tr v-for="l in filtered" :key="l.id" :class="{'doc-excluded':l.input.excluded}">
          <td><input type="checkbox" :checked="!l.input.excluded" :aria-label="`Включить: ${l.name}`" @change="input(l.id).excluded=!($event.target as HTMLInputElement).checked"></td>
          <td><b>{{ l.name }}</b><small>{{ l.category }} · {{ l.id }}</small><details><summary>Основание и предложение</summary><p>{{ l.source }}</p><p>{{ l.note }}</p><label>Поставщик / источник цены<input :value="l.input.supplier" maxlength="500" @input="textInput(l.id,'supplier',$event)"></label><label>Дата цены<input type="date" :value="l.input.quoteDate" @change="textInput(l.id,'quoteDate',$event)"></label><label>Комментарий<textarea :value="l.input.note" maxlength="1000" @input="textInput(l.id,'note',$event)"></textarea></label></details></td>
          <td>{{ l.unit }}</td><td><input type="number" min="0" max="1000000" step="any" :value="l.input.quantity??''" :placeholder="l.quantity===null?'Нужен объём':number(l.quantity)" :aria-label="`Объём: ${l.name}`" @change="numeric(l.id,'quantity',$event)"><small>{{ l.overridden?'Введено вручную':l.quantity===null?'Требует расчёта':hasBudget?'Предварительный объём сметы':'Из модели / спецификации' }}</small></td>
          <td><input v-if="l.category==='Материалы'" type="number" min="0" max="100" step="any" :value="l.input.waste" :aria-label="`Запас: ${l.name}`" @change="numeric(l.id,'waste',$event)"><span v-else>—</span></td>
          <td><input v-if="l.category==='Материалы'" type="number" min="0.000001" max="1000000" step="any" :value="l.input.pack??''" placeholder="Не задано" :aria-label="`Упаковка: ${l.name}`" @change="numeric(l.id,'pack',$event)"><span v-else>—</span></td>
          <td><b>{{ number(l.order) }}</b><small v-if="l.packs!==null">{{ l.packs }} уп.</small></td>
          <td><input type="number" min="0" max="1000000000" step="any" :value="l.input.price??''" placeholder="Нет цены" :aria-label="`Цена: ${l.name}`" @change="numeric(l.id,'price',$event)"></td>
          <td><b>{{ l.input.excluded?'Исключено':l.amount===null?'—':number(l.amount,2) }}</b></td>
        </tr>
        <tr v-if="!filtered.length"><td colspan="9">Нет позиций по выбранному фильтру.</td></tr>
      </tbody></table></div>
      <form class="doc-add" @submit.prevent="addLine"><h3>Дополнительная позиция</h3><input v-model="newName" maxlength="200" placeholder="Например, ревизионный люк" aria-label="Название дополнительной позиции" required><select v-model="newCategory" aria-label="Категория дополнительной позиции"><option v-for="c in categories" :key="c">{{ c }}</option></select><input v-model="newUnit" maxlength="20" aria-label="Единица дополнительной позиции" required><button type="submit">Добавить</button></form>
      <p class="doc-hint">{{ persistence }}. Исключение строки сохраняется в выгрузке. Для расчёта по предложению поставщика раскройте «Основание и предложение».</p>
    </div>
    <div v-if="tab==='materials'" class="doc-materials">
      <h3>Комплектация · Алматы · {{ bathroomBudget.date }}</h3>
      <p>Фотографии плитки взяты с карточек выбранных артикулов. Реальные оттенок, калибр и партия проверяются по образцу. Фасады под дуб пока показаны условно: конкретный мебельный декор не выбран.</p>
      <div class="doc-material-grid"><article v-for="p in sourcedProducts" :key="p.id">
        <img v-if="tilePhotos[p.id]" :src="tilePhotos[p.id]" :alt="p.name" loading="lazy">
        <small>{{ p.status }} · {{ bathroomBudget.date }}</small><h4>{{ p.name }}</h4>
        <b>{{ money(p.price) }} / {{ p.unit }}</b><p>{{ p.note }}</p>
        <a :href="p.url!" target="_blank" rel="noopener noreferrer">Карточка / каталог поставщика ↗</a>
      </article></div>
      <h3>Решения по санузлу</h3>
      <div class="doc-table-scroll"><table><thead><tr><th>Раздел</th><th>Решение</th><th>Основание</th></tr></thead><tbody><tr v-for="d in spec.decision_register" :key="d.topic"><td>{{ d.topic }}</td><td>{{ d.choice }}</td><td>{{ d.basis }}</td></tr></tbody></table></div>
      <p><b>Защита от протечек включена:</b> 120 000 ₸ комплект + 30 000 ₸ монтаж и проверка. Бойлер и тёплый пол исключены.</p>
      <p>Мебель HPL: общий лимит 400 000 ₸ с раковиной и монтажом; цену выбранной конструкции должен подтвердить изготовитель.</p>
      <h3>Перед заказом и монтажом</h3><ul><li v-for="item in spec.pending" :key="item">{{ item }}</li></ul>
      <p>Основания выбора света: <a v-for="source in lightingSources" :key="source.url" :href="source.url" target="_blank" rel="noopener noreferrer">{{ source.label }} ↗ </a></p>
      <p><b>Гигиенический душ обязателен и уже включён:</b> 45 000 ₸ комплект/подводка + 20 000 ₸ монтаж. Заказная мебель, часть оборудования и работы имеют расчётные лимиты.</p>
    </div>
    <div v-if="tab==='drawings'" class="doc-drawings">
      <div class="doc-drawing-list"><input v-model="drawingQuery" type="search" aria-label="Поиск чертежа" placeholder="Найти чертёж…"><button v-for="s in filteredDrawings" :key="s.id" :aria-pressed="drawing?.id===s.id" @click="activeDrawing=s.id"><small>{{ s.id }}</small>{{ s.title }}</button><p v-if="!filteredDrawings.length">Чертежи не найдены.</p><p>Схемы получены из общей 3D-модели. Размеры условные. Сетка плитки показывает формат, а не карту реза.</p></div>
      <div v-if="drawing" class="doc-drawing"><p class="eyebrow">{{ drawing.status }}</p><h3>{{ drawing.title }}</h3><div v-html="drawing.svg"></div><p v-for="p in drawing.paragraphs" :key="p">{{ p }}</p></div>
    </div>
    <div v-if="tab==='package'" class="doc-package">
      <div class="doc-section-intro"><h3>Состав по {{ dossier.coverage.length }} типам документов</h3><p>Сверено с <a :href="dossier.reference.url" target="_blank" rel="noopener noreferrer">перечнем Земстандарта ↗</a> · {{ dossier.reference.checkedAt }}. Статус показывает наличие данных, а не готовность к строительству. В каждом разделе — связанные листы и то, что ещё нужно уточнить.</p></div>
      <div class="doc-table-scroll doc-coverage"><table><thead><tr><th>Раздел / документ</th><th>Состояние</th><th>Что требуется уточнить</th><th>В комплекте</th></tr></thead><tbody>
        <tr v-for="c in dossier.coverage" :key="c.id"><td><small>{{ c.section }} · {{ c.id }}</small><b>{{ c.title }}</b></td><td>{{ coverageStatus[c.status] }}</td><td>{{ c.missing.join('; ') || 'Исходные сведения приведены на листах' }}</td><td><button @click="showCoverage(c.id)">Листы: {{ c.sheetIds.length }}</button></td></tr>
      </tbody></table></div>
      <div ref="sheetList" class="doc-sheet-controls"><input v-model="sheetQuery" type="search" placeholder="Название или номер листа…" aria-label="Поиск листа"><select v-model="coverageId" aria-label="Тип документа"><option value="">Все документы</option><option v-for="c in dossier.coverage" :key="c.id" :value="c.id">{{ c.id }} · {{ c.title }}</option></select><span>{{ filteredSheets.length }} листов</span><button v-if="coverageId||sheetQuery" @click="coverageId='';sheetQuery=''">Сбросить</button></div>
      <details v-for="s in filteredSheets" :key="s.id"><summary><span class="doc-sheet-id">{{ s.id }}</span><b>{{ s.title }}</b><span class="doc-sheet-status">{{ s.status }}</span></summary><p v-for="p in s.paragraphs" :key="p">{{ p }}</p><div v-if="s.table" class="doc-table-scroll"><table><thead><tr><th v-for="h in s.table.headers" :key="h">{{ h }}</th></tr></thead><tbody><tr v-for="(r,i) in s.table.rows" :key="i"><td v-for="(c,j) in r" :key="j">{{ c }}</td></tr></tbody></table></div><p v-if="s.svg"><button @click="showDrawing(s.id)">Открыть чертёж</button></p></details>
      <p v-if="!filteredSheets.length" class="doc-hint">Листы не найдены. Измените поиск или тип документа.</p>
    </div>
    <div v-if="tab==='workflow'" class="doc-workflow"><template v-if="hasBudget"><h3>График санузла · 6–7 недель до полной готовности</h3><p>Рабочие дни от старта, 5 дней в неделю. Материалы должны быть доступны к соответствующему этапу; сушка по техлисту. Заказная мебель изготавливается параллельно финишным работам.</p><div class="doc-table-scroll"><table><thead><tr><th>Этап</th><th>Рабочие дни</th><th>Условие</th></tr></thead><tbody><tr v-for="r in bathroomBudget.schedule" :key="r[0]"><td>{{ r[0] }}</td><td>{{ r[1] }}–{{ Number(r[1])+Number(r[2])-1 }}</td><td>{{ r[3] }}</td></tr></tbody></table></div></template><h3>Порядок работ</h3><p>Даты, длительности и исполнители назначаются после согласования проекта. Технологические паузы — по выбранным материалам.</p><div class="doc-stages"><article v-for="r in workStages" :key="r[0]"><span>{{ r[0] }}</span><h4>{{ r[1] }}</h4><small>{{ r[2] }}</small><p>{{ r[3] }}</p></article></div><h3>Приёмка и скрытые работы</h3><div class="doc-table-scroll"><table><thead><tr><th>Этап</th><th>Проверка</th><th>Что получить</th></tr></thead><tbody><tr v-for="r in acceptanceChecks" :key="r[0]"><td v-for="(c,i) in r" :key="i">{{ c }}</td></tr></tbody></table></div><p>В печатном комплекте есть формы для факта, даты, замечаний и подписей. Ни одна работа не помечается выполненной автоматически.</p></div>
  </section>
</template>
