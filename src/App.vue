<script setup lang="ts">
import { computed, ref, shallowRef, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { TresCanvas } from '@tresjs/core'
import { ACESFilmicToneMapping, PCFSoftShadowMap } from 'three'
import SceneBridge from './components/SceneBridge.vue'
import DocumentWorkspace from './components/DocumentWorkspace.vue'
import VideoTour from './components/VideoTour.vue'
import './documentation.css'
import seed from './data/apartment.json'
import { parseApartment } from './domain/schema.ts'
import type { Apartment } from './domain/schema.ts'
import type { ViewMode } from './scene/canonical.ts'
import type { LightingPreset } from './scene/lighting.ts'
import { renderNotice } from './scene/provenance.ts'
import { polygonArea } from './domain/math.ts'
import { base64 } from './scene/export.ts'
const exportMode = new URLSearchParams(location.search).has('export')
const section = ref(new URLSearchParams(location.search).has('tour') ? 'tour' : new URLSearchParams(location.search).has('documents') ? 'documents' : 'viewer')
// A presentation, not an editor: the source JSON is the only saved design.
const model = shallowRef(parseApartment(seed))
const room = ref('all'),
  mode = ref<ViewMode>('dollhouse'),
  lighting = ref<LightingPreset>('day')
const dimensions = ref(false),
  ready = ref(false),
  error = ref('')
const cutaway = ref(false), showCeilings = ref(false)
const bridge = ref<InstanceType<typeof SceneBridge> | null>(null)
const currentRoom = computed(() => model.value.rooms.find((r) => r.id === room.value))
const notice = computed(() => renderNotice(model.value, room.value))
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
    'Сохранена выбранная композиция A3 / M1 / T1 / Д2. Свет, монтажные привязки и полотенцесушитель ещё в проработке.',
  ],
  bedroom: [
    'Место для тишины.',
    'Кровать 160 × 200, большой светлый шкаф и ТВ. Рабочее место вынесено в гостиную.',
  ],
  living: [
    'Жить. Работать. Принимать.',
    'Шалфейный диван, обеденный стол и отдельное рабочее место у окна. Дуб связывает мебель в единую композицию.',
  ],
  kitchen: [
    'Всё под рукой.',
    'Открытая кухня-ниша: угловой ряд, дубовые фасады, светлый верх и каменная столешница. Соседство помещений сохранено по исходному плану.',
  ],
  hall: [
    'Дом начинается здесь.',
    'Светлое хранение у входа, зеркало в полный рост и компактная банкетка.',
  ],
  loggia: [
    'Маленькая пауза.',
    'Кресло, кофейный столик и низкий шкаф. Отдельная спокойная зона для отдыха.',
  ],
}
const electricalPoints = computed(() =>
  model.value.objects.filter(
    (o) => o.electrical && (room.value === 'all' || o.roomId === room.value),
  ),
)
const story = computed(
  () => stories[room.value] ?? [roomTitle.value, currentRoom.value?.note ?? ''],
)
async function setRoom(id: string) {
  if (id !== 'all' && !model.value.rooms.some((r) => r.id === id && r.polygon))
    throw new Error('Unknown room')
  room.value = id
  if (id === 'all' && mode.value === 'interior') mode.value = 'dollhouse'
  await nextTick()
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
const lightNote = computed(() => lights.find((l) => l[0] === lighting.value)?.[2])
async function setView(view: ViewMode) {
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
      model.value = parseApartment(a)
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
      lighting.value = value
      await nextTick()
    },
    screenshot: () => bridge.value!.screenshot(),
    manifest: () => bridge.value!.manifest(),
    viewState: () => bridge.value!.viewState(),
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
    <main v-if="section === 'viewer'">
      <section ref="viewport" class="viewport" :aria-label="`Трёхмерный вид: ${roomTitle}`">
        <TresCanvas
          shadows
          :shadow-map-type="PCFSoftShadowMap"
          :tone-mapping="ACESFilmicToneMapping"
          :tone-mapping-exposure="1.05"
          clear-color="#e7e5de"
          :dpr="[1, 2]"
          :fps-limit="40"
          :preserve-drawing-buffer="true"
        >
          <SceneBridge
            ref="bridge"
            :model="model"
            :mode="mode"
            :room="room"
            :dimensions="dimensions"
            :cutaway="cutaway"
            :show-ceilings="showCeilings"
            :lighting="lighting"
            @ready="ready = true"
            @error="error = $event"
          />
        </TresCanvas>
        <div class="scene-label">
          <span>{{ roomTitle.toUpperCase() }} / DESIGN STUDY</span><b>{{ story[0] }}</b>
          <small>{{
            room === 'bathroom'
              ? 'Выбранная композиция · A3 / M1 / T1 / Д2'
              : 'Авторская палитра · дуб / лён / шалфей'
          }}</small>
        </div>
        <div v-if="notice.length" class="generation-notice" role="note">
          <b>{{ notice[0] }}</b
          ><span>{{ notice[1] }}</span>
        </div>
        <div class="view-controls">
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
        <div v-if="!ready && !error" class="loading">Подготавливаю материалы…</div>
        <div v-if="error" role="alert" class="error">{{ error }}</div>
        <div class="view-caption">
          <span>{{
            mode === 'plan'
              ? 'Пропорции и расположение'
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
        <div class="light-options" aria-label="Сценарий света">
          <button
            v-for="[id, label] in lights"
            :key="id"
            :aria-pressed="lighting === id"
            @click="lighting = id"
          >
            <span :class="['light-dot', id]"></span>{{ label }}
          </button>
        </div>
        <p class="light-note">{{ lightNote }}</p>
        <div v-if="mode === 'ceiling'" class="design-status">
          <b>Потолок · вид снизу</b>
          <p>
            Белый матовый потолок, условная отметка 2850 мм. Светильники показаны на своём месте.
            Тип потолка и закладные — предложение.
          </p>
        </div>
        <div v-if="mode === 'electrical'" class="design-status">
          <b>Розетки и выключатели · предложение</b>
          <p>
            Мебель скрыта, чтобы видеть точки. Высота указана до центра от условного чистого пола.
            Трассы, защита и монтаж не рассчитаны.
          </p>
          <p v-for="p in electricalPoints" :key="p.id">
            <b>{{ p.id }}</b> · {{ p.name }} · {{ p.electrical?.gangs }}
            {{ p.kind === 'Socket' ? 'роз.' : 'клав.' }} · h
            {{ Math.round(p.position[1] + p.size[1] / 2) }} мм
          </p>
        </div>
        <div class="divider"></div>
        <p class="eyebrow">02 / ОТДЕЛКА</p>
        <div class="material-row">
          <span class="swatch stone"></span>
          <div>
            <b>Светлый камень</b
            ><small>{{
              room === 'bathroom'
                ? 'M1 / T1 · стены 1200 × 600 · пол 600 × 600'
                : 'Матовый камень · кухня и санузел'
            }}</small>
          </div>
        </div>
        <div class="material-row">
          <span class="swatch oak"></span>
          <div>
            <b>Натуральный дуб</b
            ><small>{{
              room === 'bathroom'
                ? 'Д2 · тумба и хозяйственная колонна'
                : 'Тёплый оттенок · пол и мебель'
            }}</small>
          </div>
        </div>
        <div class="material-row">
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
          Оттенки и фактуры условные. Автоматически предложенные мебель и отделка ещё не утверждены.
          Артикулы не выбраны.
        </p>
        <div class="design-status">
          <span>{{ room === 'bathroom' ? 'В ПРОРАБОТКЕ' : 'АВТОМАТИЧЕСКИЙ ВАРИАНТ' }}</span>
          <p>
            {{
              room === 'bathroom'
                ? 'Полотенцесушитель: место и модель. Деталировка запила У1. Свет и электрика.'
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
    <VideoTour v-else />
    <footer>
      <span>Все помещения · единая палитра · санузел A3 / M1 / T1 / Д2</span
      ><span>Эскиз · размеры условные</span>
    </footer>
  </div>
</template>
