import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import * as T from 'three'
import type { Object3D } from 'three/src/core/Object3D.js'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'
import {
  collectReviewParts,
  transformedBoxObb,
  overlapBoxParts,
  findPartIntersections,
  auditWallIntersections,
} from '../src/review/geometry.ts'
import { createEntity } from '../src/scene/components.ts'
import { disposeTree } from '../src/scene/canonical.ts'
import { parseApartment } from '../src/domain/schema.ts'

const material = new T.MeshBasicMaterial()
function box(
  id: string,
  size = [1, 1, 1],
  position = [0, 0, 0],
  yaw = 0,
  geometry?: T.BufferGeometry,
) {
  const mesh = new T.Mesh(
    geometry ?? new T.BoxGeometry(...(size as [number, number, number])),
    material,
  )
  mesh.position.set(...(position as [number, number, number]))
  mesh.rotation.y = yaw
  mesh.userData = { entityId: id, partId: `${id}__0`, kind: 'Wall' }
  return mesh
}
function scene(...objects: Object3D[]) {
  const root = new T.Group()
  root.add(...objects)
  return root
}
const close = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-6, `${a} != ${b}`)

test('world OBB transforms an offset centre through rotation, reflection and nested transforms', () => {
  const root = new T.Group(),
    parent = new T.Group()
  root.position.set(4, 1, -2)
  root.rotation.y = 0.6
  root.scale.setScalar(2)
  parent.position.set(0.4, 0.5, 0.6)
  parent.rotation.x = 0.3
  root.add(parent)
  const mesh = box('offset')
  mesh.geometry.translate(1.2, 2.3, 3.4)
  mesh.scale.set(-2, 1, 0.5)
  parent.add(mesh)
  const [part] = collectReviewParts(root)
  const expected = mesh.geometry
    .boundingBox!.getCenter(new T.Vector3())
    .applyMatrix4(mesh.matrixWorld)
  close(part.obb.center.distanceTo(expected), 0)
  close(part.obb.halfSize.x, 2)
  close(part.obb.halfSize.y, 1)
  close(part.obb.halfSize.z, 0.5)
  assert.equal(part.solidBox, true)
  disposeTree(root)
})

test('face contact, sub-tolerance seams and containment are distinguished from positive overlap', () => {
  const a = box('left'),
    b = box('right', [1, 1, 1], [1, 0, 0]),
    root = scene(a, b)
  assert.deepEqual(auditWallIntersections(root), [])
  b.position.x = 0.99995
  assert.deepEqual(
    auditWallIntersections(root),
    [],
    '0.05mm contact noise is ignored at 0.1mm tolerance',
  )
  b.position.x = 0.9998
  assert.equal(auditWallIntersections(root).length, 1, '0.2mm overlap is caught')
  b.position.x = 0
  b.scale.setScalar(0.00005)
  assert.deepEqual(
    auditWallIntersections(root),
    [],
    'a contained 0.05mm sliver does not exceed tolerance',
  )
  assert.equal(auditWallIntersections(root, 0.001).length, 1)
  disposeTree(root)
})

test('parallel diagonal boards with intersecting AABBs are separate in actual oriented bounds', () => {
  const yaw = Math.PI / 4
  const a = box('a', [2, 1, 0.1], [0, 0, 0], yaw)
  const b = box('b', [2, 1, 0.1], [0.15, 0, 0.15], yaw)
  const root = scene(a, b),
    parts = collectReviewParts(root)
  assert.ok(parts[0].box.intersectsBox(parts[1].box))
  assert.equal(overlapBoxParts(parts[0], parts[1]), false)
  assert.deepEqual(auditWallIntersections(root), [])
  b.position.set(0.02, 0, 0.02)
  assert.equal(auditWallIntersections(root).length, 1)
  disposeTree(root)
})

test('cross-axis SAT rejects skew rods whose face axes alone cannot separate them', () => {
  const a = box('a', [3, 0.15, 0.15])
  // The long axes are perpendicular. Their common-normal separation is 0.3m,
  // exceeding the combined 0.15*sqrt(2)m cross-section projection.
  const b = box('b', [3, 0.15, 0.15], [0, -0.3 / Math.SQRT2, 0.3 / Math.SQRT2])
  b.quaternion.setFromUnitVectors(new T.Vector3(1, 0, 0), new T.Vector3(0, 1, 1).normalize())
  const root = scene(a, b),
    parts = collectReviewParts(root)
  assert.ok(parts[0].box.intersectsBox(parts[1].box))
  assert.equal(overlapBoxParts(parts[0], parts[1]), false)
  disposeTree(root)
})

test('curved or rounded bounds are reported only as candidates, never solid intersections', () => {
  const root = scene(
    box('round', [1, 1, 1], [0, 0, 0], 0, new RoundedBoxGeometry(1, 1, 1, 2, 0.1)),
    box('square'),
  )
  const parts = collectReviewParts(root)
  assert.equal(parts.find((part) => part.entityId === 'round')!.solidBox, false)
  assert.equal(findPartIntersections(parts)[0].certainty, 'bounds-candidate')
  assert.deepEqual(findPartIntersections(parts, { includeCandidates: false }), [])
  assert.equal(auditWallIntersections(root)[0].severity, 'warning')
  disposeTree(root)
})

test('nested nonuniform scale that creates shear falls back to candidate bounds', () => {
  const root = new T.Group(),
    child = box('shear')
  root.scale.set(2, 1, 1)
  child.rotation.y = Math.PI / 4
  root.add(child)
  const [part] = collectReviewParts(root)
  assert.equal(part.solidBox, false)
  assert.throws(() => transformedBoxObb(child.geometry.boundingBox!, child.matrixWorld), /sheared/)
  disposeTree(root)
})

test('scope filtering is symmetric and excludes ordinary within-entity assembly overlaps', () => {
  const a = box('a'),
    b = box('b'),
    c = box('c'),
    root = scene(a, b, c)
  const parts = collectReviewParts(root)
  assert.equal(findPartIntersections(parts).length, 3)
  const scoped = findPartIntersections(parts, { leftEntityIds: ['b'], rightEntityIds: ['a'] })
  assert.deepEqual(
    scoped.map((hit) => [hit.a.entityId, hit.b.entityId]),
    [['a', 'b']],
  )
  b.userData.entityId = 'a'
  assert.equal(findPartIntersections(collectReviewParts(root)).length, 2)
  assert.equal(
    findPartIntersections(collectReviewParts(root), { includeSameEntity: true }).length,
    3,
  )
  disposeTree(root)
})

test('invalid tolerances, missing scope IDs and missing or duplicate mesh IDs fail closed', () => {
  assert.throws(() => findPartIntersections([], { toleranceMm: -1 }), /Tolerance/)
  assert.throws(() => findPartIntersections([], { toleranceMm: NaN }), /Tolerance/)
  assert.throws(
    () => findPartIntersections([], { leftEntityIds: ['missing'] }),
    /Unknown review entity/,
  )
  const a = box('a'),
    b = box('b'),
    root = scene(a, b)
  b.userData.partId = a.userData.partId
  assert.throws(() => collectReviewParts(root), /Duplicate review part/)
  delete b.userData.partId
  assert.throws(() => collectReviewParts(root), /lacks stable/)
  disposeTree(root)
})

const seed = () =>
  parseApartment(
    JSON.parse(readFileSync(new URL('../src/data/apartment.json', import.meta.url), 'utf8')),
  )
function walls(a = seed()) {
  const root = new T.Group(),
    material = new T.MeshPhysicalMaterial()
  const materials = new Map(a.materials.map((m) => [m.id, material]))
  for (const wall of a.objects.filter((e) => e.kind === 'Wall'))
    root.add(createEntity(wall, a, materials))
  return root
}

test('current canonical wall cells pass; restoring the prior 50mm wall intrusion produces actionable IDs', () => {
  const a = seed(),
    current = walls(a)
  assert.deepEqual(auditWallIntersections(current), [])
  disposeTree(current)
  a.objects.find((e) => e.id === 'source-bedroom-entry')!.wall!.start[0] -= 50
  const broken = walls(a),
    findings = auditWallIntersections(broken)
  const hit = findings.find(
    (finding) =>
      finding.entityIds.includes('wall-east') && finding.entityIds.includes('source-bedroom-entry'),
  )
  assert.ok(hit, JSON.stringify(findings))
  assert.equal(hit.severity, 'error')
  assert.ok(
    (hit.details!.parts as string[][]).every((pair) => pair.length === 2 && pair.every(Boolean)),
  )
  disposeTree(broken)
})

test('arbitrarily rotated wall openings remain voids in generalized wall intersection review', () => {
  const a = seed(),
    wall = structuredClone(a.objects.find((e) => e.kind === 'Wall')!)
  wall.id = 'angled-wall'
  wall.position = [100, 0, 200]
  wall.rotation = [0, 17, 0]
  wall.wall = {
    start: [0, 0],
    end: [2400, 1800],
    thickness: 100,
    height: 2700,
    openings: [{ id: 'door-test', kind: 'door', offset: 900, width: 900, bottom: 0, height: 2100 }],
  }
  a.objects = [wall]
  const root = walls(a),
    obstacle = box('crossing', [0.2, 0.2, 0.2])
  // Opening centre in the wall's untransformed model coordinates.
  root.updateMatrixWorld(true)
  const at = new T.Vector3(1.08, 1, 0.81).applyMatrix4(root.children[0].matrixWorld)
  obstacle.position.copy(at)
  root.add(obstacle)
  assert.deepEqual(auditWallIntersections(root), [])
  obstacle.position.y = 2.5
  assert.ok(auditWallIntersections(root).some((finding) => finding.entityIds.includes('crossing')))
  disposeTree(root)
})
