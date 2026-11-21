import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import * as T from 'three'
import { createEntity } from '../src/scene/components.ts'
import { dropInSinkGeometry } from '../src/scene/basin.ts'
import { parseApartment } from '../src/domain/schema.ts'
import type { Entity, Kind } from '../src/domain/schema.ts'

const apartment = parseApartment(
  JSON.parse(readFileSync(new URL('../src/data/apartment.json', import.meta.url), 'utf8')),
)
const materials = new Map(
  apartment.materials.map((m) => [
    m.id,
    Object.assign(new T.MeshPhysicalMaterial({ color: m.color }), { name: m.id }),
  ]),
)

const cases: Array<[Kind, NonNullable<Entity['params']>['fixture'], [number, number, number]]> = [
  ['Sofa', undefined, [2400, 820, 900]],
  ['Sofa', 'armchair', [650, 750, 600]],
  ['Sofa', 'diningChair', [430, 800, 450]],
  ['Sofa', 'officeChair', [550, 850, 550]],
  ['Bed', undefined, [1600, 950, 2100]],
  ['Table', undefined, [1200, 750, 600]],
  ['Table', 'roundTable', [850, 750, 850]],
  ['Table', 'roundTable', [650, 400, 1000]],
  ['Table', 'bench', [700, 450, 400]],
  ['Countertop', 'rug', [2300, 10, 2200]],
  ['Countertop', 'mediaScreen', [1450, 850, 40]],
  ['Countertop', 'mediaScreen', [40, 850, 1450]],
  ['Countertop', 'monitor', [650, 500, 220]],
  ['Countertop', 'artwork', [1000, 1100, 30]],
  ['Countertop', 'artwork', [1000, 1050, 25]],
  ['Sink', 'dropInSink', [500, 123, 440]],
]

test('detailed furnishing meshes stay in their declared envelope and keep stable export IDs', () => {
  for (const [kind, fixture, size] of cases) {
    const entity: Entity = {
      id: `${kind}-${fixture ?? 'default'}`,
      name: kind,
      kind,
      size,
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      roomId: 'living',
      material: 'sage',
      evidence: 'assumed',
      params: fixture ? { fixture } : {},
    }
    const root = createEntity(entity, apartment, materials),
      bounds = new T.Box3().setFromObject(root, true)
    const min = [-size[0] / 2000, 0, -size[2] / 2000],
      max = [size[0] / 2000, size[1] / 1000, size[2] / 2000]
    for (const [i, axis] of ['x', 'y', 'z'].entries()) {
      assert.ok(bounds.min[axis as 'x'] >= min[i] - 1e-6, `${entity.id}: ${axis} minimum`)
      assert.ok(bounds.max[axis as 'x'] <= max[i] + 1e-6, `${entity.id}: ${axis} maximum`)
    }
    const ids: string[] = []
    root.traverse((o) => {
      if (!(o instanceof T.Mesh)) return
      ids.push(o.userData.partId)
      assert.equal(o.userData.entityId, entity.id)
      assert.ok(o.geometry.getAttribute('position').count > 0)
      o.geometry.dispose()
    })
    assert.equal(ids.length, new Set(ids).size)
    assert.ok(ids.length >= (fixture === 'dropInSink' ? 1 : 2))
  }
})

test('drop-in bowl clears the worktop cutout throughout its thickness and remains hollow', () => {
  const geometry = dropInSinkGeometry(0.5, 0.123, 0.44),
    material = new T.MeshPhysicalMaterial({ side: T.DoubleSide }),
    basin = new T.Mesh(geometry, material),
    position = geometry.getAttribute('position'),
    index = geometry.getIndex()!
  // Model installation: bottom 785 mm, worktop 870..900 mm, flange 900..908 mm.
  // Check the actual triangle intersections at section heights inside the worktop,
  // not merely the declared entity dimensions or a few outside vertices.
  for (const height of [0.085, 0.09, 0.1, 0.11, 0.1149]) {
    let crossings = 0
    for (let t = 0; t < index.count; t += 3) {
      const points = [0, 1, 2].map((v) =>
        new T.Vector3().fromBufferAttribute(position, index.getX(t + v)),
      )
      for (let e = 0; e < 3; e++) {
        const a = points[e],
          b = points[(e + 1) % 3]
        if ((a.y < height && b.y > height) || (b.y < height && a.y > height)) {
          const hit = a.clone().lerp(b, (height - a.y) / (b.y - a.y))
          crossings++
          assert.ok(Math.abs(hit.x) < 0.235, 'bowl penetrates 470 mm cutout sides')
          assert.ok(Math.abs(hit.z) < 0.205, 'bowl penetrates 410 mm cutout front/back')
        }
      }
    }
    assert.ok(crossings > 0)
  }
  basin.updateMatrixWorld(true)
  const center = new T.Raycaster(new T.Vector3(0, 0.3, 0), new T.Vector3(0, -1, 0)).intersectObject(
      basin,
    )[0],
    rim = new T.Raycaster(new T.Vector3(0.24, 0.3, 0), new T.Vector3(0, -1, 0)).intersectObject(
      basin,
    )[0]
  assert.ok(center && center.point.y < 0.02, 'opening must expose the recessed floor')
  assert.ok(
    rim && Math.abs(rim.point.y - 0.123) < 1e-6,
    'flange must support the bowl above the worktop',
  )
  geometry.dispose()
  material.dispose()
})

test('upholstered sofas use the selected fabric for their cushions', () => {
  const sofa: Entity = {
    id: 'fabric-sofa',
    name: 'Sofa',
    kind: 'Sofa',
    roomId: 'living',
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    size: [2400, 820, 900],
    material: 'sage',
    evidence: 'assumed',
  }
  const root = createEntity(sofa, apartment, materials)
  root.traverse((o) => {
    if (!(o instanceof T.Mesh)) return
    assert.notEqual(
      o.material,
      materials.get('white'),
      'sofa cushions must not become white ceramic',
    )
    o.geometry.dispose()
  })
})
