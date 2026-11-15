import * as T from 'three'
import { renderNotice } from './provenance.ts'
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import type { Apartment } from '../domain/schema.ts'
import { geometryManifest, visibleEntities, disposeTree } from './canonical.ts'
import type { CameraSpec } from './cameras.ts'
import { presets } from './cameras.ts'
import { lightingSpecs } from './lighting.ts'
import type { LightingPreset } from './lighting.ts'
export async function exportScene(
  root: T.Group,
  a: Apartment,
  camera: CameraSpec,
  room: string,
  lighting: LightingPreset,
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
    lights: lightingSpecs(a, room, lighting),
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
    const actual = geometryManifest(loaded.scene),
      byId = new Map(actual.map((p) => [p.id, p]))
    let maxError = 0
    if (actual.length !== expected.length || byId.size !== expected.length)
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
      parts: actual.length,
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
