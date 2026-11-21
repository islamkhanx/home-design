import * as T from 'three'
import type { Apartment } from '../domain/schema.ts'
import { mm, deg } from '../domain/math.ts'
export type LightingPreset = 'day' | 'evening' | 'clean'
export type LightSpec = {
  id: string
  /** Multiple lamps can belong to one declared fixture. */
  entityId?: string
  type: 'point' | 'spot' | 'area'
  position: number[]
  target: number[]
  color: string
  power: number
  size: number
  width?: number
  height?: number
}
const emitterBase = new WeakMap<T.Mesh, number[]>()
export function updateEmitters(root: T.Group, a: Apartment, specs: LightSpec[]) {
  const powers = new Map<string, number>()
  for (const spec of specs) {
    const id = spec.entityId ?? spec.id
    powers.set(id, (powers.get(id) ?? 0) + spec.power)
  }
  for (const entity of root.children) {
    const source = a.objects.find((e) => e.id === entity.userData.entityId)
    if (!source || !['LEDStrip', 'Spotlight', 'TrackLight', 'Pendant'].includes(source.kind))
      continue
    const ratio = (powers.get(source.id) ?? 0) / (source.params?.lumens || 500)
    entity.traverse((object) => {
      if (!(object instanceof T.Mesh)) return
      if (!emitterBase.has(object)) {
        const materials = (
          Array.isArray(object.material) ? object.material : [object.material]
        ).map((m) => m.clone())
        object.material = Array.isArray(object.material) ? materials : materials[0]
        emitterBase.set(
          object,
          materials.map((m) => (m as T.MeshPhysicalMaterial).emissiveIntensity ?? 0),
        )
      }
      const materials = Array.isArray(object.material) ? object.material : [object.material]
      materials.forEach((m, i) => {
        if ('emissiveIntensity' in m)
          (m as T.MeshPhysicalMaterial).emissiveIntensity = emitterBase.get(object)![i] * ratio
      })
    })
  }
}
export function lightingSpecs(a: Apartment, room: string, preset: LightingPreset): LightSpec[] {
  if (preset === 'day') return [] // Neutral material-review rig is separate from installed fixtures.
  const specs: LightSpec[] = []
  for (const e of a.objects) {
    if (
      !['LEDStrip', 'Spotlight', 'TrackLight', 'Pendant'].includes(e.kind) ||
      e.visible === false ||
      (room !== 'all' && e.roomId !== room)
    )
      continue
    const group = e.params?.group ?? 'general'
    const wallAccent = e.kind === 'LEDStrip' && e.roomId !== 'bathroom' && Boolean(e.params?.designStyle) && group === 'accent'
    const factor =
      group === 'night'
        ? 0
        : preset === 'evening'
          ? group === 'mirror' || group === 'accent'
            ? wallAccent ? 0.65 : 0.28
            : 0
          : 1
    if (!factor) continue
    const q = new T.Quaternion().setFromEuler(
        new T.Euler(...(e.rotation.map(deg) as [number, number, number])),
      ),
      p = new T.Vector3(...(e.position.map(mm) as [number, number, number]))
    const vertical = e.kind === 'LEDStrip' && e.size[1] > e.size[0] && e.size[1] > e.size[2]
    const dir = new T.Vector3(
      ...((vertical ? [1, 0, 0] : [0, -1, 0]) as [number, number, number]),
    ).applyQuaternion(q)
    if (vertical) p.add(new T.Vector3(0, mm(e.size[1]) / 2, 0).applyQuaternion(q))
    if (wallAccent && !vertical) {
      // Position the emitter just below the profile and graze the wall beneath it.
      p.add(new T.Vector3(0, -.012, mm(e.size[2]) / 2).applyQuaternion(q))
      dir.set(0, -1, -.3).normalize().applyQuaternion(q)
    } else p.addScaledVector(dir, 0.025)
    const style = e.params?.designStyle
    const pendantForm = e.kind === 'Pendant' ? e.params?.lightForm : undefined
    const linearTrack = e.kind === 'TrackLight' && style === 'hitech'
    if (linearTrack)
      p.add(new T.Vector3(0, mm(e.size[1]) * .57 + .023, 0).applyQuaternion(q))
    const spec: LightSpec = {
      id: e.id,
      type: pendantForm ? (pendantForm === 'disc' ? 'area' : 'point')
        : e.kind === 'LEDStrip' || linearTrack || (e.kind === 'Pendant' && style === 'hitech') ? 'area'
          : e.kind === 'Pendant' && (style === 'classic' || style === 'japandi') ? 'point' : 'spot',
      position: p.toArray(),
      target: p.clone().add(dir).toArray(),
      color: e.params?.color ?? '#ffe6bc',
      power: (e.params?.lumens ?? 500) * factor,
      size: 0.06,
      width: mm(vertical ? e.size[2] : e.size[0]) * (linearTrack ? .94 : 1),
      height: mm(vertical ? e.size[1] : e.size[2]) * (linearTrack ? .7 : 1),
    }
    if (pendantForm === 'cluster') {
      const shadeHeight = Math.min(mm(e.size[1]) * .56, mm(Math.min(e.size[0], e.size[2])) * .71)
      for (let i = 0; i < 3; i++) {
        const offset = new T.Vector3(mm(e.size[0]) * (i - 1) * .28, i * shadeHeight * .22, 0).applyQuaternion(q)
        const position = p.clone().add(offset)
        specs.push({ ...spec, id: `${e.id}:globe-${i + 1}`, entityId: e.id,
          position: position.toArray(), target: position.clone().add(dir).toArray(), power: spec.power / 3 })
      }
    } else if (e.kind === 'TrackLight' && style && !linearTrack) {
      for (let i = 0; i < 3; i++) {
        const offset = new T.Vector3(mm(e.size[0]) * (i - 1) * .33, 0, 0).applyQuaternion(q)
        specs.push({ ...spec, id: `${e.id}:lamp-${i + 1}`, entityId: e.id,
          position: p.clone().add(offset).toArray(), target: p.clone().add(offset).add(dir).toArray(), power: spec.power / 3 })
      }
    } else specs.push(spec)
  }
  return specs
}

/** Show the proposed fixtures at reduced power alongside the daytime review rig. */
export function presentationLightSpecs(a: Apartment, room: string, preset: LightingPreset): LightSpec[] {
  if (preset !== 'day') return lightingSpecs(a, room, preset)
  const proposed = new Set(a.objects.filter(entity => entity.params?.designStyle && entity.roomId !== 'bathroom').map(entity => entity.id))
  if (!proposed.size) return []
  return lightingSpecs(a, room, 'clean')
    .filter(spec => proposed.has(spec.entityId ?? spec.id))
    .map(spec => ({ ...spec, power: spec.power * .55 }))
}
// Photographic exposure normalization for FAST. This is a visual preview, not a lux meter.
export const FAST_LIGHT_GAIN = 0.055
export function makeLighting(specs: LightSpec[], preset: LightingPreset, underside = false) {
  const g = new T.Group()
  g.name = 'presentation-lighting'
  g.add(
    new T.HemisphereLight(
      '#fff9ed',
      '#b4afa3',
      preset === 'day' ? 0.85 : preset === 'evening' ? 0.1 : 0.45,
    ),
  )
  if (preset === 'day') {
    const key = new T.DirectionalLight('#fff7e8', 2.6)
    key.position.set(2.8, underside ? -4 : 5.5, 4.2)
    key.target.position.set(0.8, 0.6, 1)
    key.castShadow = true
    key.shadow.mapSize.set(2048, 2048)
    key.shadow.camera.left = -4
    key.shadow.camera.right = 4
    key.shadow.camera.top = 4
    key.shadow.camera.bottom = -4
    key.shadow.normalBias = 0.004
    key.shadow.bias = -0.0001
    key.shadow.camera.near = 0.1
    key.shadow.camera.far = 15
    g.add(key, key.target)
    const fill = new T.DirectionalLight('#e9eff8', 0.8)
    fill.position.set(-2, underside ? -2 : 2, -2)
    g.add(fill)
  }
  let shadows = 0
  for (const spec of specs) {
    if (spec.type === 'point') {
      const light = new T.PointLight(spec.color, (spec.power * FAST_LIGHT_GAIN) / (4 * Math.PI), 10, 2)
      light.position.fromArray(spec.position)
      light.castShadow = shadows++ < 4
      light.shadow.mapSize.set(1024, 1024)
      light.shadow.bias = -0.0001
      light.shadow.normalBias = 0.004
      g.add(light)
      continue
    }
    if (spec.type === 'area') {
      const width = Math.max(0.02, spec.width ?? 0.04),
        height = Math.max(0.02, spec.height ?? 0.5)
      const l = new T.RectAreaLight(
        spec.color,
        (spec.power * FAST_LIGHT_GAIN) / (Math.PI * width * height),
        width,
        height,
      )
      l.position.fromArray(spec.position)
      l.lookAt(new T.Vector3().fromArray(spec.target))
      g.add(l)
      continue
    }
    const l = new T.SpotLight(
      spec.color,
      (spec.power * FAST_LIGHT_GAIN) / (2 * Math.PI),
      10,
      Math.PI / 2.7,
      0.85,
      2,
    )
    l.position.fromArray(spec.position)
    l.target.position.fromArray(spec.target)
    l.castShadow = shadows++ < 4
    l.shadow.mapSize.set(2048, 2048)
    l.shadow.bias = -0.0001
    l.shadow.normalBias = 0.004
    l.shadow.camera.near = 0.03
    g.add(l, l.target)
  }
  return g
}
