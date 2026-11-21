<script setup lang="ts">
import { onMounted, onBeforeUnmount, watch, ref, nextTick } from 'vue'
import { useTresContext, useLoop } from '@tresjs/core'
import { OrbitControls } from '@tresjs/cientos'
import * as T from 'three'
import type { Object3D } from 'three/src/core/Object3D.js'
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js'
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js'
import type { Apartment } from '../domain/schema.ts'
import {
  buildCanonical,
  applyVisibility,
  disposeTree,
  geometryManifest,
} from '../scene/canonical.ts'
import type { ViewMode } from '../scene/canonical.ts'
import { makeCamera, presets, snapshotCamera, fitOrthographic } from '../scene/cameras.ts'
import { bindIndoorControls } from '../scene/indoor-controls.ts'
import { prepareWalkthroughApartment, walkingSpace, safeWalkingStart } from '../scene/walking-space.ts'
import { makeLighting, lightingSpecs, updateEmitters } from '../scene/lighting.ts'
import type { LightingPreset } from '../scene/lighting.ts'
import { makeAnnotations, makeElectricalAnnotations } from '../scene/annotations.ts'
import { renderNotice, screenshotWithNotice } from '../scene/provenance.ts'
import { exportScene } from '../scene/export.ts'
import { createPresentation, makeMirrors, disposeMirrors } from '../scene/presentation.ts'
const props = defineProps<{
  model: Apartment
  mode: ViewMode
  room: string
  dimensions: boolean
  cutaway: boolean
  showCeilings: boolean
  lighting: LightingPreset
}>()
const emit = defineEmits<{ ready: []; error: [message: string] }>()
const ctx = useTresContext(),
  target = ref<[number, number, number]>([0.9, 1, 1.2]),
  cameraKey = ref(0)
let root: T.Group | null = null,
  lights: T.Group | null = null,
  annotations: T.Group | null = null,
  currentCamera: T.PerspectiveCamera | T.OrthographicCamera | null = null
let post: ReturnType<typeof createPresentation> | undefined
let mirrors: T.Group | null = null
let releaseIndoorControls: (() => void) | undefined
let sceneModel = props.model
const { render } = useLoop()
let dirty = true,
  lastFrame = ''
function renderFrame(force = false) {
  if (!currentCamera) return
  const renderer = ctx.renderer.instance as T.WebGLRenderer
  currentCamera.updateMatrixWorld()
  const size = renderer.getSize(new T.Vector2())
  const frame = [
    ...currentCamera.matrixWorld.elements,
    ...currentCamera.projectionMatrix.elements,
    size.x,
    size.y,
    renderer.getPixelRatio(),
  ].join(',')
  if (!force && !dirty && frame === lastFrame) return
  dirty = false
  lastFrame = frame
  post ??= createPresentation(renderer, ctx.scene.value, currentCamera)
  post.render(currentCamera, ['plan', 'ceiling'].includes(props.mode))
}
render((done) => {
  try {
    renderFrame()
  } catch (e) {
    emit('error', String(e))
  }
  done()
})
let generation = 0,
  alive = true,
  env: T.WebGLRenderTarget | undefined
function remove(o: Object3D | null) {
  if (o) {
    ctx.scene.value.remove(o)
    o.traverse((child) => {
      if (child instanceof T.SpotLight || child instanceof T.DirectionalLight)
        child.shadow.dispose()
    })
    disposeTree(o)
  }
}
function presentation() {
  dirty = true
  if (!root) return
  applyVisibility(root, props.model, props.room, props.mode, props.cutaway, props.showCeilings)
  const specs = lightingSpecs(props.model, props.mode === 'interior' ? 'all' : props.room, props.lighting)
  updateEmitters(root, props.model, specs)
  remove(lights)
  lights = makeLighting(specs, props.lighting, props.mode === 'ceiling')
  ctx.scene.value.add(lights)
  remove(annotations)
  annotations = new T.Group()
  if (props.mode === 'electrical' || props.mode === 'plan') annotations.add(makeElectricalAnnotations(props.model, props.room, root))
  if (props.dimensions) annotations.add(makeAnnotations(props.model, props.room, root, null, props.mode === 'ceiling'))
  if (annotations) ctx.scene.value.add(annotations)
  disposeMirrors(mirrors)
  mirrors = ['plan', 'ceiling', 'electrical'].includes(props.mode)
    ? null
    : makeMirrors(props.model, props.room)
  if (mirrors) ctx.scene.value.add(mirrors)
  ctx.scene.value.environmentIntensity = props.lighting === 'evening' ? 0.12 : 0.5
  ctx.renderer.invalidate()
}
function resetCamera() {
  dirty = true
  if (!root) return
  releaseIndoorControls?.()
  releaseIndoorControls = undefined
  const spec = fitOrthographic(presets(root)[props.mode], root, ctx.sizes.aspectRatio.value || 1.6)
  // Reserve space for outer dimension labels and plan controls, not only meshes.
  if (props.mode === 'plan') spec.verticalSpan *= 1.25
  if (currentCamera) ctx.camera.deregisterCamera(currentCamera)
  currentCamera = makeCamera(spec, ctx.sizes.aspectRatio.value || 1.6)
  ctx.camera.registerCamera(currentCamera, true)
  target.value = spec.target as [number, number, number]
  cameraKey.value++
  // Wait for the old orbit controller to unmount before attaching indoor input.
  const camera = currentCamera
  const space = props.mode === 'interior' ? walkingSpace(sceneModel,root) : null
  if(space) {
    const polygon=sceneModel.rooms.find(r=>r.id===props.room)?.polygon?.map(p=>p.map(n=>n/1000))??[]
    const p=safeWalkingStart([camera.position.x,camera.position.z],space,polygon)
    camera.position.x=p[0];camera.position.z=p[1];camera.updateMatrixWorld()
  }
  nextTick(() => {
    if (!alive || camera !== currentCamera || props.mode !== 'interior') return
    releaseIndoorControls = bindIndoorControls(camera as T.PerspectiveCamera,
      (ctx.renderer.instance as T.WebGLRenderer).domElement,
      () => { dirty = true; ctx.renderer.invalidate() },space!.free)
  })
  ctx.renderer.invalidate()
}
watch(
  () => [props.model,props.mode === 'interior'],
  async () => {
    const token = ++generation
    try {
      const nextModel=props.mode === 'interior' ? prepareWalkthroughApartment(props.model) : props.model
      const next = await buildCanonical(nextModel)
      if (token !== generation || !alive) {
        disposeTree(next)
        return
      }
      remove(root)
      root = next
      sceneModel = nextModel
      ctx.scene.value.add(root)
      presentation()
      resetCamera()
      emit('ready')
    } catch (e) {
      emit('error', String(e))
    }
  },
  { immediate: true, deep: true },
)
watch(
  () => [props.room, props.mode],
  () => {
    presentation()
    resetCamera()
  },
)
watch(() => [props.cutaway, props.showCeilings, props.dimensions, props.lighting], presentation)
watch(
  () => ctx.sizes.aspectRatio.value,
  (aspect) => {
    if (!currentCamera) return
    if (currentCamera instanceof T.PerspectiveCamera) currentCamera.aspect = aspect
    else {
      const half = root
        ? fitOrthographic(presets(root)[props.mode], root, aspect).verticalSpan / 2
        : (currentCamera.top - currentCamera.bottom) / 2
      currentCamera.top = half
      currentCamera.bottom = -half
      currentCamera.left = -half * aspect
      currentCamera.right = half * aspect
    }
    currentCamera.updateProjectionMatrix()
  },
)
onMounted(() => {
  RectAreaLightUniformsLib.init()
  const r = ctx.renderer.instance as T.WebGLRenderer
  const pmrem = new T.PMREMGenerator(r),
    studio = new RoomEnvironment()
  env = pmrem.fromScene(studio, 0.04)
  ctx.scene.value.environment = env.texture
  dirty = true
  studio.dispose()
  pmrem.dispose()
})
onBeforeUnmount(() => {
  alive = false
  releaseIndoorControls?.()
  generation++
  const r = ctx.renderer.instance as T.WebGLRenderer
  for (const o of [root, lights, annotations]) remove(o)
  if (currentCamera) ctx.camera.deregisterCamera(currentCamera)
  disposeMirrors(mirrors)
  post?.dispose()
  ctx.scene.value.environment = null
  env?.dispose()
})
async function exportCurrent() {
  if (!root || !currentCamera) throw new Error('Scene is not ready')
  return exportScene(root, sceneModel, snapshotCamera(currentCamera), props.room, props.lighting, props.mode)
}
function screenshot() {
  if (!currentCamera) throw new Error('Camera is not ready')
  const r = ctx.renderer.instance as T.WebGLRenderer
  renderFrame(true)
  return screenshotWithNotice(r.domElement, renderNotice(props.model, props.room))
}
defineExpose({
  exportCurrent,
  screenshot,
  resetCamera,
  manifest: () => (root ? geometryManifest(root) : []),
  camera: () => (currentCamera ? snapshotCamera(currentCamera) : null),
  viewState: () => {
    const labels: string[] = []
    annotations?.traverse((o) => { if (o.userData.dimension) labels.push(o.userData.label) })
    return { visible: root?.children.filter((o) => o.visible).map((o) => o.userData.entityId) ?? [], dimensions: labels,
      camera:currentCamera?snapshotCamera(currentCamera):null,walking:!!releaseIndoorControls }
  },
})
</script>
<template>
  <OrbitControls
    v-if="mode !== 'interior'"
    :key="cameraKey"
    :target="target"
    make-default
    :enable-damping="true"
    :damping-factor="0.1"
    :min-distance="0.15"
    :max-distance="15"
    :min-zoom="0.5"
    :max-zoom="5"
    :max-polar-angle="['plan', 'ceiling'].includes(mode) ? Math.PI : Math.PI / 2 - 0.02"
    :enable-rotate="!['plan', 'ceiling'].includes(mode)"
    @change="ctx.renderer.invalidate()"
  />
</template>
