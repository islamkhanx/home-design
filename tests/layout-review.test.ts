import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import * as T from 'three'
import type { Object3D } from 'three/src/core/Object3D.js'
import { OBB } from 'three/addons/math/OBB.js'
import { createEntity } from '../src/scene/components.ts'
import { parseApartment } from '../src/domain/schema.ts'
import type { Entity } from '../src/domain/schema.ts'
import { SOURCE_RINGS, planPoint } from '../src/domain/source-plan.ts'

const a = parseApartment(
  JSON.parse(readFileSync(new URL('../src/data/apartment.json', import.meta.url), 'utf8')),
)
const material = new T.MeshPhysicalMaterial({ side: T.DoubleSide })
const materials = new Map(a.materials.map((m) => [m.id, material]))
const entity = (id: string) => {
  const e = a.objects.find((o) => o.id === id)
  assert.ok(e, `missing reviewed object ${id}`)
  return e
}
const groups = new Map<string, T.Group>()
function group(id: string) {
  if (!groups.has(id)) groups.set(id, createEntity(entity(id), a, materials))
  return groups.get(id)!
}
const bounds = (id: string) => new T.Box3().setFromObject(group(id), true)
function parts(root: Object3D) {
  const meshes: T.Mesh[] = []
  root.traverse((o) => {
    if (o instanceof T.Mesh) meshes.push(o)
  })
  return meshes
}
function hasVolumeOverlap(left: T.Box3, right: T.Box3, tolerance = 0.0001) {
  return ['x', 'y', 'z'].every(
    (axis) =>
      Math.min(left.max[axis as 'x'], right.max[axis as 'x']) -
        Math.max(left.min[axis as 'x'], right.min[axis as 'x']) >
      tolerance,
  )
}
function assertSeparate(left: string, right: string) {
  for (const p of parts(group(left)))
    for (const q of parts(group(right)))
      assert.ok(
        !hasVolumeOverlap(new T.Box3().setFromObject(p, true), new T.Box3().setFromObject(q, true)),
        `${p.name} intersects ${q.name}`,
      )
}
function forward(e: Entity) {
  return new T.Vector3(0, 0, 1).applyAxisAngle(
    new T.Vector3(0, 1, 0),
    T.MathUtils.degToRad(e.rotation[1]),
  )
}

test('furnishing review preserves the traced structural shell and every room contour', () => {
  for (const room of a.rooms) assert.deepEqual(room.polygon, SOURCE_RINGS[room.id].map(planPoint))
  // Captured from the pre-review revision 9 source model, excluding appearance,
  // camera and visibility fields. No render export is needed to run this test.
  const structure = a.objects
    .filter((o) => ['Wall', 'Door', 'Window', 'Floor', 'Ceiling'].includes(o.kind))
    .map((o) => ({
      id: o.id,
      kind: o.kind,
      roomId: o.roomId,
      position: o.position,
      rotation: o.rotation,
      size: o.size,
      wall: o.wall,
      surface: o.surface,
      attach: o.attach,
    }))
    .sort((left, right) => left.id.localeCompare(right.id))
  assert.equal(
    createHash('sha256').update(JSON.stringify(structure)).digest('hex'),
    '7d2fa7ccd112b67af13f9a5afbab5972f91aeb0eae82cf8f693eb3ca246913cb',
  )
})

test('bathroom socket faces clear the mirror, vanity, WC frame and laundry panels', () => {
  for (const id of [
    'mirror',
    'mirror-light-0',
    'mirror-light-1',
    'vanity',
    'wc-frame',
    'wc-storage',
  ])
    assertSeparate('E01', id)
  for (const id of ['laundry-tower', 'washer', 'towel-warmer']) assertSeparate('E02', id)
  const socket = bounds('E01')
  assert.ok(
    bounds('wc-frame').min.z - socket.max.z > 0.018,
    'socket needs a visible gap before the WC box',
  )
  assert.equal(
    entity('E02').electrical?.wallId,
    'wall-south',
    'washer isolation must not return behind its side panel',
  )
  assert.ok(entity('toilet').position[2] / 1000 - bounds('vanity').max.z >= 0.38)
  assert.ok(bounds('laundry-tower').min.z - bounds('toilet').max.z >= 0.03)
})

test('washer fits the actual cabinet cavity without intersecting any structural panel', () => {
  assertSeparate('washer', 'laundry-tower')
  const washer = bounds('washer'),
    tower = bounds('laundry-tower'),
    panel = 0.018
  assert.ok(washer.min.x - (tower.min.x + panel) > 0.006)
  assert.ok(tower.max.x - panel - washer.max.x > 0.006)
  assert.ok(washer.min.z - (tower.min.z + panel) > 0.02)
  assert.ok(tower.max.z - panel - washer.max.z > 0.048)
  assert.ok(Math.abs(washer.min.y) < 0.00001, 'machine must stand on the floor')
  const door = entity('wall-east').wall!.openings.find((o) => o.id === 'door')!
  const openingEnd = (entity('wall-east').wall!.start[1] + door.offset + door.width) / 1000
  assert.ok(tower.min.z - openingEnd > 0.057, 'tower must clear the doorway end')
})

test('interior door leaves and handles clear fixed furniture at sampled proposed swing angles', () => {
  for (const [id, angle, room] of [
    ['door', -90, 'bathroom'],
    ['door-bedroom', 90, 'bedroom'],
    ['door-loggia', 90, 'loggia'],
  ] as const) {
    const fixed = a.objects.filter(
      (o) =>
        o.roomId === room &&
        ![
          'Wall',
          'Door',
          'Window',
          'Floor',
          'Ceiling',
          'Socket',
          'Switch',
          'Spotlight',
          'TrackLight',
          'Pendant',
          'LEDStrip',
        ].includes(o.kind),
    )
    const fixedBoxes = fixed.flatMap((e) =>
      parts(group(e.id)).map((m) => ({ name: m.name, box: new T.Box3().setFromObject(m, true) })),
    )
    for (let step = 0; step <= 18; step++) {
      const e = { ...entity(id), params: { ...entity(id).params, doorAngle: (angle * step) / 18 } }
      const root = createEntity(e, a, materials)
      // Last two meshes are the moving leaf and handle; frames are not moving.
      for (const mesh of parts(root).slice(-2)) {
        mesh.geometry.computeBoundingBox()
        const moving = new OBB().fromBox3(mesh.geometry.boundingBox!).applyMatrix4(mesh.matrixWorld)
        for (const other of fixedBoxes)
          assert.ok(
            !moving.intersectsOBB(new OBB().fromBox3(other.box), 1e-8),
            `${id} at ${e.params.doorAngle}° hits ${other.name}`,
          )
      }
      for (const mesh of parts(root)) mesh.geometry.dispose()
    }
  }
})

test('wardrobe fronts, desk chair and key circulation gaps remain usable in the proposal', () => {
  assert.ok(forward(entity('auto-bedroom-Шкаф')).z < -0.99, 'wardrobe must face into bedroom')
  const chair = entity('auto-living-Рабочее кресло'),
    desk = entity('auto-living-Рабочий стол')
  const towardDesk = new T.Vector3(
    desk.position[0] - chair.position[0],
    0,
    desk.position[2] - chair.position[2],
  ).normalize()
  assert.ok(forward(chair).dot(towardDesk) > 0.99, 'office chair faces the desk')
  assert.ok(bounds('auto-bedroom-Шкаф').min.z - bounds('auto-bedroom-Кровать').max.z >= 1.019)
  assert.ok(bounds('auto-bedroom-ТВ').min.x - bounds('auto-bedroom-Кровать').max.x > 0.95)
  assert.ok(
    3.212 - bounds('auto-bedroom-ТВ').max.x >= 0.06,
    'TV bracket and wiring need space behind the screen',
  )
  assert.ok(bounds('auto-living-ТВ').min.x >= 0.06)
  assert.ok(bounds('auto-living-Диван').min.x - bounds('auto-living-Журнальный стол').max.x >= 0.45)
  assert.ok(
    bounds('auto-living-Журнальный стол').min.x - bounds('auto-living-ТВ-тумба').max.x >= 0.76,
  )
  assert.ok(bounds('auto-loggia-Кофейный столик').min.x - bounds('auto-loggia-Скамья').max.x > 0.27)
  assert.ok(
    Math.abs(bounds('auto-living-Монитор').min.y - bounds('auto-living-Рабочий стол').max.y) <
      0.00001,
  )
})

test('kitchen cutout is open, supports the sink rim and does not intersect the submerged bowl', () => {
  const sink = entity('auto-kitchen-Мойка'),
    top = entity('auto-kitchen-Столешница A')
  const hole = top.params!.sinkCutout!,
    cx = (top.position[0] + hole.center[0]) / 1000,
    cz = (top.position[2] + hole.center[1]) / 1000
  assert.ok(
    Math.abs(cx - sink.position[0] / 1000) < 1e-8 && Math.abs(cz - sink.position[2] / 1000) < 1e-8,
  )
  const topBounds = bounds(top.id),
    topY = topBounds.max.y
  const down = (x: number, z: number, id: string) =>
    new T.Raycaster(new T.Vector3(x, topY + 0.4, z), new T.Vector3(0, -1, 0)).intersectObject(
      group(id),
      true,
    )
  assert.equal(down(cx, cz, top.id).length, 0, 'countertop must have an actual hole')
  assert.ok(
    down(cx, cz, 'auto-kitchen-Нижний ряд 3')[0].point.y < 0.03,
    'sink cabinet must not have a solid top under the bowl',
  )
  assert.ok(
    Math.abs(topBounds.min.y - bounds('auto-kitchen-Нижний ряд 2').max.y) < 0.00001,
    'worktop sits on base units',
  )
  for (const [axis, half] of [
    [0, hole.size[0] / 2000],
    [2, hole.size[1] / 2000],
  ] as const)
    for (const sign of [-1, 1]) {
      const direction = new T.Vector3(axis === 0 ? sign : 0, 0, axis === 2 ? sign : 0)
      for (const y of [topBounds.min.y + 0.005, topY - 0.005]) {
        const hits = new T.Raycaster(new T.Vector3(cx, y, cz), direction, 0, 0.4).intersectObject(
          group(sink.id),
          true,
        )
        assert.ok(hits.length > 0, 'cross-section must hit the actual bowl shell')
        assert.ok(
          hits.every((hit) => hit.distance <= half + 0.0001),
          'submerged bowl must fit inside cutout, not intersect the worktop',
        )
      }
      const x = cx + (axis === 0 ? sign * (half + 0.004) : 0),
        z = cz + (axis === 2 ? sign * (half + 0.004) : 0)
      const rim = down(x, z, sink.id)[0],
        support = down(x, z, top.id)[0]
      assert.ok(rim && support, 'sink rim must overlap supporting worktop')
      assert.ok(rim.point.y >= support.point.y - 0.0001 && rim.point.y - support.point.y <= 0.02)
    }
})

test('dining group keeps an eastern route clear with both chairs pulled out', () => {
  const eastWall = 3.212
  const table = bounds('auto-living-Обеденный стол')
  assert.ok(eastWall - table.max.x >= 0.9, 'table must leave a direct eastern route')
  assert.ok(table.min.x - bounds('auto-kitchen-Столешница B').max.x >= 0.84)
  for (const id of ['auto-living-Стул 1', 'auto-living-Стул 2']) {
    const e = entity(id), direction = forward(e)
    for (const pullout of [0, 300]) {
      const moved = structuredClone(e)
      moved.position[0] -= direction.x * pullout
      moved.position[2] -= direction.z * pullout
      const model = createEntity(moved, a, materials)
      const box = new T.Box3().setFromObject(model, true)
      assert.ok(eastWall - box.max.x >= 0.75, `${id}: eastern route at ${pullout} mm`)
      for (const part of parts(model)) part.geometry.dispose()
    }
  }
  const pendant = entity('auto-living-Подвес над столом'), dining = entity('auto-living-Обеденный стол')
  assert.equal(pendant.position[0], dining.position[0])
  assert.equal(pendant.position[2], dining.position[2])
})

test('pendant canopies meet the ceiling and the dining shade sits above the table', () => {
  for (const id of ['auto-living-Подвес над столом', 'auto-bedroom-Подвес']) {
    const e = entity(id),
      ceiling = a.objects.find((o) => o.kind === 'Ceiling' && o.roomId === e.roomId)!
    assert.ok(Math.abs(bounds(id).max.y - bounds(ceiling.id).min.y) < 0.00001)
  }
  const gap =
    bounds('auto-living-Подвес над столом').min.y - bounds('auto-living-Обеденный стол').max.y
  assert.ok(gap >= 0.7 && gap <= 1.0)
})

test.after(() => {
  for (const root of groups.values()) for (const mesh of parts(root)) mesh.geometry.dispose()
  material.dispose()
})
