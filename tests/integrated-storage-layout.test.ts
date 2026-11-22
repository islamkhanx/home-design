import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import * as T from 'three'
import type { Object3D } from 'three/src/core/Object3D.js'
import { OBB } from 'three/addons/math/OBB.js'
import { parseApartment } from '../src/domain/schema.ts'
import { createEntity } from '../src/scene/components.ts'

const a = parseApartment(
  JSON.parse(readFileSync(new URL('../src/data/apartment.json', import.meta.url), 'utf8')),
)
const material = new T.MeshPhysicalMaterial({ side: T.DoubleSide })
const materials = new Map(a.materials.map((m) => [m.id, material]))
const entity = (id: string) => {
  const e = a.objects.find((o) => o.id === id)
  assert.ok(e, `missing integrated storage object: ${id}`)
  return e
}
const groups = new Map<string, T.Group>()
function group(id: string) {
  if (!groups.has(id)) groups.set(id, createEntity(entity(id), a, materials))
  const g = groups.get(id)!
  g.updateMatrixWorld(true)
  return g
}
function parts(root: Object3D) {
  const meshes: T.Mesh[] = []
  root.traverse((o) => {
    if (o instanceof T.Mesh) meshes.push(o)
  })
  return meshes
}
const bounds = (id: string) => new T.Box3().setFromObject(group(id), true)
function union(ids: string[]) {
  return ids.reduce((box, id) => box.union(bounds(id)), new T.Box3())
}
function near(actual: number, expected: number, label: string, tolerance = 0.00002) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${label}: ${actual} ≠ ${expected}`)
}
function assertSeparate(left: string, right: string) {
  for (const p of parts(group(left)))
    for (const q of parts(group(right))) {
      const b = new T.Box3().setFromObject(p, true),
        c = new T.Box3().setFromObject(q, true)
      const overlap = ['x', 'y', 'z'].every(
        (axis) =>
          Math.min(b.max[axis as 'x'], c.max[axis as 'x']) -
            Math.max(b.min[axis as 'x'], c.min[axis as 'x']) >
          0.00001,
      )
      assert.ok(!overlap, `${p.name} penetrates ${q.name}`)
    }
}
function rayAt(id: string, x: number, y: number, z: number) {
  const hits = new T.Raycaster(
    new T.Vector3(x, y, z),
    new T.Vector3(0, 0, 1),
    0,
    2,
  ).intersectObject(group(id), true)
  assert.ok(hits.length, `${id}: expected surface on ray`)
  return hits[0].point.z
}
const bedroom = [
  'auto-bedroom-Левый добор шкафа',
  'auto-bedroom-Шкаф',
  'auto-bedroom-Правый добор шкафа',
]
const hall = [
  'auto-hall-Левый добор прихожей',
  'auto-hall-Входная ниша',
  'auto-hall-Шкаф у входа',
  'auto-hall-Правый добор прихожей',
]

test('bedroom joinery ends at the bathroom return and preserves bed clearance with sliding fronts', () => {
  const assembly = union(bedroom),
    body = bounds(bedroom[1]),
    bed = bounds('auto-bedroom-Кровать')
  near(assembly.min.x, 0, 'left assembly edge')
  near(assembly.max.x, 1.959, 'right assembly edge')
  near(assembly.max.x, bounds('wall-north').max.x, 'aligned bathroom return')
  near(assembly.min.z, -0.77, 'front line')
  near(assembly.max.y, 2.85, 'ceiling line')
  near(assembly.min.z - bed.max.z, 1.02, 'bed access')
  near(body.max.z - body.min.z, 0.65, 'hanging wardrobe depth')
  near(bounds(bedroom[0]).max.x, body.min.x, 'left filler seam')
  near(body.max.x, bounds(bedroom[2]).min.x, 'right filler seam')
  assert.equal(entity(bedroom[1]).params?.cabinetDoorStyle, 'sliding')
  // Two closed panels occupy different tracks, not a merely renamed hinged front.
  const first = rayAt(bedroom[1], 0.5, 1, -0.95),
    second = rayAt(bedroom[1], 1.5, 1, -0.95)
  near(Math.abs(first - second), 0.024, 'sliding track separation')
  for (const id of bedroom) assertSeparate(id, 'auto-bedroom-Кровать')
  assertSeparate(bedroom[0], bedroom[1])
  assertSeparate(bedroom[1], bedroom[2])
})

test('hall bench and mirror fit the actual open niche without penetrating its panels', () => {
  const niche = bounds('auto-hall-Входная ниша'),
    bench = bounds('auto-hall-Банкетка'),
    mirror = bounds('auto-hall-Зеркало')
  const assembly = union(hall)
  near(assembly.min.x, 3.212, 'hall return edge')
  near(assembly.max.x, 4.659, 'entry wall edge')
  near(assembly.min.z, 2.042, 'single hall front line')
  near(assembly.max.y, 2.85, 'hall ceiling line')
  for (const b of [bench, mirror]) {
    assert.ok(b.min.x > niche.min.x + 0.018 && b.max.x < niche.max.x - 0.018)
    assert.ok(b.min.z > niche.min.z && b.max.z < niche.max.z - 0.018)
  }
  near(bench.min.x - niche.min.x - 0.018, 0.032, 'bench left clear gap')
  near(niche.max.x - 0.018 - bench.max.x, 0.032, 'bench right clear gap')
  near(niche.max.z - 0.018 - bench.max.z, 0.014, 'bench rear gap')
  near(niche.max.z - 0.018 - mirror.max.z, 0.001, 'mirror in front of back panel')
  for (const id of ['auto-hall-Банкетка', 'auto-hall-Зеркало'])
    for (const cabinet of hall) assertSeparate(id, cabinet)
  assertSeparate('auto-hall-Банкетка', 'auto-hall-Зеркало')
  // A ray at head/torso height reaches the retained back panel; above the niche
  // it meets a cabinet door. The lower opening must not be a solid cabinet box.
  near(rayAt('auto-hall-Входная ниша', 3.537, 0.65, 1.8), 2.374, 'open niche back')
  near(rayAt('auto-hall-Входная ниша', 3.537, 2.4, 1.8), 2.042, 'upper storage front')
})

test('entry leaf and handle clear integrated hall storage from -90 to 90 degrees', () => {
  const pose = (angle: number) => {
    const e = structuredClone(entity('door-entry'))
    e.params = { ...e.params, doorAngle: angle }
    const g = createEntity(e, a, materials)
    g.updateMatrixWorld(true)
    return parts(g)
  }
  const closed = new Map(pose(0).map((m) => [m.name, m.matrixWorld.clone()]))
  const moving = new Set(
    pose(90)
      .filter((m) => !m.matrixWorld.equals(closed.get(m.name)!))
      .map((m) => m.name),
  )
  assert.ok(moving.size >= 2, 'the opening leaf and its handle must move')
  const obb = (mesh: T.Mesh) => {
    mesh.geometry.computeBoundingBox()
    return new OBB().fromBox3(mesh.geometry.boundingBox!).applyMatrix4(mesh.matrixWorld)
  }
  const obstacles = [...hall, 'auto-hall-Банкетка', 'auto-hall-Зеркало'].flatMap((id) =>
    parts(group(id)).map((m) => ({ name: m.name, box: obb(m) })),
  )
  for (let angle = -90; angle <= 90; angle += 5)
    for (const mesh of pose(angle).filter((m) => moving.has(m.name))) {
      const box = obb(mesh)
      for (const obstacle of obstacles)
        assert.ok(
          !box.intersectsOBB(obstacle.box),
          `${mesh.name} hits ${obstacle.name} at ${angle}°`,
        )
    }
})

test('hall storage uses sliding tracks and keeps the niche upper front above the entry opening', () => {
  const id = 'auto-hall-Шкаф у входа', cabinet = bounds(id),
    nicheId = 'auto-hall-Входная ниша', niche = bounds(nicheId)
  assert.equal(entity(id).params?.cabinetDoorStyle, 'sliding')
  near(cabinet.min.x, 3.837, 'hall wardrobe left edge')
  near(cabinet.max.x, 4.637, 'hall wardrobe right edge')
  near(cabinet.min.z, 2.042, 'hall wardrobe front line')
  near(cabinet.max.z, 2.392, 'hall wardrobe back line')
  near(cabinet.max.z - cabinet.min.z, 0.35, 'unchanged hall wardrobe depth')
  const leftTrack = rayAt(id, 4.05, 1, 1.8), rightTrack = rayAt(id, 4.4, 1, 1.8)
  near(Math.abs(leftTrack - rightTrack), 0.024, 'actual hall sliding track separation')
  // The niche remains open above the entry opening. Only its higher storage
  // doors are hinged, so their vertical interval cannot meet the entry leaf.
  near(rayAt(nicheId, 3.537, 2.325, 1.8), 2.374, 'open niche above entry frame')
  const fronts = parts(group(nicheId))
    .map(m => new T.Box3().setFromObject(m, true))
    .filter(b => Math.abs(b.min.z - niche.min.z) < 0.00001)
  assert.ok(fronts.length, 'the upper niche must retain a real front panel')
  assert.ok(Math.min(...fronts.map(b => b.min.y)) > bounds('door-entry').max.y,
    'hinged niche storage begins above the full entry frame')
})

test('WC upper cabinet is flush with its frame and meets the ceiling without fixture collisions', () => {
  const cabinet = bounds('wc-storage'),
    frame = bounds('wc-frame')
  near(cabinet.min.x, 0, 'WC cabinet rear')
  near(cabinet.max.x, 0.2, 'WC cabinet front')
  near(cabinet.max.x, frame.max.x, 'continuous WC front plane')
  near(cabinet.min.y, frame.max.y, 'cabinet supported above frame')
  near(cabinet.min.y, 1.2, 'WC cabinet bottom')
  near(cabinet.max.y, 2.85, 'WC cabinet ceiling line')
  near(cabinet.min.z, frame.min.z, 'first side alignment')
  near(cabinet.max.z, frame.max.z, 'second side alignment')
  for (const id of [
    'wc-frame',
    'toilet',
    'flush',
    'E01',
    'vanity',
    'mirror',
    'hygienic-shower',
    'laundry-tower',
  ])
    assertSeparate('wc-storage', id)
})

test('all proposed sockets and switches remain outside actual cabinetry and filler panels', () => {
  const obb = (mesh: T.Mesh) => {
    mesh.geometry.computeBoundingBox()
    const box = new OBB().fromBox3(mesh.geometry.boundingBox!).applyMatrix4(mesh.matrixWorld)
    // Ignore only numerical contact; do not hide meaningful panel penetration.
    box.halfSize.addScalar(-0.000005)
    return box
  }
  const cabinets = a.objects
    .filter(
      (e) =>
        ['Wardrobe', 'KitchenCabinet'].includes(e.kind) || e.params?.fixture === 'joineryPanel',
    )
    .flatMap((e) => parts(group(e.id)).map((m) => ({ name: m.name, box: obb(m) })))
  const points = a.objects.filter((e) => ['Socket', 'Switch'].includes(e.kind))
  for (const prefix of ['E', 'S'])
    for (let i = 1; i <= (prefix === 'E' ? 18 : 5); i++)
      assert.ok(points.some((e) => e.id === prefix + String(i).padStart(2, '0')))
  for (const point of points)
    for (const mesh of parts(group(point.id))) {
      const box = obb(mesh)
      for (const cabinet of cabinets)
        assert.ok(!box.intersectsOBB(cabinet.box), `${mesh.name} penetrates ${cabinet.name}`)
    }
})

test('draft hall switch remains reachable from the hall through the full entry-door sweep', () => {
  const control = entity('S04'),
    b = bounds(control.id),
    host = entity('source-hall-north').wall!
  assert.equal(control.evidence, 'assumed')
  assert.equal(control.electrical?.wallId, 'source-hall-north')
  assert.equal(control.electrical?.side, 1)
  near((b.min.y + b.max.y) / 2, 0.9, 'switch center height')
  near((b.min.x + b.max.x) / 2, 3.55, 'switch on unobstructed north wall')
  near(b.min.z, bounds('source-hall-north').max.z + 0.001, 'switch back follows its wall face')
  assert.ok(b.min.x >= host.start[0] / 1000 && b.max.x <= host.end[0] / 1000)
  const approach = new T.Vector3(3.55, 0.9, 1.4)
  const ray = new T.Raycaster(approach, new T.Vector3(0, 0, -1), 0, 1)
  const controlHit = ray.intersectObject(group(control.id), true)[0]
  assert.ok(controlHit, 'the approach ray must reach the visible switch front')
  // Stop at the switch face: its supporting wall is intentionally behind it.
  ray.far = controlHit.distance - 0.00001
  for (const id of [...hall, 'auto-hall-Банкетка', 'auto-hall-Зеркало'])
    assert.equal(ray.intersectObject(group(id), true).length, 0, `${id} obstructs switch access`)
  const boxes = parts(group(control.id)).map((mesh) => {
    mesh.geometry.computeBoundingBox()
    return new OBB().fromBox3(mesh.geometry.boundingBox!).applyMatrix4(mesh.matrixWorld)
  })
  for (let angle = -90; angle <= 90; angle += 1) {
    const door = structuredClone(entity('door-entry'))
    door.params = { ...door.params, doorAngle: angle }
    const posed = createEntity(door, a, materials)
    posed.updateMatrixWorld(true)
    assert.equal(
      ray.intersectObject(posed, true).length,
      0,
      `entry door screens the hall switch from its approach at ${angle}°`,
    )
    for (const mesh of parts(posed)) {
      mesh.geometry.computeBoundingBox()
      const box = new OBB().fromBox3(mesh.geometry.boundingBox!).applyMatrix4(mesh.matrixWorld)
      assert.ok(
        boxes.every((controlBox) => !box.intersectsOBB(controlBox)),
        `${mesh.name} hits S04 at ${angle}°`,
      )
    }
  }
})
