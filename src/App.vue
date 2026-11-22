<script setup lang="ts">
import { computed, ref, shallowRef, onMounted, onBeforeUnmount, nextTick, watch } from 'vue'
import { TresCanvas } from '@tresjs/core'
import { ACESFilmicToneMapping, PCFShadowMap, PCFSoftShadowMap } from 'three'
import SceneBridge from './components/SceneBridge.vue'
import DocumentWorkspace from './components/DocumentWorkspace.vue'
import VideoTour from './components/VideoTour.vue'
import PhotorealPanel from './components/PhotorealPanel.vue'
import DesignImages from './components/DesignImages.vue'
import LiveDesignPicker from './components/LiveDesignPicker.vue'
import LightingPanel from './components/LightingPanel.vue'
import './documentation.css'
import seed from './data/apartment.json'
import { parseApartment } from './domain/schema.ts'
import type { Apartment } from './domain/schema.ts'
import type { ViewMode } from './scene/canonical.ts'
import { roomSelectionView } from './scene/cameras.ts'
import type { LightingControls, LightingPreset } from './scene/lighting.ts'
import { renderNotice } from './scene/provenance.ts'
import { polygonArea } from './domain/math.ts'
import { base64 } from './scene/export.ts'
import { roomElectricalPoints } from './domain/electrical.ts'
import { planEntities } from './domain/drawings.ts'
import { wallMaterialForRoom } from './domain/wall-finishes.ts'
import { applyDesignStudy, DESIGN_VARIANTS, FEATURED_DESIGN_STUDIES } from './domain/design-variants.ts'
const query = new URLSearchParams(location.search)
const exportMode = query.has('export')
const section = ref(query.has('design') ? 'design' : query.has('tour') ? 'tour' : query.has('documents') ? 'documents' : 'viewer')
// A presentation, not an editor: the source JSON is the only saved design.
const model = shallowRef(parseApartment(seed))
const studyModels = new Map<string, Apartment>()
const studyChoices = [
  ...DESIGN_VARIANTS.filter(variant => variant.id === 'current'),
  ...FEATURED_DESIGN_STUDIES.flatMap(id => DESIGN_VARIANTS.filter(variant => variant.id === id)),
  ...DESIGN_VARIANTS.filter(variant => variant.category === 'concept' && variant.reference && !FEATURED_DESIGN_STUDIES.includes(variant.id)),
  ...DESIGN_VARIANTS.filter(variant => variant.category === 'concept' && !variant.reference),
]
const requestedStudy = ref('current')
const activeStudy = ref('current')
const previewModel = computed(() => studyModels.get(requestedStudy.value) ?? model.value)
const shownModel = shallowRef(model.value)
const activeConcept = computed(() => activeStudy.value === 'current' ? undefined : studyChoices.find(variant => variant.id === activeStudy.value))
const studySwitching = computed(() => requestedStudy.value !== activeStudy.value)
const walkingEntry = !exportMode && query.has('walk')
  ? model.value.rooms.find(candidate => candidate.id === 'living' && candidate.polygon)?.id
  : undefined
const room = ref(walkingEntry ?? 'all'),
  mode = ref<ViewMode>(walkingEntry ? 'interior' : 'dollhouse'),
  lighting = ref<LightingPreset>(walkingEntry && query.get('light') === 'evening' ? 'evening' : 'day')
const lightingControls = shallowRef<LightingControls>({ windows: lighting.value === 'day', sources: {} })
function resetLighting() {
  lightingControls.value = { windows: lighting.value === 'day', sources: {} }
}
function selectLighting(preset: LightingPreset) {
  lighting.value = preset
  resetLighting()
}
function toggleWindowLight(on: boolean) {
  lightingControls.value = { ...lightingControls.value, windows: on }
}
function toggleLightSource(id: string, on: boolean) {
  lightingControls.value = {
    ...lightingControls.value,
    sources: { ...lightingControls.value.sources, [id]: on },
  }
}
const dimensions = ref(false),
  ready = ref(false),
  error = ref('')
watch(mode, value => { if (value === 'plan') dimensions.value = true })
const dimensionItems = computed(() => planEntities(shownModel.value, room.value))
const cutaway = ref(false), showCeilings = ref(false)
const bridge = ref<InstanceType<typeof SceneBridge> | null>(null)
const photoMode = ref(false)
const photo = ref<{ url: string; title: string } | null>(null)
function selectStudy(id: string) {
  if (!studyChoices.some(variant => variant.id === id)) return
  try {
    if (id !== 'current' && !studyModels.has(id))
      studyModels.set(id, applyDesignStudy(model.value, id))
    error.value = ''
    requestedStudy.value = id
    if (mode.value === 'interior') viewport.value?.querySelector('canvas')?.focus({ preventScroll: true })
  } catch (failure) {
    error.value = failure instanceof Error ? failure.message : String(failure)
  }
}
function cycleStudy(step: number) {
  const index = studyChoices.findIndex(variant => variant.id === requestedStudy.value)
  selectStudy(studyChoices[(index + step + studyChoices.length) % studyChoices.length].id)
}
function studyShortcut(event: KeyboardEvent) {
  if (exportMode || photoMode.value || mode.value !== 'interior' || event.repeat || event.metaKey || event.ctrlKey || event.altKey ||
      !(event.target instanceof HTMLCanvasElement)) return
  if (event.code !== 'BracketLeft' && event.code !== 'BracketRight') return
  event.preventDefault()
  cycleStudy(event.code === 'BracketRight' ? 1 : -1)
}
function sceneReady(source: Apartment) {
  shownModel.value = source
  const match = [...studyModels].find(([, candidate]) => candidate === source)
  activeStudy.value = match?.[0] ?? 'current'
  requestedStudy.value = activeStudy.value
  ready.value = true
}
async function exportPhotoScene() {
  if (!bridge.value || !ready.value || mode.value !== 'interior') throw new Error('Выберите готовый ракурс изнутри комнаты.')
  return bridge.value.exportCurrent()
}
async function enterPhotoRoom() {
  photoMode.value = false
  if (room.value === 'all') await setRoom(model.value.rooms.find(r => r.id === 'living')?.id ?? model.value.rooms.find(r => r.polygon)!.id)
  await setView('interior')
}
function showPhoto(result: { url: string; title: string }) {
  photo.value = result
  photoMode.value = true
}
const currentRoom = computed(() => model.value.rooms.find((r) => r.id === room.value))
const wallFinishes = computed(() => {
  const a = shownModel.value, rooms = currentRoom.value ? [currentRoom.value] : a.rooms
  const ids = new Set(rooms.flatMap(r => a.objects
    .filter(o => o.wall && o.visible !== false && (o.roomId === r.id || o.sharedWith?.includes(r.id)))
    .map(o => wallMaterialForRoom(o, r))))
  return a.materials.filter(material => ids.has(material.id))
})
const kitchenFacade = computed(() => {
  const cabinet = shownModel.value.objects.find(o => o.roomId === 'kitchen' && o.kind === 'KitchenCabinet')
  return shownModel.value.materials.find(material => material.id === cabinet?.material)
})
const notice = computed(() => renderNotice(shownModel.value, room.value))
const completeGeometry = computed(() => model.value.rooms.every((r) => r.polygon))
const roomTitle = computed(
  () =>
    currentRoom.value?.name ?? (completeGeometry.value ? 'Вся квартира' : 'Доступная часть модели'),
)
const area = computed(() => currentRoom.value?.documentedArea ?? model.value.documentedArea)
const modelArea = computed(() =>
  currentRoom.value?.polygon ? (polygonArea(currentRoom.value.polygon) / 1e6).toFixed(2) : null,
)
const stories: Record<string, [string, string]> = {
  all: [
    'Ваш план. Новый интерьер.',
    'Контур восстановлен с исходного плана: боковой вход, лоджия за спальней, открытая кухня-ниша. Мебель и отделка предложены автоматически.',
  ],
  bathroom: [
    'Камень. Дуб. Свет.',
    'A3 / M1 / T1 / Д2. На стенах и полу — фото Laparet Noa. Гигиенический душ включён; смета, поставщики и график доступны в документах. Монтажные привязки предварительные.',
  ],
  bedroom: [
    'Место для тишины.',
    'Кровать 160 × 200, шкаф-купе до потолка с доборами у стен и ТВ. Рабочее место вынесено в гостиную.',
  ],
  living: [
    'Жить. Работать. Принимать.',
    'Шалфейный диван, обеденный стол и рабочее место у окна. Неглубокая ТВ-тумба сохраняет больше свободного места.',
  ],
  kitchen: [
    'Всё под рукой.',
    'Единый встроенный гарнитур с антресолью до потолка. Холодильник и посудомойка скрыты за общими фасадами, духовка и СВЧ собраны в колонне. Вытяжка встроена в верхний ряд.',
  ],
  hall: [
    'Дом начинается здесь.',
    'Шкаф до потолка и открытая ниша с банкеткой и зеркалом собраны в одной линии у входа. Проход остаётся свободным.',
  ],
  loggia: [
    'Маленькая пауза.',
    'Компактная скамья и кофейный столик. Отдельная спокойная зона для отдыха.',
  ],
}
const electricalPoints = computed(() =>
  roomElectricalPoints(model.value, room.value),
)
const story = computed(() => activeConcept.value && room.value !== 'bathroom'
  ? [activeConcept.value.label, activeConcept.value.description]
  : stories[room.value] ?? [roomTitle.value, currentRoom.value?.note ?? ''])
async function setRoom(id: string) {
  if (id !== 'all' && !model.value.rooms.some((r) => r.id === id && r.polygon))
    throw new Error('Unknown room')
  room.value = id
  photoMode.value = false
  mode.value = roomSelectionView(mode.value, id)
  await nextTick()
}
async function walkStudy(id: string, roomId: string) {
  selectStudy(id)
  section.value = 'viewer'
  photoMode.value = false
  const start = model.value.rooms.find(candidate => candidate.id === roomId && candidate.polygon)
    ?? model.value.rooms.find(candidate => candidate.id === 'living' && candidate.polygon)
    ?? model.value.rooms.find(candidate => candidate.polygon)
  if (!start) return
  room.value = start.id
  mode.value = 'interior'
  await nextTick()
  window.scrollTo(0, 0)
}
const views: [ViewMode, string][] = [
  ['dollhouse', 'Общий вид'],
  ['interior', 'Внутри'],
  ['plan', 'План'],
  ['electrical', 'Электрика'],
  ['ceiling', 'Потолки'],
]
const lights: [LightingPreset, string, string][] = [
  ['day', 'Материалы', 'Нейтральный обзорный свет: цвет, фактура и объём.'],
  ['clean', 'Основной', 'Основные светильники. Предварительный сценарий.'],
  ['evening', 'Вечер', 'Мягкий локальный свет. В санузле — только зеркало.'],
]
const viewport = ref<HTMLElement | null>(null)
function focusScene() {
  viewport.value?.querySelector('canvas')?.focus({ preventScroll: true })
}
const entryStudy = walkingEntry && query.get('study')
if (entryStudy) selectStudy(entryStudy)
watch(photoMode, value => {
  const canvas = viewport.value?.querySelector('canvas')
  if (!canvas) return
  canvas.inert = value
  if (value) canvas.blur()
})
const fullscreen = ref(false)
async function toggleFullscreen() {
  try {
    if (document.fullscreenElement) await document.exitFullscreen()
    else await viewport.value?.requestFullscreen()
  } catch {
    error.value = 'Полноэкранный режим недоступен в этом браузере.'
  }
}
const syncFullscreen = () => {
  fullscreen.value = !!document.fullscreenElement
}
onMounted(() => document.addEventListener('fullscreenchange', syncFullscreen))
onBeforeUnmount(() => document.removeEventListener('fullscreenchange', syncFullscreen))
const lightNote = computed(() => mode.value === 'interior'
  ? 'Окна и отдельные светильники можно переключить в меню «Свет» на сцене.'
  : lights.find((l) => l[0] === lighting.value)?.[2])
async function setView(view: ViewMode) {
  photoMode.value = false
  mode.value = view
  await nextTick()
  bridge.value?.resetCamera()
}
onMounted(() => {
  // CLI automation exists only in the explicit export page; the public view has no mutation API.
  if (!exportMode) return
  ;(window as any).__HOME_DESIGN__ = {
    get ready() {
      return ready.value
    },
    get model() {
      return structuredClone(model.value)
    },
    setModel: async (a: Apartment) => {
      studyModels.clear()
      requestedStudy.value = 'current'
      model.value = parseApartment(a)
      resetLighting()
      room.value = 'all'
      ready.value = false
      await nextTick()
    },
    setRoom,
    setView: async (v: ViewMode) => {
      if (!['dollhouse', 'plan', 'interior', 'free', 'ceiling', 'electrical'].includes(v))
        throw new Error('Unknown view')
      await setView(v)
    },
    export: async () => {
      const b = await bridge.value!.exportCurrent()
      return { glb: base64(b.glb), metadata: b.metadata }
    },
    setLighting: async (value: LightingPreset) => {
      if (!lights.some(([id]) => id === value)) throw new Error('Unknown lighting')
      selectLighting(value)
      await nextTick()
    },
    screenshot: () => bridge.value!.screenshot(),
    manifest: () => bridge.value!.manifest(),
    viewState: () => bridge.value!.viewState(),
    setStudy: selectStudy,
  }
})
</script>
<template>
  <div class="viewer">
    <header>
      <span class="brand">H<span>·</span></span>
      <div>
        <p class="eyebrow">HOME / DESIGN STUDY</p>
        <h1>
          {{ roomTitle }} <span>{{ area.toFixed(2) }} м² по плану</span>
        </h1>
      </div>
      <nav class="project-nav" aria-label="Раздел проекта">
        <button :aria-pressed="section === 'viewer'" @click="section = 'viewer'">
          3D-визуализация
        </button>
        <button :aria-pressed="section === 'documents'" @click="section = 'documents'">
          Смета и документы
        </button>
        <button :aria-pressed="section === 'tour'" @click="section = 'tour'">Видеотур</button>
        <button :aria-pressed="section === 'design'" @click="section = 'design'">Варианты дизайна</button>
      </nav>
    </header>
    <nav v-if="section === 'viewer'" class="room-nav" aria-label="Помещения">
      <button v-if="completeGeometry" :aria-pressed="room === 'all'" @click="setRoom('all')">
        Вся квартира
      </button>
      <span v-else class="sample-note">Остальные помещения: геометрия на сверке</span>
      <button
        v-for="r in model.rooms.filter((r) => r.polygon)"
        :key="r.id"
        :aria-pressed="room === r.id"
        @click="setRoom(r.id)"
      >
        {{ r.name }}
      </button>
    </nav>
    <main v-if="section === 'viewer'" :class="{ 'is-walking': mode === 'interior' }">
      <section ref="viewport" class="viewport" :class="{ 'is-photo': photoMode }" :aria-label="`Трёхмерный вид: ${roomTitle}`" @keydown="studyShortcut">
        <TresCanvas
          shadows
          :shadow-map-type="mode === 'interior' ? PCFShadowMap : PCFSoftShadowMap"
          :tone-mapping="ACESFilmicToneMapping"
          :tone-mapping-exposure="1.05"
          clear-color="#e7e5de"
          :dpr="[1, 2]"
          :fps-limit="40"
          :preserve-drawing-buffer="true"
        >
          <SceneBridge
            ref="bridge"
            :model="previewModel"
            :mode="mode"
            :room="room"
            :dimensions="dimensions"
            :cutaway="cutaway"
            :show-ceilings="showCeilings"
            :lighting="lighting"
            :lighting-controls="mode === 'interior' ? lightingControls : undefined"
            @ready="sceneReady"
            @busy="ready = false"
            @error="error = $event"
          />
        </TresCanvas>
        <div class="render-mode segmented" aria-label="Режим визуализации">
          <button :aria-pressed="!photoMode" @click="photoMode = false">Прогулка 3D</button>
          <button :aria-pressed="photoMode" @click="photoMode = true">Фотореализм</button>
        </div>
        <LiveDesignPicker v-if="!photoMode && !exportMode" :choices="studyChoices" :featured="FEATURED_DESIGN_STUDIES" :selected="requestedStudy"
          :active="activeStudy" :switching="studySwitching" :walking="mode === 'interior'"
          @select="selectStudy" @cycle="cycleStudy" />
        <LightingPanel v-if="mode === 'interior' && !photoMode && !exportMode"
          :model="shownModel" :room="room" :preset="lighting" :controls="lightingControls"
          @windows="toggleWindowLight" @source="toggleLightSource" @reset="resetLighting" @close="focusScene" />
        <div v-if="photoMode" class="photo-view">
          <template v-if="photo">
            <img :src="photo.url" :alt="`Рендер Cycles: ${photo.title}`" />
            <p>{{ photo.title }} · сохранённый ракурс. Вернитесь в 3D, чтобы продолжить прогулку.</p>
          </template>
          <div v-else class="photo-empty">
            <p class="eyebrow">ФОТОРЕАЛИЗМ / CYCLES</p>
            <h2>Ваш ракурс. Свет и фактура.</h2>
            <p>Войдите в комнату, выберите точку и запустите рендер в панели справа. Готовое изображение появится здесь.</p>
            <button @click="enterPhotoRoom">Выбрать ракурс в 3D</button>
          </div>
        </div>
        <div v-show="!photoMode && !activeConcept && mode !== 'interior'" class="scene-label">
          <span>{{ roomTitle.toUpperCase() }} / DESIGN STUDY</span><b>{{ story[0] }}</b>
          <small>{{
            room === 'bathroom'
              ? 'Выбранная композиция · A3 / M1 / T1 / Д2'
              : 'Авторская палитра · дуб / лён / шалфей'
          }}</small>
        </div>
        <div v-if="notice.length && !photoMode" class="generation-notice" role="note">
          <b>{{ notice[0] }}</b
          ><span>{{ notice[1] }}</span>
        </div>
        <div v-show="!photoMode" class="view-controls">
          <div class="segmented" aria-label="Ракурс">
            <button
              v-for="[id, label] in views"
              :key="id"
              :aria-pressed="mode === id"
              :disabled="id === 'interior' && room === 'all'"
              :title="
                id === 'interior' && room === 'all'
                  ? 'Выберите помещение для вида изнутри'
                  : undefined
              "
              @click="setView(id)"
            >
              {{ label }}
            </button>
          </div>
          <button class="reset" @click="bridge?.resetCamera()" aria-label="Вернуть исходный ракурс">
            ↺
          </button>
        </div>
        <button
          class="fullscreen"
          @click="toggleFullscreen"
          :aria-label="fullscreen ? 'Выйти из полного экрана' : 'На весь экран'"
          :aria-pressed="fullscreen"
        >
          ⛶
        </button>
        <div v-if="!ready && !error && !studySwitching" class="loading" role="status">Подготавливаю материалы…</div>
        <div v-if="error" role="alert" class="error">{{ error }}</div>
        <div v-show="!photoMode" class="view-caption">
          <span>{{
            mode === 'plan'
              ? 'Пропорции и расположение'
              : mode === 'interior'
                ? 'Нажми на сцену · WASD — идти · Shift — быстрее · потяни мышью — оглядеться · колесо — масштаб'
                : 'Потяни, чтобы осмотреть · колесо — приблизить'
          }}</span>
          <div class="visibility-controls">
            <label v-if="mode === 'dollhouse' || mode === 'free'"><input type="checkbox" v-model="cutaway" />Разрез стен</label>
            <label v-if="mode === 'dollhouse' || mode === 'free'"><input type="checkbox" v-model="showCeilings" />Потолки</label>
            <label><input type="checkbox" v-model="dimensions" />Размеры</label>
          </div>
        </div>
      </section>
      <aside>
        <p class="eyebrow">01 / АТМОСФЕРА</p>
        <h2>{{ story[0] }}</h2>
        <p class="intro">
          {{ story[1] }}
        </p>
        <p v-if="activeConcept?.reference && room !== 'bathroom'" class="light-note">
          {{ activeConcept.reference.lesson }}
          <a :href="activeConcept.reference.url" target="_blank" rel="noopener noreferrer">{{ activeConcept.reference.title }} · {{ activeConcept.reference.studio }} ↗</a>
        </p>
        <div class="light-options" aria-label="Сценарий света">
          <button
            v-for="[id, label] in lights"
            :key="id"
            :aria-pressed="lighting === id"
            @click="selectLighting(id)"
          >
            <span :class="['light-dot', id]"></span>{{ label }}
          </button>
        </div>
        <p class="light-note">{{ lightNote }}</p>
        <PhotorealPanel :ready="ready" :interior="mode === 'interior'" :room-title="activeConcept ? `${roomTitle} · ${activeConcept.label}` : roomTitle"
          :export-scene="exportPhotoScene" @enter="enterPhotoRoom" @result="showPhoto" />
        <div v-if="mode === 'ceiling'" class="design-status">
          <b>Потолок · вид снизу</b>
          <p>
            Белый матовый потолок, условная отметка 2850 мм. Светильники показаны на своём месте.
            Тип потолка и закладные — предложение.
          </p>
        </div>
        <div v-if="mode === 'electrical' || mode === 'plan'" class="design-status">
          <b>Розетки и выключатели · предложение</b>
          <p>
            {{ mode === 'electrical' ? 'Мебель скрыта, чтобы видеть точки.' : 'Точки показаны вместе с мебелью.' }} Высота указана до центра от условного чистого пола.
            Трассы, защита и монтаж не рассчитаны.
          </p>
          <p v-for="p in electricalPoints" :key="p.id">
            <b>{{ p.id }}</b> · {{ p.name }} · {{ p.electrical?.gangs }}
            {{ p.kind === 'Socket' ? 'роз.' : 'клав.' }} · h
            {{ Math.round(p.position[1] + p.size[1] / 2) }} мм
            <small v-if="room !== 'all' && p.roomId !== room"> · вне помещения, управление его светом</small>
          </p>
        </div>
        <div v-if="dimensions && dimensionItems.length && mode !== 'electrical' && mode !== 'ceiling'" class="design-status furniture-dimensions">
          <b>Габариты мебели и оборудования</b>
          <p>Ш × В × Г, мм — локальные размеры модели до поворота. Предварительно, не размеры для заказа. Тумба показана вместе с чашей и смесителем.</p>
          <p v-for="item in dimensionItems" :key="item.id"><b>{{ item.name }}</b><br>{{ item.size.join(' × ') }} мм</p>
        </div>
        <div class="divider"></div>
        <p class="eyebrow">02 / ОТДЕЛКА</p>
        <div v-for="finish in wallFinishes" :key="finish.id" class="material-row">
          <span class="swatch" :style="{ backgroundColor: finish.color, ...(finish.texture ? { backgroundImage: `url(${finish.texture})`, backgroundSize: 'cover' } : {}) }"></span>
          <div>
            <b>{{ finish.name }}</b
            ><small>{{
              room === 'bathroom'
                ? 'Стены · M1 / T1 · 1200 × 600'
                : room === 'all' ? 'Стены · внутренняя отделка помещений' : 'Стены · сторона выбранной комнаты'
            }}</small>
          </div>
        </div>
        <div v-if="!activeConcept || room === 'bathroom' || room === 'kitchen'" class="material-row">
          <span :class="['swatch', room === 'kitchen' ? '' : 'oak']" :style="room === 'kitchen' && kitchenFacade ? { backgroundColor: kitchenFacade.color } : undefined"></span>
          <div>
            <b>{{ room === 'kitchen' ? 'Единые фасады гарнитура' : 'Натуральный дуб' }}</b
            ><small>{{
              room === 'bathroom'
                ? 'Д2 · тумба и хозяйственная колонна'
                : room === 'kitchen' ? `${kitchenFacade?.name ?? 'Материал по модели'} · общий цоколь и верхняя линия`
                : 'Тёплый оттенок · пол и мебель'
            }}</small>
          </div>
        </div>
        <div v-if="!activeConcept || room === 'bathroom'" class="material-row">
          <span :class="['swatch', room === 'bathroom' ? 'ceramic' : 'sage']"></span>
          <div>
            <b>{{ room === 'bathroom' ? 'Белая керамика' : 'Лён и шалфей' }}</b
            ><small>{{
              room === 'bathroom'
                ? 'Мягкий глянец · сатиновый металл'
                : 'Мягкие ткани · спокойные акценты'
            }}</small>
          </div>
        </div>
        <p class="sample-note">
          {{ room === 'bathroom' ? 'Плитка показана фотографиями выбранных для сметы артикулов; тон и партию проверить по образцу. Фасады HPL на влагостойкой МДФ; дубовый декор пока условный. Свет санузла: 4000 K, CRI ≥90.' : 'Оттенки и фактуры условные. Автоматически предложенные мебель и отделка ещё не утверждены; артикулы не выбраны.' }}
        </p>
        <div class="design-status">
          <span>{{ room === 'bathroom' ? 'В ПРОРАБОТКЕ' : 'АВТОМАТИЧЕСКИЙ ВАРИАНТ' }}</span>
          <p>
            {{
              room === 'bathroom'
                ? 'Обмеры, паспорта изделий, монтажные привязки электрики и деталировка У1. Свет 4000 K и состав оборудования уже определены.'
                : 'Контур оцифрован по исходному PDF. Мебель и декор предложены автоматически; размеры по масштабу окна, не обмер.'
            }}
          </p>
        </div>
        <details>
          <summary>Размеры и допущения</summary>
          <p>{{ currentRoom?.note ?? model.generation?.note }}</p>
          <p v-if="modelArea">
            Площадь условной модели: {{ modelArea }} м². Площадь по исходному плану:
            {{ area.toFixed(2) }} м².
          </p>
          <p v-if="room === 'all'">
            45,99 м² — итог по исходному плану с учётной площадью лоджии 1,55 м². Полная площадь
            лоджии — 3,10 м². Контур оцифрован по чертежу; размер 2,4 м относится к окну, а не к
            ширине квартиры.
          </p>
          <p>
            Площади сверены с исходным PDF. Размеры модели сняты с изображения по масштабу окна;
            расстановка и монтажные размеры требуют обмеров. Свет показан для сравнения сценариев, а
            не расчёта освещённости.
          </p>
        </details>
      </aside>
    </main>
    <DocumentWorkspace v-else-if="section === 'documents'" :model="model" />
    <VideoTour v-else-if="section === 'tour'" />
    <DesignImages v-else :model="model" @preview="walkStudy" />
    <footer>
      <span>{{ section === 'design' ? 'Концепции интерьера · предложения для сравнения' : activeConcept && section === 'viewer' ? `${activeConcept.label} · предложение` : 'Все помещения · текущий проект' }} · санузел A3 / M1 / T1 / Д2</span
      ><span>Эскиз · размеры условные</span>
    </footer>
  </div>
</template>
