<script setup lang="ts">
import { onMounted, onBeforeUnmount, watch, ref, nextTick } from 'vue'
import { useTresContext, useLoop } from '@tresjs/core'
import { OrbitControls } from '@tresjs/cientos'
import * as T from 'three'
import type { Object3D } from 'three/src/core/Object3D.js'
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js'
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js'
import type { Apartment } from '../domain/schema.ts'
import { pointInPolygon } from '../domain/math.ts'
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
import { makeLighting, presentationLightSpecs, updateEmitters } from '../scene/lighting.ts'
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
const emit = defineEmits<{ ready: [source: Apartment]; busy: []; error: [message: string] }>()
const ctx = useTresContext(),
  target = ref<[number, number, number]>([0.9, 1, 1.2]),
  cameraKey = ref(0)
type SceneSnapshot = {
  source: Apartment
  model: Apartment
  root: T.Group
  space: ReturnType<typeof walkingSpace> | null
}
let active: SceneSnapshot | undefined,
  previous: SceneSnapshot | undefined,
  lights: T.Group | null = null,
  annotations: T.Group | null = null,
  currentCamera: T.PerspectiveCamera | T.OrthographicCamera | null = null
let post: ReturnType<typeof createPresentation> | undefined
let mirrors: T.Group | null = null
let releaseIndoorControls: (() => void) | undefined
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
  building = false,
  alive = true,
  env: T.WebGLRenderTarget | undefined
function remove(o: Object3D | null) {
  if (o) {
    ctx.scene.value.remove(o)
    o.traverse((child) => {
      if (child instanceof T.SpotLight || child instanceof T.DirectionalLight || child instanceof T.PointLight)
        child.shadow.dispose()
    })
    disposeTree(o)
  }
}
function visibility({ root, model }: SceneSnapshot) {
  applyVisibility(root, model, props.room, props.mode, props.cutaway, props.showCeilings)
}
function presentation() {
  dirty = true
  if (!active) return
  const { root, model } = active
  visibility(active)
  const specs = presentationLightSpecs(model, props.mode === 'interior' ? 'all' : props.room, props.lighting)
  updateEmitters(root, model, specs)
  remove(lights)
  lights = makeLighting(specs, props.lighting, props.mode === 'ceiling')
  ctx.scene.value.add(lights)
  remove(annotations)
  annotations = new T.Group()
  if (props.mode === 'electrical' || props.mode === 'plan') annotations.add(makeElectricalAnnotations(model, props.room, root))
  if (props.dimensions) annotations.add(makeAnnotations(model, props.room, root, null, props.mode === 'ceiling'))
  if (annotations) ctx.scene.value.add(annotations)
  disposeMirrors(mirrors)
  mirrors = ['plan', 'ceiling', 'electrical'].includes(props.mode)
    ? null
    : makeMirrors(model, props.mode === 'interior' ? 'all' : props.room)
  if (mirrors) ctx.scene.value.add(mirrors)
  ctx.scene.value.environmentIntensity = props.lighting === 'evening' ? 0.12 : 0.5
  ctx.renderer.invalidate()
}
function roomCamera({ root, model, space }: SceneSnapshot) {
  const spec = fitOrthographic(presets(root)[props.mode], root, ctx.sizes.aspectRatio.value || 1.6)
  // Reserve space for outer dimension labels and plan controls, not only meshes.
  if (props.mode === 'plan') spec.verticalSpan *= 1.25
  const camera = makeCamera(spec, ctx.sizes.aspectRatio.value || 1.6)
  if (space) {
    const polygon = model.rooms.find(r => r.id === props.room)?.polygon
    const point = safeWalkingStart(
      [camera.position.x, camera.position.z],
      space,
      polygon?.map(p => p.map(n => n / 1000)),
    )
    camera.position.x = point[0]
    camera.position.z = point[1]
    camera.updateMatrixWorld()
  }
  return { camera, target: spec.target as [number, number, number] }
}
function setRoomCamera(pose: ReturnType<typeof roomCamera>) {
  dirty = true
  releaseIndoorControls?.()
  releaseIndoorControls = undefined
  if (currentCamera) ctx.camera.deregisterCamera(currentCamera)
  const camera = pose.camera
  currentCamera = camera
  ctx.camera.registerCamera(camera, true)
  target.value = pose.target
  cameraKey.value++
  // Wait for the old orbit controller to unmount before attaching indoor input.
  nextTick(() => {
    if (!alive || camera !== currentCamera || props.mode !== 'interior' || !(camera instanceof T.PerspectiveCamera)) return
    releaseIndoorControls = bindIndoorControls(camera,
      (ctx.renderer.instance as T.WebGLRenderer).domElement,
      () => { dirty = true; ctx.renderer.invalidate() },
      point => active?.space?.free(point) ?? false)
  })
  ctx.renderer.invalidate()
}
function resetCamera() {
  if (active && Boolean(active.space) === (props.mode === 'interior'))
    setRoomCamera(roomCamera(active))
}
function sameScene(scene: SceneSnapshot, source: Apartment, inside: boolean) {
  return scene.source === source && Boolean(scene.space) === inside
}
watch(
  [() => props.model, () => props.mode === 'interior'],
  async ([source, inside]) => {
    const token = ++generation
    if (active && sameScene(active, source, inside)) {
      building = false
      emit('ready', active.source)
      return
    }
    building = true
    emit('busy')
    let built: T.Group | undefined
    try {
      let next = previous
      if (!next || !sameScene(next, source, inside)) {
        const model = inside ? prepareWalkthroughApartment(source) : source
        built = await buildCanonical(model)
        if (token !== generation || !alive) return
        next = { source, model, root: built, space: inside ? walkingSpace(model, built) : null }
      }
      visibility(next)
      const walkingCamera = active?.space && next.space && currentCamera instanceof T.PerspectiveCamera
        ? currentCamera : null
      let eye: number[] | undefined
      const pose = walkingCamera ? null : roomCamera(next)
      if (walkingCamera && next.space) {
        const { x, z } = walkingCamera.position
        // Keep a person in their actual room, which may differ from their chosen starting room.
        const polygon = next.model.rooms.find(room =>
          room.polygon && pointInPolygon([x * 1000, z * 1000], room.polygon),
        )?.polygon
        eye = safeWalkingStart([x, z], next.space, polygon?.map(p => p.map(n => n / 1000)))
      }
      // Commit only after the replacement is built and the current eye point is validated.
      if (previous && previous !== next) disposeTree(previous.root)
      active?.root.removeFromParent()
      previous = active
      active = next
      built = undefined
      ctx.scene.value.add(next.root)
      if (walkingCamera && eye) {
        walkingCamera.position.x = eye[0]
        walkingCamera.position.z = eye[1]
        walkingCamera.updateMatrixWorld()
      }
      presentation()
      if (pose) setRoomCamera(pose)
      building = false
      emit('ready', next.source)
    } catch (e) {
      if (token !== generation || !alive) return
      building = false
      if (active && Boolean(active.space) === inside) emit('ready', active.source)
      emit('error', String(e))
    } finally {
      if (built) disposeTree(built)
    }
  },
  { immediate: true },
)
watch(
  [() => props.room, () => props.mode],
  () => {
    if (!active || Boolean(active.space) !== (props.mode === 'interior')) return
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
      const half = active
        ? fitOrthographic(presets(active.root)[props.mode], active.root, aspect).verticalSpan / 2
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
  for (const o of [active?.root ?? null, previous?.root ?? null, lights, annotations]) remove(o)
  if (currentCamera) ctx.camera.deregisterCamera(currentCamera)
  disposeMirrors(mirrors)
  post?.dispose()
  ctx.scene.value.environment = null
  env?.dispose()
})
async function exportCurrent() {
  if (!active || !currentCamera || building || Boolean(active.space) !== (props.mode === 'interior'))
    throw new Error('Scene is not ready')
  const { root, model } = active
  const snapshot = root.clone(true)
  const materials = new Map<T.Material, T.Material>()
  const copyMaterial = (material: T.Material) => {
    let copy = materials.get(material)
    if (!copy) {
      copy = material.clone()
      materials.set(material, copy)
    }
    return copy
  }
  // Capture visibility and emitter intensity before the async exporter yields.
  // Geometry and image sources are immutable and can be shared with the live view.
  snapshot.traverse(object => {
    if (!(object instanceof T.Mesh)) return
    object.material = Array.isArray(object.material)
      ? object.material.map(copyMaterial)
      : copyMaterial(object.material)
  })
  try {
    return await exportScene(snapshot, model, snapshotCamera(currentCamera), props.room, props.lighting, props.mode)
  } finally {
    materials.forEach(material => material.dispose())
  }
}
function screenshot() {
  if (!currentCamera) throw new Error('Camera is not ready')
  const r = ctx.renderer.instance as T.WebGLRenderer
  renderFrame(true)
  return screenshotWithNotice(r.domElement, renderNotice(active?.model ?? props.model, props.room))
}
defineExpose({
  exportCurrent,
  screenshot,
  resetCamera,
  manifest: () => (active ? geometryManifest(active.root) : []),
  camera: () => (currentCamera ? snapshotCamera(currentCamera) : null),
  viewState: () => {
    const labels: string[] = []
    annotations?.traverse((o) => { if (o.userData.dimension) labels.push(o.userData.label) })
    return { visible: active?.root.children.filter((o) => o.visible).map((o) => o.userData.entityId) ?? [], dimensions: labels,
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
