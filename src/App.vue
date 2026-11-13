<script setup lang="ts">
import { computed, ref, shallowRef, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { TresCanvas } from '@tresjs/core'
import { ACESFilmicToneMapping, PCFSoftShadowMap } from 'three'
import SceneBridge from './components/SceneBridge.vue'
import seed from './data/apartment.json'
import { parseApartment } from './domain/schema.ts'
import type { Apartment } from './domain/schema.ts'
import type { ViewMode } from './scene/canonical.ts'
import type { LightingPreset } from './scene/lighting.ts'
import { base64 } from './scene/export.ts'
const exportMode = new URLSearchParams(location.search).has('export')
// A presentation, not an editor: the source JSON is the only saved design.
const model = shallowRef(parseApartment(seed))
const room = ref('bathroom'),
  mode = ref<ViewMode>('dollhouse'),
  lighting = ref<LightingPreset>('day')
const dimensions = ref(false),
  ready = ref(false),
  error = ref('')
const bridge = ref<InstanceType<typeof SceneBridge> | null>(null)
const currentRoom = computed(() => model.value.rooms.find((r) => r.id === room.value))
const views: [ViewMode, string][] = [
  ['dollhouse', 'Общий вид'],
  ['interior', 'Внутри'],
  ['plan', 'План'],
]
const lights: [LightingPreset, string, string][] = [
  ['day', 'Материалы', 'Нейтральный обзорный свет: цвет, фактура и объём.'],
  ['clean', 'Основной', 'Две потолочные точки и свет у зеркала. Предложение G1 + G2.'],
  ['evening', 'Вечер', 'Только приглушённый свет у зеркала. Предложение G2.'],
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
      room.value = model.value.rooms.find((r) => r.polygon)?.id ?? ''
      ready.value = false
      await nextTick()
    },
    setView: async (v: ViewMode) => {
      if (!['dollhouse', 'plan', 'interior', 'free'].includes(v)) throw new Error('Unknown view')
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
          {{ currentRoom?.name }} <span>{{ currentRoom?.documentedArea.toFixed(2) }} м²</span>
        </h1>
      </div>
      <span class="readonly"><i></i> A3 / M1 / T1 / Д2 <span>Дизайн санузла</span></span>
    </header>
    <main>
      <section ref="viewport" class="viewport" aria-label="Трёхмерный вид санузла">
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
            :cutaway="true"
            :lighting="lighting"
            @ready="ready = true"
            @error="error = $event"
          />
        </TresCanvas>
        <div class="scene-label">
          <span>01 — САНУЗЕЛ</span><b>Камень. Дуб. Свет.</b><small>Выбранная композиция · A3</small>
        </div>
        <div class="view-controls">
          <div class="segmented" aria-label="Ракурс">
            <button
              v-for="[id, label] in views"
              :key="id"
              :aria-pressed="mode === id"
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
          }}</span
          ><label><input type="checkbox" v-model="dimensions" />Размеры</label>
        </div>
      </section>
      <aside>
        <p class="eyebrow">01 / АТМОСФЕРА</p>
        <h2>Свет меняет<br />восприятие.</h2>
        <p class="intro">
          Один интерьер, три состояния. Сравни фактуру при нейтральном свете и мягкий вечер у
          зеркала.
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
        <div class="divider"></div>
        <p class="eyebrow">02 / ОТДЕЛКА</p>
        <div class="material-row">
          <span class="swatch stone"></span>
          <div><b>Светлый камень</b><small>M1 / T1 · стены 1200 × 600 · пол 600 × 600</small></div>
        </div>
        <div class="material-row">
          <span class="swatch oak"></span>
          <div><b>Натуральный дуб</b><small>Д2 · тумба и хозяйственная колонна</small></div>
        </div>
        <div class="material-row">
          <span class="swatch ceramic"></span>
          <div><b>Белая керамика</b><small>Мягкий глянец · сатиновый металл</small></div>
        </div>
        <p class="sample-note">
          Оттенки и фактуры условные. Д2 определяет цвет дуба; конструкция фасадов и артикулы ещё не
          выбраны.
        </p>
        <div class="design-status">
          <span>В ПРОРАБОТКЕ</span>
          <p>Полотенцесушитель: место и модель. Деталировка запила У1. Свет и электрика.</p>
        </div>
        <details>
          <summary>Размеры и допущения</summary>
          <p>{{ currentRoom?.note }}</p>
          <p>
            Подтверждена площадь. Расстановка и монтажные размеры требуют обмеров. Свет показан для
            сравнения сценариев, а не расчёта освещённости.
          </p>
        </details>
      </aside>
    </main>
    <footer>
      <span>A3 · ванна · подвесная тумба · хозяйственная колонна</span
      ><span>Эскиз · размеры условные</span>
    </footer>
  </div>
</template>
