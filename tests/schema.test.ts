import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parseApartment, validateApartment, dimensionWarnings } from '../src/domain/schema.ts'
const seed = () =>
  JSON.parse(readFileSync(new URL('../src/data/apartment.json', import.meta.url), 'utf8'))
test('seed validates, does not claim measured lengths', () => {
  const a = parseApartment(seed())
  assert.equal(a.documentedArea, 45.99)
  assert.equal(a.rooms.filter((r) => r.polygon).length, 1)
  assert.ok(a.objects.every((o) => o.evidence === 'assumed'))
  assert.ok(dimensionWarnings(a).length > 0)
})
test('parse clones data; callers cannot silently mutate canonical input', () => {
  const a = seed(),
    b = parseApartment(a)
  b.objects[0].size[0] = 99
  assert.notEqual(a.objects[0].size[0], 99)
})
test('wrong source units and nonfinite coordinates rejected', () => {
  const a = seed()
  a.units = 'm'
  assert.throws(() => parseApartment(a))
  a.units = 'mm'
  a.objects[0].position[0] = NaN
  assert.throws(() => parseApartment(a))
})
test('duplicate object, material and room IDs rejected', () => {
  for (const collection of ['objects', 'materials', 'rooms']) {
    const a = seed()
    a[collection].push(structuredClone(a[collection][0]))
    assert.ok(validateApartment(a).length)
  }
})
test('door outside wall or detached from its opening rejected', () => {
  let a = seed()
  a.objects.find((o: any) => o.wall?.openings.length).wall.openings[0].width = 9000
  assert.throws(() => parseApartment(a))
  a = seed()
  a.objects.find((o: any) => o.attach).attach.openingId = 'missing'
  assert.throws(() => parseApartment(a))
})
test('attached doors inherit transform rather than shifting away from the hole', () => {
  const a = seed()
  a.objects.find((o: any) => o.attach).position = [100, 0, 0]
  assert.throws(() => parseApartment(a))
})
test('invalid polygons and remote texture paths rejected', () => {
  let a = seed()
  a.rooms[0].polygon = [
    [0, 0],
    [100, 100],
    [0, 100],
    [100, 0],
  ]
  assert.throws(() => parseApartment(a))
  a = seed()
  a.materials[0].texture = 'https://example.com/image.png'
  assert.throws(() => parseApartment(a))
})
test('null imported records and excessive light output rejected', () => {
  const a = seed()
  a.objects.push(null)
  assert.ok(validateApartment(a).length)
  a.objects.pop()
  a.objects[0].params = { lumens: Infinity }
  assert.throws(() => parseApartment(a))
})
test('slab accepts interior hole, rejects exterior, touching and overlapping holes', () => {
  const a = seed(),
    f = a.objects.find((o: any) => o.kind === 'Floor')
  f.surface.holes = [
    [
      [100, 100],
      [200, 100],
      [200, 200],
      [100, 200],
    ],
  ]
  assert.doesNotThrow(() => parseApartment(a))
  f.surface.holes.push([
    [150, 150],
    [250, 150],
    [250, 250],
    [150, 250],
  ])
  assert.throws(() => parseApartment(a))
  f.surface.holes = [
    [
      [0, 0],
      [100, 0],
      [100, 100],
      [0, 100],
    ],
  ]
  assert.throws(() => parseApartment(a))
  f.surface.holes = [
    [
      [5000, 0],
      [5100, 0],
      [5100, 100],
      [5000, 100],
    ],
  ]
  assert.throws(() => parseApartment(a))
})
