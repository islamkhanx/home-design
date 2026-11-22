import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, mkdtempSync, writeFileSync, rmSync, linkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import type { Apartment } from '../src/domain/schema.ts'
import type { ReviewProfile } from '../src/review/profile.ts'
import { reviewApartment } from '../src/review/review.ts'
import { homeReviewProfile } from '../src/review/home-profile.ts'
import { parseReviewArgs } from '../scripts/review-geometry.mjs'

const project = fileURLToPath(new URL('..', import.meta.url))
const cli = path.join(project, 'scripts/review-geometry.mjs')
const seed = (): Apartment =>
  JSON.parse(readFileSync(new URL('../src/data/apartment.json', import.meta.url), 'utf8'))
const run = (...args: string[]) =>
  spawnSync(process.execPath, ['--experimental-strip-types', cli, ...args], {
    cwd: project,
    encoding: 'utf8',
    timeout: 30_000,
  })

test('integrated home review exposes full declared coverage and unresolved warnings without mutating source/profile', async () => {
  const apartment = seed(),
    before = structuredClone(apartment),
    profile = structuredClone(homeReviewProfile)
  const report = await reviewApartment(apartment, profile)
  assert.equal(report.status, 'review-required')
  assert.equal(report.errors, 0)
  assert.equal(report.warnings, 6)
  assert.equal(report.findings.length, 6)
  assert.ok(report.findings.every((f) => f.rule === 'attachment.access-review'))
  assert.equal(report.coverage.rooms, 6)
  assert.equal(report.coverage.electricalPoints, 23)
  assert.equal(report.coverage.walls, 18)
  assert.equal(report.coverage.declaredPlacementRelations, homeReviewProfile.placement.length)
  assert.equal(report.coverage.motions.plans, homeReviewProfile.motions!.length)
  assert.equal(report.coverage.motions.movingParts, 43)
  assert.equal(report.coverage.motions.sampledPoses, 1450)
  assert.equal(report.coverage.navigation!.roomTargets, 6)
  assert.equal(report.coverage.navigation!.activityTargets, 17)
  assert.equal(report.navigation!.length, 23)
  assert.ok(
    report.navigation!.every(
      (target) => target.status === 'reachable' && target.routeMm!.length >= 2,
    ),
  )
  assert.ok(report.manualReview.some((note) => note.includes('Washer installation:') && note.includes('640 mm')))
  assert.deepEqual(apartment, before)
  assert.deepEqual(profile, homeReviewProfile)
})

test('regressing console length is reported from supplied geometry and is never silently repaired by regeneration', async () => {
  const apartment = seed(),
    consoleEntity = apartment.objects.find((e) => e.id === 'auto-living-ТВ-тумба')!
  consoleEntity.size[0] = 1600
  const before = structuredClone(apartment)
  const report = await reviewApartment(apartment, homeReviewProfile)
  assert.ok(
    report.findings.some(
      (f) => f.rule === 'placement.intersection' && f.entityIds.includes(consoleEntity.id),
    ),
  )
  assert.ok(
    report.warnings > 6,
    'rounded furniture intersections remain explicit review candidates',
  )
  assert.notEqual(report.status, 'passed')
  assert.deepEqual(apartment, before)
})

test('putting fridge back into the oven column produces sampled motion findings against the supplied model', async () => {
  const apartment = seed(),
    fridge = apartment.objects.find((e) => e.id === 'auto-kitchen-Холодильник')!
  fridge.position[2] = 5550
  const report = await reviewApartment(apartment, homeReviewProfile)
  assert.ok(
    report.findings.some(
      (f) => f.rule === 'motion.intersection' && f.entityIds.includes(fridge.id),
    ),
  )
  assert.equal(fridge.position[2], 5550)
})

test('missing entities in every declared relation type produce errors and incorrect front counts cannot silently reduce coverage', async () => {
  const apartment = seed()
  const profile: ReviewProfile = {
    id: 'missing-reference-test',
    apartmentId: apartment.id,
    placement: [
      { id: 'missing-pair', kind: 'separate', left: 'absent-left', right: 'absent-right' },
    ],
    motions: [{ entityId: 'absent-moving', kind: 'pullout', distanceMm: 100 }],
    navigation: {
      startMm: [4350, 1500],
      includeRoomCameras: false,
      targets: [{ id: 'missing-target', entityId: 'absent-target', positionMm: [4350, 1500] }],
    },
  }
  const report = await reviewApartment(apartment, profile)
  for (const rule of [
    'placement.missing-entity',
    'motion.missing-entity',
    'navigation.missing-entity',
  ])
    assert.ok(
      report.findings.some((f) => f.rule === rule && f.severity === 'error'),
      rule,
    )
  assert.equal(report.status, 'failed')
  const incomplete = structuredClone(homeReviewProfile)
  const cabinet = incomplete.motions!.find((plan) => plan.kind === 'cabinet')!
  if (cabinet.kind !== 'cabinet') throw new Error('Test profile needs a cabinet')
  cabinet.hinges.pop()
  const missingFront = await reviewApartment(apartment, incomplete)
  assert.ok(
    missingFront.findings.some(
      (f) => f.rule === 'motion.front-coverage' && f.entityIds.includes(cabinet.entityId),
    ),
  )
})

test('profile identity is checked and an unprofiled review explicitly declares omitted coverage', async () => {
  const apartment = seed()
  await assert.rejects(
    reviewApartment(apartment, { ...homeReviewProfile, apartmentId: 'another-apartment' }),
    /different apartment/,
  )
  const report = await reviewApartment(apartment)
  assert.equal(report.profile, null)
  assert.equal(report.coverage.declaredPlacementRelations, 0)
  assert.equal(report.coverage.motions.plans, 0)
  assert.equal(report.coverage.navigation, null)
  assert.ok(report.limits.some((limit) => limit.includes('No project profile')))
})

test('review CLI validates options and help does not require an apartment file', () => {
  for (const args of [
    ['--wat'],
    ['--input'],
    ['--profile', 'unknown'],
    ['--output', '--json'],
    ['--input', '/tmp/same.json', '--output', '/tmp/same.json'],
  ])
    assert.throws(() => parseReviewArgs(args), args.join(' '))
  const help = run('--help', '--input', '/tmp/this-apartment-does-not-exist.json')
  assert.equal(help.status, 0, help.stderr)
  assert.match(help.stdout, /Usage:/)
  const invalid = run('--unknown-flag')
  assert.equal(invalid.status, 2)
  assert.match(invalid.stderr, /Unknown review argument/)
})

test('CLI JSON/report preserve the source bytes and strict mode fails on unresolved warnings', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'home-review-runner-'))
  try {
    const input = path.join(directory, 'input.json'),
      output = path.join(directory, 'nested', 'report.json')
    const bytes = JSON.stringify(seed(), null, 2) + '\n'
    writeFileSync(input, bytes)
    const result = run('--input', input, '--profile', 'none', '--json', '--output', output)
    assert.equal(result.status, 0, result.stderr)
    const report = JSON.parse(result.stdout)
    assert.equal(report.sourceHash, createHash('sha256').update(bytes).digest('hex'))
    assert.equal(report.errors, 0)
    assert.equal(report.warnings, 6)
    assert.equal(report.profile, null)
    assert.deepEqual(JSON.parse(readFileSync(output, 'utf8')), report)
    assert.equal(readFileSync(input, 'utf8'), bytes)
    const strict = run('--input', input, '--profile', 'none', '--json', '--strict')
    assert.equal(strict.status, 1, strict.stderr)
    assert.equal(JSON.parse(strict.stdout).warnings, 6)
    assert.equal(readFileSync(input, 'utf8'), bytes)
    writeFileSync(input, '{broken json')
    const invalid = run('--input', input, '--profile', 'none', '--json')
    assert.equal(invalid.status, 2)
    assert.equal(invalid.stdout, '')
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('review output cannot overwrite source through a hardlink alias', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'home-review-hardlink-'))
  try {
    const input = path.join(directory, 'input.json'),
      alias = path.join(directory, 'alias.json')
    const bytes = JSON.stringify(seed())
    writeFileSync(input, bytes)
    linkSync(input, alias)
    const result = run('--input', input, '--profile', 'none', '--output', alias, '--json')
    assert.equal(result.status, 2, 'read-only review must reject the same inode under another path')
    assert.match(result.stderr, /overwrite|same file/i)
    assert.equal(readFileSync(input, 'utf8'), bytes)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
