import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import * as T from 'three'
import { createEntity } from '../src/scene/components.ts'
import { kitchenInteriors } from '../src/domain/kitchen-interior.ts'
import { parseApartment } from '../src/domain/schema.ts'
import type { Entity } from '../src/domain/schema.ts'

const seed = parseApartment(
  JSON.parse(readFileSync(new URL('../src/data/apartment.json', import.meta.url), 'utf8')),
)
const kitchen = kitchenInteriors(seed)
const materials = new Map(
  seed.materials.map((m) => [
    m.id,
    Object.assign(new T.MeshPhysicalMaterial({ color: m.color, side: T.DoubleSide }), {
      name: m.id,
    }),
  ]),
)
const group = (e: Entity) => {
  const g = createEntity(e, seed, materials)
  g.updateMatrixWorld(true)
  return g
}
const parts = (g: ReturnType<typeof createEntity>) => {
  const result: Array<{ mesh: T.Mesh; box: T.Box3 }> = []
  g.traverse((o) => {
    if (o instanceof T.Mesh) result.push({ mesh: o, box: new T.Box3().setFromObject(o, true) })
  })
  return result
}
const positiveOverlap = (a: T.Box3, b: T.Box3) =>
  (['x', 'y', 'z'] as const).every(
    (axis) => Math.min(a.max[axis], b.max[axis]) - Math.max(a.min[axis], b.min[axis]) > 1e-7,
  )
const get = (id: string) => kitchen.find((e) => e.id === `auto-kitchen-${id}`)!
const appliance = (type: NonNullable<Entity['params']>['appliance']) =>
  kitchen.find((e) => e.kind === 'Appliance' && e.params?.appliance === type)!
const local = (e: Entity) => group({ ...e, position: [0, 0, 0], rotation: [0, 0, 0] })
const generic = (params: Entity['params'] = {}): Entity => ({
  id: 'cabinet-geometry-test',
  name: 'Cabinet',
  kind: 'Wardrobe',
  roomId: 'hall',
  position: [0, 0, 0],
  rotation: [0, 0, 0],
  size: [600, 2850, 600],
  material: 'paint',
  evidence: 'assumed',
  params,
})
function insideEnvelope(e: Entity) {
  for (const { mesh, box } of parts(local(e))) {
    assert.ok(
      box.min.x >= -e.size[0] / 2000 - 1e-7 && box.max.x <= e.size[0] / 2000 + 1e-7,
      `${e.id}/${mesh.name}: width`,
    )
    assert.ok(
      box.min.y >= -1e-7 && box.max.y <= e.size[1] / 1000 + 1e-7,
      `${e.id}/${mesh.name}: height`,
    )
    assert.ok(
      box.min.z >= -e.size[2] / 2000 - 1e-7 && box.max.z <= e.size[2] / 2000 + 1e-7,
      `${e.id}/${mesh.name}: depth`,
    )
  }
}

test('built-in appliances fit their actual cabinet meshes without positive-volume penetration', () => {
  const hood = kitchen.find((e) => e.params?.fixture === 'extractorHood')!
  for (const [device, housing] of [
    [appliance('fridge'), get('Колонна холодильника')],
    [appliance('oven'), get('Колонна духовки и СВЧ')],
    [appliance('microwave'), get('Колонна духовки и СВЧ')],
    [appliance('dishwasher'), get('Корпус посудомойки')],
    [hood, get('Корпус скрытой вытяжки')],
  ]) {
    assert.ok(device && housing)
    insideEnvelope(device)
    const deviceParts = parts(group(device)),
      housingParts = parts(group(housing))
    for (const a of deviceParts)
      for (const b of housingParts)
        assert.ok(
          !positiveOverlap(a.box, b.box),
          `${device.id}/${a.mesh.name} penetrates ${housing.id}/${b.mesh.name}`,
        )
  }
})

test('integrated appliances carry painted furniture fronts aligned with the adjacent cabinet plane', () => {
  for (const [device, housing] of [
    [appliance('fridge'), get('Колонна холодильника')],
    [appliance('dishwasher'), get('Нижний ряд 3')],
  ]) {
    const localFronts = parts(local(device)).filter(
      (p) =>
        Math.abs(p.box.max.z - device.size[2] / 2000) < 1e-7 &&
        p.box.max.x - p.box.min.x > (device.size[0] / 1000) * 0.9,
    )
    assert.equal(localFronts.length, device.params?.appliance === 'fridge' ? 2 : 1)
    for (const p of localFronts) assert.equal((p.mesh.material as T.Material).name, 'paint')
    const forward = new T.Vector3(0, 0, 1).applyAxisAngle(
      new T.Vector3(0, 1, 0),
      (device.rotation[1] * Math.PI) / 180,
    )
    const plane =
      new T.Vector3(...device.position.map((n) => n / 1000)).dot(forward) + device.size[2] / 2000
    const cabinetPlane =
      new T.Vector3(...housing.position.map((n) => n / 1000)).dot(forward) + housing.size[2] / 2000
    assert.ok(Math.abs(plane - cabinetPlane) < 1e-8)
  }
})

test('open appliance niches have no front, back or shelf obstructing their center', () => {
  for (const e of kitchen.filter((e) => e.params?.cabinetVoids?.some((v) => v.front !== false))) {
    const g = local(e)
    for (const v of e.params!.cabinetVoids!.filter((v) => v.front !== false)) {
      const y = (v.bottom + v.height / 2) / 1000
      const ray = new T.Raycaster(
        new T.Vector3(0, y, e.size[2] / 2000 + 0.05),
        new T.Vector3(0, 0, -1),
      )
      assert.equal(ray.intersectObject(g, true).length, 0, `${e.id}: niche center is filled`)
    }
  }
})

test('ordinary cabinet door panels do not penetrate their carcass', () => {
  const e = generic({ cabinetTopScribe: 50, cabinetTopTier: 500, cabinetDoors: 2 }),
    meshes = parts(local(e))
  insideEnvelope(e)
  const fronts = meshes.filter((p) => Math.abs(p.box.max.z - 0.3) < 1e-7)
  assert.equal(fronts.length, 4)
  for (const a of fronts)
    for (const b of meshes.filter((p) => p !== a))
      assert.ok(!positiveOverlap(a.box, b.box), `${a.mesh.name} penetrates ${b.mesh.name}`)
})

test('sliding doors remain full-height, in bounds and separate from each other and their tracks', () => {
  const e = {
    ...generic({ cabinetTopScribe: 50, cabinetDoorStyle: 'sliding', cabinetDoors: 2 }),
    size: [1900, 2850, 650] as Entity['size'],
  }
  insideEnvelope(e)
  const meshes = parts(local(e)),
    doors = meshes.filter(
      (p) =>
        p.box.max.x - p.box.min.x > 0.8 &&
        p.box.max.y - p.box.min.y > 2.7 &&
        p.box.max.z - p.box.min.z < 0.025 &&
        p.box.min.z > 0.2,
    )
  const tracks = meshes.filter(
    (p) => (p.mesh.material as T.Material).name === 'ink' && p.box.max.y - p.box.min.y < 0.02,
  )
  assert.equal(doors.length, 2)
  assert.equal(tracks.length, 2)
  for (const a of doors)
    for (const b of meshes.filter((p) => p !== a))
      assert.ok(!positiveOverlap(a.box, b.box), `${a.mesh.name} intersects ${b.mesh.name}`)
})

test('an open hall niche retains its requested backboard and has no front obstruction', () => {
  const e = generic({
      cabinetTopScribe: 50,
      cabinetPlinth: 0,
      cabinetVoids: [{ bottom: 0, height: 2250, keepBack: true }],
    }),
    g = local(e)
  const hits = new T.Raycaster(new T.Vector3(0, 1, 0.4), new T.Vector3(0, 0, -1)).intersectObject(
    g,
    true,
  )
  assert.ok(hits.length > 0)
  assert.ok(
    hits[0].point.z < -0.28,
    'first hit must be the rear board, not a facade or filled niche',
  )
})

test('microwave has a horizontal turntable distinct from oven racks', () => {
  const micro = parts(local(appliance('microwave'))),
    oven = parts(local(appliance('oven')))
  const turntables = micro.filter(
    (p) =>
      p.mesh.geometry.type === 'CylinderGeometry' &&
      p.box.max.y - p.box.min.y < 0.01 &&
      p.box.max.x - p.box.min.x > 0.2,
  )
  assert.equal(turntables.length, 1)
  assert.equal(
    oven.filter(
      (p) =>
        p.mesh.geometry.type === 'CylinderGeometry' &&
        p.box.max.y - p.box.min.y < 0.01 &&
        p.box.max.x - p.box.min.x > 0.2,
    ).length,
    0,
  )
  assert.ok(turntables[0].box.max.z < 0.2, 'turntable belongs inside the cavity')
})
