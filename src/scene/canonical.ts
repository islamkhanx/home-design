import * as T from 'three'
import type { Object3D } from 'three/src/core/Object3D.js'
import type { Apartment } from '../domain/schema.ts'
import { parseApartment } from '../domain/schema.ts'
import { createEntity } from './components.ts'
import { buildMaterials, applyMetricUVs } from './materials.ts'
export type ViewMode = 'dollhouse' | 'plan' | 'interior' | 'free'
export async function buildCanonical(input: Apartment): Promise<T.Group> {
  const a = parseApartment(input),
    materials = await buildMaterials(a.materials),
    root = new T.Group()
  root.name = 'canonical-apartment'
  root.userData = { schemaVersion: 1, revision: a.revision, units: 'm', sourceUnits: 'mm' }
  for (const e of a.objects)
    if (!['DimensionLine', 'RoomLabel'].includes(e.kind)) root.add(createEntity(e, a, materials))
  root.updateMatrixWorld(true)
  applyMetricUVs(root)
  return root
}
export function applyVisibility(
  root: T.Group,
  a: Apartment,
  room: string,
  mode: ViewMode,
  cutaway: boolean,
) {
  for (const g of root.children) {
    const e = a.objects.find((o) => o.id === g.userData.entityId)!
    g.visible =
      e.visible !== false &&
      (room === 'all' || e.roomId === room) &&
      !(
        mode === 'plan' &&
        (e.kind === 'Ceiling' || ['Spotlight', 'TrackLight', 'Pendant'].includes(e.kind))
      ) &&
      !(cutaway && mode === 'interior' && e.kind === 'Door') &&
      !(
        cutaway &&
        mode === 'dollhouse' &&
        (e.cutaway === true || ['Spotlight', 'TrackLight', 'Pendant'].includes(e.kind))
      )
  }
}
export function disposeTree(root: Object3D) {
  const geometries = new Set<T.BufferGeometry>(),
    materials = new Set<T.Material>(),
    textures = new Set<T.Texture>()
  root.traverse((o) => {
    const m = o as T.Mesh
    if (m.geometry) geometries.add(m.geometry)
    for (const mat of Array.isArray(m.material) ? m.material : m.material ? [m.material] : []) {
      materials.add(mat)
      for (const v of Object.values(mat)) if (v instanceof T.Texture) textures.add(v)
    }
  })
  geometries.forEach((g) => g.dispose())
  materials.forEach((m) => m.dispose())
  textures.forEach((t) => t.dispose())
}
export function geometryManifest(root: Object3D) {
  root.updateMatrixWorld(true)
  const parts: { id: string; entityId: string; min: number[]; max: number[]; triangles: number }[] =
    []
  root.traverse((o) => {
    if (!(o instanceof T.Mesh)) return
    const b = new T.Box3().setFromObject(o, true)
    parts.push({
      id: o.userData.partId,
      entityId: o.userData.entityId,
      min: b.min.toArray(),
      max: b.max.toArray(),
      triangles: (o.geometry.index?.count ?? o.geometry.attributes.position.count) / 3,
    })
  })
  return parts
}
export function visibleEntities(root: Object3D) {
  return root.children.filter((o) => o.visible).map((o) => o.userData.entityId as string)
}
