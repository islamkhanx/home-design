import * as T from 'three'
import type { Apartment, Entity } from '../domain/schema.ts'
import { mm, deg, pointInPolygon, polygonArea } from '../domain/math.ts'
import { wallFaceForRoom } from '../domain/wall-finishes.ts'
import { fixtureColor, fixtureOptics } from './fixture-optics.ts'
export type LightingPreset = 'day' | 'evening' | 'clean'
export type LightingControls = { windows: boolean; sources: Readonly<Record<string, boolean>> }
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
  /** Width axis of the rectangular diffuser in world space. */
  tangent?: number[]
}
export type ResolvedLighting = { fixtures: LightSpec[]; windows: LightSpec[] }
export type LightingSource = {
  id: string
  name: string
  roomId: string
  kind: 'fixture' | 'window'
  on: boolean
  override?: boolean
}
const fixtureKinds = new Set<Entity['kind']>(['LEDStrip', 'Spotlight', 'TrackLight', 'Pendant'])
const sourceId = (spec: LightSpec) => spec.entityId ?? spec.id
const inRoom = (entity: Entity, room: string) => room === 'all' || entity.roomId === room
const emitterBase = new WeakMap<T.MeshPhysicalMaterial, number>()
export function updateEmitters(root: T.Group, a: Apartment, specs: LightSpec[]) {
  const powers = new Map<string, number>()
  for (const spec of specs) {
    const id = sourceId(spec)
    powers.set(id, (powers.get(id) ?? 0) + spec.power)
  }
  const fixtures = new Map(a.objects.filter(entity => fixtureKinds.has(entity.kind)).map(entity => [entity.id, entity]))
  for (const entity of root.children) {
    const source = fixtures.get(entity.userData.entityId)
    if (!source) continue
    const ratio = (powers.get(source.id) ?? 0) / (source.params?.lumens || 500)
    entity.traverse(object => {
      if (!(object instanceof T.Mesh) || !object.userData.fixtureDiffuser ||
          !(object.material instanceof T.MeshPhysicalMaterial)) return
      const material = object.material
      const base = emitterBase.get(material) ?? material.emissiveIntensity
      emitterBase.set(material, base)
      material.emissiveIntensity = base * ratio
    })
  }
}
export function lightingSpecs(a: Apartment, room: string, preset: LightingPreset): LightSpec[] {
  if (preset === 'day') return [] // Neutral material-review rig is separate from installed fixtures.
  const specs: LightSpec[] = []
  for (const e of a.objects) {
    if (
      !fixtureKinds.has(e.kind) ||
      e.visible === false ||
      !inRoom(e, room)
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
    const optics = fixtureOptics(e)
    const rotation = new T.Quaternion().setFromEuler(new T.Euler(...(e.rotation.map(deg) as [number, number, number])))
    const origin = new T.Vector3().fromArray(e.position.map(mm))
    for (const optic of optics) {
      const position = new T.Vector3().fromArray(optic.origin).applyQuaternion(rotation).add(origin)
      const direction = new T.Vector3().fromArray(optic.direction).normalize().applyQuaternion(rotation)
      specs.push({
        id: optic.suffix ? `${e.id}:${optic.suffix}` : e.id,
        ...(optic.suffix ? { entityId: e.id } : {}),
        type: optic.type,
        position: position.toArray(),
        target: position.clone().add(direction).toArray(),
        color: fixtureColor(e),
        power: (e.params?.lumens ?? 500) * factor / optics.length,
        size: Math.min(.14, Math.max(.024, Math.min(optic.size[0], optic.size[2]) * .4)),
        ...(optic.type === 'area' && {
          width: optic.width,
          height: optic.height,
          tangent: new T.Vector3().fromArray(optic.tangent!).applyQuaternion(rotation).toArray(),
        }),
      })
    }
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

type ExteriorWindow = { entity: Entity; light: LightSpec }

function exteriorWindows(a: Apartment): ExteriorWindow[] {
  const objects = new Map(a.objects.map(entity => [entity.id, entity]))
  const rooms = new Map(a.rooms.map(room => [room.id, room]))
  const windows: ExteriorWindow[] = []
  for (const entity of a.objects) {
    if (entity.kind !== 'Window' || entity.visible === false || !entity.attach) continue
    const host = objects.get(entity.attach.wallId)
    const wall = host?.wall
    const room = rooms.get(entity.roomId)
    if (!host || !wall || !room || host.visible === false || host.sharedWith?.length) continue
    const opening = wall.openings.find(candidate => candidate.id === entity.attach!.openingId)
    if (!opening || opening.kind !== 'window' || opening.width <= 0 || opening.height <= 0) continue
    const side = wallFaceForRoom(host, room)
    if (!side) continue
    if (a.rooms.some(candidate => {
      if (candidate.id === room.id) return false
      const face = wallFaceForRoom(host, candidate)
      return face && face !== side
    })) continue

    const along = new T.Vector3(wall.end[0] - wall.start[0], 0, wall.end[1] - wall.start[1]).normalize()
    const normal = new T.Vector3(-along.z, 0, along.x).multiplyScalar(side === 'left' ? 1 : -1)
    const position = new T.Vector3(mm(wall.start[0]), mm(opening.bottom + opening.height / 2), mm(wall.start[1]))
      .addScaledVector(along, mm(opening.offset + opening.width / 2))
      .addScaledVector(normal, mm(wall.thickness / 2) + 0.035)
    const yaw = deg(host.rotation[1])
    position.applyAxisAngle(T.Object3D.DEFAULT_UP, yaw).add(new T.Vector3().fromArray(host.position.map(mm)))
    normal.applyAxisAngle(T.Object3D.DEFAULT_UP, yaw)
    const width = mm(opening.width), height = mm(opening.height)
    windows.push({ entity, light: {
      id: entity.id,
      entityId: entity.id,
      type: 'area',
      position: position.toArray(),
      target: position.clone().add(normal).toArray(),
      color: '#f1f7ff',
      // Shared fixture units convert to 80 W/m² of aperture in Cycles.
      power: width * height * 4800,
      size: .06,
      width,
      height,
      tangent: along.applyAxisAngle(T.Object3D.DEFAULT_UP, yaw).toArray(),
    } })
  }
  return windows
}

export function exteriorWindowIds(a: Apartment) {
  return exteriorWindows(a).map(({ entity }) => entity.id)
}

function fixtureSchedule(
  a: Apartment,
  room: string,
  preset: LightingPreset,
  controls: LightingControls,
  windows: ExteriorWindow[],
): LightSpec[] {
  const windowedRooms = new Set(windows.map(window => window.entity.roomId))
  const fixtures = new Map(a.objects.filter(entity => fixtureKinds.has(entity.kind)).map(entity => [entity.id, entity]))
  const defaults = preset === 'evening'
    ? new Map(lightingSpecs(a, room, 'evening').map(spec => [spec.id, spec.power]))
    : undefined
  return lightingSpecs(a, room, 'clean').flatMap(spec => {
    const owner = fixtures.get(sourceId(spec))!
    const override = controls.sources[owner.id]
    if (spec.power <= 0 || override === false) return []
    if (override === true || preset === 'clean') return [spec]
    if (preset === 'evening') {
      const power = defaults?.get(spec.id)
      return power ? [{ ...spec, power }] : []
    }
    if (owner.params?.designStyle && owner.roomId !== 'bathroom') return [{ ...spec, power: spec.power * .55 }]
    return windowedRooms.has(owner.roomId) ? [] : [spec]
  })
}

export function resolveLighting(
  a: Apartment,
  room: string,
  preset: LightingPreset,
  controls: LightingControls,
): ResolvedLighting {
  const windows = exteriorWindows(a)
  return {
    fixtures: fixtureSchedule(a, room, preset, controls, windows),
    windows: controls.windows
      ? windows.filter(window => inRoom(window.entity, room) && controls.sources[window.entity.id] !== false).map(window => window.light)
      : [],
  }
}

export function listLightingSources(
  a: Apartment,
  room: string,
  preset: LightingPreset,
  controls: LightingControls,
): LightingSource[] {
  const windows = exteriorWindows(a)
  const active = new Set(fixtureSchedule(a, room, preset, controls, windows).map(sourceId))
  const fixtures = a.objects.filter(entity => fixtureKinds.has(entity.kind) && entity.visible !== false &&
    entity.params?.group !== 'night' && entity.params?.lumens !== 0 && inRoom(entity, room))
  return [
    ...windows.filter(window => inRoom(window.entity, room)).map(({ entity }): LightingSource => ({
      id: entity.id, name: entity.name, roomId: entity.roomId, kind: 'window',
      on: controls.windows && controls.sources[entity.id] !== false,
      override: controls.sources[entity.id],
    })),
    ...fixtures.map((entity): LightingSource => ({
      id: entity.id, name: entity.name, roomId: entity.roomId, kind: 'fixture',
      on: active.has(entity.id), override: controls.sources[entity.id],
    })),
  ]
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
  addFixtures(g, specs)
  return g
}

/** Use shadows for realtime window apertures. Cycles uses their full area. */
export function makeInteriorLighting(schedule: ResolvedLighting, model: Apartment, focusRoom: string) {
  const group = new T.Group()
  group.name = 'interior-lighting'
  const roomsBySource = new Map(model.objects.map(entity => [entity.id, entity.roomId]))
  const fixtureOrder = [...schedule.fixtures].sort((a, b) =>
    Number(roomsBySource.get(sourceId(b)) === focusRoom) - Number(roomsBySource.get(sourceId(a)) === focusRoom)
    || b.power - a.power,
  )
  for (const window of schedule.windows) {
    const aperture = new T.SpotLight(window.color, (window.power * FAST_LIGHT_GAIN * .72) / (2 * Math.PI),
      18, Math.PI * .39, .96, 2)
    aperture.position.fromArray(window.position)
    aperture.target.position.fromArray(window.target)
    aperture.castShadow = true
    aperture.shadow.mapSize.set(1024, 1024)
    aperture.shadow.camera.near = .025
    aperture.shadow.bias = -.0001
    aperture.shadow.normalBias = .004
    aperture.shadow.radius = 3
    aperture.shadow.autoUpdate = false
    aperture.shadow.needsUpdate = true
    group.add(aperture, aperture.target)
    // Spread some daylight across the full pane instead of burning a circular
    // hotspot at its center. The main spot still provides wall occlusion.
    group.add(makeAreaLight(window, .16))
  }
  addFixtures(group, fixtureOrder, 4, true)

  // Three's direct lights have no reflected irradiance. Estimate a weak diffuse
  // return in each lit room from its active sources. No source means no fill.
  const roomSources = new Map<string, { position: T.Vector3; color: T.Color; amount: number }>()
  for (const [specs, gain] of [[schedule.fixtures, 1 / 1900], [schedule.windows, 1 / 27000]] as const) {
    for (const spec of specs) {
      const room = roomsBySource.get(sourceId(spec))
      if (!room) continue
      const bounce = roomSources.get(room) ?? { position: new T.Vector3(), color: new T.Color(0, 0, 0), amount: 0 }
      const amount = spec.power * gain
      bounce.position.addScaledVector(new T.Vector3().fromArray(spec.position).lerp(new T.Vector3().fromArray(spec.target), .7), amount)
      bounce.color.add(new T.Color(spec.color).multiplyScalar(amount))
      bounce.amount += amount
      roomSources.set(room, bounce)
    }
  }
  for (const room of model.rooms) {
    const estimate = roomSources.get(room.id), polygon = room.polygon
    if (!estimate || !polygon?.length) continue
    const center = new T.Vector3()
    for (const [x, z] of polygon) center.add(new T.Vector3(mm(x), 0, mm(z)))
    center.divideScalar(polygon.length)
    const position = estimate.position.divideScalar(estimate.amount)
    const candidate = position.clone().lerp(center, .6)
    if (pointInPolygon([candidate.x * 1000, candidate.z * 1000], polygon)) position.copy(candidate)
    const range = Math.min(6, Math.max(3, Math.sqrt(polygonArea(polygon)) / 900))
    const bounce = new T.PointLight(estimate.color.multiplyScalar(1 / estimate.amount).lerp(new T.Color('#f4ede5'), .35),
      Math.min(1.25, estimate.amount) * .95, range, 1.45)
    bounce.name = `reflected-light:${room.id}`
    bounce.position.set(position.x, 1.18, position.z)
    group.add(bounce)
  }
  return group
}

function makeAreaLight(spec: LightSpec, gain = 1, minimumSide = .02) {
  const width = Math.max(minimumSide, spec.width ?? .04), height = Math.max(minimumSide, spec.height ?? .5)
  const light = new T.RectAreaLight(spec.color, spec.power * FAST_LIGHT_GAIN * gain / (Math.PI * width * height), width, height)
  light.position.fromArray(spec.position)
  light.lookAt(new T.Vector3().fromArray(spec.target))
  if (spec.tangent) {
    const z = light.position.clone().sub(new T.Vector3().fromArray(spec.target)).normalize()
    const x = new T.Vector3().fromArray(spec.tangent)
    x.addScaledVector(z, -x.dot(z)).normalize()
    if (x.lengthSq()) light.quaternion.setFromRotationMatrix(new T.Matrix4().makeBasis(x, z.clone().cross(x), z))
  }
  return light
}

function addFixtures(g: T.Group, specs: LightSpec[], shadowLimit = 4, interior = false) {
  let shadows = 0
  for (const spec of specs) {
    if (spec.type === 'point') {
      const light = new T.PointLight(spec.color, (spec.power * FAST_LIGHT_GAIN) / (4 * Math.PI), 10, 2)
      light.position.fromArray(spec.position)
      light.castShadow = shadows++ < shadowLimit
      light.shadow.mapSize.set(1024, 1024)
      light.shadow.bias = -0.0001
      light.shadow.normalBias = 0.004
      if (interior) {
        light.shadow.radius = 2
        light.shadow.autoUpdate = false
        light.shadow.needsUpdate = true
      }
      g.add(light)
      continue
    }
    if (spec.type === 'area') {
      g.add(makeAreaLight(spec, 1, interior ? .055 : .02))
      continue
    }
    const l = new T.SpotLight(
      spec.color,
      (spec.power * FAST_LIGHT_GAIN) / (2 * Math.PI),
      10,
      interior ? Math.PI / 2.5 : Math.PI / 2.7,
      interior ? .94 : .85,
      2,
    )
    l.position.fromArray(spec.position)
    l.target.position.fromArray(spec.target)
    l.castShadow = shadows++ < shadowLimit
    l.shadow.mapSize.set(interior ? 1024 : 2048, interior ? 1024 : 2048)
    l.shadow.bias = -0.0001
    l.shadow.normalBias = 0.004
    l.shadow.camera.near = 0.03
    if (interior) {
      l.shadow.radius = 2.75
      l.shadow.autoUpdate = false
      l.shadow.needsUpdate = true
    }
    g.add(l, l.target)
  }
}
