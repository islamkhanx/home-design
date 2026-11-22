import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import * as T from 'three'
import { restoreSourcePlan, SOURCE_RINGS, planPoint } from '../src/domain/source-plan.ts'
import { parseApartment } from '../src/domain/schema.ts'
import { stitchSlabJunctions } from '../src/domain/slab-junctions.ts'
import { createEntity } from '../src/scene/components.ts'
import { disposeTree } from '../src/scene/canonical.ts'
import type { V2 } from '../src/domain/math.ts'

const read = (name: string) => JSON.parse(readFileSync(new URL(name, import.meta.url), 'utf8'))
const a = restoreSourcePlan(parseApartment(read('../src/data/apartment.json')), read('../src/data/bathroom-interior.json'))
const close = (x: number, y: number, label = '') => assert.ok(Math.abs(x - y) < 1e-6, `${label}: ${x} != ${y}`)

test('source wall butt joints remove overlapping volumes while preserving room rings and world openings', () => {
  for (const room of a.rooms) assert.deepEqual(room.polygon, SOURCE_RINGS[room.id].map(planPoint))
  const expected: Record<string, [V2, V2]> = {
    'window-courtyard': [[565, -5372], [2965, -5372]],
    'window-living': [[471, 9796], [2871, 9796]],
    'window-bedroom': [[859, -4141], [2109, -4141]],
    'door-loggia': [[2176, -4141], [2976, -4141]],
    door: [[1909, 894], [1909, 1794]],
    'door-bedroom': [[2059, 765], [2959, 765]],
    'door-entry': [[4709, 991], [4709, 2041]],
  }
  const materials = new Map(a.materials.map(m => [m.id, new T.MeshPhysicalMaterial({ side: T.DoubleSide })]))
  const root = new T.Group()
  const parts: { id: string; box: T.Box3 }[] = []
  for (const wall of a.objects.filter(o => o.wall)) {
    const w = wall.wall!, length = Math.hypot(w.end[0] - w.start[0], w.end[1] - w.start[1])
    assert.equal(w.height, 3000)
    for (const opening of w.openings) {
      const at = (u: number): V2 => [w.start[0] + (w.end[0] - w.start[0]) * u / length, w.start[1] + (w.end[1] - w.start[1]) * u / length]
      assert.deepEqual([at(opening.offset), at(opening.offset + opening.width)], expected[opening.id], opening.id)
    }
    const group = createEntity(wall, a, materials)
    root.add(group); group.updateMatrixWorld(true)
    group.traverse(o => { if (o instanceof T.Mesh) parts.push({ id: wall.id, box: new T.Box3().setFromObject(o, true) }) })
  }
  try {
    for (let i = 0; i < parts.length; i++) for (let j = i + 1; j < parts.length; j++) {
      if (parts[i].id === parts[j].id) continue
      const overlap = parts[i].box.clone().intersect(parts[j].box), size = overlap.getSize(new T.Vector3())
      assert.ok(overlap.isEmpty() || Math.min(size.x, size.y, size.z) < 1e-6, `${parts[i].id} overlaps ${parts[j].id}`)
    }
    const envelope = new T.Box3().setFromObject(root, true)
    for (const [actual, expected] of [[envelope.min.x, -.25], [envelope.max.x, 4.759], [envelope.min.z, -5.497], [envelope.max.z, 9.921]] as const) close(actual, expected)
    for (const [x, z] of [[-62.5, -5309.5], [1934, 750], [4684, 720], [4684, 2470]]) {
      const hits = new T.Raycaster(new T.Vector3(x / 1000, 3.2, z / 1000), new T.Vector3(0, -1, 0), 0, .3).intersectObject(root, true)
      assert.equal(new Set(hits.filter(hit => Math.abs(hit.point.y - 3) < 1e-6).map(hit => hit.object.userData.entityId)).size, 1, 'one top face at each joint')
    }
  } finally { disposeTree(root) }
})

test('rear service seam, short wall-cap slit and entrance sill close without adding an exterior floor', () => {
  const service = a.objects.find(o => o.id === 'source-service-strip')!
  assert.equal(service.position[2] - service.size[2] / 2, 2512)
  assert.equal(service.position[2] + service.size[2] / 2, 2824, 'kitchen-facing service plane stays fixed')
  const materials = new Map(a.materials.map(m => [m.id, new T.MeshPhysicalMaterial({ side: T.DoubleSide })]))
  const root = new T.Group()
  for (const o of a.objects.filter(o => ['Floor', 'Ceiling'].includes(o.kind) || o.id === service.id)) root.add(createEntity(o, a, materials))
  root.updateMatrixWorld(true)
  const ray = (x: number, y: number, z: number, direction: number, far: number) => new T.Raycaster(new T.Vector3(x / 1000, y / 1000, z / 1000), new T.Vector3(0, direction, 0), 0, far).intersectObject(root, true)
  try {
    assert.ok(ray(850, 2800, 2515, 1, .3).some(hit => hit.object.userData.entityId === service.id))
    assert.ok(ray(1962, 100, 2450, -1, .2).some(hit => hit.object.userData.kind === 'Floor'))
    assert.ok(ray(1962, 2800, 2450, 1, .2).some(hit => hit.object.userData.kind === 'Ceiling'))
    for (const x of [4660, 4680, 4709, 4758]) assert.ok(ray(x, 100, 1500, -1, .2).some(hit => hit.object.userData.entityId === 'source-hall-floor'))
    assert.equal(ray(4760, 100, 1500, -1, .2).length, 0, 'no floor beyond outer wall face')
    assert.deepEqual(stitchSlabJunctions(a), a, 'repeated stitching does not enlarge patched slabs again')
  } finally { disposeTree(root) }
})
