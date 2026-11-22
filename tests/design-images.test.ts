import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, writeFile, mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import * as T from 'three'
import { parseApartment } from '../src/domain/schema.ts'
import type { Entity } from '../src/domain/schema.ts'
import { buildCanonical, geometryManifest, disposeTree } from '../src/scene/canonical.ts'
import { wallFaceForRoom, wallMaterialForRoom } from '../src/domain/wall-finishes.ts'
import { createDesignVariant, geometryFingerprint, validateDesignOptions, parseDesignArgs, generateDesignImages, importDesignConcept } from '../scripts/design-images.mjs'
import { designService } from '../scripts/design-service.mjs'
const seed = async () => parseApartment(JSON.parse(await readFile(new URL('../src/data/apartment.json', import.meta.url), 'utf8')))

test('design alternatives are isolated material copies with identical canonical mesh bounds and triangle counts', async () => {
  const source = await seed(), before = JSON.stringify(source)
  const { apartment: changed } = createDesignVariant(source, 'living', 'warm')
  assert.equal(JSON.stringify(source), before)
  assert.equal(geometryFingerprint(changed), geometryFingerprint(source))
  assert.deepEqual(changed.objects.filter((o: Entity) => o.roomId !== 'living'), source.objects.filter(o => o.roomId !== 'living'))
  assert.deepEqual(changed.materials.slice(0, source.materials.length), source.materials)
  const base = await buildCanonical(source), variation = await buildCanonical(changed)
  try {
    assert.deepEqual(geometryManifest(variation), geometryManifest(base))
    const baseMeshes = new Map<string, T.Mesh>()
    base.traverse(o => { if (o instanceof T.Mesh) baseMeshes.set(o.name, o) })
    let changedCount = 0
    variation.traverse(o => {
      if (!(o instanceof T.Mesh) || Array.isArray(o.material)) return
      const old = baseMeshes.get(o.name)!
      if (Array.isArray(old.material)) return
      if (o.material.name !== old.material.name) {
        changedCount++
        assert.equal(o.userData.roomId, 'living')
        assert.ok(o.material.name.startsWith('design-living-warm-'))
      }
    })
    assert.ok(changedCount > 30, `Only ${changedCount} parts changed`)
  } finally { disposeTree(base); disposeTree(variation) }
})

test('bed component fabrics and wood details follow scoped palette aliases', async () => {
  const source = await seed(), { apartment: changed } = createDesignVariant(source, 'bedroom', 'contrast')
  const root = await buildCanonical(changed)
  try {
    const bed = root.children.find(o => o.userData.entityId === source.objects.find(e => e.kind === 'Bed')!.id)!
    const names = new Set<string>()
    bed.traverse(o => { if (o instanceof T.Mesh && !Array.isArray(o.material)) names.add(o.material.name) })
    assert.ok(names.has('design-bedroom-contrast-linen'))
    assert.ok(names.has('design-bedroom-contrast-rug'))
    assert.ok(names.has('design-bedroom-contrast-sage'))
    assert.equal(names.has('linen'), false)
    assert.equal(names.has('rug'), false)
    const bad = structuredClone(source)
    bad.objects[0].materialOverrides = { linen: 'missing-material' }
    assert.throws(() => parseApartment(bad), /material overrides/)
  } finally { disposeTree(root) }
})

test('room variants recolour only their wall faces, preserving bathroom tile and neighbouring shared faces', async () => {
  const source = await seed(), bedroom = source.rooms.find(r => r.id === 'bedroom')!
  const { apartment: changed, retainedWallFaces } = createDesignVariant(source, 'bedroom', 'warm')
  const partition = changed.objects.find((o: Entity) => o.id === 'wall-north')!
  assert.equal(partition.roomId, 'bathroom', 'room ownership must not hide the bedroom face')
  assert.equal(wallMaterialForRoom(partition, bedroom), 'design-bedroom-warm-paint')
  assert.equal(partition.wall?.materials?.left, 'bathroom-stone')
  assert.equal(partition.wall?.materials?.edge, 'paint')
  assert.equal(geometryFingerprint(changed), geometryFingerprint(source))
  for (const wall of changed.objects.filter((o: Entity) => o.wall)) {
    const before = source.objects.find(o => o.id === wall.id)!
    for (const room of source.rooms.filter(r => r.id !== 'bedroom')) {
      if (wallFaceForRoom(before, room)) assert.equal(wallMaterialForRoom(wall, room), wallMaterialForRoom(before, room), `${wall.id}: changed ${room.id} finish`)
    }
  }
  assert.ok(retainedWallFaces.some((entry: any) => entry.wallId === 'wall-east' && entry.sharedWith.includes('hall')))
  const base = await buildCanonical(source), variation = await buildCanonical(changed)
  try { assert.deepEqual(geometryManifest(variation), geometryManifest(base)) }
  finally { disposeTree(base); disposeTree(variation) }
})

test('confirmed bathroom is immutable and unknown or duplicate alternatives are rejected', async () => {
  const source = await seed()
  assert.deepEqual(createDesignVariant(source, 'bathroom', 'current').apartment, source)
  assert.throws(() => createDesignVariant(source, 'bathroom', 'warm'), /защищена/)
  assert.throws(() => createDesignVariant(source, 'missing-room', 'current'), /геометрией/)
  assert.throws(() => validateDesignOptions({ room: 'living', variants: ['current', 'current'], preset: 'preview', device: 'auto' }, source), /разных/)
  assert.throws(() => validateDesignOptions({ room: 'living', variants: ['current'], preset: 'unbounded', device: 'auto' }, source), /настройки/)
  const options = parseDesignArgs(['--room', 'bathroom'])
  assert.ok('variants' in options)
  assert.deepEqual(options.variants, ['current'])
  assert.throws(() => parseDesignArgs(['--unsafe']), /параметр/)
})

test('schema preparation produces plans, all room elevations and AI brief without claiming an image was rendered', async () => {
  const output = await mkdtemp(path.join(tmpdir(), 'design-pipeline-test-'))
  try {
    const result = await generateDesignImages({ room: 'living', variants: ['current', 'warm'], preset: 'preview', device: 'cpu', output, prepareOnly: true })
    assert.equal(result.status, 'prepared'); assert.equal(result.completed, 0)
    assert.equal(result.items[0].image, undefined)
    const source = JSON.parse(await readFile(path.join(output, 'source-apartment.json'), 'utf8'))
    assert.equal(result.sourceGeometryHash, geometryFingerprint(source))
    const warm = JSON.parse(await readFile(path.join(output, 'warm/variant-apartment.json'), 'utf8'))
    assert.equal(geometryFingerprint(warm), geometryFingerprint(source))
    assert.match(await readFile(path.join(output, 'warm/plan.svg'), 'utf8'), /data-room-id="living"/)
    const count = source.rooms.find((r: any) => r.id === 'living').polygon.length
    assert.equal(result.items[1].elevations.length, count)
    assert.match(await readFile(path.join(output, `warm/elevation-${count}.svg`), 'utf8'), /<svg/)
    const prompt = await readFile(path.join(output, 'warm/prompt.txt'), 'utf8')
    assert.match(prompt, /not verified measurements/)
    assert.match(prompt, /not.*approved design/)
    assert.match(prompt, /No boiler, underfloor heating or night lighting/)
  } finally { await rm(output, { recursive: true, force: true }) }
})

test('imported AI concept stays separate from the checked reference and explicitly lacks geometry verification', async () => {
  const output = await mkdtemp(path.join(tmpdir(), 'design-concept-test-'))
  try {
    await mkdir(path.join(output, 'current'))
    const reference = Buffer.from('immutable-reference')
    await writeFile(path.join(output, 'current/render.png'), reference)
    await writeFile(path.join(output, 'manifest.json'), JSON.stringify({ status: 'done', sourceHash: 'reference-sha', items: [{ id: 'current', status: 'done', image: 'current/render.png', geometryPassed: true }] }))
    const concept = Buffer.alloc(120); Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(concept)
    await writeFile(path.join(output, 'external.png'), concept)
    await importDesignConcept({ job: output, variant: 'current', image: path.join(output, 'external.png') })
    const state = JSON.parse(await readFile(path.join(output, 'manifest.json'), 'utf8'))
    assert.equal(state.items[0].image, 'current/render.png')
    assert.equal(state.items[0].conceptImage, 'current/concept.png')
    assert.equal(state.items[0].conceptProvenance.geometryVerified, false)
    assert.equal(state.items[0].conceptProvenance.appliedToModel, false)
    assert.deepEqual(await readFile(path.join(output, 'current/render.png')), reference)
    await assert.rejects(importDesignConcept({ job: output, variant: '../current', image: path.join(output, 'external.png') }), /Нет проверенного/)
  } finally { await rm(output, { recursive: true, force: true }) }
})

test('catalog exposes actual rooms and locked bathroom; unknown asset routes never touch arbitrary files', async () => {
  const handler = designService({ env: { BLENDER_PATH: '/no/blender' } })
  let response: any
  const send = (_: unknown, status: number, body: any) => { response = { status, body } }
  await handler({ method: 'GET' }, {}, '/__local/design/catalog', send)
  assert.equal(response.status, 200); assert.equal(response.body.available, false)
  assert.deepEqual(response.body.rooms.find((r: any) => r.id === 'bathroom').allowedVariants, ['current'])
  await handler({ method: 'GET' }, {}, '/__local/design/asset/../../.env', send)
  assert.equal(response.status, 404)
  handler.close()
})

test('real design CLI reaches Blender after headless export and reports failure without a top-level-await import deadlock', { skip: process.platform === 'win32', timeout: 30000 }, async () => {
  const temporary = await mkdtemp(path.join(tmpdir(), 'design-cli-regression-'))
  try {
    // A small genuine canonical scene keeps this a subprocess/module-graph test,
    // while exercising the actual CLI → export → Blender launch path.
    const source = await seed()
    source.objects = source.objects.filter(o => o.roomId === 'living' && o.kind === 'Floor')
    const input = path.join(temporary, 'source.json'), output = path.join(temporary, 'output')
    const blender = path.join(temporary, 'mock-blender')
    await writeFile(input, JSON.stringify(source))
    await writeFile(blender, '#!/bin/sh\necho MOCK_BLENDER_REACHED >&2\nexit 23\n', { mode: 0o755 })
    const result = await new Promise<{ code: number | null; log: string }>((resolve, reject) => {
      const child = spawn(process.execPath, ['--experimental-strip-types', fileURLToPath(new URL('../scripts/design-images.mjs', import.meta.url)),
        '--input', input, '--room', 'living', '--variants', 'current', '--preset', 'preview', '--device', 'cpu', '--output', output],
        { env: { ...process.env, BLENDER_PATH: blender }, stdio: ['ignore', 'pipe', 'pipe'] })
      let log = ''
      child.stdout.on('data', chunk => { log += chunk }); child.stderr.on('data', chunk => { log += chunk })
      child.on('error', reject)
      child.on('close', code => resolve({ code, log }))
    })
    assert.equal(result.code, 1)
    assert.match(result.log, /MOCK_BLENDER_REACHED/)
    assert.doesNotMatch(result.log, /unsettled top-level await/)
    const manifest = JSON.parse(await readFile(path.join(output, 'manifest.json'), 'utf8'))
    assert.equal(manifest.status, 'error')
    assert.equal(manifest.completed, 0)
    assert.equal(manifest.items[0].image, undefined)
    const metadata = JSON.parse(await readFile(path.join(output, 'current/scene.metadata.json'), 'utf8'))
    assert.ok(metadata.geometry.length > 0)
  } finally { await rm(temporary, { recursive: true, force: true }) }
})
