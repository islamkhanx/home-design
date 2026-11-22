import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import * as T from 'three'
import type { Apartment, Entity } from '../src/domain/schema.ts'
import { createEntity } from '../src/scene/components.ts'
import { disposeTree } from '../src/scene/canonical.ts'
import { auditAttachments } from '../src/review/attachments.ts'

const seed = (): Apartment =>
  JSON.parse(readFileSync(new URL('../src/data/apartment.json', import.meta.url), 'utf8'))
function scene(a: Apartment) {
  const material = new T.MeshPhysicalMaterial({ side: T.DoubleSide })
  const materials = new Map(a.materials.map((m) => [m.id, material]))
  const root = new T.Group()
  for (const e of a.objects) root.add(createEntity(e, a, materials))
  return root
}
function review(a: Apartment) {
  const root = scene(a)
  try {
    return auditAttachments(a, root)
  } finally {
    disposeTree(root)
  }
}
function fixture(angle = 0, hostYaw = 0, side: 1 | -1 = 1) {
  const a = seed()
  const host: Entity = {
    id: 'arbitrary-host',
    name: 'Test wall',
    roomId: a.rooms[0].id,
    kind: 'Wall',
    material: 'paint',
    evidence: 'assumed',
    position: [300, 0, 400],
    rotation: [0, hostYaw, 0],
    size: [2200, 2700, 100],
    wall: {
      start: [100, 200],
      end: [100 + 2200 * Math.cos(angle), 200 + 2200 * Math.sin(angle)],
      thickness: 100,
      height: 2700,
      openings: [],
    },
  }
  const normal = new T.Vector3(-Math.sin(angle) * side, 0, Math.cos(angle) * side)
  const at = new T.Vector3(
    100 + Math.cos(angle) * 1000,
    1060,
    200 + Math.sin(angle) * 1000,
  ).addScaledVector(normal, 58)
  const rotation = new T.Matrix4().makeRotationY((hostYaw * Math.PI) / 180)
  at.applyMatrix4(rotation).add(new T.Vector3(...host.position))
  const worldNormal = normal.clone().transformDirection(rotation)
  const point: Entity = {
    id: 'arbitrary-electrical-point',
    name: 'Test point',
    roomId: host.roomId,
    kind: 'Socket',
    material: 'paint',
    evidence: 'assumed',
    size: [152, 80, 14],
    position: at.toArray(),
    rotation: [0, (Math.atan2(worldNormal.x, worldNormal.z) * 180) / Math.PI, 0],
    electrical: { wallId: host.id, offset: 1000, side, gangs: 2, purpose: 'Test', controls: [] },
  }
  a.objects = [host, point]
  return { a, host, point }
}

test('all current attached points pass mounting checks, while service and media access remain explicit warnings', () => {
  const a = seed(),
    findings = review(a)
  assert.equal(a.objects.filter((e) => e.electrical).length, 23)
  assert.deepEqual(
    findings.filter((f) => f.severity === 'error'),
    [],
  )
  for (const id of ['E05', 'E06', 'E07', 'E08', 'E15'])
    assert.ok(
      findings.some((f) => f.rule === 'attachment.access-review' && f.entityIds.includes(id)),
      `${id}: service access is not silently waived`,
    )
})

test('attachment checks work for arbitrary wall angles, reversed sides, translated hosts and enclosing scene transforms', () => {
  for (const [angle, hostYaw, side] of [
    [0, 0, 1],
    [0.65, 19, -1],
    [1.8, -42, 1],
  ] as const) {
    const { a } = fixture(angle, hostYaw, side),
      root = scene(a)
    root.position.set(4.25, 1.1, -3)
    root.rotation.y = 0.43
    try {
      assert.deepEqual(auditAttachments(a, root), [])
    } finally {
      disposeTree(root)
    }
  }
})

test('negative mutations catch a shifted mounting point, a reversed face and a missing attachment contract', () => {
  for (const [mutation, expected] of [
    [
      (p: Entity) => {
        p.position[0] += 15
      },
      'attachment.alignment',
    ],
    [
      (p: Entity) => {
        p.position[2] += 15
      },
      'attachment.alignment',
    ],
    [
      (p: Entity) => {
        p.rotation[1] += 180
      },
      'attachment.facing',
    ],
    [
      (p: Entity) => {
        delete p.electrical
      },
      'attachment.metadata',
    ],
    [
      (p: Entity) => {
        p.electrical!.wallId = 'missing-host'
      },
      'attachment.host',
    ],
  ] as const) {
    const { a, point } = fixture()
    mutation(point)
    assert.ok(
      review(a).some((f) => f.rule === expected),
      expected,
    )
  }
})

test('frame edges must fit the wall and avoid openings even when their center is correctly attached', () => {
  const { a, host, point } = fixture()
  host.wall!.openings.push({
    id: 'new-opening',
    kind: 'door',
    offset: 1050,
    width: 500,
    bottom: 0,
    height: 2100,
  })
  assert.ok(review(a).some((f) => f.rule === 'attachment.opening'))
  host.wall!.openings = []
  point.position[0] += 1180
  point.electrical!.offset += 1180
  const findings = review(a)
  assert.ok(findings.some((f) => f.rule === 'attachment.wall-boundary'))
  assert.ok(
    !findings.some((f) => f.rule === 'attachment.alignment'),
    'the center still obeys the declared offset',
  )
})

test('changed opaque finishes bury a geometrically attached point until its surface offset follows the actual finish', () => {
  const { a, point } = fixture()
  const finish: Entity = {
    id: 'unfamiliar-cladding-name',
    name: 'Finish',
    kind: 'Countertop',
    roomId: point.roomId,
    position: [1400, 700, 754],
    rotation: [0, 0, 0],
    size: [1200, 900, 8],
    material: 'paint',
    evidence: 'assumed',
    params: { fixture: 'joineryPanel' },
  }
  a.objects.push(finish)
  assert.ok(
    review(a).some((f) => f.rule === 'attachment.buried-face' && f.entityIds.includes(finish.id)),
  )
  point.position[2] += 108
  point.electrical!.surfaceOffset = 108
  assert.deepEqual(review(a), [])
  finish.position[2] += 35
  assert.ok(review(a).some((f) => f.rule === 'attachment.buried-face'))
  point.position[2] += 35
  point.electrical!.surfaceOffset! += 35
  assert.deepEqual(review(a), [])
})

test('removing a service hatch creates a buried rear-panel error instead of a cabinet-access warning alone', () => {
  const a = seed()
  const cabinet = a.objects.find((e) => e.id === 'auto-kitchen-Боковой ряд 3')!
  delete cabinet.params!.cabinetVoids
  const findings = review(a)
  for (const id of ['E05', 'E06'])
    assert.ok(
      findings.some(
        (f) =>
          f.rule === 'attachment.buried-face' &&
          f.entityIds.includes(id) &&
          f.details?.rearPanel === true,
      ),
    )
})

test('ray tests ignore presentation cutaways and detect missing contact geometry', () => {
  const { a, point } = fixture(),
    root = scene(a)
  try {
    root.visible = false
    assert.deepEqual(auditAttachments(a, root), [], 'a cutaway is not missing model geometry')
    const group = root.children.find((g) => g.userData.entityId === point.id)!
    const removed = [...group.children]
    group.clear()
    assert.ok(auditAttachments(a, root).some((f) => f.rule === 'attachment.face-missing'))
    group.add(...removed)
  } finally {
    disposeTree(root)
  }
})

test('attachment review accepts explicit numerical tolerance and rejects invalid settings', () => {
  const { a, point } = fixture()
  point.position[2] += 0.05
  const root = scene(a)
  try {
    assert.deepEqual(auditAttachments(a, root), [])
    assert.ok(
      auditAttachments(a, root, { toleranceMm: 0.01 }).some(
        (f) => f.rule === 'attachment.alignment',
      ),
    )
    for (const options of [
      { toleranceMm: -1 },
      { toleranceMm: NaN },
      { accessDepthMm: 0 },
      { accessDepthMm: Infinity },
    ])
      assert.throws(() => auditAttachments(a, root, options))
  } finally {
    disposeTree(root)
  }
})
