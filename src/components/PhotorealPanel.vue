<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { base64 } from '../scene/export.ts'

const props = defineProps<{
  ready: boolean
  interior: boolean
  roomTitle: string
  exportScene: () => Promise<{ glb: ArrayBuffer; metadata: unknown }>
}>()
const emit = defineEmits<{
  enter: []
  result: [result: { url: string; title: string }]
}>()
const preset = ref('preview'), device = ref('auto'), available = ref(false), token = ref('')
const submitting = ref(false), error = ref(''), job = ref<any>(null), captureTitle = ref('')
const running = computed(() => submitting.value || job.value?.status === 'running')
const progress = computed(() => {
  if (job.value?.status === 'running' && job.value.phase === 'rendering' && !job.value.samplesTotal) return null
  return typeof job.value?.progress === 'number' ? Math.round(job.value.progress * 100) : null
})
const phases: Record<string, string> = {
  starting: 'Запуск', importing: 'Подготовка сцены', materials: 'Подготовка материалов', rendering: 'Свет и отражения', denoising: 'Убираю шум',
  saving: 'Сохранение изображения', done: 'Изображение готово', cancelled: 'Отменено', error: 'Ошибка рендера',
}
const elapsed = computed(() => {
  const seconds = Math.floor(job.value?.elapsedSeconds ?? 0)
  return `${Math.floor(seconds / 60)} мин ${seconds % 60} с`
})
let timer: ReturnType<typeof setTimeout> | undefined, stopped = false
const storageKey = 'home-design:photoreal-job:v1'
function remember(id: string, title: string) {
  try { sessionStorage.setItem(storageKey, JSON.stringify({ id, title })) } catch { /* Storage is optional. */ }
}
async function poll(id: string) {
  clearTimeout(timer)
  try {
    const response = await fetch(`/__local/jobs/${id}`)
    const data = await response.json()
    if (response.status === 404) {
      job.value = null
      try { sessionStorage.removeItem(storageKey) } catch { /* Optional history. */ }
      const status = await fetch('/__local/status').then(r => r.json())
      token.value = status.token
      available.value = status.available
      error.value = 'Предыдущая задача больше недоступна после перезапуска сервера. Можно создать новый кадр.'
      return
    }
    if (!response.ok) throw new Error(data.error || 'Не удалось прочитать прогресс')
    if (stopped) return
    job.value = data
    error.value = ''
    if (data.status === 'done') {
      emit('result', { url: `/__local/image/${id}`, title: captureTitle.value })
    } else if (data.status === 'error') {
      error.value = data.error || 'Рендер остановлен'
    }
    if (data.status === 'running') timer = setTimeout(() => poll(id), 1500)
  } catch (e) {
    if (stopped) return
    error.value = `Нет связи с рендером: ${(e as Error).message}`
    // A dropped connection does not prove that Blender stopped.
    if (job.value?.status === 'running') timer = setTimeout(() => poll(id), 4000)
  }
}
onMounted(async () => {
  try {
    const response = await fetch('/__local/status')
    if (!response.ok) throw new Error('Local server unavailable')
    const data = await response.json()
    available.value = data.available
    token.value = data.token
    if (available.value) {
      let saved: { id: string; title: string } | null = null
      try { saved = JSON.parse(sessionStorage.getItem(storageKey) || 'null') } catch { /* Optional history. */ }
      if (saved && /^[0-9a-f-]{36}$/.test(saved.id)) {
        captureTitle.value = saved.title
        await poll(saved.id)
      }
    }
  } catch { available.value = false }
})
onBeforeUnmount(() => { stopped = true; clearTimeout(timer) })
async function start() {
  if (!props.ready || !props.interior || running.value) return
  submitting.value = true
  error.value = ''
  job.value = null
  captureTitle.value = props.roomTitle
  try {
    // A server restart changes its request token even when the previous job was completed.
    const statusResponse = await fetch('/__local/status')
    if (!statusResponse.ok) throw new Error('Локальный сервер недоступен')
    const status = await statusResponse.json()
    token.value = status.token
    if (!status.available) throw new Error('Blender не найден')
    const bundle = await props.exportScene()
    const response = await fetch('/__local/render', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-render-token': token.value },
      body: JSON.stringify({ glb: base64(bundle.glb), metadata: bundle.metadata,
        preset: preset.value, device: device.value, look: 'photoreal' }),
    })
    const data = await response.json()
    if (!response.ok) throw new Error(data.error || 'Не удалось запустить рендер')
    job.value = data
    remember(data.id, captureTitle.value)
    if (!stopped) await poll(data.id)
  } catch (e) { if (!stopped) error.value = (e as Error).message }
  finally { submitting.value = false }
}
async function cancel() {
  if (!job.value?.id) return
  try {
    const response = await fetch(`/__local/cancel/${job.value.id}`, {
      method: 'POST', headers: { 'x-render-token': token.value },
    })
    const data = await response.json()
    if (!response.ok) throw new Error(data.error || 'Не удалось отменить рендер')
    await poll(job.value.id)
  } catch (e) { error.value = (e as Error).message }
}
</script>

<template>
  <section class="photo-panel" aria-label="Фотореалистичный рендер">
    <p class="eyebrow">ФОТОРЕАЛИЗМ / CYCLES</p>
    <h3>Свет, фактура, отражения.</h3>
    <p>Снимок текущего ракурса с полными стенами и потолком. Можно ходить в 3D, выбрать точку и создать изображение.</p>
    <template v-if="available">
      <button v-if="!interior" class="photo-enter" @click="emit('enter')">Выбрать ракурс изнутри</button>
      <div class="photo-settings">
        <label>Размер<select v-model="preset" :disabled="running">
          <option value="preview">960 × 540 · проба</option>
          <option value="quality">1920 × 1080</option>
          <option value="ultra">3840 × 2160</option>
        </select></label>
        <label>Устройство<select v-model="device" :disabled="running">
          <option value="auto">Авто · GPU / CPU</option>
          <option value="gpu">GPU · Metal на Mac</option>
          <option value="cpu">CPU</option>
        </select></label>
      </div>
      <button class="photo-start" :disabled="!ready || !interior || running" @click="start">
        {{ submitting ? 'Подготовка модели…' : 'Создать фотореалистичный кадр' }}
      </button>
      <div v-if="job" class="photo-progress" role="status" aria-live="polite">
        <b>{{ phases[job.status === 'running' ? job.phase : job.status] ?? 'Подготовка' }}<span v-if="progress !== null"> · {{ progress }}%</span></b>
        <progress v-if="job.status === 'running'" max="100" :value="progress ?? undefined" aria-label="Прогресс рендера"></progress>
        <small>{{ elapsed }}<template v-if="job.device"> · {{ job.device }}</template></small>
        <button v-if="job.status === 'running'" class="photo-cancel" @click="cancel">Отменить</button>
        <a v-if="job.status === 'done'" :href="`/__local/image/${job.id}`" download="home-photoreal.png">Скачать PNG</a>
      </div>
      <p class="photo-note">Рендер занимает время и продолжается при переходе по вкладкам, пока работает локальное приложение.</p>
    </template>
    <p v-else class="photo-note">Для создания изображения откройте локальное приложение через <code>npm run dev</code> с установленным Blender.</p>
    <p v-if="error" class="photo-error" role="alert">{{ error }}</p>
  </section>
</template>

<style scoped>
.photo-panel { padding-bottom: 24px; margin-bottom: 28px; border-bottom: 1px solid #deded2; }
h3 { font: 400 23px/1.2 Georgia, serif; margin: 12px 0; }
p { font-size: 12px; line-height: 1.7; color: #757c69; }
.photo-settings { display: grid; gap: 12px; margin: 16px 0; }
label { display: grid; gap: 6px; font-size: 11px; }
select { font: inherit; width: 100%; padding: 10px; border: 1px solid #d6dbce; border-radius: 6px; background: #fffefa; color: #45523d; }
button { font-size: 12px; border-radius: 6px; padding: 11px; }
.photo-start { width: 100%; color: white; background: #4d6443; border: 0; line-height: 1.5; }
button:disabled { opacity: .5; cursor: default; }
.photo-enter, .photo-cancel { border: 1px solid #cfd7c6; color: #4d6443; background: transparent; }
.photo-progress { display: grid; gap: 10px; font-size: 12px; margin-top: 18px; }
.photo-progress small { color: #7a806f; }
progress { width: 100%; accent-color: #637e50; }
a { color: #4d6443; }
.photo-note { font-size: 10px; }
.photo-error { color: #a34b37; overflow-wrap: anywhere; }
</style>
