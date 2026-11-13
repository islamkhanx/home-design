import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import * as T from 'three'
import {
  buildCanonical,
  geometryManifest,
  disposeTree,
  applyVisibility,
} from '../src/scene/canonical.ts'
import { createEntity } from '../src/scene/components.ts'
import { parseApartment, kinds } from '../src/domain/schema.ts'
import type { Entity } from '../src/domain/schema.ts'
const seed = () =>
  parseApartment(
    JSON.parse(readFileSync(new URL('../src/data/apartment.json', import.meta.url), 'utf8')),
  )
test('all exported parts retain stable IDs, source attribution and metric bounds', async () => {
  const a = seed(),
    r = await buildCanonical(a),
    m = geometryManifest(r)
  assert.deepEqual(
    new Set(m.map((p) => p.entityId)),
    new Set(
      a.objects.filter((e) => !['DimensionLine', 'RoomLabel'].includes(e.kind)).map((e) => e.id),
    ),
  )
  assert.equal(new Set(m.map((p) => p.id)).size, m.length)
  assert.ok(
    m.every((p) => p.min.every(Number.isFinite) && p.max.every(Number.isFinite) && p.triangles > 0),
  )
  assert.ok(m.every((p) => a.objects.some((e) => e.id === p.entityId)))
  disposeTree(r)
})
test('visibility/camera cutaway never deletes canonical export geometry', async () => {
  const a = seed(),
    r = await buildCanonical(a),
    before = geometryManifest(r)
  applyVisibility(r, a, 'bathroom', 'dollhouse', true)
  assert.ok(r.children.some((c) => !c.visible))
  assert.deepEqual(geometryManifest(r), before)
  disposeTree(r)
})
test('wall at arbitrary angle keeps its door void under raycasting', async () => {
  const a = seed(),
    e = a.objects.find((o) => o.kind === 'Wall')!
  e.wall = {
    start: [0, 0],
    end: [2400, 1800],
    height: 2700,
    thickness: 100,
    openings: [{ id: 'opening', kind: 'door', offset: 900, width: 900, bottom: 0, height: 2100 }],
  }
  a.objects = [e]
  const root = await buildCanonical(a)
  const direction = new T.Vector3(-0.6, 0, 0.8),
    center = new T.Vector3(1.08, 1, 0.81),
    ray = new T.Raycaster(center.clone().addScaledVector(direction, 1), direction.clone().negate())
  assert.equal(ray.intersectObject(root, true).length, 0)
  center.y = 2.4
  ray.set(center.clone().addScaledVector(direction, 1), direction.clone().negate())
  assert.ok(ray.intersectObject(root, true).length > 0)
  disposeTree(root)
})
test('parameter edits propagate into the same manifest consumed by Blender', async () => {
  const a = seed(),
    t = a.objects.find((o) => o.kind === 'Bathtub')!
  t.size[0] = 1600
  t.position = [1000, 0, 350]
  let root = await buildCanonical(a)
  const b = new T.Box3().setFromObject(root.children.find((c) => c.name === t.id)!, true)
  assert.ok(Math.abs(b.getSize(new T.Vector3()).x - 1.6) < 1e-6)
  assert.ok(Math.abs(b.getCenter(new T.Vector3()).x - 1) < 1e-6)
  disposeTree(root)
})
test('every furniture factory produces nonempty finite geometry inside its envelope', () => {
  const a = seed(),
    mat = new T.MeshPhysicalMaterial(),
    materials = new Map(a.materials.map((m) => [m.id, mat]))
  for (const kind of kinds.filter(
    (k) =>
      !['Wall', 'Floor', 'Ceiling', 'Door', 'Window', 'DimensionLine', 'RoomLabel'].includes(k),
  )) {
    const e: Entity = {
      id: kind,
      name: kind,
      kind,
      roomId: 'bathroom',
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      size: [600, 850, 450],
      material: 'white',
      evidence: 'assumed',
      params: { appliance: 'washer' },
    }
    const g = createEntity(e, a, materials),
      b = new T.Box3().setFromObject(g, true)
    assert.ok(!b.isEmpty(), kind)
    for (const [axis, lo, hi] of [
      ['x', -0.3, 0.3],
      ['y', 0, 0.85],
      ['z', -0.225, 0.225],
    ] as const)
      assert.ok(
        b.min[axis] >= lo - 1e-5 && b.max[axis] <= hi + 1e-5,
        kind + ' ' + axis + ' exceeds envelope ' + JSON.stringify(b),
      )
  }
  mat.dispose()
})
