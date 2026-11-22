import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import * as T from 'three'
import { createEntity } from '../src/scene/components.ts'
import { disposeTree, geometryManifest } from '../src/scene/canonical.ts'
import { updateWindowAppearance } from '../src/scene/window-appearance.ts'
import { parseApartment } from '../src/domain/schema.ts'
import type { Entity } from '../src/domain/schema.ts'

test('door and window frames butt at corners without overlapping surfaces or changing the opening envelope', () => {
  const apartment = parseApartment(JSON.parse(readFileSync(new URL('../src/data/apartment.json', import.meta.url), 'utf8')))
  const material = new T.MeshPhysicalMaterial({ side: T.DoubleSide })
  const materials = new Map(apartment.materials.map(m => [m.id, material]))
  for (const kind of ['Door', 'Window'] as const) {
    const bottom = kind === 'Window' ? 900 : 0, height = kind === 'Window' ? 1200 : 2100
    const wall: Entity = {
      id: 'frame-host', name: 'Frame host', kind: 'Wall', roomId: apartment.rooms[0].id,
      position: [500, 0, 700], rotation: [0, 31, 0], size: [3000, 2700, 200],
      material: apartment.materials[0].id, evidence: 'assumed',
      wall: { start: [400, 700], end: [2800, 2500], height: 2700, thickness: 200,
        openings: [{ id: 'opening', kind: kind === 'Door' ? 'door' : 'window', offset: 900, width: 900, bottom, height }] },
    }
    const opening: Entity = {
      id: 'frame', name: 'Frame', kind, roomId: wall.roomId, position: [0, 0, 0], rotation: [0, 0, 0],
      size: [900, height, 200], material: wall.material, evidence: 'assumed',
      attach: { wallId: wall.id, openingId: 'opening' }, params: { doorAngle: 90 },
    }
    apartment.objects = [wall, opening]
    const root = createEntity(opening, apartment, materials), meshes: T.Mesh[] = []
    root.updateMatrixWorld(true)
    root.traverse(o => { if (o instanceof T.Mesh) meshes.push(o) })
    const frames = meshes.slice(0, kind === 'Window' ? 4 : 3)
    const boxes = frames.map(mesh => {
      mesh.geometry.computeBoundingBox()
      return mesh.geometry.boundingBox!.clone().translate(mesh.position)
    })
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
      const overlap = boxes[i].clone().intersect(boxes[j])
      const size = overlap.getSize(new T.Vector3())
      assert.ok(overlap.isEmpty() || Math.min(size.x, size.y, size.z) < 1e-6,
        `${kind}: frame members ${i}/${j} must not occupy the same volume`)
    }
    const envelope = boxes.reduce((all, b) => all.union(b), new T.Box3())
    assert.ok(envelope.min.distanceTo(new T.Vector3(.9, bottom / 1000, -.1)) < 1e-6)
    assert.ok(envelope.max.distanceTo(new T.Vector3(1.8, (bottom + height) / 1000, .1)) < 1e-6)
    const aligned = frames[0].parent!.matrixWorld
    const corners = [
      [.9 + .04 * .37, (bottom + height) / 1000 - .04 * .43],
      [1.8 - .04 * .37, (bottom + height) / 1000 - .04 * .43],
      ...(kind === 'Window' ? [[.9 + .04 * .37, bottom / 1000 + .04 * .43], [1.8 - .04 * .37, bottom / 1000 + .04 * .43]] : []),
    ]
    for (const [x, y] of corners) {
      const origin = new T.Vector3(x, y, .4).applyMatrix4(aligned)
      const direction = new T.Vector3(0, 0, -1).transformDirection(aligned)
      const hits = new T.Raycaster(origin, direction).intersectObjects(frames)
      assert.ok(hits.length)
      const firstSurface = hits.filter(hit => Math.abs(hit.distance - hits[0].distance) < 1e-6)
      assert.equal(new Set(firstSurface.map(hit => hit.object.uuid)).size, 1,
        `${kind}: a corner must have one visible frame surface, not overlapping jamb and rail`)
    }
    for (const mesh of meshes) mesh.geometry.dispose()
  }
  material.dispose()
})

test('only enabled exterior panes show the sky and changing the window lights preserves the glass geometry', () => {
  const apartment = parseApartment(JSON.parse(readFileSync(new URL('../src/data/apartment.json', import.meta.url), 'utf8')))
  const frame = new T.MeshPhysicalMaterial({ side: T.DoubleSide })
  const glass = new T.MeshPhysicalMaterial({ transmission: .92, ior: 1.5 })
  const materials = new Map(apartment.materials.map(m => [m.id, m.id === 'glass' ? glass : frame]))
  const room = new T.Group()
  const panes = new Map<string, T.Mesh<T.BufferGeometry, T.MeshPhysicalMaterial>>()
  for (const entity of apartment.objects.filter(entity => entity.kind === 'Window')) {
    const window = createEntity(entity, apartment, materials)
    room.add(window)
    window.traverse(object => {
      if (object instanceof T.Mesh && object.userData.windowPane) panes.set(entity.id, object)
    })
  }
  try {
    const before = geometryManifest(room)
    const exterior = ['window-living', 'window-courtyard']
    const living = panes.get(exterior[0])!
    const loggia = panes.get(exterior[1])!
    const bedroom = panes.get('window-bedroom')!
    updateWindowAppearance(room, exterior, [exterior[0]])

    function skyUniform(pane: typeof living) {
      const uniforms: Record<string, T.IUniform> = {}
      const shader = { ...T.ShaderLib.physical, uniforms }
      pane.material.onBeforeCompile(shader as Parameters<typeof pane.material.onBeforeCompile>[0], {} as T.WebGLRenderer)
      assert.match(shader.fragmentShader, /mix\(totalDiffuse, apertureSkyColor/)
      return uniforms.apertureSkyVisibility
    }
    const livingSky = skyUniform(living)
    const loggiaSky = skyUniform(loggia)
    assert.deepEqual([livingSky.value, loggiaSky.value], [1, 0])
    assert.equal(bedroom.material, glass)
    assert.equal(bedroom.castShadow, false)
    assert.equal(living.material.transmission, glass.transmission)
    assert.equal(living.material.emissiveIntensity, glass.emissiveIntensity)
    assert.equal(living.material.clone().onBeforeCompile, glass.onBeforeCompile, 'export snapshots keep the canonical glass')

    updateWindowAppearance(room, exterior, [exterior[1]])
    assert.deepEqual([livingSky.value, loggiaSky.value], [0, 1])
    updateWindowAppearance(room, [], [])
    assert.deepEqual([livingSky.value, loggiaSky.value], [0, 0])
    assert.deepEqual(geometryManifest(room), before)
  } finally {
    disposeTree(room)
  }
})
