import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import type { Apartment, Entity } from '../src/domain/schema.ts'
import { parseApartment } from '../src/domain/schema.ts'
import { buildCanonical, disposeTree } from '../src/scene/canonical.ts'
import { prepareWalkthroughApartment, walkingSpace } from '../src/scene/walking-space.ts'
import { auditNavigation } from '../src/review/navigation.ts'

function fixture(wallEnd = 2700): Apartment {
  const wall: Entity = {
    id: 'divider',
    name: 'Divider',
    kind: 'Wall',
    roomId: 'test-room',
    position: [0, 0, 0],
    rotation: [0, 0, 0],
    size: [100, 3000, wallEnd],
    material: 'plain',
    evidence: 'assumed',
    wall: { start: [3000, 0], end: [3000, wallEnd], thickness: 100, height: 3000, openings: [] },
  }
  return {
    schemaVersion: 1,
    id: 'navigation-fixture',
    name: 'Navigation fixture',
    revision: 1,
    units: 'mm',
    documentedArea: 24,
    notes: [],
    materials: [{ id: 'plain', name: 'Plain', color: '#dddddd', roughness: 0.6, metalness: 0 }],
    rooms: [
      {
        id: 'test-room',
        name: 'Test room',
        documentedArea: 24,
        evidence: 'assumed',
        note: 'Synthetic fixture',
        polygon: [
          [0, 0],
          [6000, 0],
          [6000, 4000],
          [0, 4000],
        ],
        interiorCamera: { position: [5500, 1600, 2000], target: [500, 1600, 2000] },
      },
    ],
    objects: [wall],
  }
}

test('navigation finds a bent route with exact requested endpoints and checked segments', async () => {
  const a = fixture(),
    root = await buildCanonical(a)
  try {
    const result = auditNavigation(a, root, { startMm: [503.25, 2001.75] })
    assert.deepEqual(result.findings, [])
    assert.equal(result.targets.length, 1)
    const target = result.targets[0]
    assert.equal(target.status, 'reachable')
    assert.deepEqual(target.routeMm![0], [503.25, 2001.75])
    assert.deepEqual(target.routeMm!.at(-1), [5500, 2000])
    assert.ok(
      target.routeMm!.some((p) => p[1] > 2840),
      'route goes around wall plus clearance',
    )
    const space = walkingSpace(a, root)
    for (let i = 1; i < target.routeMm!.length; i++) {
      const from = target.routeMm![i - 1].map((n) => n / 1000),
        to = target.routeMm![i].map((n) => n / 1000)
      assert.ok(space.segment(from, to), `${from} -> ${to}`)
    }
    assert.deepEqual(
      result,
      auditNavigation(a, root, { startMm: [503.25, 2001.75] }),
      'review is deterministic',
    )
  } finally {
    disposeTree(root)
  }
})

test('extending a divider disconnects a free target instead of snapping across the barrier', async () => {
  const a = fixture(4000),
    root = await buildCanonical(a)
  try {
    const result = auditNavigation(a, root, { startMm: [500, 2000] })
    assert.equal(result.targets[0].status, 'disconnected')
    assert.equal(result.findings[0].rule, 'navigation.disconnected')
    assert.equal(
      result.findings[0].severity,
      'warning',
      'sampling cannot prove that no route exists',
    )
    assert.equal(result.targets[0].routeMm, undefined)
  } finally {
    disposeTree(root)
  }
})

test('continuous edge checks reject a tiny corner clip missed by walkthrough point samples', async () => {
  const a = fixture(),
    root = await buildCanonical(a)
  try {
    // The inflated wall corner is X2810/Z2840. This line enters its corner
    // for only about1.4mm, between the viewer's25mm point samples.
    const start: [number, number] = [2790, 2819],
      end: [number, number] = [2830, 2859]
    const space = walkingSpace(a, root)
    assert.ok(
      space.segment(
        start.map((n) => n / 1000),
        end.map((n) => n / 1000),
      ),
    )
    const result = auditNavigation(a, root, {
      startMm: start,
      includeRoomCameras: false,
      targets: [{ id: 'near-corner', positionMm: end }],
    })
    assert.equal(result.targets[0].status, 'reachable')
    assert.ok(
      result.targets[0].routeMm!.length > 2,
      'unsafe direct edge must be replaced by a route around the corner',
    )
  } finally {
    disposeTree(root)
  }
})

test('blocked activity targets and starts are reported exactly, never silently relocated', async () => {
  const a = fixture(),
    root = await buildCanonical(a)
  try {
    const result = auditNavigation(a, root, {
      startMm: [500, 2000],
      includeRoomCameras: false,
      targets: [{ id: 'cabinet-front', entityId: 'divider', positionMm: [3000, 2000] }],
    })
    assert.equal(result.targets[0].status, 'blocked')
    assert.deepEqual(result.targets[0].positionMm, [3000, 2000])
    assert.deepEqual(result.findings[0].entityIds, ['divider'])
    assert.equal(result.findings[0].rule, 'navigation.target-blocked')
    const blockedStart = auditNavigation(a, root, { startMm: [3000, 2000] })
    assert.equal(blockedStart.targets[0].status, 'start-blocked')
    assert.equal(blockedStart.findings[0].rule, 'navigation.start-blocked')
    assert.equal(blockedStart.metrics.visitedNodes, 0)
  } finally {
    disposeTree(root)
  }
})

test('activity targets follow the actual cabinet transform and catch a moved, rotated obstruction', async () => {
  const a = fixture()
  a.objects.push({
    id: 'cabinet',
    name: 'Cabinet',
    kind: 'Wardrobe',
    roomId: 'test-room',
    position: [1000, 0, 1000],
    rotation: [0, 0, 0],
    size: [600, 2000, 600],
    material: 'plain',
    evidence: 'assumed',
  })
  const root = await buildCanonical(a)
  const options = {
    startMm: [500, 3500] as [number, number],
    includeRoomCameras: false,
    targets: [
      { id: 'cabinet-access', entityId: 'cabinet', entityOffsetMm: [0, 650] as [number, number] },
    ],
  }
  try {
    const initial = auditNavigation(a, root, options)
    assert.equal(initial.targets[0].status, 'reachable')
    assert.deepEqual(initial.targets[0].positionMm, [1000, 1650])
    const cabinet = root.children.find((group) => group.userData.entityId === 'cabinet')!
    cabinet.position.set(2, 0, 1)
    const translated = auditNavigation(a, root, options)
    assert.equal(translated.targets[0].status, 'reachable')
    assert.deepEqual(translated.targets[0].positionMm, [2000, 1650])

    // Only the scene transform changes, deliberately leaving stale source
    // coordinates behind. The relative point must use the inspected geometry.
    cabinet.position.set(2.35, 0, 1.2)
    cabinet.rotation.y = Math.PI / 2
    const turned = auditNavigation(a, root, options)
    assert.equal(turned.targets[0].status, 'blocked')
    assert.ok(Math.abs(turned.targets[0].positionMm[0] - 3000) < 1e-6)
    assert.ok(Math.abs(turned.targets[0].positionMm[1] - 1200) < 1e-6)
    assert.ok(turned.findings[0].entityIds.includes('divider'))
    assert.ok(
      walkingSpace(a, root).free([1, 1.65]),
      'the stale absolute point would still have passed',
    )
    assert.deepEqual(a.objects.find((entity) => entity.id === 'cabinet')!.position, [1000, 0, 1000])
  } finally {
    disposeTree(root)
  }
})

test('relative targets with missing entities or scene groups fail without fallback coordinates', async () => {
  const a = fixture(),
    root = await buildCanonical(a)
  const options = {
    startMm: [500, 2000] as [number, number],
    includeRoomCameras: false,
    targets: [
      { id: 'front', entityId: 'not-present', entityOffsetMm: [0, 650] as [number, number] },
    ],
  }
  try {
    const absent = auditNavigation(a, root, options)
    assert.equal(absent.targets.length, 0, 'unresolved results must not invent a position')
    assert.equal(absent.metrics.unresolvedTargets, 1)
    assert.equal(absent.findings[0].rule, 'navigation.target-entity-missing')
    assert.equal(absent.findings[0].severity, 'error')
    options.targets[0].entityId = 'divider'
    const divider = root.children[0]
    root.remove(divider)
    const absentScene = auditNavigation(a, root, options)
    assert.equal(absentScene.findings[0].rule, 'navigation.target-entity-missing')
    assert.equal(absentScene.findings[0].details!.missingSceneGroup, true)
    root.add(divider)
    a.objects = []
    const absentModel = auditNavigation(a, root, options)
    assert.equal(absentModel.findings[0].rule, 'navigation.target-entity-missing')
    assert.equal(absentModel.findings[0].details!.missingModelEntity, true)
  } finally {
    disposeTree(root)
  }
})

test('unmodeled room targets and invalid review options cannot produce an apparently complete pass', async () => {
  const a = fixture(),
    root = await buildCanonical(a)
  try {
    delete a.rooms[0].interiorCamera
    assert.equal(
      auditNavigation(a, root, { startMm: [500, 2000] }).findings[0].rule,
      'navigation.room-target-missing',
    )
    for (const gridMm of [0, -1, NaN, Infinity])
      assert.throws(() => auditNavigation(a, root, { startMm: [500, 2000], gridMm }))
    assert.throws(() => auditNavigation(a, root, { startMm: [NaN, 2000] }))
    assert.throws(
      () => auditNavigation(a, root, { startMm: [500, 2000], maxCells: 2 }),
      /grid needs/,
    )
    assert.throws(
      () =>
        auditNavigation(a, root, {
          startMm: [500, 2000],
          targets: [
            { id: 'same', positionMm: [500, 1000] },
            { id: 'same', positionMm: [500, 2000] },
          ],
        }),
      /unique/,
    )
    assert.throws(
      () =>
        auditNavigation(a, root, {
          startMm: [500, 2000],
          targets: [{ id: 'bad', positionMm: [500, Infinity] }],
        }),
      /finite/,
    )
    assert.throws(
      () =>
        auditNavigation(a, root, {
          startMm: [500, 2000],
          targets: [
            {
              id: 'ambiguous',
              positionMm: [500, 2000],
              entityId: 'divider',
              entityOffsetMm: [0, 650],
            } as never,
          ],
        }),
      /exactly one/,
    )
    assert.throws(
      () =>
        auditNavigation(a, root, {
          startMm: [500, 2000],
          targets: [{ id: 'unbound', entityOffsetMm: [0, 650] } as never],
        }),
      /entityId/,
    )
  } finally {
    disposeTree(root)
  }
})

test('all canonical room cameras remain reachable at their exact positions from the hall', async () => {
  const source = parseApartment(
    JSON.parse(readFileSync(new URL('../src/data/apartment.json', import.meta.url), 'utf8')),
  )
  const before = JSON.stringify(source),
    a = prepareWalkthroughApartment(source),
    root = await buildCanonical(a)
  try {
    const result = auditNavigation(a, root, { startMm: [4350, 1500] })
    assert.deepEqual(result.findings, [], JSON.stringify(result.findings, null, 2))
    assert.equal(result.targets.length, source.rooms.length)
    assert.ok(result.targets.every((t) => t.status === 'reachable'))
    for (const target of result.targets) assert.deepEqual(target.routeMm!.at(-1), target.positionMm)
    assert.equal(JSON.stringify(source), before, 'audit must not alter source or door poses')
  } finally {
    disposeTree(root)
  }
})
