import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import * as T from 'three'
import { createEntity } from '../src/scene/components.ts'
import { parseApartment } from '../src/domain/schema.ts'

const a = parseApartment(
  JSON.parse(readFileSync(new URL('../src/data/apartment.json', import.meta.url), 'utf8')),
)
const materials = new Map(
  a.materials.map((m) => [m.id, Object.assign(new T.MeshPhysicalMaterial(), { name: m.id })]),
)
function local(id: string) {
  const e = a.objects.find((e) => e.id === id)!
  assert.ok(e, id)
  const group = createEntity({ ...e, position: [0, 0, 0], rotation: [0, 0, 0] }, a, materials)
  group.updateMatrixWorld(true)
  const meshes: T.Mesh[] = []
  group.traverse((o) => {
    if (o instanceof T.Mesh) meshes.push(o)
  })
  return { e, group, meshes }
}
const bounds = (m: T.Mesh) => new T.Box3().setFromObject(m, true)
const overlap = (a: T.Box3, b: T.Box3) =>
  (['x', 'y', 'z'] as const).every(
    (axis) => Math.min(a.max[axis], b.max[axis]) - Math.max(a.min[axis], b.min[axis]) > 1e-7,
  )

test('office-chair tyres reach the floor and stems connect every caster to its spoke', () => {
  const { meshes } = local('auto-living-Рабочее кресло')
  const wheels = meshes.filter((m) => m.geometry.type === 'SphereGeometry')
  assert.equal(wheels.length, 5)
  for (const wheel of wheels) {
    const b = bounds(wheel)
    assert.ok(Math.abs(b.min.y) < 1e-7, 'flattened tyre must touch the floor')
    const stem = meshes.find(
      (m) =>
        m.geometry.type === 'CylinderGeometry' &&
        Math.abs(m.position.x - wheel.position.x) < 1e-8 &&
        Math.abs(m.position.z - wheel.position.z) < 1e-8,
    )
    assert.ok(stem, 'missing caster stem')
    assert.ok(overlap(bounds(stem), b), 'stem must enter the wheel hub')
    assert.ok(
      meshes.some(
        (m) =>
          m.geometry.type === 'RoundedBoxGeometry' &&
          bounds(m).max.y < 0.1 &&
          overlap(bounds(stem), bounds(m)),
      ),
      'stem must enter the supporting spoke',
    )
  }
})

test('bathroom shower riser, arm and rain head form connected solid joints', () => {
  const { e, meshes } = local('shower')
  if (e.params?.fixture === 'bathShower250') {
    const head = meshes.find(m => m.userData.fixturePart === 'overhead-250')!
    const pipe = meshes.find(m => m.geometry.type === 'TubeGeometry')!
    const path = (pipe.geometry as T.TubeGeometry).parameters.path
    assert.ok(bounds(head).containsPoint(path.getPoint(1)), 'continuous riser/arm ends inside the head')
    const mixer = meshes.find(m => m.geometry.type === 'CylinderGeometry' && bounds(m).getSize(new T.Vector3()).x > .29)!
    assert.ok(bounds(mixer).containsPoint(path.getPoint(0)), 'riser begins inside the thermostat')
    return
  }
  const cylinders = meshes.filter((m) => m.geometry.type === 'CylinderGeometry')
  const riser = cylinders.find((m) => bounds(m).getSize(new T.Vector3()).y > 0.5)!
  const head = cylinders.find((m) => bounds(m).getSize(new T.Vector3()).y < 0.03)!
  const arm = meshes
    .filter((m) => m.geometry.type === 'RoundedBoxGeometry')
    .sort((a, b) => bounds(b).max.y - bounds(a).max.y)[0]
  assert.ok(overlap(bounds(riser), bounds(arm)), 'riser must reach the horizontal arm')
  assert.ok(overlap(bounds(head), bounds(arm)), 'rain head must join the arm')
})

test('bathroom spot diffusers are visible through actual housing openings from below', () => {
  for (const id of ['spot-0', 'spot-1']) {
    const { e, group } = local(id)
    const hit = new T.Raycaster(new T.Vector3(0, -0.1, 0), new T.Vector3(0, 1, 0)).intersectObject(
      group,
      true,
    )[0]
    assert.ok(hit)
    assert.equal(hit.object.userData.fixtureDiffuser, true)
    assert.equal(((hit.object as T.Mesh).material as T.Material).name, 'bathroom-light')
    assert.ok(Math.abs(hit.point.y) < 1e-7)
    // The annular shell also retains outward-facing normals in normal rendering.
    const radius = Math.min(e.size[0], e.size[2]) / 2000
    const side = new T.Raycaster(
      new T.Vector3(radius + 0.1, e.size[1] / 2000, 0),
      new T.Vector3(-1, 0, 0),
    ).intersectObject(group, true)[0]
    assert.ok(side && Math.abs(side.point.x - radius) < 1e-6)
  }
})

test('the extractor filter is exposed at the underside of its hollow canopy', () => {
  const { e, group, meshes } = local('auto-kitchen-Вытяжка')
  const filter = meshes.find((m) => m.userData.fixturePart === 'filter')!
  const ray = new T.Raycaster(
    new T.Vector3(0, -0.1, (e.size[2] / 1000) * 0.03),
    new T.Vector3(0, 1, 0),
  )
  const hit = ray.intersectObject(group, true)[0]
  assert.equal(hit?.object, filter)
  for (const m of meshes.filter((m) => m !== filter))
    assert.ok(
      !overlap(bounds(filter), bounds(m)),
      'housing must not fill or cover the filter opening',
    )
})

test('oven and microwave displays and controls are visible in front of recessed control rails', () => {
  for (const id of ['auto-kitchen-Духовка', 'auto-kitchen-Микроволновка']) {
    const { e, group, meshes } = local(id)
    const controls = meshes.filter((m) => ['display', 'control'].includes(m.userData.appliancePart))
    const rails = meshes.filter((m) => m.userData.appliancePart === 'control-rail')
    assert.equal(controls.length, 3)
    assert.equal(rails.length, 1)
    for (const control of controls) {
      const b = bounds(control),
        center = b.getCenter(new T.Vector3())
      const hit = new T.Raycaster(
        new T.Vector3(center.x, center.y, e.size[2] / 2000 + 0.1),
        new T.Vector3(0, 0, -1),
      ).intersectObject(group, true)[0]
      assert.equal(hit?.object, control, `${id}: control hidden behind an opaque face`)
      assert.ok(
        b.max.z - bounds(rails[0]).max.z > 0.002,
        'control face must stand clear of the rail',
      )
      assert.ok(!overlap(b, bounds(rails[0])), 'controls must meet rather than penetrate the rail')
    }
  }
})

test('vanity front strips are exposed and no longer coplanar with a filled cabinet face', () => {
  const { e, group, meshes } = local('vanity')
  const lines = meshes.filter((m) => {
    const s = bounds(m).getSize(new T.Vector3())
    return Math.abs(s.y - 0.003) < 1e-7 && Math.abs(s.z - 0.002) < 1e-7 && s.x > 0.3
  })
  assert.equal(lines.length, 2)
  for (const line of lines) {
    const b = bounds(line),
      center = b.getCenter(new T.Vector3())
    const hit = new T.Raycaster(
      new T.Vector3(0, center.y, e.size[2] / 2000 + 0.1),
      new T.Vector3(0, 0, -1),
    ).intersectObject(group, true)[0]
    assert.equal(hit?.object, line)
    for (const other of meshes.filter((m) => m !== line))
      assert.ok(!overlap(b, bounds(other)), 'front detail must not occupy the body volume')
  }
})

test('reviewed component repairs retain every declared outer envelope', () => {
  for (const id of [
    'auto-living-Рабочее кресло',
    'shower',
    'spot-0',
    'spot-1',
    'auto-kitchen-Вытяжка',
    'auto-kitchen-Духовка',
    'auto-kitchen-Микроволновка',
    'vanity',
    'towel-warmer',
    'auto-living-Диван',
    'auto-bedroom-Панно',
    'auto-living-Панно',
    'auto-bedroom-Ковёр',
    'auto-living-Ковёр',
  ]) {
    const { e, meshes } = local(id)
    for (const m of meshes) {
      const b = bounds(m)
      assert.ok(b.min.x >= -e.size[0] / 2000 - 1e-6 && b.max.x <= e.size[0] / 2000 + 1e-6, id)
      assert.ok(b.min.z >= -e.size[2] / 2000 - 1e-6 && b.max.z <= e.size[2] / 2000 + 1e-6, id)
      assert.ok(b.min.y >= -1e-6 && b.max.y <= e.size[1] / 1000 + 1e-6, id)
    }
  }
})

test('exposed sofa, artwork and rug faces have one nearest surface instead of coplanar layers', () => {
  for (const [id, origin, direction] of [
    ['auto-living-Диван', [-1.3, 0.25, 0], [1, 0, 0]],
    ['auto-bedroom-Панно', [-0.6, 0.55, -0.0075], [1, 0, 0]],
    ['auto-living-Панно', [-0.6, 0.55, -0.009], [1, 0, 0]],
    ['auto-bedroom-Ковёр', [-1.238, 0.05, 0], [0, -1, 0]],
    ['auto-living-Ковёр', [-1.238, 0.05, 0], [0, -1, 0]],
  ] as const) {
    const { group } = local(id)
    const hits = new T.Raycaster(
      new T.Vector3(...origin),
      new T.Vector3(...direction),
    ).intersectObject(group, true)
    assert.ok(hits.length, id)
    const nearest = hits[0]
    assert.ok(
      hits
        .filter((h) => Math.abs(h.distance - nearest.distance) < 1e-6)
        .every((h) => h.object === nearest.object),
      `${id}: exposed coplanar surfaces`,
    )
  }
})

test('sofa back cushions rest on the real seat surface and meet the backrest', () => {
  const { e, meshes } = local('auto-living-Диван')
  const backrest = meshes.find((m) => m.userData.upholsteryPart === 'backrest')!
  const pillows = meshes.filter((m) => m.userData.upholsteryPart === 'back-cushion')
  assert.ok(pillows.length)
  for (const pillow of pillows) {
    const seat = meshes.find(
      (m) =>
        m.userData.upholsteryPart === 'seat' && Math.abs(m.position.x - pillow.position.x) < 1e-8,
    )!
    const top = new T.Raycaster(
      new T.Vector3(pillow.position.x, e.size[1] / 1000 + 1, pillow.position.z),
      new T.Vector3(0, -1, 0),
    ).intersectObject(seat)[0]
    const bottom = new T.Raycaster(
      new T.Vector3(pillow.position.x, -0.1, pillow.position.z),
      new T.Vector3(0, 1, 0),
    ).intersectObject(pillow)[0]
    assert.ok(
      top && bottom && bottom.point.y <= top.point.y + 1e-6,
      'back pillow floats above the seat',
    )
    const rear = new T.Raycaster(
      new T.Vector3(pillow.position.x, pillow.position.y, -e.size[2] / 1000),
      new T.Vector3(0, 0, 1),
    ).intersectObject(pillow)[0]
    const support = new T.Raycaster(
      new T.Vector3(pillow.position.x, pillow.position.y, 0),
      new T.Vector3(0, 0, -1),
    ).intersectObject(backrest)[0]
    assert.ok(
      rear && support && Math.abs(rear.point.z - support.point.z) < 1e-6,
      'back pillow misses the backrest',
    )
  }
})

test('towel warmer has four connected mounts reaching its existing rear mounting plane', () => {
  const { e, meshes } = local('towel-warmer')
  const mounts = meshes.filter((m) => m.userData.fixturePart === 'standoff')
  const rails = meshes.filter(
    (m) => m.geometry.type === 'CylinderGeometry' && bounds(m).getSize(new T.Vector3()).y > 0.5,
  )
  assert.equal(mounts.length, 4)
  for (const mount of mounts) {
    assert.ok(Math.abs(bounds(mount).min.z + e.size[2] / 2000) < 1e-7)
    assert.ok(
      rails.some((rail) => overlap(bounds(mount), bounds(rail))),
      'mount must join a radiator rail',
    )
  }
})
