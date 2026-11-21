<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { Apartment } from '../domain/schema.ts'

const props = defineProps<{ model: Apartment }>()
const emit = defineEmits<{ preview: [studyId: string, roomId: string] }>()
type DesignFeatures = { walls: string; furniture: string; lighting: string; materials: string }
type BuiltReference = { title: string; studio: string; url: string; lesson: string }
type Variant = {
  id: string
  label: string
  description: string
  swatches: string[]
  category?: 'concept' | 'palette' | 'reference'
  features?: DesignFeatures
  lighting?: { preset: string; label: string }
  reference?: BuiltReference
}
type CatalogRoom = { id: string; name: string; allowedVariants: string[] }
type DesignItem = {
  id: string
  label: string
  status: 'pending' | 'preparing' | 'rendering' | 'done' | 'cancelled' | 'error'
  image?: string
  prompt?: string
  plan?: string
  roomPlan?: string
  elevations?: string[]
  conceptImage?: string
  conceptLabel?: string
  reference?: BuiltReference
  scope?: string
  geometryPassed?: boolean
  architectureUnchanged?: boolean
  geometryUnchanged?: boolean
  changes?: string[]
  changeSummary?: { furniture: number; lighting: number; wallPanels: number; materials: number }
}
type DesignJob = {
  id: string
  status: 'starting' | 'running' | 'prepared' | 'done' | 'cancelled' | 'error'
  room: string
  roomName: string
  sourceRevision?: number
  sourceHash?: string
  preset: string
  requestedDevice?: 'auto' | 'cpu' | 'gpu'
  percent: number
  completed: number
  total: number
  elapsedSeconds: number
  message: string
  error?: string
  items: DesignItem[]
}
const rooms = ref<CatalogRoom[]>([])
const variants = ref<Variant[]>([])
const room = ref(
  props.model.rooms.find((r) => r.id === 'living' && r.polygon)?.id ??
    props.model.rooms.find((r) => r.polygon)?.id ??
    '',
)
const selected = ref(['current'])
const preset = ref('draft')
const device = ref('auto')
const available = ref(false)
const connecting = ref(true)
const serverMessage = ref('')
const token = ref('')
const requestBusy = ref(false)
const error = ref('')
const pollError = ref('')
const job = ref<DesignJob | null>(null)
const modelHash = ref<string | null>(null)
const expanded = ref<DesignItem | null>(null)
const lightbox = ref<HTMLDialogElement | null>(null)
const active = computed(
  () => job.value != null && ['starting', 'running'].includes(job.value.status),
)
const locked = computed(() => active.value || requestBusy.value)
const selectedRoom = computed(() => rooms.value.find((r) => r.id === room.value))
const allowed = computed(() => selectedRoom.value?.allowedVariants ?? [])
const conceptVariants = computed(() =>
  variants.value.filter((v) => v.id === 'current' || v.reference),
)
const earlierConcepts = computed(() =>
  variants.value.filter((v) => v.category === 'concept' && !v.reference),
)
const paletteVariants = computed(() =>
  variants.value.filter((v) => v.category === 'palette' || ['warm', 'contrast'].includes(v.id)),
)
const results = computed(() =>
  (job.value?.items ?? []).map((item) => ({
    ...item,
    reference: item.reference ?? variants.value.find((variant) => variant.id === item.id)?.reference,
  })),
)
const featureLabels: Record<keyof DesignFeatures, string> = {
  walls: 'Стены',
  furniture: 'Мебель',
  lighting: 'Свет',
  materials: 'Материалы',
}
const choiceCount = computed(() => selected.value.filter((id) => allowed.value.includes(id)).length)
const progress = computed(() => Math.max(0, Math.min(100, job.value?.percent ?? 0)))
const staleJob = computed(() =>
  job.value?.sourceHash && modelHash.value
    ? job.value.sourceHash !== modelHash.value
    : job.value?.sourceRevision !== undefined && job.value.sourceRevision !== props.model.revision,
)
const labels: Record<string, string> = {
  starting: 'Подготовка вариантов',
  running: 'Создание изображений',
  prepared: 'Схемы и задания готовы',
  done: 'Изображения готовы',
  cancelled: 'Генерация остановлена',
  error: 'Не удалось завершить генерацию',
  pending: 'В очереди',
  preparing: 'Подготовка схемы',
  rendering: 'Рендер изображения',
}
const storageKey = 'home-design:design-images:last-job'
let alive = true
let modelHashRun = 0
let timer: ReturnType<typeof setTimeout> | undefined
watch(
  () => props.model,
  async (model) => {
    const run = ++modelHashRun
    modelHash.value = null
    try {
      if (!globalThis.crypto?.subtle) return
      const bytes = new TextEncoder().encode(JSON.stringify(model))
      const hash = await globalThis.crypto.subtle.digest('SHA-256', bytes)
      if (alive && run === modelHashRun)
        modelHash.value = Array.from(new Uint8Array(hash), (byte) =>
          byte.toString(16).padStart(2, '0'),
        ).join('')
    } catch {
      // Older or non-secure browsers retain the revision comparison.
    }
  },
  { deep: true, immediate: true },
)
function remember(id: string | null) {
  try {
    if (id) sessionStorage.setItem(storageKey, id)
    else sessionStorage.removeItem(storageKey)
  } catch {
    /* The workflow also reconnects through the local catalog. */
  }
}
function remembered() {
  try {
    return sessionStorage.getItem(storageKey)
  } catch {
    return null
  }
}
async function json(url: string, init?: RequestInit) {
  const response = await fetch(url, init)
  const data = await response.json().catch(() => null)
  if (!response.ok || !data) {
    const failure = new Error(data?.error ?? 'Локальный сервер недоступен.')
    Object.assign(failure, { status: response.status })
    throw failure
  }
  return data
}
function post(body: Record<string, unknown> = {}): RequestInit {
  return {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-render-token': token.value },
    body: JSON.stringify(body),
  }
}
async function refreshToken() {
  const status = await json('/__local/status')
  token.value = status.token
  if (!status.available) throw new Error('Blender не найден на этом компьютере.')
}
watch([room, allowed], () => {
  selected.value = selected.value.filter((id) => allowed.value.includes(id))
  if (!selected.value.length && allowed.value.length) selected.value = [allowed.value[0]]
})
watch(expanded, async (item) => {
  await nextTick()
  if (!alive) return
  if (item) lightbox.value?.showModal()
  else lightbox.value?.close()
})
async function poll(id: string) {
  clearTimeout(timer)
  let retry = true
  try {
    const data: DesignJob = await json('/__local/design/jobs/' + encodeURIComponent(id))
    if (!alive) return
    job.value = data
    pollError.value = ''
    retry = ['starting', 'running'].includes(data.status)
    if (retry) {
      room.value = data.room
      preset.value = data.preset
      if (data.requestedDevice) device.value = data.requestedDevice
      selected.value = data.items.map((item) => item.id)
    }
  } catch (e) {
    if (!alive) return
    if ((e as { status?: number }).status === 404) {
      remember(null)
      retry = false
      job.value = null
      pollError.value = 'Предыдущая задача больше не доступна. Можно создать новые варианты.'
    } else {
      pollError.value =
        'Связь с сервером прервалась. Проверяю снова; готовые изображения остаются на диске.'
    }
  } finally {
    if (alive && retry) timer = setTimeout(() => void poll(id), 2000)
  }
}
async function connect() {
  connecting.value = true
  error.value = ''
  try {
    const [status, catalog] = await Promise.all([
      json('/__local/status'),
      json('/__local/design/catalog'),
    ])
    if (!alive) return
    token.value = status.token
    available.value = !!catalog.available
    serverMessage.value = catalog.message ?? status.message ?? ''
    rooms.value = catalog.rooms
    const preferred: string[] = catalog.defaultVariants ?? []
    const incoming: Variant[] = catalog.variants
    variants.value = [
      ...preferred.flatMap(id => incoming.filter(variant => variant.id === id)),
      ...incoming.filter(variant => !preferred.includes(variant.id)),
    ]
    if (catalog.defaultVariants?.length)
      selected.value = catalog.defaultVariants.filter((id: string) => allowed.value.includes(id))
    if (!rooms.value.some((r) => r.id === room.value)) room.value = rooms.value[0]?.id ?? ''
    const id = catalog.latestJobId ?? remembered()
    if (id) {
      remember(id)
      await poll(id)
    }
  } catch {
    if (alive) {
      available.value = false
      serverMessage.value =
        'Откройте локальное приложение через npm run dev, чтобы создавать изображения.'
    }
  } finally {
    if (alive) connecting.value = false
  }
}
onMounted(() => {
  if (location.protocol === 'file:') {
    connecting.value = false
    serverMessage.value = 'Автономный HTML показывает проект, но не запускает рендер.'
    return
  }
  void connect()
})
onBeforeUnmount(() => {
  alive = false
  clearTimeout(timer)
})
async function start() {
  if (locked.value || !available.value || !choiceCount.value) return
  requestBusy.value = true
  error.value = ''
  pollError.value = ''
  try {
    await refreshToken()
    const result = await json(
      '/__local/design/start',
      post({
        room: room.value,
        variants: selected.value.filter((id) => allowed.value.includes(id)),
        preset: preset.value,
        device: device.value,
      }),
    )
    remember(result.id)
    if (alive) await poll(result.id)
  } catch (e) {
    if (alive) error.value = (e as Error).message
  } finally {
    if (alive) requestBusy.value = false
  }
}
async function cancel() {
  if (!job.value || requestBusy.value) return
  requestBusy.value = true
  error.value = ''
  const id = job.value.id
  try {
    await refreshToken()
    await json('/__local/design/cancel/' + encodeURIComponent(id), post())
    if (alive) await poll(id)
  } catch (e) {
    if (alive) error.value = (e as Error).message
  } finally {
    if (alive) requestBusy.value = false
  }
}
function elapsed(seconds: number) {
  const minutes = Math.floor(Math.max(0, seconds) / 60)
  return minutes < 60
    ? `${minutes} мин ${Math.floor(Math.max(0, seconds) % 60)} с`
    : `${Math.floor(minutes / 60)} ч ${minutes % 60} мин`
}
function resultChanges(item: DesignItem) {
  if (!item.changeSummary || item.geometryUnchanged !== false) return item.changes ?? []
  // Catalog descriptions express the style direction. A room may only have
  // space for part of that composition, so results use actual placement counts.
  const walls = item.changeSummary.wallPanels
    ? `Элементы отделки стен: ${item.changeSummary.wallPanels}.`
    : 'Дополнительные стеновые панели не установлены.'
  return [walls, ...(item.changes ?? []).filter((change) => !change.startsWith('Стены:'))]
}
</script>

<template>
  <section class="design-workspace">
    <div class="design-heading">
      <div>
        <h2>Сравнение интерьеров</h2>
        <p class="design-intro">
          Посмотрите концепции всей квартиры в 3D или сравните их на рендерах из выбранной комнаты.
        </p>
      </div>
      <div class="design-source">
        <span>Источник</span><b>Модель · ревизия {{ model.revision }}</b
        ><small>Контуры и проёмы из проекта</small>
      </div>
    </div>
    <div v-if="connecting" class="design-empty" role="status">Подключаю локальный рендер…</div>
    <div v-else-if="!available" class="design-empty">
      <h3>Изображения создаёт Blender на вашем компьютере</h3>
      <p>{{ serverMessage }}</p>
      <p>
        Запуск приложения: <code>npm run dev</code>. Blender должен быть установлен; путь можно
        указать в <code>BLENDER_PATH</code>.
      </p>
      <button class="design-secondary" @click="connect">Проверить подключение</button>
    </div>

    <template v-if="variants.length">
      <div class="design-settings">
        <label
          >Помещение<select v-model="room" :disabled="locked">
            <option v-for="item in rooms" :key="item.id" :value="item.id">{{ item.name }}</option>
          </select></label
        >
        <label
          v-if="available"
          >Качество<select v-model="preset" :disabled="locked">
            <option value="draft">Быстрая проба · 480 × 270</option>
            <option value="preview">Просмотр · 960 × 540</option>
            <option value="quality">Финал · 1920 × 1080</option>
            <option value="ultra">Печать · 3840 × 2160</option>
          </select></label
        >
        <label
          v-if="available"
          >Устройство<select v-model="device" :disabled="locked">
            <option value="auto">Авто · GPU, иначе CPU</option>
            <option value="gpu">Только GPU · Metal на Mac</option>
            <option value="cpu">Только CPU</option>
          </select></label
        >
      </div>
      <fieldset class="design-variants" :disabled="locked">
        <legend>Концепции для сравнения</legend>
        <article
          v-for="variant in conceptVariants"
          :key="variant.id"
          class="design-variant"
          :class="{
            selected: selected.includes(variant.id),
            unavailable: !allowed.includes(variant.id),
            reference: variant.id === 'current',
          }"
        >
          <label class="design-variant-title">
            <input
              v-model="selected"
              type="checkbox"
              :value="variant.id"
              :aria-label="variant.label"
              :disabled="!available || !allowed.includes(variant.id)"
            /><b>{{ variant.label }}</b>
          </label>
          <span class="design-swatches" aria-hidden="true"
            ><i
              v-for="color in variant.swatches"
              :key="color"
              :style="{ backgroundColor: color }"
            ></i
          ></span>
          <p>{{ variant.description }}</p>
          <details v-if="variant.features" class="design-elevations">
            <summary>Отделка, мебель и свет</summary>
            <dl class="design-features">
              <div v-for="(description, key) in variant.features" :key="key">
                <dt>{{ featureLabels[key] }}</dt>
                <dd>{{ description }}</dd>
              </div>
            </dl>
          </details>
          <template v-if="variant.reference">
            <p>{{ variant.reference.lesson }}</p>
            <div class="design-reference-links">
              <a :href="variant.reference.url" target="_blank" rel="noopener noreferrer">
                {{ variant.reference.title }} · {{ variant.reference.studio }} ↗
              </a>
              <button v-if="allowed.includes(variant.id)" type="button" @click="emit('preview', variant.id, room)">Посмотреть в 3D</button>
            </div>
          </template>
        </article>
      </fieldset>
      <details v-if="earlierConcepts.length" class="design-palette-options">
        <summary>Прежние концепции</summary>
        <fieldset class="design-variants design-palettes" :disabled="locked">
          <legend class="sr-only">Прежние концепции</legend>
          <label v-for="variant in earlierConcepts" :key="variant.id" class="design-variant"
            :class="{ selected: selected.includes(variant.id), unavailable: !allowed.includes(variant.id) }">
            <span class="design-variant-title">
              <input v-model="selected" type="checkbox" :value="variant.id" :aria-label="variant.label"
                :disabled="!available || !allowed.includes(variant.id)" />
              <b>{{ variant.label }}</b>
            </span>
            <p>{{ variant.description }}</p>
          </label>
        </fieldset>
      </details>
      <details v-if="paletteVariants.length" class="design-palette-options">
        <summary>Только смена палитры · {{ paletteVariants.length }} прежних варианта</summary>
        <fieldset class="design-variants design-palettes" :disabled="locked">
          <legend class="sr-only">Варианты цвета без изменения форм</legend>
          <label
            v-for="variant in paletteVariants"
            :key="variant.id"
            class="design-variant"
            :class="{
              selected: selected.includes(variant.id),
              unavailable: !allowed.includes(variant.id),
            }"
          >
            <div class="design-variant-title">
              <input
                v-model="selected"
                type="checkbox"
                :value="variant.id"
                :aria-label="variant.label"
                :disabled="!available || !allowed.includes(variant.id)"
              />
              <b>{{ variant.label }}</b>
            </div>
            <span class="design-swatches" aria-hidden="true">
              <i
                v-for="color in variant.swatches"
                :key="color"
                :style="{ backgroundColor: color }"
              ></i>
            </span>
            <p>{{ variant.description }}</p>
          </label>
        </fieldset>
      </details>
      <p v-if="room === 'bathroom'" class="design-note">
        Для санузла доступен текущий проект: выбранные материалы, мебель и свет сохранены.
      </p>
      <div v-if="available" class="design-actions">
        <button
          v-if="!active"
          class="design-primary"
          :disabled="requestBusy || !choiceCount"
          @click="start"
        >
          {{ requestBusy ? 'Запуск…' : `Создать изображения · ${choiceCount}` }}
        </button>
        <button v-else class="design-secondary" :disabled="requestBusy" @click="cancel">
          {{ requestBusy ? 'Останавливаю…' : 'Остановить' }}
        </button>
        <span>Варианты рендерятся последовательно. На CPU это может занять время.</span>
      </div>
    </template>

    <p v-if="error" class="design-error" role="alert">{{ error }}</p>
    <p v-if="pollError" class="design-note" role="status">{{ pollError }}</p>
    <p v-if="staleJob" class="design-note design-stale" role="status">
      Сравнение сохранено по прежнему состоянию модели. Создайте новое сравнение, чтобы увидеть
      последние изменения квартиры.
    </p>
    <div v-if="job" class="design-progress" aria-live="polite">
      <p
        v-if="
          job.items.some((item) => ['warm', 'contrast'].includes(item.id)) &&
          job.items.every((item) => ['current', 'warm', 'contrast'].includes(item.id))
        "
        class="design-note"
      >
        Здесь сохранено прежнее сравнение палитр. Для новых форм мебели, стен и света выберите
        концепции выше.
      </p>
      <div>
        <b>{{ labels[job.status] ?? job.status }} · {{ job.roomName }}</b
        ><span>{{ Math.floor(progress) }}%</span>
      </div>
      <progress :value="progress" max="100" aria-label="Прогресс создания вариантов"></progress>
      <p>{{ job.message }}</p>
      <div class="design-stats">
        <span>{{ job.completed }} / {{ job.total }} изображений</span
        ><span>{{ elapsed(job.elapsedSeconds) }}</span
        ><span>{{
          job.preset === 'ultra'
            ? '4K'
            : job.preset === 'quality'
              ? 'Full HD'
              : job.preset === 'draft'
                ? '480 × 270'
                : '960 × 540'
        }}</span>
        <span v-if="job.sourceRevision">Ревизия {{ job.sourceRevision }}</span>
      </div>
      <p v-if="job.error" class="design-error" role="alert">{{ job.error }}</p>
      <button v-if="!active" class="design-refresh" @click="poll(job.id)">
        Обновить изображения
      </button>
    </div>

    <div v-if="job && results.length" class="design-gallery">
      <article v-for="item in results" :key="job.id + item.id" class="design-result">
        <button
          v-if="item.image"
          class="design-image-button"
          :aria-label="`Открыть изображение: ${item.label}`"
          @click="expanded = item"
        >
          <img
            :src="item.image"
            :alt="`${job.roomName}: ${item.label}, концепция по модели квартиры`"
            loading="lazy"
          />
        </button>
        <div v-else class="design-placeholder">
          <span>{{ labels[item.status] ?? item.status }}</span
          ><small>{{ item.label }}</small>
        </div>
        <div class="design-result-body">
          <h3>{{ item.label }}</h3>
          <template v-if="item.reference">
            <p>{{ item.reference.lesson }}</p>
            <div class="design-reference-links">
              <a :href="item.reference.url" target="_blank" rel="noopener noreferrer">
                {{ item.reference.title }} · {{ item.reference.studio }} ↗
              </a>
              <button type="button" @click="emit('preview', item.id, job.room)">Посмотреть в 3D</button>
            </div>
          </template>
          <p>
            {{
              item.geometryPassed
                ? 'Геометрия этого варианта проверена после рендера.'
                : 'Вариант по схемам и модели проекта.'
            }}
          </p>
          <div
            v-if="item.changeSummary && item.geometryUnchanged === false"
            class="design-change-counts"
          >
            <span v-if="item.scope === 'all'">Вся квартира</span>
            <span>Панели · {{ item.changeSummary.wallPanels }}</span>
            <span v-if="item.changeSummary.furniture"
              >Мебель · {{ item.changeSummary.furniture }}</span
            >
            <span v-if="item.changeSummary.lighting">Свет · {{ item.changeSummary.lighting }}</span>
          </div>
          <ul v-if="resultChanges(item).length" class="design-changes">
            <li v-for="change in resultChanges(item)" :key="change">{{ change }}</li>
          </ul>
          <p v-if="item.architectureUnchanged" class="design-architecture">
            Контуры, проёмы и высоты сохранены.
            {{
              item.geometryUnchanged === false
                ? 'Мебель, свет и декор изменены в этой концепции.'
                : 'Геометрия предметов сохранена.'
            }}
          </p>
          <div class="design-result-links">
            <a v-if="item.image" :href="item.image" :download="`${job.room}-${item.id}.png`"
              >Скачать PNG</a
            ><a v-if="item.plan" :href="item.plan" target="_blank" rel="noopener">План квартиры</a
            ><a v-if="item.roomPlan" :href="item.roomPlan" target="_blank" rel="noopener"
              >Схема комнаты</a
            ><a
              v-if="item.prompt"
              :href="item.prompt"
              :download="`${job.room}-${item.id}-prompt.txt`"
              >Задание для ИИ</a
            >
          </div>
          <details v-if="item.elevations?.length" class="design-elevations">
            <summary>Развёртки стен · {{ item.elevations.length }}</summary>
            <div class="design-result-links">
              <a
                v-for="(url, index) in item.elevations"
                :key="url"
                :href="url"
                target="_blank"
                rel="noopener"
                >Стена {{ index + 1 }}</a
              >
            </div>
          </details>
          <div v-if="item.conceptImage" class="design-concept">
            <b>{{ item.conceptLabel ?? 'ИИ-концепция · геометрия не проверена' }}</b>
            <button
              class="design-image-button"
              :aria-label="`Открыть ИИ-концепцию: ${item.label}`"
              @click="
                expanded = {
                  ...item,
                  image: item.conceptImage,
                  label: item.label + ' · ИИ-концепция',
                }
              "
            >
              <img
                :src="item.conceptImage"
                :alt="`ИИ-концепция: ${item.label}, геометрия не проверена`"
                loading="lazy"
              />
            </button>
            <a :href="item.conceptImage" :download="`${job.room}-${item.id}-concept.png`"
              >Скачать концепцию</a
            >
          </div>
        </div>
      </article>
    </div>
    <div class="design-handoff">
      <h3>Нужны свободные идеи от ИИ?</h3>
      <p>
        У каждой концепции есть схема и отдельное задание со стилем и ограничениями. Передайте их
        генератору изображений вместе с готовым рендером. ИИ может менять детали и пропорции — такие
        изображения остаются концепциями для обсуждения.
      </p>
      <p>
        Основные изображения создаются локально в Blender из геометрии проекта; ключ ИИ-сервиса не
        требуется. Добавленные ИИ-концепции отмечаются отдельно.
      </p>
    </div>

    <dialog
      ref="lightbox"
      class="design-lightbox"
      :aria-label="expanded?.label ?? 'Изображение варианта'"
      @click.self="expanded = null"
      @close="expanded = null"
    >
      <template v-if="expanded?.image"
        ><button class="design-lightbox-close" autofocus @click="expanded = null">Закрыть ×</button
        ><img :src="expanded.image" :alt="expanded.label" />
        <p>{{ expanded.label }}</p></template
      >
    </dialog>
  </section>
</template>

<style scoped>
.design-refresh {
  padding: 0;
  margin-top: 18px;
  border: 0;
  background: transparent;
  color: #4d6443;
  text-decoration: underline;
  text-underline-offset: 4px;
  font-size: 12px;
}
.design-elevations {
  margin-top: 16px;
}
.design-elevations .design-result-links {
  margin-top: 14px;
}
.design-concept {
  border-top: 1px solid #e2e2d8;
  margin-top: 20px;
  padding-top: 18px;
}
.design-concept > b {
  display: block;
  font-size: 11px;
  font-weight: 550;
  color: #8b7550;
  margin-bottom: 12px;
}
.design-concept .design-image-button {
  border-radius: 6px;
  overflow: hidden;
}
.design-concept > a {
  display: inline-block;
  margin-top: 12px;
  font-size: 12px;
  color: #4d6443;
  text-underline-offset: 4px;
}
.design-workspace {
  max-width: 1280px;
  margin: auto;
  padding: 44px 32px 70px;
  color: #344130;
}
.design-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 35px;
}
.design-heading h2 {
  font-size: 44px;
  letter-spacing: -1.5px;
  margin: 12px 0;
}
.design-intro {
  max-width: 680px;
  line-height: 1.7;
  color: #77816b;
  font-size: 14px;
}
.design-source {
  flex: none;
  display: grid;
  gap: 8px;
  padding-left: 24px;
  border-left: 1px solid #d8ddcf;
  font-size: 13px;
}
.design-source span,
.design-source small {
  font-size: 11px;
  color: #858b79;
}
.design-note {
  background: #eee9db;
  padding: 15px 20px;
  border-radius: 9px;
  font-size: 12px;
  line-height: 1.65;
  margin: 12px 0;
}
.design-stale {
  border-left: 3px solid #aa8a45;
  color: #786337;
}
.design-settings {
  display: flex;
  flex-wrap: wrap;
  gap: 20px;
  margin: 30px 0;
}
.design-settings label {
  display: grid;
  gap: 9px;
  font-size: 12px;
}
.design-settings select {
  font: inherit;
  padding: 12px 15px;
  border: 1px solid #d6decd;
  border-radius: 7px;
  background: white;
  color: #43543b;
  min-width: 190px;
}
.design-variants {
  border: 0;
  padding: 0;
  margin: 28px 0;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
}
.design-variants legend {
  padding: 0;
  margin-bottom: 14px;
  font-size: 13px;
  font-weight: 600;
}
.design-variant {
  padding: 20px;
  border: 1px solid #dce0d3;
  border-radius: 12px;
  background: #fcfcf9;
}
label.design-variant, .design-variant-title { cursor: pointer; }
.design-variant.selected {
  border-color: #8f9c7e;
  background: #f1f3ec;
  box-shadow: inset 0 0 0 1px #8f9c7e;
}
.design-variant.unavailable {
  opacity: 0.55;
  cursor: default;
}
.design-variant-title {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 14px;
}
.design-reference-links {
  display: flex;
  align-items: baseline;
  gap: 8px 16px;
  flex-wrap: wrap;
  margin-top: 12px;
  font-size: 12px;
}
.design-reference-links a, .design-reference-links button {
  color: #465d39;
  text-underline-offset: 3px;
}
.design-reference-links button {
  background: none;
  border: none;
  padding: 0;
  text-decoration: underline;
  font: inherit;
  cursor: pointer;
}
.design-variant.reference {
  grid-column: 1 / -1;
  padding: 17px 20px;
}
.design-variant.reference .design-swatches {
  float: right;
  margin: 12px 0 0 24px;
}
.design-variant.reference .design-features {
  display: none;
}
.design-features {
  margin: 20px 0 0;
  display: grid;
  gap: 11px;
}
.design-features > div {
  display: grid;
  grid-template-columns: 68px 1fr;
  gap: 10px;
  font-size: 11px;
  line-height: 1.55;
}
.design-features dt {
  font-weight: 600;
  color: #59664f;
}
.design-features dd {
  margin: 0;
  color: #76816a;
}
.design-palette-options {
  margin: 20px 0;
  color: #76816a;
  font-size: 12px;
}
.design-palette-options summary {
  cursor: pointer;
  padding: 6px 0;
}
.design-palettes {
  margin: 16px 0;
}
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}
.design-variant input {
  accent-color: #637e50;
  margin: 0;
}
.design-variant p {
  font-size: 12px;
  line-height: 1.6;
  color: #79816d;
  margin: 14px 0 0;
}
.design-variant small {
  display: block;
  font-size: 11px;
  line-height: 1.5;
  color: #857555;
  margin-top: 12px;
}
.design-swatches {
  display: flex;
  gap: 7px;
  margin-top: 14px;
}
.design-swatches i {
  width: 22px;
  height: 22px;
  display: block;
  border-radius: 50%;
  border: 1px solid #00000010;
}
.design-actions {
  display: flex;
  align-items: center;
  gap: 20px;
  margin: 24px 0;
}
.design-actions > span {
  font-size: 11px;
  color: #858c79;
  line-height: 1.6;
  max-width: 340px;
}
.design-primary,
.design-secondary {
  padding: 13px 20px;
  border-radius: 7px;
  font: inherit;
  font-size: 13px;
  cursor: pointer;
}
.design-primary {
  background: #4d6443;
  color: white;
  border: 1px solid #4d6443;
}
.design-secondary {
  background: #fff;
  color: #4d6443;
  border: 1px solid #bfcab5;
}
button:disabled,
fieldset:disabled .design-variant {
  opacity: 0.55;
  cursor: default;
}
.design-empty,
.design-progress {
  padding: 24px;
  background: white;
  border: 1px solid #dfe3d8;
  border-radius: 12px;
  margin: 28px 0;
}
.design-empty h3,
.design-handoff h3 {
  font-size: 16px;
  font-weight: 550;
  margin: 0 0 10px;
}
.design-empty p {
  font-size: 12px;
  line-height: 1.8;
  color: #7b836f;
}
.design-progress > div:first-of-type {
  display: flex;
  justify-content: space-between;
  gap: 18px;
  font-size: 13px;
}
.design-progress progress {
  width: 100%;
  height: 18px;
  accent-color: #637e50;
  margin: 14px 0;
}
.design-progress p {
  font-size: 12px;
  color: #7b836f;
  line-height: 1.7;
  margin: 4px 0 12px;
}
.design-stats {
  display: flex;
  gap: 24px;
  flex-wrap: wrap;
  font-size: 12px;
  color: #77816b;
}
.design-error {
  padding: 12px 16px;
  border-radius: 7px;
  background: #f4e5df;
  color: #984c3c !important;
  font-size: 12px;
  line-height: 1.6;
}
.design-gallery {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 22px;
  margin: 30px 0;
}
.design-result {
  border: 1px solid #dfe3d8;
  border-radius: 12px;
  overflow: hidden;
  background: white;
}
.design-image-button {
  display: block;
  width: 100%;
  padding: 0;
  border: 0;
  background: #e8e6df;
}
.design-image-button img {
  display: block;
  width: 100%;
  aspect-ratio: 16/9;
  object-fit: contain;
}
.design-placeholder {
  aspect-ratio: 16/9;
  background: linear-gradient(130deg, #ecece4, #e2e5d9);
  display: flex;
  flex-direction: column;
  gap: 9px;
  align-items: center;
  justify-content: center;
  color: #7c876e;
  font-size: 14px;
}
.design-placeholder small {
  font-size: 11px;
}
.design-result-body {
  padding: 20px;
}
.design-result h3 {
  font-size: 16px;
  font-weight: 550;
  margin: 0 0 8px;
}
.design-result p {
  font-size: 11px;
  color: #858d7a;
  line-height: 1.6;
  margin: 0 0 16px;
}
.design-change-counts {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin: 10px 0 16px;
}
.design-change-counts span {
  background: #eef0e8;
  color: #68745c;
  border-radius: 4px;
  padding: 5px 7px;
  font-size: 10px;
}
.design-changes {
  margin: 0 0 16px;
  padding-left: 17px;
  font-size: 11px;
  line-height: 1.65;
  color: #6e7c62;
}
.design-changes li + li {
  margin-top: 5px;
}
.design-result p.design-architecture {
  border-top: 1px solid #eceee5;
  padding-top: 12px;
  font-size: 10px;
}
.design-result-links {
  display: flex;
  flex-wrap: wrap;
  gap: 18px;
}
.design-result-links a {
  font-size: 12px;
  color: #4d6443;
  text-decoration-thickness: 1px;
  text-underline-offset: 4px;
}
.design-handoff {
  margin-top: 36px;
  padding-top: 24px;
  border-top: 1px solid #dfe3d8;
  max-width: 850px;
}
.design-handoff p {
  font-size: 12px;
  color: #7d856f;
  line-height: 1.8;
  margin: 8px 0;
}
.design-lightbox {
  position: fixed;
  inset: 0;
  width: 100vw;
  height: 100dvh;
  max-width: none;
  max-height: none;
  margin: 0;
  border: 0;
  background: #151a15ee;
  padding: 70px 24px 30px;
}
.design-lightbox[open] {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
}
.design-lightbox img {
  max-width: 100%;
  max-height: calc(100dvh - 150px);
  object-fit: contain;
}
.design-lightbox p {
  color: #f1f4e9;
  font-size: 13px;
}
.design-lightbox-close {
  position: absolute;
  top: 22px;
  right: 24px;
  border: 1px solid #b7c1b0;
  background: #f6f6f0;
  color: #3b4c32;
  padding: 10px 17px;
  border-radius: 7px;
  font-size: 13px;
}
code {
  overflow-wrap: anywhere;
}
@media (max-width: 850px) {
  .design-heading {
    display: block;
  }
  .design-source {
    margin: 20px 0;
    border-left: 0;
    padding: 0;
  }
  .design-variants {
    grid-template-columns: 1fr;
  }
  .design-gallery {
    grid-template-columns: 1fr;
  }
  .design-variant {
    padding: 18px;
  }
  .design-swatches {
    margin-top: 12px;
  }
  .design-settings label {
    flex: 1;
    min-width: 180px;
  }
  .design-actions {
    align-items: flex-start;
    flex-direction: column;
    gap: 12px;
  }
}
@media (max-width: 600px) {
  .design-workspace {
    padding: 28px 18px 50px;
  }
  .design-heading h2 {
    font-size: 34px;
  }
  .design-intro {
    font-size: 13px;
  }
  .design-progress {
    padding: 20px;
  }
  .design-progress > div:first-child {
    line-height: 1.6;
  }
  .design-stats {
    gap: 14px;
  }
}
</style>
