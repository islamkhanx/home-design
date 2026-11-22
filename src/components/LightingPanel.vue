<script setup lang="ts">
import { computed, ref } from 'vue'
import type { Apartment } from '../domain/schema.ts'
import { listLightingSources } from '../scene/lighting.ts'
import type { LightingControls, LightingPreset } from '../scene/lighting.ts'

const props = defineProps<{
  model: Apartment
  room: string
  preset: LightingPreset
  controls: LightingControls
}>()
const emit = defineEmits<{
  windows: [on: boolean]
  source: [id: string, on: boolean]
  reset: []
  close: []
}>()

const open = ref(false)
const sources = computed(() => listLightingSources(props.model, 'all', props.preset, props.controls))
const windows = computed(() => sources.value.filter(source => source.kind === 'window'))
const activeCount = computed(() => sources.value.filter(source => source.on).length)
const rooms = computed(() => new Map(props.model.rooms.map(room => [room.id, room.name])))
const fixtureGroups = computed(() => {
  const fixtures = sources.value.filter(source => source.kind === 'fixture')
  const roomIds = [...new Set([props.room, ...props.model.rooms.map(room => room.id)])]
  return roomIds.map(id => {
    const roomFixtures = fixtures.filter(source => source.roomId === id)
    const totals = new Map<string, number>()
    const positions = new Map<string, number>()
    for (const { name } of roomFixtures) totals.set(name, (totals.get(name) ?? 0) + 1)
    return {
      id,
      name: rooms.value.get(id) ?? id,
      fixtures: roomFixtures.map(source => {
        const number = (positions.get(source.name) ?? 0) + 1
        positions.set(source.name, number)
        const label = totals.get(source.name) === 1 ? source.name : `${source.name} ${number}`
        return { ...source, label }
      }),
    }
  }).filter(group => group.fixtures.length > 0)
})
const changed = computed(() => props.controls.windows !== (props.preset === 'day') ||
  Object.keys(props.controls.sources).length > 0)

function close() {
  if (!open.value) return
  open.value = false
  emit('close')
}
function toggle() {
  if (open.value) close()
  else open.value = true
}
function checked(event: Event) {
  return (event.target as HTMLInputElement).checked
}
</script>

<template>
  <div class="lighting-control" @keydown.esc.stop="close">
    <button type="button" class="lighting-trigger" :aria-expanded="open"
      aria-controls="interior-lighting-panel" @click="toggle">
      <span>Свет</span>
      <span class="lighting-count" aria-hidden="true">{{ activeCount }}/{{ sources.length }}</span>
    </button>
    <section v-if="open" id="interior-lighting-panel" class="lighting-panel" aria-label="Управление светом">
      <div class="lighting-heading">
        <b>Управление светом</b>
        <button type="button" class="lighting-close" aria-label="Закрыть настройки света" @click="close">×</button>
      </div>
      <div class="lighting-list">
        <fieldset v-if="windows.length">
          <legend>Дневной свет</legend>
          <label class="lighting-row lighting-master">
            <span>Свет из окон</span>
            <input type="checkbox" role="switch" :checked="controls.windows" @change="emit('windows', checked($event))" />
          </label>
          <label v-for="source in windows" :key="source.id" class="lighting-row lighting-window">
            <span>{{ source.name }} · {{ rooms.get(source.roomId) }}</span>
            <input type="checkbox" role="switch" :checked="controls.windows ? source.on : (source.override ?? true)"
              :disabled="!controls.windows" @change="emit('source', source.id, checked($event))" />
          </label>
        </fieldset>
        <fieldset v-for="group in fixtureGroups" :key="group.id">
          <legend>{{ group.name }}</legend>
          <label v-for="source in group.fixtures" :key="source.id" class="lighting-row">
            <span>{{ source.label }}</span>
            <input type="checkbox" role="switch" :checked="source.on" @change="emit('source', source.id, checked($event))" />
          </label>
        </fieldset>
      </div>
      <button type="button" class="lighting-reset" :disabled="!changed" @click="emit('reset')">Сбросить к сценарию</button>
    </section>
  </div>
</template>

<style scoped>
.lighting-control {
  position: absolute;
  top: 78px;
  left: 28px;
  z-index: 7;
  max-width: calc(100% - 56px);
  color: #354031;
}
.lighting-trigger {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 38px;
  padding: 5px 9px 5px 13px;
  border: 1px solid #d5d7cb;
  border-radius: 9px;
  background: #fcfbf4f5;
  color: inherit;
  font-size: 12px;
  font-weight: 650;
  box-shadow: 0 2px 12px #22291819;
}
.lighting-trigger:hover, .lighting-trigger[aria-expanded='true'] { background: #eff0e7; }
.lighting-count {
  padding: 2px 5px;
  border-radius: 5px;
  background: #e6e9df;
  color: #45533a;
  font-size: 11px;
  font-variant-numeric: tabular-nums;
}
.lighting-panel {
  display: grid;
  margin-top: 7px;
  width: min(320px, calc(100vw - 56px));
  border: 1px solid #d5d7cb;
  border-radius: 9px;
  background: #fcfbf6;
  box-shadow: 0 8px 26px #181d1829;
}
.lighting-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 7px 8px 6px 14px;
  border-bottom: 1px solid #e3e3d8;
  font-size: 13px;
}
.lighting-close {
  width: 30px;
  height: 30px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: inherit;
  font-size: 21px;
}
.lighting-close:hover { background: #e8ebdf; }
.lighting-list { max-height: min(335px, 41dvh); overflow: auto; overscroll-behavior: contain; padding: 8px 12px; }
.lighting-list fieldset { margin: 0 0 10px; padding: 0; border: 0; min-width: 0; }
.lighting-list legend { margin: 0; padding: 5px 1px 3px; color: #58674c; font-size: 11px; font-weight: 650; }
.lighting-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-height: 37px;
  padding: 5px 3px 5px 1px;
  border-bottom: 1px solid #ebebe2;
  font-size: 12px;
  line-height: 1.4;
  cursor: pointer;
}
.lighting-master { font-weight: 650; }
.lighting-window { padding-left: 8px; }
.lighting-row:has(input:disabled) { opacity: .55; cursor: default; }
.lighting-row input {
  appearance: none;
  position: relative;
  flex: 0 0 32px;
  height: 19px;
  margin: 0;
  border: 1px solid #a2a998;
  border-radius: 12px;
  background: #e3e5dc;
  cursor: inherit;
}
.lighting-row input::after {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 13px;
  height: 13px;
  border-radius: 50%;
  background: #fff;
  box-shadow: 0 1px 2px #1f33152e;
  content: '';
}
.lighting-row input:checked { border-color: #516644; background: #5a724b; }
.lighting-row input:checked::after { left: 15px; }
.lighting-row input:focus-visible, .lighting-trigger:focus-visible, .lighting-close:focus-visible, .lighting-reset:focus-visible {
  outline: 2px solid #4e713f;
  outline-offset: 2px;
}
.lighting-reset {
  padding: 11px 14px;
  border: 0;
  border-top: 1px solid #e3e3d8;
  background: transparent;
  color: #425c36;
  text-align: left;
  font-size: 12px;
}
.lighting-reset:disabled { color: #787e73; cursor: default; }
.lighting-reset:not(:disabled):hover { background: #eff0e7; }
@media (max-width: 650px) {
  .lighting-control { left: 18px; top: 131px; max-width: calc(100% - 36px); }
  .lighting-list { max-height: min(215px, 31dvh); }
}
</style>
