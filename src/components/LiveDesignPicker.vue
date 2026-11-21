<script setup lang="ts">
import { computed, ref } from 'vue'

type Choice = {
  id: string
  label: string
  description: string
  swatches: readonly string[]
  reference?: { title: string; studio: string; url: string; lesson: string }
}

const props = defineProps<{
  choices: readonly Choice[]
  featured: readonly string[]
  selected: string
  active: string
  switching: boolean
  walking: boolean
}>()
const emit = defineEmits<{ select: [id: string]; cycle: [step: number] }>()
const open = ref(false)
const trigger = ref<HTMLButtonElement | null>(null)
const picked = computed(() => props.choices.find(choice => choice.id === props.selected))
const featuredChoices = computed(() => props.choices.filter(choice => props.featured.includes(choice.id)))
const sources = computed(() => props.choices.filter(choice => choice.reference && !props.featured.includes(choice.id)))
const earlier = computed(() => props.choices.filter(choice => choice.id !== 'current' && !choice.reference))

function close() {
  open.value = false
  trigger.value?.focus()
}

function select(event: Event) {
  emit('select', (event.target as HTMLSelectElement).value)
  open.value = false
}
</script>

<template>
  <div class="live-design" @keydown.esc.stop="open && close()">
    <div class="live-design-bar" role="group" aria-label="Сменить интерьер в 3D">
      <button type="button" aria-label="Предыдущая концепция" title="Предыдущая концепция ([)" @click="emit('cycle', -1)">‹</button>
      <button ref="trigger" type="button" class="live-design-trigger" :aria-expanded="open" aria-controls="live-design-choices" @click="open = !open">
        <span>{{ picked?.label ?? 'Текущий проект' }}</span><span aria-hidden="true">⌄</span>
      </button>
      <button type="button" aria-label="Следующая концепция" title="Следующая концепция (])" @click="emit('cycle', 1)">›</button>
    </div>
    <p v-if="switching" class="live-design-progress" role="status">Загружаю концепцию…</p>
    <section v-if="open" id="live-design-choices" class="live-design-choices" aria-label="Концепции интерьера">
      <label for="live-design-style">Концепция интерьера</label>
      <select id="live-design-style" :value="selected" @change="select">
        <option value="current">Текущий проект</option>
        <optgroup v-if="featuredChoices.length" label="Орех, графит и тёплый свет">
          <option v-for="choice in featuredChoices" :key="choice.id" :value="choice.id">{{ choice.label }}</option>
        </optgroup>
        <optgroup label="По реализованным проектам">
          <option v-for="choice in sources" :key="choice.id" :value="choice.id">{{ choice.label }}</option>
        </optgroup>
        <optgroup label="Прежние концепции">
          <option v-for="choice in earlier" :key="choice.id" :value="choice.id">{{ choice.label }}</option>
        </optgroup>
      </select>
      <div v-if="picked" class="live-design-description">
        <div class="live-design-swatches" aria-hidden="true">
          <i v-for="(color, index) in picked.swatches" :key="index" :style="{ backgroundColor: color }" />
        </div>
        <p>{{ picked.description }}</p>
        <template v-if="picked.reference">
          <p>{{ picked.reference.lesson }}</p>
          <a :href="picked.reference.url" target="_blank" rel="noopener noreferrer">{{ picked.reference.title }} · {{ picked.reference.studio }} ↗</a>
        </template>
      </div>
      <small v-if="walking">На сцене <kbd>[</kbd> и <kbd>]</kbd> меняют концепцию.</small>
    </section>
    <span class="sr-only" aria-live="polite">{{ switching ? '' : `В сцене ${choices.find(choice => choice.id === active)?.label}` }}</span>
  </div>
</template>

<style scoped>
.live-design { position: absolute; z-index: 7; right: 80px; top: 24px; max-width: calc(100% - 106px); }
.live-design-bar { display: flex; justify-content: flex-end; white-space: nowrap; border: 1px solid #d5d7cb; border-radius: 9px; background: #fcfbf4f5; box-shadow: 0 2px 12px #22291819; overflow: hidden; }
.live-design-bar button { background: transparent; border: 0; min-width: 35px; min-height: 43px; padding: 5px 10px; color: #48543d; }
.live-design-bar button:first-child, .live-design-bar button:last-child { font-size: 23px; line-height: 1; }
.live-design-bar button:hover, .live-design-bar button:focus-visible { background: #e6e9df; }
.live-design-trigger { display: flex; gap: 10px; align-items: center; justify-content: space-between; font-weight: 650; font-size: 12px; min-width: 0; }
.live-design-trigger > span:first-child { overflow: hidden; text-overflow: ellipsis; }
.live-design-choices, .live-design-progress { border: 1px solid #d5d7cb; background: #fcfbf6; color: #354031; border-radius: 9px; box-shadow: 0 8px 26px #181d1829; }
.live-design-choices { position: absolute; right: 0; top: calc(100% + 7px); width: min(300px, calc(100vw - 45px)); max-height: min(390px, 52dvh); overflow: auto; padding: 16px; }
.live-design-choices label { display: block; margin-bottom: 7px; font-size: 13px; font-weight: 650; }
.live-design-choices select { width: 100%; padding: 8px; border: 1px solid #c7cbbd; border-radius: 5px; background: white; color: #354031; }
.live-design-description { font-size: 12px; line-height: 1.55; }
.live-design-description p { margin: 8px 0; }
.live-design-description a { display: inline-block; color: #465d39; text-underline-offset: 3px; }
.live-design-swatches { display: flex; gap: 5px; margin-top: 12px; }
.live-design-swatches i { width: 17px; height: 17px; border-radius: 50%; border: 1px solid #0002; }
.live-design-choices small { display: block; margin-top: 12px; color: #56624f; font-size: 11px; }
.live-design-progress { position: absolute; right: 0; top: 100%; margin: 6px 0 0; padding: 6px 9px; white-space: nowrap; font-size: 11px; pointer-events: none; }
.live-design:has(.live-design-choices) .live-design-progress { top: auto; bottom: calc(100% + 4px); }
.sr-only { position: absolute; width: 1px; height: 1px; clip-path: inset(50%); overflow: hidden; white-space: nowrap; }
@media (max-width: 650px) {
  .live-design { top: 78px; right: 18px; max-width: calc(100% - 36px); }
}
</style>
