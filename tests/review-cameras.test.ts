import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { buildCanonical, applyVisibility, disposeTree } from '../src/scene/canonical.ts'
import { presets, safeIndoorCamera } from '../src/scene/cameras.ts'
import { prepareWalkthroughApartment, walkingSpace } from '../src/scene/walking-space.ts'
import { pointInPolygon } from '../src/domain/math.ts'
import type { V2 } from '../src/domain/math.ts'
import { parseApartment } from '../src/domain/schema.ts'

test('each room review camera stays inside its floor and clear of furniture without changing its heading', async () => {
  const apartment = prepareWalkthroughApartment(parseApartment(JSON.parse(
    readFileSync(new URL('../src/data/apartment.json', import.meta.url), 'utf8'),
  )))
  const root = await buildCanonical(apartment)
  try {
    const space = walkingSpace(apartment, root)
    for (const room of apartment.rooms.filter((r) => r.polygon)) {
      applyVisibility(root, apartment, room.id, 'interior', true)
      const original = presets(root).interior
      const before = JSON.stringify(original)
      const safe = safeIndoorCamera(original, apartment, root, room.id)
      assert.equal(JSON.stringify(original), before)
      assert.ok(space.free([safe.position[0], safe.position[2]]), room.id)
      assert.ok(pointInPolygon([safe.position[0], safe.position[2]], room.polygon!.map((p) => p.map((n) => n / 1000) as V2)))
      assert.equal(safe.position[1], room.interiorCamera!.position[1] / 1000)
      for (let axis = 0; axis < 3; axis++)
        assert.ok(Math.abs((safe.target[axis] - safe.position[axis]) - (original.target[axis] - original.position[axis])) < 1e-10)
      for (const wall of apartment.objects.filter((e) => ['Wall', 'Ceiling'].includes(e.kind) && e.visible !== false))
        assert.ok(root.children.find((g) => g.userData.entityId === wall.id)?.visible, wall.id)
    }
  } finally {
    disposeTree(root)
  }
})
