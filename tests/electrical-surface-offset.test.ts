import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parseApartment, validateApartment } from '../src/domain/schema.ts'
import type { Apartment } from '../src/domain/schema.ts'

const seed = (): Apartment =>
  JSON.parse(readFileSync(new URL('../src/data/apartment.json', import.meta.url), 'utf8'))

test('electrical surface offset is optional and accepts 0 through 500 mm', () => {
  const a = seed(),
    e = a.objects.find((o) => o.id === 'E03')!
  delete e.electrical!.surfaceOffset
  assert.deepEqual(validateApartment(a), [])
  assert.equal(
    parseApartment(a).objects.find((o) => o.id === e.id)!.electrical!.surfaceOffset,
    undefined,
  )
  for (const surfaceOffset of [0, 8, 123.5, 500]) {
    e.electrical!.surfaceOffset = surfaceOffset
    assert.deepEqual(validateApartment(a), [])
    assert.equal(
      parseApartment(a).objects.find((o) => o.id === e.id)!.electrical!.surfaceOffset,
      surfaceOffset,
    )
  }
})

test('electrical surface offset rejects invalid types and distances', () => {
  for (const surfaceOffset of [-1, 500.01, NaN, Infinity, -Infinity, '10', null, false]) {
    const a = seed(),
      e = a.objects.find((o) => o.id === 'E03')!
    e.electrical!.surfaceOffset = surfaceOffset as number
    assert.ok(
      validateApartment(a).some((error) => error.includes('electrical surface offset')),
      String(surfaceOffset),
    )
    assert.throws(() => parseApartment(a), /electrical surface offset/)
  }
})

test('schema preserves points displaced toward their finish surface without imposing the old wall plane', () => {
  const a = seed(),
    e = a.objects.find((o) => o.id === 'E03')!,
    p = e.electrical!
  const wall = a.objects.find((o) => o.id === p.wallId)!.wall!
  const dx = wall.end[0] - wall.start[0],
    dz = wall.end[1] - wall.start[1],
    length = Math.hypot(dx, dz)
  p.surfaceOffset = 58
  const normalDistance = wall.thickness / 2 + e.size[2] / 2 + 1 + p.surfaceOffset
  e.position[0] = wall.start[0] + (dx / length) * p.offset - (dz / length) * p.side * normalDistance
  e.position[2] = wall.start[1] + (dz / length) * p.offset + (dx / length) * p.side * normalDistance
  const parsed = parseApartment(a).objects.find((o) => o.id === e.id)!
  assert.deepEqual(parsed.position, e.position)
  assert.equal(parsed.electrical!.surfaceOffset, 58)
})
