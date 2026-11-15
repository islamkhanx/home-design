import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parseApartment } from '../src/domain/schema.ts'
import { buildCanonical, applyVisibility, geometryManifest, disposeTree } from '../src/scene/canonical.ts'
import { dimensionGuides } from '../src/scene/dimensions.ts'

const a = parseApartment(JSON.parse(readFileSync(new URL('../src/data/apartment.json', import.meta.url), 'utf8')))

test('dimensions cover polygon edges without stored DimensionLine objects and follow geometry edits', () => {
  assert.ok(!a.objects.some((o) => o.kind === 'DimensionLine'))
  const all = dimensionGuides(a, 'all')
  assert.equal(all.length, a.rooms.reduce((n, r) => n + r.polygon!.length, 0))
  for (const room of a.rooms) {
    const guides = dimensionGuides(a, room.id)
    assert.equal(guides.length, room.polygon!.length)
    for (const [i, guide] of guides.entries()) {
      const p = room.polygon![i], q = room.polygon![(i + 1) % guides.length]
      assert.equal(guide.millimeters, Math.hypot(q[0] - p[0], q[1] - p[1]))
      assert.ok(Math.abs(Math.hypot(...guide.start.map((n, j) => n - guide.end[j])) * 1000 - guide.millimeters) < 1e-8)
    }
    assert.ok(dimensionGuides(a, room.id, true).every((g) => g.start[1] > 2.7))
  }
  const changed = structuredClone(a)
  changed.rooms[0].polygon![0][0] += 100
  assert.notDeepEqual(dimensionGuides(changed, changed.rooms[0].id), dimensionGuides(a, a.rooms[0].id))
})

test('default overview retains all walls and fixtures; ceiling toggle and cutaway preserve geometry', async () => {
  const root = await buildCanonical(a), before = geometryManifest(root)
  const visible = () => new Set(root.children.filter((o) => o.visible).map((o) => o.userData.entityId))
  applyVisibility(root, a, 'all', 'dollhouse', false)
  for (const e of a.objects.filter((o) => ['Wall', 'Socket', 'Switch', 'Pendant', 'Spotlight', 'TrackLight'].includes(o.kind)))
    assert.ok(visible().has(e.id), `${e.id} must be visible by default`)
  assert.ok(a.objects.filter((o) => o.kind === 'Ceiling').every((o) => !visible().has(o.id)))
  applyVisibility(root, a, 'all', 'dollhouse', false, true)
  assert.ok(a.objects.filter((o) => o.kind === 'Ceiling').every((o) => visible().has(o.id)))
  for (const room of ['all', ...a.rooms.map((r) => r.id)]) {
    for (const mode of ['dollhouse', 'electrical', 'interior', 'plan', 'ceiling'] as const) {
      applyVisibility(root, a, room, mode, true)
      const ids = visible()
      for (const point of a.objects.filter((o) => o.electrical && ids.has(o.id)))
        assert.ok(ids.has(point.electrical!.wallId), `${room}/${mode}: ${point.id} missing its wall`)
      if (mode === 'electrical')
        for (const point of a.objects.filter((o) => o.electrical && (room === 'all' || o.roomId === room)))
          assert.ok(ids.has(point.id), `${room}: electrical mode must show ${point.id}`)
    }
  }
  assert.deepEqual(geometryManifest(root), before)
  disposeTree(root)
})
