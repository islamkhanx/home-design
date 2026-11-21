import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { Raycaster, Vector3 } from 'three'
import {
  buildTourPlan,
  validateTourOptions,
  assertResume,
  progressSummary,
} from '../scripts/tour-plan.mjs'
import { buildCanonical, disposeTree } from '../src/scene/canonical.ts'
import { prepareWalkthroughApartment, navigationSpace, crossesObstacle, roundedWalkingPath, safeWalkingSample } from '../scripts/walkthrough-path.mjs'
import { parseApartment } from '../src/domain/schema.ts'

const apartment = parseApartment(
  JSON.parse(readFileSync(new URL('../src/data/apartment.json', import.meta.url), 'utf8')),
)

test('walkthrough retains the whole apartment and follows a collision-free route through every room', async () => {
  const source = JSON.stringify(apartment)
  const plan = await buildTourPlan(apartment, { seconds: 60, fps: 24 })
  assert.equal(plan.version, 2)
  assert.equal(plan.shots.length, 1)
  assert.equal(plan.shots[0].startFrame, 1)
  assert.equal(plan.shots[0].endFrame, 1440)
  assert.equal(plan.walkthrough.frames.length, 1440)
  assert.ok(plan.walkthrough.distanceMeters > 20)
  const staged = prepareWalkthroughApartment(apartment)
  const root = await buildCanonical(staged)
  try {
    const nav = navigationSpace(staged, root),
      shot = plan.shots[0]
    for (const room of apartment.rooms)
      assert.ok(plan.walkthrough.frames.some((f) => f.room === room.id))
    for (const o of apartment.objects.filter(
      (o) => o.visible !== false && !['DimensionLine', 'RoomLabel'].includes(o.kind),
    ))
      assert.ok(shot.visibleEntityIds.includes(o.id), o.id + ' must stay visible throughout')
    for (const [index, section] of plan.walkthrough.sections.entries()) {
      if (index) assert.deepEqual(section.path[0], plan.walkthrough.sections[index - 1].path.at(-1), 'walking sections must join without a teleport')
      for (let i = 1; i < section.path.length; i++)
        assert.ok(nav.segment(section.path[i - 1], section.path[i]))
    }
    for (const [i, frame] of plan.walkthrough.frames.entries()) {
      const [x, y, z] = frame.position
      assert.equal(y, 1.6)
      assert.ok(nav.free([x, z]))
      if (i) {
        const prev = plan.walkthrough.frames[i - 1]
        assert.ok(nav.segment([prev.position[0], prev.position[2]], [x, z]), 'between-frame travel must also stay clear')
        assert.ok(
          Math.hypot(...frame.position.map((v: number, j: number) => v - prev.position[j])) < 0.08,
          'camera must not jump',
        )
        const direction = (f: any) =>
          Math.atan2(f.target[0] - f.position[0], f.target[2] - f.position[2])
        const delta = direction(frame) - direction(prev)
        assert.ok(
          Math.abs(Math.atan2(Math.sin(delta), Math.cos(delta))) < 0.06,
          'turn must be smooth',
        )
      }
    }
    assert.ok(shot.renderNotice.length)
  } finally {
    disposeTree(root)
  }
  assert.equal(JSON.stringify(apartment), source, 'source design must not be mutated')
  // Only internal door poses change in the export copy. No architectural edits.
  for (const original of apartment.objects) {
    const stagedObject = staged.objects.find((o: { id: string }) => o.id === original.id)!
    if (original.kind !== 'Door') assert.deepEqual(stagedObject, original)
  }
  const closedRoot = await buildCanonical(apartment)
  try {
    assert.throws(
      () => navigationSpace(apartment, closedRoot).route([2.55, 1.55], [2.65, -1.6]),
      /No collision-free/,
    )
  } finally {
    disposeTree(closedRoot)
  }
})

test('loggia and entrance review pauses follow the room cameras and have an unobstructed central view', async () => {
  const plan = await buildTourPlan(apartment, { seconds: 60, fps: 24 })
  const root = await buildCanonical(prepareWalkthroughApartment(apartment))
  try {
    for (const room of ['loggia', 'hall']) {
      const camera = apartment.rooms.find((r) => r.id === room)!.interiorCamera!
      const section = plan.walkthrough.sections.filter((s: { room: string }) => s.room === room).at(-1)!
      const end = section.path.at(-1)!
      assert.ok(Math.hypot(end[0] - camera.position[0] / 1000, end[1] - camera.position[2] / 1000) < 0.08,
        `${room}: pause must use the reviewed viewpoint, within navigation-grid rounding`)
      const paused = plan.walkthrough.frames.filter((f: { position: number[] }) =>
        Math.hypot(f.position[0] - end[0], f.position[2] - end[1]) < 1e-7)
      assert.ok(paused.length > 1, `${room}: retain a pause for inspection`)
      const frame = paused.at(-1)!
      const eye = new Vector3(...frame.position as [number, number, number])
      const target = new Vector3(...frame.target as [number, number, number])
      const intended = new Vector3(...camera.target.map((n) => n / 1000) as [number, number, number])
      const direction = target.clone().sub(eye).normalize()
      const actualYaw = Math.atan2(direction.x, direction.z)
      const intendedYaw = Math.atan2(intended.x - eye.x, intended.z - eye.z)
      assert.ok(Math.abs(Math.atan2(Math.sin(actualYaw - intendedYaw), Math.cos(actualYaw - intendedYaw))) < 0.01,
        `${room}: the paused camera must finish looking toward the reviewed subject`)
      const ray = new Raycaster(eye, direction, 0.025, eye.distanceTo(intended) - 0.025)
      const blocked = ray.intersectObject(root, true).find((hit) => {
        let entity = hit.object
        while (entity.parent && !entity.userData.entityId) entity = entity.parent
        return ['Door', 'Wall'].includes(apartment.objects.find((e) => e.id === entity.userData.entityId)?.kind ?? '')
      })
      assert.equal(blocked, undefined, `${room}: walls or door leaves must not block the review subject`)
    }
  } finally {
    disposeTree(root)
  }
})

test('continuous path checks detect thin crossings between sampled points in either direction', () => {
  const box = { min: [.011, 0, -.002], max: [.013, 1, .002] }
  const from = [0, 0], to = [1, 0]
  for (let i = 0; i <= 40; i++)
    assert.equal(crossesObstacle([i / 40, 0], [i / 40, 0], box, 0), false)
  assert.equal(crossesObstacle(from, to, box, 0), true)
  assert.equal(crossesObstacle(to, from, box, 0), true)
  assert.equal(crossesObstacle([.012, 0], to, box, 0), true)
  assert.equal(crossesObstacle([0, .002], [1, .002], box, 0), false, 'boundary tangency matches walking-space semantics')
  assert.equal(crossesObstacle([0, .003], [1, .003], box, .002), true, 'retain camera clearance inflation')
})

test('corner rounding reduces its radius when the large curve clips furniture and validates its connectors', () => {
  const box = { min: [.85, 0, .05], max: [.95, 1, .15] }
  const nav = {
    free: (p: number[]) => !crossesObstacle(p, p, box, 0),
    segment: (a: number[], b: number[]) => !crossesObstacle(a, b, box, 0),
  }
  const route = [[0, 0], [1, 0], [1, 1]]
  assert.equal(nav.free([.925, .075]), false, 'the original 300mm corner curve is obstructed')
  const rounded = roundedWalkingPath(route, nav)
  assert.ok(rounded.length > route.length, 'a smaller safe radius should retain a rounded turn')
  assert.deepEqual(rounded[0], route[0])
  assert.deepEqual(rounded.at(-1), route.at(-1))
  for (let i = 1; i < rounded.length; i++) assert.ok(nav.segment(rounded[i - 1], rounded[i]))
})

test('frame sampling preserves obstacle clearance and floor support while catching up across corners', () => {
  const box = { min: [0, 0, .15], max: [.85, 1, 1] }
  const nav = { segment: (from: number[], to: number[]) => !crossesObstacle(from, to, box) }
  const path = [[0, 0], [1, 0], [1, 1]], lengths = [0, 1, 2]
  assert.equal(nav.segment([.95, 0], [1, .1]), false,
    'both sampled positions are clear but their chord clips the inflated obstacle')
  const corner = safeWalkingSample(path, lengths, .95, 1.1, nav)
  assert.deepEqual(corner.point, [1, 0], 'retain the safe turn before moving beyond it')
  assert.equal(corner.distance, 1)
  const next = safeWalkingSample(path, lengths, corner.distance, 1.2, nav)
  const end = safeWalkingSample(path, lengths, next.distance, 2, nav)
  assert.ok(nav.segment([.95, 0], corner.point))
  assert.ok(nav.segment(corner.point, next.point))
  assert.ok(nav.segment(next.point, end.point))
  assert.ok(next.distance > corner.distance)
  assert.deepEqual(end.point, path.at(-1), 'camera must resume and complete the path')

  const detour = [[0, 0], [0, 2], [2, 2], [2, 1]], distances = [0, 2, 4, 5]
  const obstruction = { min: [.4, 0, .4], max: [1.6, 1, 1.6] }
  const onFloor = ([x, z]: number[]) =>
    (x >= 0 && x <= .05 && z >= 0 && z <= 2) ||
    (x >= 0 && x <= 2 && z >= 1.95 && z <= 2) ||
    (x >= 1.95 && x <= 2 && z >= 1 && z <= 2)
  const floorSegment = (from: number[], to: number[]) => Array.from({ length: 101 }, (_, i) =>
    from.map((n, axis) => n + (to[axis] - n) * i / 100)).every(onFloor)
  for (const space of [
    { segment: (from: number[], to: number[]) => !crossesObstacle(from, to, obstruction) },
    { segment: floorSegment },
  ]) {
    let sample = { point: detour[0], distance: 0 }
    for (const expectedDistance of [2, 4, 5]) {
      const advanced = safeWalkingSample(detour, distances, sample.distance, 5, space)
      assert.equal(advanced.distance, expectedDistance, 'lag must recover from the actual previous position')
      assert.ok(space.segment(sample.point, advanced.point))
      sample = advanced
    }
    assert.deepEqual(sample.point, detour.at(-1), 'multiple safe steps must reach the final point')
  }
})

test('invalid video settings and mismatched resume inputs fail explicitly', () => {
  for (const options of [
    { preset: 'ultra' },
    { seconds: NaN },
    { seconds: 181 },
    { seconds: 0 },
    { fps: 60 },
    { device: 'anything' },
  ])
    assert.throws(() => validateTourOptions(options))
  assert.throws(() => assertResume({ signature: 'old' }, 'new'), /preserved/)
  assert.doesNotThrow(() => assertResume({ signature: 'same' }, 'same'))
})

test('ETA excludes restored frames; completed and paused elapsed time stops', () => {
  const startedAt = '2026-11-15T10:00:00Z',
    now = Date.parse(startedAt) + 10000
  const state = { startedAt, phase: 'rendering', completed: 85, resumedFrames: 80, total: 100 }
  assert.equal(progressSummary(state, now).etaSeconds, 30)
  assert.equal(progressSummary({ ...state, completed: 80 }, now).etaSeconds, null)
  const done = progressSummary(
    { ...state, phase: 'done', completed: 100, finishedAt: '2026-11-15T10:00:20Z' },
    now + 600000,
  )
  assert.equal(done.percent, 100)
  assert.equal(done.elapsedSeconds, 20)
  assert.equal(
    progressSummary({ ...state, phase: 'paused', pausedAt: '2026-11-15T10:00:08Z' }, now)
      .elapsedSeconds,
    8,
  )
  assert.equal(progressSummary({ phase: 'idle' }).elapsedSeconds, 0)
})
