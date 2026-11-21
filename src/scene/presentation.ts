import * as T from 'three'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { SSAOPass } from 'three/addons/postprocessing/SSAOPass.js'
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js'
import { Reflector } from 'three/addons/objects/Reflector.js'
import type { Apartment } from '../domain/schema.ts'

/** Presentation-only passes. The canonical mesh exported to Cycles is untouched. */
export function createPresentation(renderer: T.WebGLRenderer, scene: T.Scene, camera: T.Camera) {
  const target = new T.WebGLRenderTarget(1, 1, { type: T.HalfFloatType, samples: 4 })
  const composer = new EffectComposer(renderer, target)
  const beauty = new RenderPass(scene, camera)
  const ao = new SSAOPass(scene, camera, 1, 1, 16)
  ao.kernelRadius = 0.12
  ao.minDistance = 0.001
  ao.maxDistance = 0.18
  const output = new OutputPass()
  composer.addPass(beauty)
  composer.addPass(ao)
  composer.addPass(output)
  let lastSize = ''
  return {
    render(nextCamera: T.Camera, plan: boolean) {
      beauty.camera = ao.camera = nextCamera
      ao.enabled = !plan
      const perspective = nextCamera instanceof T.PerspectiveCamera ? 1 : 0
      if (ao.ssaoMaterial.defines.PERSPECTIVE_CAMERA !== perspective) {
        ao.ssaoMaterial.defines.PERSPECTIVE_CAMERA = perspective
        ao.ssaoMaterial.needsUpdate = true
      }
      const camera = nextCamera as T.PerspectiveCamera | T.OrthographicCamera
      ao.ssaoMaterial.uniforms.cameraNear.value = camera.near
      ao.ssaoMaterial.uniforms.cameraFar.value = camera.far
      ao.ssaoMaterial.uniforms.cameraProjectionMatrix.value.copy(camera.projectionMatrix)
      ao.ssaoMaterial.uniforms.cameraInverseProjectionMatrix.value.copy(
        camera.projectionMatrixInverse,
      )
      const size = renderer.getSize(new T.Vector2())
      const dpr = Math.min(renderer.getPixelRatio(), 1.5)
      const key = `${size.x}/${size.y}/${dpr}`
      if (key !== lastSize) {
        composer.setPixelRatio(dpr)
        composer.setSize(size.x, size.y)
        lastSize = key
      }
      composer.render()
    },
    dispose() {
      beauty.dispose()
      ao.dispose()
      output.dispose()
      composer.dispose()
    },
  }
}

export function makeMirrors(model: Apartment, room: string) {
  const group = new T.Group()
  group.name = 'presentation-reflections'
  let reflecting = false
  for (const e of model.objects) {
    if (e.material !== 'mirror' || e.visible === false || (room !== 'all' && e.roomId !== room))
      continue
    const [w, h, d] = e.size.map((v) => v / 1000)
    const thinX = w < d
    const mirror = new Reflector(new T.PlaneGeometry(thinX ? d : w, h), {
      color: 0xf4f4f4,
      textureWidth: 768,
      textureHeight: 768,
      clipBias: 0.0003,
    })
    const holder = new T.Group()
    holder.position.fromArray(e.position.map((v) => v / 1000))
    holder.rotation.set(...(e.rotation.map(T.MathUtils.degToRad) as [number, number, number]))
    mirror.position.set(thinX ? w / 2 + 0.0003 : 0, h / 2, thinX ? 0 : d / 2 + 0.0003)
    if (thinX) mirror.rotation.y = Math.PI / 2
    // A reflection pass can see other mirrors through an open door.
    const reflect = mirror.onBeforeRender.bind(mirror)
    mirror.onBeforeRender = (...args) => {
      if (reflecting || args[1].overrideMaterial) return
      reflecting = true
      try {
        reflect(...args)
      } finally {
        reflecting = false
      }
    }
    holder.add(mirror)
    group.add(holder)
  }
  return group
}
export function disposeMirrors(group: T.Group | null) {
  group?.traverse((o) => {
    if (o instanceof Reflector) {
      o.dispose()
      o.geometry.dispose()
    }
  })
  group?.removeFromParent()
}
