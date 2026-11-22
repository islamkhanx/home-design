import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import * as T from 'three'
import { parseApartment } from '../src/domain/schema.ts'
import type { Apartment, Entity } from '../src/domain/schema.ts'
import { createEntity } from '../src/scene/components.ts'
import { disposeTree } from '../src/scene/canonical.ts'
import { auditPlacement } from '../src/review/placement.ts'
import type { PlacementConstraint } from '../src/review/placement.ts'
import { homeReviewProfile } from '../src/review/home-profile.ts'

const source = parseApartment(
  JSON.parse(readFileSync(new URL('../src/data/apartment.json', import.meta.url), 'utf8')),
)
function scene(a: Apartment) {
  const material = new T.MeshPhysicalMaterial({ side: T.DoubleSide })
  const root = new T.Group(),
    materials = new Map(a.materials.map((m) => [m.id, material]))
  for (const e of a.objects) root.add(createEntity(e, a, materials))
  root.updateMatrixWorld(true)
  return root
}

test('bathroom relations detect narrowed gaps and deliberate fixture overlaps', () => {
  for (const id of ['bath-vanity-joint', 'wc-laundry', 'wc-vanity',
    'washer-cabinet', 'washer-socket-wc-storage', 'washer-socket-laundry']) {
    const relation = homeReviewProfile.placement.find(r => r.id === id)!
    const a = structuredClone(source)
    const left = a.objects.find(o => o.id === relation.left)!
    const right = a.objects.find(o => o.id === relation.right)!
    if (relation.kind === 'gap') {
      const axis = { x: 0, y: 1, z: 2 }[relation.axis]
      right.position[axis] = left.position[axis]
    } else if (id === 'washer-cabinet') {
      left.position[0] += 60 // Machine crosses an actual cabinet side panel.
    } else {
      left.position = [...right.position]
    }
    const root = scene(a)
    try {
      assert.ok(auditPlacement(a, root, [relation]).some(f =>
        f.details?.constraintId === id), `Regression must be detected: ${id}`)
    } finally { disposeTree(root) }
  }
})

test('all declared top scribes meet the actual ceiling, without a hardcoded height', () => {
  for (const ceilingY of [2850, 3100]) {
    const a = structuredClone(source)
    for (const e of a.objects) {
      if (e.kind === 'Ceiling') e.position[1] += ceilingY - 2850
      if (e.params?.cabinetTopScribe) e.size[1] += ceilingY - 2850
    }
    const root = scene(a)
    try {
      assert.deepEqual(auditPlacement(a, root), [])
    } finally {
      disposeTree(root)
    }
  }
})

test('every ceiling join detects a short cabinet and a cabinet crossing the ceiling', () => {
  for (const e of source.objects.filter((e) => e.params?.cabinetTopScribe))
    for (const delta of [-25, 25]) {
      const a = structuredClone(source)
      a.objects.find((o) => o.id === e.id)!.size[1] += delta
      const root = scene(a)
      try {
        assert.ok(
          auditPlacement(a, root).some(
            (f) => f.rule === 'placement.ceiling-join' && f.entityIds.includes(e.id),
          ),
          `${e.id}/${delta}`,
        )
      } finally {
        disposeTree(root)
      }
    }
})

test('a cabinet over a ceiling hole is reported even though the ceiling AABB covers it', () => {
  const a = structuredClone(source)
  a.objects = a.objects.filter((e) => ['ceiling', 'laundry-tower'].includes(e.id))
  const cabinet = a.objects.find((e) => e.id === 'laundry-tower')!
  const [x, , z] = cabinet.position
  a.objects.find((e) => e.id === 'ceiling')!.surface!.holes = [
    [
      [x - 30, z - 30],
      [x + 30, z - 30],
      [x + 30, z + 30],
      [x - 30, z + 30],
    ],
  ]
  const root = scene(a)
  try {
    assert.ok(auditPlacement(a, root).some((f) => f.rule === 'placement.ceiling-missing'))
  } finally {
    disposeTree(root)
  }
})

test('declared relations fail closed for missing entities and invalid ranges', () => {
  const a = structuredClone(source),
    root = scene(a)
  try {
    assert.equal(
      auditPlacement(a, root, [
        { id: 'required', kind: 'separate', left: 'missing', right: 'washer' },
      ])[0].rule,
      'placement.missing-entity',
    )
    assert.throws(() =>
      auditPlacement(a, root, [
        {
          id: 'range',
          kind: 'gap',
          left: 'washer',
          right: 'laundry-tower',
          axis: 'x',
          minMm: 20,
          maxMm: 10,
        },
      ]),
    )
    assert.throws(() => auditPlacement(a, root, [], NaN))
    assert.throws(
      () =>
        auditPlacement(a, root, [
          { id: 'self', kind: 'separate', left: 'washer', right: 'washer' },
        ]),
      /distinct entities/,
    )
    assert.throws(
      () =>
        auditPlacement(a, root, [
          {
            id: 'unknown',
            kind: 'unsupported',
            left: 'washer',
            right: 'laundry-tower',
          } as unknown as PlacementConstraint,
        ]),
      /Unknown placement/,
    )
  } finally {
    disposeTree(root)
  }
})

test('ceiling samples follow translated and yaw-rotated world geometry and detect a missing ceiling', () => {
  const a = structuredClone(source)
  a.objects = a.objects.filter((e) => ['ceiling', 'laundry-tower'].includes(e.id))
  const root = scene(a)
  root.rotation.y = T.MathUtils.degToRad(37)
  root.position.set(4, 1.25, -6)
  root.scale.setScalar(1.2)
  try {
    assert.deepEqual(auditPlacement(a, root), [])
    const ceiling = root.children.find((g) => g.userData.entityId === 'ceiling')!
    ceiling.position.y -= 0.025
    const finding = auditPlacement(a, root).find((f) => f.rule === 'placement.ceiling-join')!
    assert.ok(finding)
    assert.ok(Math.abs((finding.details!.gapMm as number) + 30) < 0.01)
    assert.equal(finding.details!.evaluation, 'five-point-sample')
    root.remove(ceiling)
    assert.ok(auditPlacement(a, root).some((f) => f.rule === 'placement.ceiling-missing'))
    root.add(ceiling) // Include removed geometry in disposal.
  } finally {
    disposeTree(root)
  }
})

test('a relative gap follows furniture movement and catches a regression without frozen coordinates', () => {
  const a = structuredClone(source)
  a.objects = a.objects.filter((e) => ['auto-bedroom-Кровать', 'auto-bedroom-Шкаф'].includes(e.id))
  for (const e of a.objects) if (e.params) delete e.params.cabinetTopScribe
  const constraint = {
    id: 'bed-access',
    kind: 'gap' as const,
    left: 'auto-bedroom-Кровать',
    right: 'auto-bedroom-Шкаф',
    axis: 'z' as const,
    minMm: 1000,
  }
  const root = scene(a)
  try {
    assert.deepEqual(auditPlacement(a, root, [constraint]), [])
    // Moving both pieces together does not change the relation.
    for (const g of root.children) g.position.z += 0.4
    assert.deepEqual(auditPlacement(a, root, [constraint]), [])
    root.children.find((g) => g.userData.entityId === constraint.right)!.position.z -= 0.05
    const finding = auditPlacement(a, root, [constraint])[0]
    assert.equal(finding.rule, 'placement.gap')
    assert.ok(Math.abs((finding.details!.gapMm as number) - 970) < 0.01)
  } finally {
    disposeTree(root)
  }
})

test('scoped solid-part separation detects penetration but permits shared-face contact', () => {
  const a = structuredClone(source)
  a.objects = ['left', 'right'].map(
    (id, i): Entity => ({
      id,
      name: id,
      kind: 'GlassPartition',
      roomId: 'bathroom',
      position: [i * 100, 0, 0],
      rotation: [0, 0, 0],
      size: [100, 500, 100],
      material: 'white',
      evidence: 'assumed',
    }),
  )
  const root = scene(a),
    constraints = [{ id: 'pair', kind: 'separate' as const, left: 'left', right: 'right' }]
  try {
    assert.deepEqual(auditPlacement(a, root, constraints), [])
    root.children[1].position.x -= 0.01
    const finding = auditPlacement(a, root, constraints)[0]
    assert.equal(finding.rule, 'placement.intersection')
    assert.equal(finding.severity, 'error')
  } finally {
    disposeTree(root)
  }
})
