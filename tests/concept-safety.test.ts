import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import * as T from 'three'
import { createDesignVariant } from '../scripts/design-images.mjs'
import { parseApartment } from '../src/domain/schema.ts'
import { pointInPolygon } from '../src/domain/math.ts'
import { buildCanonical, disposeTree, geometryManifest } from '../src/scene/canonical.ts'
import { presets, safeIndoorCamera } from '../src/scene/cameras.ts'
import { prepareWalkthroughApartment, walkingSpace } from '../src/scene/walking-space.ts'
import type { Entity } from '../src/domain/schema.ts'

const source = parseApartment(JSON.parse(readFileSync(new URL('../src/data/apartment.json', import.meta.url), 'utf8')))
const styles = ['loft', 'hitech', 'classic', 'japandi']
const structural = new Set(source.objects.filter(o => ['Wall', 'Floor', 'Ceiling', 'Door', 'Window', 'Socket', 'Switch'].includes(o.kind)
  || o.id === 'source-service-strip').map(o => o.id))
const overlap = (a: T.Box3, b: T.Box3) => ['x', 'y', 'z'].every(axis =>
  Math.min(a.max[axis as 'x'], b.max[axis as 'x']) - Math.max(a.min[axis as 'x'], b.min[axis as 'x']) > 1e-5)

test('all room concepts preserve architectural meshes and cabinet height; panels stay clear of usable objects', async () => {
  const originalJson = JSON.stringify(source), originalRoot = await buildCanonical(source)
  const baseArchitecture = geometryManifest(originalRoot).filter(part => structural.has(part.entityId))
  try {
    for (const room of source.rooms.filter(r => r.id !== 'bathroom')) for (const style of styles) {
      const prefix = `${room.id}/${style}`, { apartment } = createDesignVariant(source, room.id, style)
      const root = await buildCanonical(apartment)
      try {
        assert.deepEqual(geometryManifest(root).filter(part => structural.has(part.entityId)), baseArchitecture, `${prefix}: architecture differs`)
        const panels = apartment.objects.filter((o: Entity) => o.kind === 'WallPanel') as Entity[]
        const entities = new Map(apartment.objects.map((o: Entity) => [o.id, o]))
        for (const panel of panels) {
          assert.equal(panel.roomId, room.id)
          const group = root.children.find(g => g.userData.entityId === panel.id)!
          const box = new T.Box3().setFromObject(group, true)
          assert.ok(box.min.y >= 0 && box.max.y <= 2.85 + 1e-6, `${prefix}: panel exceeds finished height`)
          group.traverse(mesh => {
            if (!(mesh instanceof T.Mesh)) return
            const positions = mesh.geometry.getAttribute('position'), p = new T.Vector3()
            for (let i = 0; i < positions.count; i++) {
              p.fromBufferAttribute(positions, i).applyMatrix4(mesh.matrixWorld)
              assert.ok(pointInPolygon([p.x * 1000, p.z * 1000], room.polygon!), `${prefix}: panel outside room`)
            }
          })
          for (const other of root.children) {
            const entity = entities.get(other.userData.entityId) as Entity | undefined
            if (!entity || entity.visible === false || entity.roomId !== room.id ||
                ['Wall', 'Floor', 'Ceiling', 'WallPanel', 'DimensionLine', 'RoomLabel'].includes(entity.kind)) continue
            other.traverse(mesh => {
              if (!(mesh instanceof T.Mesh)) return
              assert.ok(!overlap(box, new T.Box3().setFromObject(mesh, true)), `${prefix}: ${panel.id} blocks ${entity.id}`)
            })
          }
        }
        for (const cabinet of source.objects.filter(o => o.params?.cabinetTopScribe)) {
          const group = root.children.find(g => g.userData.entityId === cabinet.id)!
          assert.ok(Math.abs(new T.Box3().setFromObject(group, true).max.y - 2.85) < 1e-6, `${prefix}: ${cabinet.id} no longer reaches ceiling`)
        }
      } finally { disposeTree(root) }
    }
    assert.equal(JSON.stringify(source), originalJson, 'source model was modified')
  } finally { disposeTree(originalRoot) }
})

test('concept snapshots retain a clear indoor starting position', async () => {
  for (const room of source.rooms.filter(r => r.id !== 'bathroom')) for (const style of styles) {
    const { apartment } = createDesignVariant(source, room.id, style)
    const staged = prepareWalkthroughApartment(apartment), root = await buildCanonical(staged)
    try {
      const camera = safeIndoorCamera(presets(root, room.id).interior, staged, root, room.id)
      assert.ok(walkingSpace(staged, root).free([camera.position[0], camera.position[2]]), `${room.id}/${style}: camera overlaps proposed furnishings`)
    } finally { disposeTree(root) }
  }
})
