import * as T from 'three'
import type { Object3D } from 'three/src/core/Object3D.js'
import { renderNotice } from './provenance.ts'
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import type { Apartment } from '../domain/schema.ts'
import { geometryManifest, visibleEntities, disposeTree } from './canonical.ts'
import type { CameraSpec } from './cameras.ts'
import type { ViewMode } from './canonical.ts'
import { presets } from './cameras.ts'
import { lightingSpecs } from './lighting.ts'
import type { LightingPreset, ResolvedLighting } from './lighting.ts'
export async function exportScene(
  root: T.Group,
  a: Apartment,
  camera: CameraSpec,
  room: string,
  lighting: LightingPreset,
  view?: ViewMode,
  lightingSchedule?: ResolvedLighting,
) {
  root.updateMatrixWorld(true)
  const exporter = new GLTFExporter()
  // Tres pointer-events augments the three barrel type, but not Group’s original base.
  // The exporter receives the actual, unmodified Three Group at this typed boundary.
  const glb = (await exporter.parseAsync(
    root as unknown as Parameters<GLTFExporter['parseAsync']>[0],
    {
      binary: true,
      onlyVisible: false,
      trs: false,
      maxTextureSize: 1024,
    },
  )) as ArrayBuffer
  if (!(glb instanceof ArrayBuffer)) throw new Error('Exporter did not produce a GLB.')
  const geometry = geometryManifest(root),
    roundTrip = await verifyGlb(glb, geometry)
  const source = new TextEncoder().encode(JSON.stringify(a))
  const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', source)))
    .map((v) => v.toString(16).padStart(2, '0'))
    .join('')
  const conceptRooms = [...new Set(a.objects.filter(entity => entity.params?.designStyle && entity.roomId !== 'bathroom').map(entity => entity.roomId))]
  const metadata = {
    schemaVersion: 1,
    units: 'm',
    sourceUnits: 'mm',
    sourceRevision: a.revision,
    sourceHash: hash,
    sourceApartment: a,
    renderNotice: renderNotice(a, room),
    roomId: room,
    camera,
    cameraPresets: presets(root),
    visibleEntityIds: visibleEntities(root),
    lightingPreset: lighting,
    ...(conceptRooms.length ? { conceptLighting: { roomIds: conceptRooms, label: a.generation?.label } } : {}),
    ...(lightingSchedule ? { lightingSchedule } : {}),
    lights: lightingSchedule?.fixtures ?? lightingSpecs(a, view === 'interior' ? 'all' : room, lighting),
    photorealLights: lightingSchedule?.fixtures ?? lightingSpecs(a, 'all', 'clean'),
    materials: a.materials,
    geometry,
    roundTrip,
    exportedAt: new Date().toISOString(),
  }
  return { glb, metadata }
}
export async function verifyGlb(glb: ArrayBuffer, expected: ReturnType<typeof geometryManifest>) {
  const loaded = await new GLTFLoader().parseAsync(glb, '')
  try {
    // glTF stores a material group as a primitive. GLTFLoader exposes those
    // primitives as child meshes; Blender joins them into the original part.
    // Recombine only children sharing the same canonical owner, never unrelated
    // objects with duplicate IDs, to verify the identical solid wall cells.
    const owners = new Map<string, Object3D>()
    const byId = new Map<string, ReturnType<typeof geometryManifest>[number]>()
    loaded.scene.updateMatrixWorld(true)
    loaded.scene.traverse(o => {
      if (!(o instanceof T.Mesh)) return
      let owner: Object3D = o
      while (owner.parent && !owner.userData.partId) owner = owner.parent
      const id = owner.userData.partId, entityId = owner.userData.entityId
      if (!id || !entityId) throw new Error('GLB mesh has no canonical part ID.')
      if (owners.has(id) && owners.get(id) !== owner) throw new Error('Duplicate GLB part ID: ' + id)
      owners.set(id, owner)
      const bounds = new T.Box3().setFromObject(o, true)
      const triangles = (o.geometry.index?.count ?? o.geometry.attributes.position.count) / 3
      const previous = byId.get(id)
      if (!previous) byId.set(id, { id, entityId, min: bounds.min.toArray(), max: bounds.max.toArray(), triangles })
      else {
        if (previous.entityId !== entityId) throw new Error('GLB entity mismatch: ' + id)
        previous.triangles += triangles
        for (let axis = 0; axis < 3; axis++) {
          previous.min[axis] = Math.min(previous.min[axis], bounds.min.getComponent(axis))
          previous.max[axis] = Math.max(previous.max[axis], bounds.max.getComponent(axis))
        }
      }
    })
    let maxError = 0
    if (byId.size !== expected.length)
      throw new Error('GLB round-trip mesh IDs/count mismatch.')
    for (const p of expected) {
      const q = byId.get(p.id)
      if (!q || q.entityId !== p.entityId || q.triangles !== p.triangles)
        throw new Error('GLB part mismatch: ' + p.id)
      for (const key of ['min', 'max'] as const)
        for (let i = 0; i < 3; i++) maxError = Math.max(maxError, Math.abs(p[key][i] - q[key][i]))
    }
    if (maxError > 0.0001) throw new Error('GLB geometry changed by ' + maxError * 1000 + ' mm.')
    return {
      passed: true,
      parts: byId.size,
      maxBoundsErrorMeters: maxError,
      toleranceMeters: 0.0001,
    }
  } finally {
    disposeTree(loaded.scene)
  }
}
export function download(data: Blob | string, name: string, type = 'application/json') {
  const blob = data instanceof Blob ? data : new Blob([data], { type }),
    url = URL.createObjectURL(blob),
    a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
export function base64(buffer: ArrayBuffer) {
  let s = ''
  const b = new Uint8Array(buffer)
  for (let i = 0; i < b.length; i += 32768) s += String.fromCharCode(...b.subarray(i, i + 32768))
  return btoa(s)
}
