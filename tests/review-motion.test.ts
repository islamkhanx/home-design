import test from 'node:test'
import assert from 'node:assert/strict'
import * as T from 'three'
import { collectReviewParts, transformedBoxObb } from '../src/review/geometry.ts'
import {
  applianceFrontBox,
  auditMotion,
  frontPartsAtDepth,
  motionMatrixAt,
  openingMotion,
} from '../src/review/motion.ts'
import type { ReviewMotion } from '../src/review/motion.ts'

const allocated: T.Mesh[] = []
const box = (min: [number, number, number], max: [number, number, number]) =>
  new T.Box3(new T.Vector3(...min), new T.Vector3(...max))
function obstacle(
  id: string,
  center: [number, number, number],
  size: [number, number, number],
  sphere = false,
) {
  const mesh = new T.Mesh(
    sphere ? new T.SphereGeometry(size[0] / 2) : new T.BoxGeometry(...size),
    new T.MeshBasicMaterial(),
  )
  mesh.position.set(...center)
  mesh.userData = { entityId: id, partId: `${id}/solid`, kind: 'Table' }
  allocated.push(mesh)
  return collectReviewParts(mesh)[0]
}
const rotation: ReviewMotion = {
  kind: 'rotation',
  axis: 'y',
  pivot: [0, 0, 0],
  from: 0,
  to: 90,
  step: 5,
}
const translation: ReviewMotion = {
  kind: 'translation',
  direction: [1, 0, 0],
  from: 0,
  to: 1000,
  step: 100,
}
const leaf = box([0, 0, -0.01], [1, 1, 0.01])
const identity = new T.Matrix4()

test('hinge sweep catches an intermediate collision while both end poses clear', () => {
  const blocker = obstacle('intermediate', [0.65, 0.5, -0.65], [0.12, 0.12, 0.12])
  const options = {
    entityId: 'door',
    partId: 'leaf',
    localBox: leaf,
    solidBox: true,
    parentMatrix: identity,
    obstacles: [blocker],
  }
  assert.deepEqual(
    auditMotion({ ...options, motion: { ...rotation, from: 0, to: 0 } }).findings,
    [],
  )
  assert.deepEqual(
    auditMotion({ ...options, motion: { ...rotation, from: 90, to: 90 } }).findings,
    [],
  )
  const report = auditMotion({ ...options, motion: rotation })
  assert.equal(report.sampleCount, 19)
  assert.equal(report.findings.length, 1, 'one earliest sampled hit per obstructing part')
  const hit = report.findings[0]
  assert.equal(hit.severity, 'error')
  assert.deepEqual(hit.entityIds, ['door', 'intermediate'])
  assert.ok(Number(hit.details!.sample) > 0 && Number(hit.details!.sample) < 90)
  assert.equal(hit.details!.obstaclePartId, 'intermediate/solid')
  assert.equal(hit.details!.evaluation, 'sampled')
})

test('rotating an offset local box around an explicit hinge also transforms its center', () => {
  const motion: ReviewMotion = { ...rotation, pivot: [2, 0, 0] }
  const matrix = motionMatrixAt(new T.Matrix4().makeTranslation(5, 0, 2), motion, 90)
  const obb = transformedBoxObb(box([2, 0, -0.01], [3, 1, 0.01]), matrix)
  assert.ok(obb.center.distanceTo(new T.Vector3(7, 0.5, 1.5)) < 1e-10)
})

test('translation follows the parent rotation and reports the first offset in millimetres', () => {
  const parent = new T.Matrix4()
    .makeTranslation(3, 0, 2)
    .multiply(new T.Matrix4().makeRotationY(Math.PI / 2))
  const report = auditMotion({
    entityId: 'drawer',
    partId: 'front',
    solidBox: true,
    localBox: box([-0.01, 0, -0.01], [0.01, 1, 0.01]),
    parentMatrix: parent,
    motion: translation,
    obstacles: [obstacle('wall', [3, 0.5, 1.5], [0.08, 1, 0.08])],
  })
  assert.equal(report.findings.length, 1)
  assert.equal(report.findings[0].details!.sample, 500)
  assert.equal(report.findings[0].details!.unit, 'mm')
})

test('last sample is included for indivisible and descending ranges', () => {
  const options = {
    entityId: 'slider',
    partId: 'body',
    solidBox: true,
    localBox: box([-0.001, 0, -0.001], [0.001, 0.1, 0.001]),
    parentMatrix: identity,
    obstacles: [obstacle('end', [0.25, 0.05, 0], [0.002, 0.1, 0.002])],
  }
  const forward = auditMotion({ ...options, motion: { ...translation, to: 250 } })
  assert.equal(forward.sampleCount, 4)
  assert.equal(forward.findings[0].details!.sample, 250)
  const reverse = auditMotion({
    ...options,
    motion: { ...translation, from: 500, to: 250, step: 100 },
  })
  assert.equal(reverse.sampleCount, 4)
  assert.equal(reverse.findings[0].details!.sample, 250)
})

test('face contact and sub-tolerance penetration pass, larger penetration is caught', () => {
  const options = {
    entityId: 'front',
    partId: 'body',
    solidBox: true,
    localBox: box([0, 0, 0], [1, 1, 1]),
    parentMatrix: identity,
    motion: { ...translation, to: 0 },
    toleranceMm: 0.1,
  }
  const inspect = (penetrationMm: number) =>
    auditMotion({
      ...options,
      obstacles: [
        obstacle(`side-${penetrationMm}`, [1.5 - penetrationMm / 1000, 0.5, 0.5], [1, 1, 1]),
      ],
    }).findings
  assert.equal(inspect(0).length, 0)
  assert.equal(inspect(0.05).length, 0)
  assert.equal(inspect(0.2).length, 1)
})

test('same-entity parts are checked unless their full entity/part key is explicitly excluded', () => {
  const ownPart = obstacle('cabinet', [0.5, 0.5, 0], [0.1, 0.1, 0.1])
  const options = {
    entityId: 'cabinet',
    partId: 'front',
    solidBox: true,
    localBox: leaf,
    parentMatrix: identity,
    motion: { ...rotation, to: 0 },
    obstacles: [ownPart],
  }
  assert.equal(auditMotion(options).findings.length, 1)
  assert.equal(
    auditMotion({ ...options, excludedParts: [{ entityId: 'other', partId: ownPart.partId }] })
      .findings.length,
    1,
  )
  assert.equal(
    auditMotion({
      ...options,
      excludedParts: [{ entityId: ownPart.entityId, partId: ownPart.partId }],
    }).findings.length,
    0,
  )
})

test('nonbox obstacles and conservative moving envelopes remain warnings', () => {
  const options = {
    entityId: 'proposal',
    partId: 'front',
    localBox: leaf,
    parentMatrix: identity,
    motion: { ...rotation, to: 0 },
  }
  const meshCandidate = auditMotion({
    ...options,
    solidBox: true,
    obstacles: [obstacle('sphere', [0.5, 0.5, 0], [0.1, 0.1, 0.1], true)],
  })
  assert.equal(meshCandidate.findings[0].severity, 'warning')
  assert.equal(meshCandidate.findings[0].details!.certainty, 'bounds-candidate')
  const movingCandidate = auditMotion({
    ...options,
    obstacles: [obstacle('solid', [0.5, 0.5, 0], [0.1, 0.1, 0.1])],
  })
  assert.equal(movingCandidate.findings[0].severity, 'warning')
})

test('invalid and unbounded sampling inputs fail before entering a sweep', () => {
  const options = {
    entityId: 'proposal',
    partId: 'front',
    localBox: leaf,
    parentMatrix: identity,
    obstacles: [],
  }
  for (const step of [0, -1, NaN, Infinity])
    assert.throws(
      () => auditMotion({ ...options, motion: { ...rotation, step } }),
      /finite|positive/,
    )
  assert.throws(() => auditMotion({ ...options, motion: { ...rotation, step: 0.00001 } }), /10001/)
  assert.throws(
    () => auditMotion({ ...options, motion: { ...translation, direction: [0, 0, 0] } }),
    /unit vector/,
  )
  assert.throws(
    () => auditMotion({ ...options, motion: { ...translation, direction: [2, 0, 0] } }),
    /unit vector/,
  )
  assert.throws(
    () =>
      auditMotion({
        ...options,
        motion: { ...rotation, axis: 'wrong' } as unknown as ReviewMotion,
      }),
    /axis/,
  )
  assert.throws(
    () =>
      auditMotion({
        ...options,
        motion: { ...rotation, kind: 'unknown' } as unknown as ReviewMotion,
      }),
    /kind/,
  )
  assert.throws(
    () =>
      auditMotion({ ...options, motion: { ...rotation, pivot: [] } as unknown as ReviewMotion }),
    /three finite/,
  )
  assert.throws(() => openingMotion(leaf, 'middle' as 'min', 'x'), /hinge/)
  assert.throws(() => openingMotion(leaf, 'min', 'z' as 'x'), /axis/)
  assert.throws(() => applianceFrontBox({ size: [600, 800, 5] }), /dimensions/)
  assert.throws(() => auditMotion({ ...options, motion: rotation, toleranceMm: -1 }), /tolerance/)
  assert.throws(
    () => auditMotion({ ...options, motion: rotation, localBox: box([0, 0, 0], [Infinity, 1, 1]) }),
    /finite/,
  )
  assert.throws(
    () => auditMotion({ ...options, motion: rotation, localBox: box([0, 0, 0], [1, 0, 1]) }),
    /positive volume/,
  )
})

test('front extraction uses measured leaf depth and rejects world-positioned input', () => {
  const root = new T.Group()
  const body = obstacle('body', [0, 0.5, 0], [0.6, 1, 0.6])
  const upper = obstacle('upper-front', [0.15, 0.75, 0.291], [0.295, 0.49, 0.018])
  const lower = obstacle('lower-front', [-0.15, 0.25, 0.291], [0.295, 0.49, 0.018])
  root.add(body.mesh, upper.mesh, lower.mesh)
  assert.deepEqual(
    frontPartsAtDepth(root, 600).map((part) => part.entityId),
    ['lower-front', 'upper-front'],
  )
  root.position.x = 1
  assert.throws(() => frontPartsAtDepth(root, 600), /origin/)
  assert.throws(() => frontPartsAtDepth(new T.Group(), -1), /positive/)
})

test.after(() =>
  allocated.forEach((mesh) => {
    mesh.geometry.dispose()
    ;(mesh.material as T.Material).dispose()
  }),
)
