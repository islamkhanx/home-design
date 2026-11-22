import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parseApartment } from '../src/domain/schema.ts'
import {
  buildCanonical,
  applyVisibility,
  geometryManifest,
  disposeTree,
} from '../src/scene/canonical.ts'
import { dimensionGuides } from '../src/scene/dimensions.ts'
import { presets } from '../src/scene/cameras.ts'

const a = parseApartment(
  JSON.parse(readFileSync(new URL('../src/data/apartment.json', import.meta.url), 'utf8')),
)

test('dimensions cover polygon edges without stored DimensionLine objects and follow geometry edits', () => {
  assert.ok(!a.objects.some((o) => o.kind === 'DimensionLine'))
  const all = dimensionGuides(a, 'all')
  assert.equal(
    all.length,
    a.rooms.reduce((n, r) => n + r.polygon!.length, 0),
  )
  for (const room of a.rooms) {
    const guides = dimensionGuides(a, room.id)
    assert.equal(guides.length, room.polygon!.length)
    for (const [i, guide] of guides.entries()) {
      const p = room.polygon![i],
        q = room.polygon![(i + 1) % guides.length]
      assert.equal(guide.millimeters, Math.hypot(q[0] - p[0], q[1] - p[1]))
      assert.ok(
        Math.abs(
          Math.hypot(...guide.start.map((n, j) => n - guide.end[j])) * 1000 - guide.millimeters,
        ) < 1e-8,
      )
    }
    assert.ok(dimensionGuides(a, room.id, true).every((g) => g.start[1] > 2.7))
  }
  const changed = structuredClone(a)
  changed.rooms[0].polygon![0][0] += 100
  assert.notDeepEqual(
    dimensionGuides(changed, changed.rooms[0].id),
    dimensionGuides(a, a.rooms[0].id),
  )
})

test('default overview retains all walls and fixtures; ceiling toggle and cutaway preserve geometry', async () => {
  const root = await buildCanonical(a),
    before = geometryManifest(root)
  const visible = () =>
    new Set(root.children.filter((o) => o.visible).map((o) => o.userData.entityId))
  applyVisibility(root, a, 'all', 'dollhouse', false)
  for (const e of a.objects.filter((o) =>
    ['Wall', 'Socket', 'Switch', 'Pendant', 'Spotlight', 'TrackLight'].includes(o.kind),
  ))
    assert.ok(visible().has(e.id), `${e.id} must be visible by default`)
  assert.ok(a.objects.filter((o) => o.kind === 'Ceiling').every((o) => !visible().has(o.id)))
  applyVisibility(root, a, 'all', 'dollhouse', false, true)
  assert.ok(a.objects.filter((o) => o.kind === 'Ceiling').every((o) => visible().has(o.id)))
  for (const room of ['all', ...a.rooms.map((r) => r.id)]) {
    for (const mode of ['dollhouse', 'electrical', 'interior', 'plan', 'ceiling'] as const) {
      applyVisibility(root, a, room, mode, true)
      const ids = visible()
      if (mode === 'interior' && room !== 'all') {
        for (const e of a.objects.filter(
          (e) => e.visible !== false && !['DimensionLine', 'RoomLabel'].includes(e.kind),
        ))
          assert.ok(ids.has(e.id), `${room}: interior must keep neighbouring geometry ${e.id}`)
        assert.deepEqual(
          presets(root).interior.position,
          a.rooms.find((r) => r.id === room)!.interiorCamera!.position.map((n) => n / 1000),
        )
      }
      for (const point of a.objects.filter((o) => o.electrical && ids.has(o.id)))
        assert.ok(
          ids.has(point.electrical!.wallId),
          `${room}/${mode}: ${point.id} missing its wall`,
        )
      if (mode === 'electrical')
        for (const point of a.objects.filter(
          (o) => o.electrical && (room === 'all' || o.roomId === room),
        ))
          assert.ok(ids.has(point.id), `${room}: electrical mode must show ${point.id}`)
    }
  }
  assert.deepEqual(geometryManifest(root), before)
  disposeTree(root)
})

test('bathroom plans include corridor control and furniture dimensions without moving devices', async () => {
  const { roomElectricalPoints } = await import('../src/domain/electrical.ts')
  const { planSvg } = await import('../src/domain/drawings.ts')
  assert.deepEqual(roomElectricalPoints(a,'bathroom').map(e=>e.id),['E01','E02','S01'])
  assert.equal(a.objects.find(e=>e.id==='S01')!.roomId,'hall')
  const root=await buildCanonical(a)
  for(const mode of ['plan','electrical'] as const) {
    applyVisibility(root,a,'bathroom',mode,false)
    assert.ok(root.children.find(e=>e.userData.entityId==='S01')!.visible)
  }
  const svg=planSvg(a,'bathroom','coordination')
  for(const text of ['E01','E02','S01'])assert.ok(svg.includes(text),text)
  for(const id of ['vanity','laundry-tower','wc-storage']) {
    const furniture = a.objects.find(e=>e.id===id)!
    assert.ok(furniture, `missing dimensioned furniture ${id}`)
    const dimensions = furniture.size.join(' × ')
    assert.ok(svg.includes(dimensions), `${id}: missing ${dimensions}`)
  }
  const changed=structuredClone(a)
  const tower = changed.objects.find(e=>e.id==='laundry-tower')!
  tower.size[0] += 70
  assert.ok(planSvg(changed,'bathroom','coordination').includes(tower.size.join(' × ')))
  assert.ok(!roomElectricalPoints(a,'bedroom').some(e=>e.id==='S01'))
  disposeTree(root)
})
