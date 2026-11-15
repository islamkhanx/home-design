<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { Apartment } from '../domain/schema.ts'
import spec from '../../docs/bathroom-spec.json'
import { blankInput, estimateLines, estimateTotals, freshDraft, modelKey, money, number, parseDraft, priceLines, estimateCsv } from '../domain/estimate.ts'
import type { CostCategory, EstimateDraft } from '../domain/estimate.ts'
import { acceptanceChecks, buildDossier, dossierHtml, workStages } from '../domain/dossier.ts'
const props = defineProps<{ model: Apartment }>()
const draft = ref<EstimateDraft>(freshDraft(props.model,spec))
const tab = ref('estimate'), category = ref('Все'), query = ref(''), onlyMissing = ref(false)
const notice = ref(''), persistence = ref('Изменения сохраняются в этом браузере'), oldDraft = ref('')
const file = ref<HTMLInputElement | null>(null)
const storageKey = `home-design:estimate:${props.model.id}`
try {
  const saved = localStorage.getItem(storageKey)
  if (saved) {
    try { draft.value = parseDraft(JSON.parse(saved),props.model,spec) }
    catch (error) { oldDraft.value = saved; notice.value = `Сохранённый черновик не применён. ${(error as Error).message}` }
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
const activeDrawing = ref('03')
const drawing = computed(()=>drawingSheets.value.find(s=>s.id===activeDrawing.value)??drawingSheets.value[0])
const categories: CostCategory[] = ['Материалы','Работы','Оборудование','Прочее']
const categoriesTotals = computed(()=>categories.map(name=>({name,total:estimateTotals(lines.value.filter(l=>l.category===name),0)})))
const newName = ref(''), newCategory = ref<CostCategory>('Работы'), newUnit = ref('компл.')
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
      <div><p class="eyebrow">HOME / ПРОЕКТ И РЕАЛИЗАЦИЯ</p><h2>От проекта<br>к ремонту.</h2><p>Смета, ведомости и рабочие материалы<br>в одном комплекте. Санузел · A3 / M1 / T1 / Д2.</p></div>
      <div class="doc-actions"><button class="doc-primary" @click="exportFile('html')">Скачать комплект</button><button @click="printPackage">Печать / PDF</button><span>{{ dossier.sheets.length }} листов · предварительная версия</span></div>
    </div>
    <div class="doc-caution"><b>Сначала обмеры, затем выпуск в работу.</b><span>Санузел 1800 × 2470 × 2700 мм — условная модель. Цены заполняются по предложениям поставщиков. Остальные помещения включены в реестр; схемы доступны только при наличии геометрии. В текущую смету они не входят.</span></div>
    <div v-if="notice" class="doc-notice" role="status">{{ notice }}<button @click="notice=''" aria-label="Закрыть уведомление">×</button></div>
    <button v-if="oldDraft" class="doc-old" @click="download('previous-estimate.json',oldDraft,'application/json')">Скачать предыдущий неприменённый черновик</button>
    <nav class="doc-tabs" aria-label="Раздел документов"><button v-for="[id,label] in [['estimate','Смета'],['drawings','Чертежи'],['package','Состав комплекта'],['workflow','Работы и приёмка']]" :key="id" :aria-pressed="tab===id" @click="tab=id">{{ label }}</button></nav>
    <div v-if="tab==='estimate'">
      <div class="doc-metrics">
        <div><small>Известная часть сметы</small><strong>{{ money(totals.subtotal) }}</strong><span>{{ totals.missing ? 'Бюджет неполный' : 'Оценены все включённые строки' }}</span></div>
        <div><small>Финансовый резерв</small><strong>{{ money(totals.reserve) }}</strong><label><input aria-label="Резерв процентов" type="number" min="0" max="100" :value="draft.reservePercent" @change="reserve"> % от известной части</label></div>
        <div><small>Известная часть с резервом</small><strong>{{ money(totals.withReserve) }}</strong><span>Не является итогом ремонта квартиры</span></div>
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
          <td>{{ l.unit }}</td><td><input type="number" min="0" max="1000000" step="any" :value="l.input.quantity??''" :placeholder="l.quantity===null?'Нужен объём':number(l.quantity)" :aria-label="`Объём: ${l.name}`" @change="numeric(l.id,'quantity',$event)"><small>{{ l.overridden?'Введено вручную':l.quantity===null?'Требует расчёта':'Из модели / спецификации' }}</small></td>
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
    <div v-if="tab==='drawings'" class="doc-drawings">
      <div class="doc-drawing-list"><button v-for="s in drawingSheets" :key="s.id" :aria-pressed="drawing?.id===s.id" @click="activeDrawing=s.id"><small>{{ s.id }}</small>{{ s.title }}</button><p>Схемы получены из общей 3D-модели. Размеры условные. Сетка плитки показывает формат, а не карту реза.</p></div>
      <div v-if="drawing" class="doc-drawing"><p class="eyebrow">{{ drawing.status }}</p><h3>{{ drawing.title }}</h3><div v-html="drawing.svg"></div><p v-for="p in drawing.paragraphs" :key="p">{{ p }}</p></div>
    </div>
    <div v-if="tab==='package'" class="doc-package">
      <div class="doc-section-intro"><h3>Комплект для обсуждения и доведения до рабочего проекта</h3><p>Каждый лист содержит ревизию и статус. Инженерные разделы сейчас оформлены как задания: без выдуманных трасс, номиналов и монтажных привязок.</p></div>
      <details v-for="s in dossier.sheets" :key="s.id"><summary><span class="doc-sheet-id">{{ s.id }}</span><b>{{ s.title }}</b><span class="doc-sheet-status">{{ s.status }}</span></summary><p v-for="p in s.paragraphs" :key="p">{{ p }}</p><div v-if="s.table" class="doc-table-scroll"><table><thead><tr><th v-for="h in s.table.headers" :key="h">{{ h }}</th></tr></thead><tbody><tr v-for="(r,i) in s.table.rows" :key="i"><td v-for="(c,j) in r" :key="j">{{ c }}</td></tr></tbody></table></div><p v-if="s.svg">Чертёж доступен во вкладке «Чертежи» и в полном комплекте.</p></details>
    </div>
    <div v-if="tab==='workflow'" class="doc-workflow"><h3>Порядок работ</h3><p>Даты, длительности и исполнители назначаются после согласования проекта. Технологические паузы — по выбранным материалам.</p><div class="doc-stages"><article v-for="r in workStages" :key="r[0]"><span>{{ r[0] }}</span><h4>{{ r[1] }}</h4><small>{{ r[2] }}</small><p>{{ r[3] }}</p></article></div><h3>Приёмка и скрытые работы</h3><div class="doc-table-scroll"><table><thead><tr><th>Этап</th><th>Проверка</th><th>Что получить</th></tr></thead><tbody><tr v-for="r in acceptanceChecks" :key="r[0]"><td v-for="(c,i) in r" :key="i">{{ c }}</td></tr></tbody></table></div><p>В печатном комплекте есть формы для факта, даты, замечаний и подписей. Ни одна работа не помечается выполненной автоматически.</p></div>
  </section>
</template>
