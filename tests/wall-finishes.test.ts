import test from 'node:test'
import assert from 'node:assert/strict'
import * as T from 'three'
import type { Object3D } from 'three/src/core/Object3D.js'
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { buildCanonical, disposeTree, geometryManifest } from '../src/scene/canonical.ts'
import { verifyGlb } from '../src/scene/export.ts'
import { parseApartment, validateApartment } from '../src/domain/schema.ts'
import type { Apartment, Room } from '../src/domain/schema.ts'
import { wallFaceForRoom, wallMaterialForRoom } from '../src/domain/wall-finishes.ts'
import { applyKitchenLivingWallColor, kitchenLivingDefaultWallMaterialId, kitchenLivingWallColors } from '../src/domain/kitchen-living-wall-colors.ts'
import seed from '../src/data/apartment.json' with { type: 'json' }

test('shortlisted wall colors cover both open rooms and keep the opposite side of the bathroom wall', () => {
  const source = parseApartment(seed)
  const living = source.rooms.find(room => room.id === 'living')!
  const kitchen = source.rooms.find(room => room.id === 'kitchen')!
  const bathroom = source.rooms.find(room => room.id === 'bathroom')!
  const windowWall = source.objects.find(wall => wall.id === 'source-living-glazing')!
  const sharedWall = source.objects.find(wall => wall.id === 'wall-south')!
  for (const choice of kitchenLivingWallColors) {
    const proposal = applyKitchenLivingWallColor(source, choice)
    const finish = proposal.materials.find(material => material.color === choice.color && material.name.includes(choice.code))!
    const changedWindowWall = proposal.objects.find(wall => wall.id === windowWall.id)!
    const changedSharedWall = proposal.objects.find(wall => wall.id === sharedWall.id)!
    assert.deepEqual(validateApartment(proposal), [])
    assert.equal(wallMaterialForRoom(changedWindowWall, living), finish.id)
    assert.equal(changedWindowWall.wall?.materials?.edge, finish.id)
    assert.equal(wallMaterialForRoom(changedSharedWall, kitchen), finish.id)
    assert.equal(wallMaterialForRoom(changedSharedWall, bathroom), 'bathroom-stone')
    assert.equal(changedSharedWall.wall?.materials?.edge, sharedWall.wall?.materials?.edge)
    assert.equal(wallMaterialForRoom(windowWall, living), kitchenLivingDefaultWallMaterialId)
    assert.equal(wallMaterialForRoom(sharedWall, kitchen), kitchenLivingDefaultWallMaterialId)
    assert.ok(proposal.objects.every((object, index) => object.wall || object === source.objects[index]))
  }
})

function fixture(): Apartment {
  return parseApartment({
    schemaVersion: 1, id: 'wall-test', name: 'Wall test', revision: 1, units: 'mm',
    documentedArea: 12, notes: [],
    rooms: [
      { id: 'left', name: 'Left', documentedArea: 6, evidence: 'assumed', note: '', polygon: [[0, 100], [3000, 100], [3000, 2000], [0, 2000]] },
      { id: 'right', name: 'Right', documentedArea: 6, evidence: 'assumed', note: '', polygon: [[0, -2000], [3000, -2000], [3000, -100], [0, -100]] },
    ],
    materials: [
      { id: 'tile', name: 'Tile', color: '#dfdfdf', roughness: .7, metalness: 0, surface: 'stone', tileSize: [1.2, .6] },
      { id: 'wood', name: 'Wood', color: '#ac8d66', roughness: .8, metalness: 0, surface: 'oak', tileSize: [.6, 2.4] },
      { id: 'edge', name: 'Edge', color: '#ffffff', roughness: .8, metalness: 0 },
    ],
    objects: [{
      id: 'wall', name: 'Wall', kind: 'Wall', roomId: 'left', sharedWith: ['right'],
      position: [0, 0, 0], rotation: [0, 0, 0], size: [3000, 2700, 200], material: 'edge', evidence: 'assumed',
      wall: { start: [0, 0], end: [3000, 0], thickness: 200, height: 2700,
        materials: { left: 'tile', right: 'wood', edge: 'edge' },
        openings: [
          { id: 'door', kind: 'door', offset: 900, width: 900, bottom: 0, height: 2100 },
          { id: 'window', kind: 'window', offset: 2200, width: 500, bottom: 900, height: 900 },
        ],
      },
    }],
  })
}

function firstHit(root: Object3D, origin: number[], direction: number[], far = 10) {
  return new T.Raycaster(new T.Vector3(...origin as [number, number, number]),
    new T.Vector3(...direction as [number, number, number]), 0.0001, far).intersectObject(root, true)[0]
}
function hitMaterial(hit: T.Intersection) {
  const mesh = hit.object as T.Mesh
  return (Array.isArray(mesh.material) ? mesh.material[hit.face!.materialIndex] : mesh.material).name
}

test('wall finishes validate material references and keep the legacy single-material fallback', async () => {
  const a = fixture(), wall = a.objects[0]
  for (const invalid of [{ left: 'missing' }, { front: 'tile' }, { left: 42 }, null, ['tile']]) {
    const copy = structuredClone(a)
    ;(copy.objects[0].wall as unknown as { materials: unknown }).materials = invalid
    assert.ok(validateApartment(copy).some(e => e.includes('wall side material')))
  }
  delete wall.wall!.materials
  assert.equal(wallMaterialForRoom(wall, a.rooms[0]), 'edge')
  const root = await buildCanonical(a)
  try {
    assert.equal(hitMaterial(firstHit(root, [.4, 1, 1], [0, 0, -1])!), 'edge')
    assert.equal(hitMaterial(firstHit(root, [.4, 1, -1], [0, 0, 1])!), 'edge')
  } finally { disposeTree(root) }
})

test('room-facing wall finishes use geometric sides, including transformed walls and partial room spans', () => {
  const a = fixture(), wall = a.objects[0]
  assert.equal(wallFaceForRoom(wall, a.rooms[0]), 'left')
  assert.equal(wallFaceForRoom(wall, a.rooms[1]), 'right')
  assert.equal(wallMaterialForRoom(wall, a.rooms[0]), 'tile')
  assert.equal(wallMaterialForRoom(wall, a.rooms[1]), 'wood')
  const partial: Room = { ...a.rooms[1], polygon: [[2400, -1500], [2800, -1500], [2800, -106], [2400, -106]] }
  assert.equal(wallFaceForRoom(wall, partial), 'right', 'a room may border only part of a long wall')
  const angle = 37 * Math.PI / 180, c = Math.cos(angle), s = Math.sin(angle)
  wall.rotation = [0, 37, 0]; wall.position = [500, 0, -400]
  for (const room of a.rooms) room.polygon = room.polygon!.map(([x, z]) => [500 + c * x + s * z, -400 - s * x + c * z])
  assert.equal(wallFaceForRoom(wall, a.rooms[0]), 'left')
  assert.equal(wallFaceForRoom(wall, a.rooms[1]), 'right')
  ;[wall.wall!.start, wall.wall!.end] = [wall.wall!.end, wall.wall!.start]
  assert.equal(wallFaceForRoom(wall, a.rooms[0]), 'right', 'reversing the wall direction reverses left/right')
  assert.equal(wallFaceForRoom(wall, { ...a.rooms[0], polygon: [[9000, 9000], [10000, 9000], [10000, 10000], [9000, 10000]] }), undefined)
})

test('wall faces, door/window reveals and outward normals retain the exact opening geometry', async () => {
  const root = await buildCanonical(fixture())
  try {
    assert.equal(hitMaterial(firstHit(root, [.4, 1, 1], [0, 0, -1])!), 'tile')
    assert.equal(hitMaterial(firstHit(root, [.4, 1, -1], [0, 0, 1])!), 'wood')
    for (const [origin, direction] of [
      [[1.2, 1, 0], [-1, 0, 0]], [[1.2, 1, 0], [1, 0, 0]], [[1.2, 1, 0], [0, 1, 0]],
      [[2.4, 1.2, 0], [0, -1, 0]], [[2.4, 1.2, 0], [0, 1, 0]],
    ]) assert.equal(hitMaterial(firstHit(root, origin, direction)!), 'edge')
    assert.equal(firstHit(root, [1.2, 1, 1], [0, 0, -1]), undefined, 'doorway must remain a true void')
    assert.equal(firstHit(root, [2.4, 1.2, 1], [0, 0, -1]), undefined, 'window must remain a true void')
    assert.equal(firstHit(root, [1, 2.5, 0], [1, 0, 0], 1.9), undefined, 'no buried faces between adjacent solid cells')
    root.traverse(o => {
      if (!(o instanceof T.Mesh)) return
      const g = o.geometry, p = g.getAttribute('position'), n = g.getAttribute('normal'), index = g.index!
      for (let i = 0; i < index.count; i += 3) {
        const ia = index.getX(i), ib = index.getX(i + 1), ic = index.getX(i + 2)
        const a = new T.Vector3().fromBufferAttribute(p, ia), b = new T.Vector3().fromBufferAttribute(p, ib), c = new T.Vector3().fromBufferAttribute(p, ic)
        const face = b.sub(a).cross(c.sub(a)).normalize()
        assert.ok(face.dot(new T.Vector3().fromBufferAttribute(n, ia)) > .999999, 'triangle winding must match its outward normal')
      }
    })
    const b = new T.Box3().setFromObject(root, true)
    assert.ok(b.min.distanceTo(new T.Vector3(0, 0, -.1)) < 1e-6)
    assert.ok(b.max.distanceTo(new T.Vector3(3, 2.7, .1)) < 1e-6)
  } finally { disposeTree(root) }
})

test('each wall side keeps its own metric tile scale along angled walls and across opening cells', async () => {
  const a = fixture(), wall = a.objects[0]
  wall.wall!.end = [2400, 1800]; wall.rotation = [0, 37, 0]; wall.position = [500, 0, -400]
  const root = await buildCanonical(a), shared = new Map<string, number[]>()
  let continuousSeams = 0
  try {
    root.traverse(o => {
      if (!(o instanceof T.Mesh)) return
      const p = o.geometry.getAttribute('position'), n = o.geometry.getAttribute('normal'), uv = o.geometry.getAttribute('uv')
      const origin = o.userData.wallUV.origin
      for (let i = 0; i < p.count; i++) {
        if (Math.abs(n.getZ(i)) < .9) continue
        const x = p.getX(i) + origin[0], y = p.getY(i) + origin[1], left = n.getZ(i) > 0
        const scale = left ? [1.2, .6] : [.6, 2.4]
        assert.ok(Math.abs(uv.getX(i) - (left ? x : 3 - x) / scale[0]) < 1e-6)
        assert.ok(Math.abs(uv.getY(i) - y / scale[1]) < 1e-6)
        const key = `${left}:${x.toFixed(5)}:${y.toFixed(5)}`, value = [uv.getX(i), uv.getY(i)]
        if (shared.has(key)) {
          continuousSeams++
          assert.ok(shared.get(key)!.every((v, j) => Math.abs(v - value[j]) < 1e-6))
        } else shared.set(key, value)
      }
    })
    assert.ok(continuousSeams > 0)
  } finally { disposeTree(root) }
})

test('GLB preserves wall-side materials and UVs while round-trip validation recombines material primitives', async t => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'FileReader')
  Object.defineProperty(globalThis, 'FileReader', { configurable: true, value: class {
    result?: ArrayBuffer
    onloadend?: () => void
    readAsArrayBuffer(blob: Blob) { void blob.arrayBuffer().then(result => { this.result = result; this.onloadend?.() }) }
  } })
  t.after(() => previous ? Object.defineProperty(globalThis, 'FileReader', previous) : Reflect.deleteProperty(globalThis, 'FileReader'))
  const root = await buildCanonical(fixture())
  try {
    const glb = await new GLTFExporter().parseAsync(root as unknown as Parameters<GLTFExporter['parseAsync']>[0], { binary: true }) as ArrayBuffer
    const expected = geometryManifest(root), result = await verifyGlb(glb, expected)
    assert.equal(result.passed, true); assert.equal(result.parts, expected.length)
    const imported = await new GLTFLoader().parseAsync(glb, '')
    try {
      assert.equal(hitMaterial(firstHit(imported.scene, [.4, 1, 1], [0, 0, -1])!), 'tile')
      assert.equal(hitMaterial(firstHit(imported.scene, [.4, 1, -1], [0, 0, 1])!), 'wood')
      assert.equal(hitMaterial(firstHit(imported.scene, [1.2, 1, 0], [-1, 0, 0])!), 'edge')
      const hit = firstHit(imported.scene, [.4, 1.5, 1], [0, 0, -1])!
      assert.ok(Math.abs(hit.uv!.x - .4 / 1.2) < 1e-6)
      assert.ok(Math.abs(hit.uv!.y - 1.5 / .6) < 1e-6)
    } finally { disposeTree(imported.scene) }
  } finally { disposeTree(root) }
})
