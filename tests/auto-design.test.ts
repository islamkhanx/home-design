import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { applyGeneratedInteriors } from '../src/domain/auto-design.ts'
import { parseApartment } from '../src/domain/schema.ts'
import type { Entity } from '../src/domain/schema.ts'
import { renderNotice } from '../src/scene/provenance.ts'
const seed = () =>
  parseApartment(
    JSON.parse(readFileSync(new URL('../src/data/apartment.json', import.meta.url), 'utf8')),
  )
const proposal = (): Entity => ({
  id: 'test-table',
  name: 'Test',
  kind: 'Table',
  roomId: 'bathroom',
  position: [900, 0, 1200],
  size: [300, 400, 300],
  rotation: [0, 0, 0],
  material: 'oak',
  evidence: 'assumed',
})

test('source plan has all rooms with source attribution and explicit scale, not measured lengths', () => {
  const a = seed()
  assert.equal(a.rooms.filter((r) => r.polygon).length, 6)
  assert.equal(a.sourcePlan?.referenceLengthMm, 2400)
  assert.equal(a.sourcePlan?.referencePixels, 204)
  assert.equal(
    a.rooms.some((r) => r.generated),
    false,
  )
  assert.equal(
    a.objects.some(
      (o) => o.generated && ['Wall', 'Floor', 'Ceiling', 'Door', 'Window'].includes(o.kind),
    ),
    false,
  )
  assert.ok(a.objects.every((o) => o.params?.group !== 'night'))
  assert.match(renderNotice(a, 'all')[1], /масштаб по окну/)
  assert.match(renderNotice(a, 'bathroom')[0], /выбранная композиция/)
})

test('interior proposals preserve architecture, decisions and source; application is repeatable', () => {
  const a = seed(),
    original = structuredClone(a),
    p = proposal(),
    b = applyGeneratedInteriors(a, [p])
  assert.deepEqual(a, original)
  assert.deepEqual(b.rooms, a.rooms)
  assert.deepEqual(
    b.objects.filter((o) => o.id !== p.id),
    a.objects,
  )
  assert.deepEqual(applyGeneratedInteriors(b, [p]), b)
  assert.match(renderNotice(b, 'bathroom')[0], /Интерьер сгенерирован/)
})

test('furnishing cannot generate architecture or place objects in rooms without source polygons', () => {
  const a = seed()
  delete a.rooms.find((r) => r.id === 'bedroom')!.polygon
  const wall = a.objects.find((o) => o.kind === 'Wall')!
  assert.throws(() => applyGeneratedInteriors(a, [wall]), /не может менять стены/)
  assert.throws(
    () => applyGeneratedInteriors(a, [{ ...proposal(), roomId: 'bedroom' }]),
    /Нет исходной геометрии/,
  )
  assert.throws(
    () => applyGeneratedInteriors(a, [{ ...proposal(), position: [0, 0, 0] }]),
    /за контур/,
  )
  assert.throws(
    () => applyGeneratedInteriors(a, [{ ...proposal(), position: [900, 2900, 1200] }]),
    /за высоту/,
  )
  a.rooms[0].generated = true
  assert.throws(() => applyGeneratedInteriors(a, []), /архитектура отозвана/)
})

import { restoreSourcePlan, SOURCE_RINGS, planPoint } from '../src/domain/source-plan.ts'
import { generateElectrical } from '../src/domain/electrical.ts'
import { generateSourceInteriors } from '../src/domain/interior-preset.ts'
import { polygonArea } from '../src/domain/math.ts'
const bathroom = JSON.parse(
  readFileSync(new URL('../src/data/bathroom-interior.json', import.meta.url), 'utf8'),
)
test('regeneration is deterministic and furnishings cannot change traced architecture', () => {
  const source = restoreSourcePlan(seed(), bathroom),
    generated = generateElectrical(generateSourceInteriors(source))
  assert.deepEqual(generated, seed())
  assert.deepEqual(generateElectrical(generateSourceInteriors(generated)), generated)
  assert.deepEqual(generated.rooms, source.rooms)
  assert.deepEqual(
    generated.objects.filter((o) => !o.generated),
    source.objects,
  )
  for (const r of source.rooms) assert.deepEqual(r.polygon, SOURCE_RINGS[r.id].map(planPoint))
})
test('source adjacency, window scale and model quantities agree without fitting to room areas', () => {
  const a = seed(),
    room = (id: string) => a.rooms.find((r) => r.id === id)!
  assert.ok(
    Math.max(...room('loggia').polygon!.map((p) => p[1])) <
      Math.min(...room('bedroom').polygon!.map((p) => p[1])),
  )
  assert.ok(
    Math.max(...room('hall').polygon!.map((p) => p[0])) >
      Math.max(...room('living').polygon!.map((p) => p[0])),
  )
  assert.ok(room('bedroom').polygon!.length > 4, 'bedroom has the source recess around bathroom')
  assert.equal(
    a.objects.some(
      (o) => o.kind === 'Wall' && o.roomId === 'kitchen' && o.sharedWith?.includes('living'),
    ),
    false,
  )
  for (const id of ['window-courtyard', 'window-living'])
    assert.equal(a.objects.find((o) => o.id === id)!.size[0], 2400)
  assert.equal(a.objects.find((o) => o.id === 'door-entry')!.size[0], 1050)
  for (const id of ['door', 'door-bedroom', 'door-entry'])
    assert.equal(a.objects.find((o) => o.id === id)!.size[1], 2300)
  assert.notEqual(polygonArea(room('bathroom').polygon!) / 1e6, room('bathroom').documentedArea)
})
