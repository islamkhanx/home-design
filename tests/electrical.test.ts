import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parseApartment } from '../src/domain/schema.ts'
import { generateElectrical } from '../src/domain/electrical.ts'
import { buildCanonical, applyVisibility, disposeTree } from '../src/scene/canonical.ts'
import { presets } from '../src/scene/cameras.ts'
import { planSvg } from '../src/domain/drawings.ts'
import * as T from 'three'
import { createEntity } from '../src/scene/components.ts'
const a = parseApartment(
  JSON.parse(readFileSync(new URL('../src/data/apartment.json', import.meta.url), 'utf8')),
)
test('electrical proposals are repeatable and preserve architecture and bathroom choices', () => {
  assert.deepEqual(generateElectrical(a), a)
  assert.equal(a.objects.filter((o) => o.kind === 'Socket').length, 18)
  assert.equal(a.objects.filter((o) => o.kind === 'Switch').length, 5)
  const bath = a.objects.filter((o) => o.roomId === 'bathroom' && o.kind === 'Socket')
  assert.equal(
    bath.reduce((n, o) => n + o.electrical!.gangs, 0),
    3,
  )
  for (const r of a.rooms)
    assert.ok(a.objects.some((o) => o.roomId === r.id && o.kind === 'Socket'))
  assert.ok(!a.objects.some((o) => o.params?.group === 'night'))
})
test('points sit on their finished wall face, clear openings, and report center height', () => {
  for (const e of a.objects.filter((o) => o.electrical)) {
    const p = e.electrical!,
      w = a.objects.find((o) => o.id === p.wallId)!.wall!
    const dx = w.end[0] - w.start[0],
      dz = w.end[1] - w.start[1],
      len = Math.hypot(dx, dz)
    const along = ((e.position[0] - w.start[0]) * dx + (e.position[2] - w.start[1]) * dz) / len
    const normal = (-(e.position[0] - w.start[0]) * dz + (e.position[2] - w.start[1]) * dx) / len
    assert.ok(Math.abs(along - p.offset) < 1e-6)
    assert.ok(Math.abs(normal - p.side * (w.thickness / 2 + (p.surfaceOffset ?? 0) + e.size[2] / 2 + 1)) < 1e-6)
    const h = e.position[1] + e.size[1] / 2
    for (const q of w.openings)
      assert.ok(
        !(
          p.offset + e.size[0] / 2 > q.offset &&
          p.offset - e.size[0] / 2 < q.offset + q.width &&
          h + 40 > q.bottom &&
          h - 40 < q.bottom + q.height
        ),
        e.id,
      )
    assert.ok(planSvg(a, e.roomId, 'electrical').includes(e.id))
  }
})
test('kitchen worktop sockets are visible in front of the actual backsplash mesh', () => {
  const material = new T.MeshPhysicalMaterial({ side: T.DoubleSide }),
    materials = new Map(a.materials.map(m => [m.id, material])),
    kitchen = a.objects.filter(e => e.roomId === 'kitchen').map(e => {
      const group = createEntity(e, a, materials)
      group.updateMatrixWorld(true)
      return group
    }),
    finish = kitchen.find(g => g.name === 'auto-kitchen-Фартук западный')!,
    finishBounds = new T.Box3().setFromObject(finish, true)
  for (const id of ['E03', 'E04']) {
    const socket = a.objects.find(e => e.id === id)!,
      group = kitchen.find(g => g.name === id)!,
      socketBounds = new T.Box3().setFromObject(group, true)
    assert.ok(Math.abs(socketBounds.min.x - finishBounds.max.x - 0.001) < 1e-6,
      `${id}: its back must follow the finished backsplash face with a 1 mm mount gap`)
    // A point can avoid mesh overlap and still be hidden behind opaque cladding.
    // Shoot from the room at each gang, including the actual socket face meshes.
    for (let gang = 0; gang < socket.electrical!.gangs; gang++) {
      const local = new T.Vector3((gang - (socket.electrical!.gangs - 1) / 2) * 0.071,
        socket.size[1] / 2000, 0),
        target = group.localToWorld(local),
        ray = new T.Raycaster(new T.Vector3(1.2, target.y, target.z), new T.Vector3(-1, 0, 0), 0, 1.5),
        hit = ray.intersectObjects(kitchen, true)[0]
      assert.equal(hit?.object.userData.entityId, id, `${id}: another object screens its socket face`)
    }
  }
})
test('kitchen socket offsets follow changed finish geometry without moving other points', () => {
  const changed = structuredClone(a),
    finish = changed.objects.find(e => e.id === 'auto-kitchen-Фартук западный')!
  finish.position[0] += 20
  finish.size[0] += 4
  const original = generateElectrical(a), result = generateElectrical(changed)
  for (const before of original.objects.filter(e => e.electrical)) {
    const after = result.objects.find(e => e.id === before.id)!
    if (['E03', 'E04'].includes(before.id)) {
      assert.equal(after.position[0] - before.position[0], 22)
      assert.equal(after.electrical!.surfaceOffset! - before.electrical!.surfaceOffset!, 22)
      assert.equal(after.position[1], before.position[1])
      assert.equal(after.position[2], before.position[2])
    } else assert.deepEqual(after, before)
  }
})
test('ceiling view shows undersides and lights; electrical view exposes points; switching restores interior', async () => {
  const root = await buildCanonical(a),
    visible = () => root.children.filter((o) => o.visible)
  applyVisibility(root, a, 'all', 'ceiling', true)
  assert.equal(visible().filter((o) => o.userData.kind === 'Ceiling').length, 6)
  assert.ok(visible().some((o) => o.userData.kind === 'TrackLight'))
  assert.ok(
    visible().every((o) =>
      ['Ceiling', 'Spotlight', 'TrackLight', 'Pendant'].includes(o.userData.kind),
    ),
  )
  const camera = presets(root).ceiling
  assert.ok(camera.position[1] < camera.target[1])
  applyVisibility(root, a, 'kitchen', 'electrical', true)
  assert.equal(visible().filter((o) => o.userData.kind === 'Socket').length, 5)
  assert.ok(!visible().some((o) => ['Ceiling', 'KitchenCabinet'].includes(o.userData.kind)))
  applyVisibility(root, a, 'kitchen', 'interior', true)
  assert.ok(visible().some((o) => o.userData.kind === 'Ceiling'))
  assert.ok(visible().some((o) => o.userData.kind === 'KitchenCabinet'))
  assert.ok(visible().some((o) => o.userData.kind === 'Socket'))
  disposeTree(root)
})
