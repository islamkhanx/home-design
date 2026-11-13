import test from 'node:test'
import assert from 'node:assert/strict'
import * as T from 'three'
import { readFileSync } from 'node:fs'
import { applyMetricUVs } from '../src/scene/materials.ts'
import { lightingSpecs, makeLighting } from '../src/scene/lighting.ts'
import { parseApartment } from '../src/domain/schema.ts'
const seed = () =>
  parseApartment(
    JSON.parse(readFileSync(new URL('../src/data/apartment.json', import.meta.url), 'utf8')),
  )
test('metric texture projection uses world dimensions across transformed meshes', () => {
  const root = new T.Group(),
    mat = new T.MeshPhysicalMaterial()
  mat.userData.metersPerTile = [0.6, 1.2]
  const mesh = new T.Mesh(new T.BoxGeometry(1.8, 2.4, 0.1), mat)
  mesh.position.set(3, 1.2, 2)
  mesh.rotation.y = Math.PI / 2
  root.add(mesh)
  applyMetricUVs(root)
  const p = mesh.geometry.getAttribute('position'),
    uv = mesh.geometry.getAttribute('uv'),
    n = mesh.geometry.getAttribute('normal'),
    v = new T.Vector3(),
    normal = new T.Vector3(),
    matrix = new T.Matrix3().getNormalMatrix(mesh.matrixWorld)
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i).applyMatrix4(mesh.matrixWorld)
    normal.fromBufferAttribute(n, i).applyMatrix3(matrix)
    if (Math.abs(normal.x) > 0.99) {
      assert.ok(Math.abs(uv.getX(i) - v.z / 0.6) < 1e-6)
      assert.ok(Math.abs(uv.getY(i) - v.y / 1.2) < 1e-6)
    }
  }
  mesh.geometry.dispose()
  mat.dispose()
})
test('mirror LEDs are area sources centered on their physical strip', () => {
  const a = seed(),
    lights = lightingSpecs(a, 'bathroom', 'clean'),
    e = a.objects.find((e) => e.kind === 'LEDStrip' && e.params?.group === 'mirror')!,
    l = lights.find((l) => l.id === e.id)!
  assert.equal(l.type, 'area')
  assert.equal(l.height, e.size[1] / 1000)
  assert.equal(l.position[1], (e.position[1] + e.size[1] / 2) / 1000)
  const group = makeLighting([l], 'clean')
  assert.ok(group.children.some((o) => o instanceof T.RectAreaLight))
})
test('evening activates only mirror lights; the approved model contains no night light', () => {
  const a = seed()
  assert.deepEqual(lightingSpecs(a, 'bathroom', 'day'), [])
  assert.ok(a.objects.every((e) => e.params?.group !== 'night'))
  const evening = lightingSpecs(a, 'bathroom', 'evening')
  assert.equal(evening.length, 2)
  assert.ok(evening.every((l) => a.objects.find((e) => e.id === l.id)?.params?.group === 'mirror'))
  assert.equal(lightingSpecs(a, 'bathroom', 'clean').length, 4)
})

import { buildCanonical, applyVisibility, disposeTree } from '../src/scene/canonical.ts'
import { presets, fitOrthographic, makeCamera } from '../src/scene/cameras.ts'
import { basinGeometry } from '../src/scene/basin.ts'

test('orthographic framing contains visible geometry on portrait and wide displays', async () => {
  const a = seed(),
    root = await buildCanonical(a)
  for (const mode of ['dollhouse', 'plan'] as const) {
    applyVisibility(root, a, 'bathroom', mode, true)
    for (const aspect of [0.45, 1, 16 / 9, 2.4]) {
      const camera = makeCamera(fitOrthographic(presets(root)[mode], root, aspect), aspect)
      camera.updateMatrixWorld(true)
      const bounds = new T.Box3()
      root.children.filter((o) => o.visible).forEach((o) => bounds.expandByObject(o))
      for (const x of [bounds.min.x, bounds.max.x])
        for (const y of [bounds.min.y, bounds.max.y])
          for (const z of [bounds.min.z, bounds.max.z]) {
            const point = new T.Vector3(x, y, z).project(camera)
            assert.ok(
              Math.abs(point.x) < 1 && Math.abs(point.y) < 1,
              `${mode}/${aspect}: clipped geometry`,
            )
          }
    }
  }
  disposeTree(root)
})
test('ceramic basin has a genuine recessed floor and stays within its envelope', () => {
  const geometry = basinGeometry(1.7, 0.6, 0.7, 0.065),
    material = new T.MeshPhysicalMaterial({ side: T.DoubleSide })
  const basin = new T.Mesh(geometry, material)
  basin.updateMatrixWorld()
  const hit = new T.Raycaster(new T.Vector3(0, 1, 0), new T.Vector3(0, -1, 0)).intersectObject(
    basin,
  )[0]
  assert.ok(
    hit && Math.abs(hit.point.y - 0.08) < 1e-6,
    'center must hit basin floor, not a top cap',
  )
  const bounds = new T.Box3().setFromObject(basin)
  assert.ok(Math.abs(bounds.max.y - 0.6) < 1e-6)
  geometry.dispose()
  material.dispose()
})
