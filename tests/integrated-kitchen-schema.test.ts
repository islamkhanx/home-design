import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parseApartment, validateApartment } from '../src/domain/schema.ts'
import type { Apartment, Entity } from '../src/domain/schema.ts'

const entity = (
  params: Entity['params'] = {},
  kind: Entity['kind'] = 'KitchenCabinet',
): Entity => ({
  id: 'integrated-kitchen-test',
  name: 'Kitchen test',
  kind,
  roomId: 'kitchen',
  position: [950, 0, 3150],
  rotation: [0, 0, 0],
  size: [600, 2850, 600],
  material: 'paint',
  evidence: 'assumed',
  params,
})
function input(e: Entity): Apartment {
  const a = JSON.parse(readFileSync(new URL('../src/data/apartment.json', import.meta.url), 'utf8'))
  a.objects = [e]
  return a
}
const errors = (params: Entity['params'], kind?: Entity['kind']) =>
  validateApartment(input(entity(params, kind)))

test('cabinet niches accept finite nonoverlapping intervals up to the cabinet top', () => {
  const params = {
    cabinetPlinth: 100,
    cabinetTopScribe: 50,
    cabinetTopTier: 500,
    cabinetVoids: [
      { bottom: 0, height: 850 },
      { bottom: 900, height: 600 },
      { bottom: 1500, height: 400 },
    ],
  }
  assert.deepEqual(errors(params), [])
  const a = input(entity(params))
  assert.deepEqual(parseApartment(a).objects[0].params, params)
  // A niche can reach the cabinet top, leaving the worktop as its cover.
  assert.deepEqual(
    errors({ cabinetTopScribe: 50, cabinetVoids: [{ bottom: 2000, height: 800 }] }),
    [],
  )
  assert.ok(errors({ cabinetTopScribe: 50, cabinetVoids: [{ bottom: 2000, height: 801 }] }).length)
  assert.deepEqual(errors({ cabinetVoids: [{ bottom: 0, height: 2850, front: false }] }), [])
  assert.deepEqual(errors({ cabinetVoids: [{ bottom: 0, height: 2850, front: true }] }), [])
})

test('cabinet niches reject invalid, overlapping and noncabinet cavity specifications', () => {
  for (const cabinetVoids of [
    [{ bottom: -1, height: 100 }],
    [{ bottom: 0, height: 0 }],
    [{ bottom: NaN, height: 100 }],
    [{ bottom: 0, height: Infinity }],
    [{ bottom: 100, height: 3000 }],
    [{ bottom: 100, height: 300, front: 'false' }],
    [{ bottom: 100, height: 300, front: null }],
    [
      { bottom: 100, height: 500 },
      { bottom: 599, height: 100 },
    ],
    Array.from({ length: 9 }, (_, i) => ({ bottom: i * 100, height: 50 })),
    [null],
    null,
    {},
  ])
    assert.ok(errors({ cabinetVoids } as Entity['params']).length, JSON.stringify(cabinetVoids))
  assert.ok(errors({ cabinetPlinth: 100, cabinetVoids: [{ bottom: 50, height: 200 }] }).length)
  assert.ok(errors({ cabinetVoids: [{ bottom: 0, height: 500 }] }, 'Table').length)
  assert.deepEqual(errors({ cabinetVoids: [] }, 'Wardrobe'), [])
})

test('plinths preserve positive usable cabinet height and belong to cabinetry or integrated appliances', () => {
  for (const cabinetPlinth of [-1, Infinity, NaN, 2850, '100', null])
    assert.ok(errors({ cabinetPlinth } as Entity['params']).length)
  assert.ok(errors({ cabinetPlinth: 100, cabinetTopScribe: 50, cabinetTopTier: 2700 }).length)
  assert.deepEqual(errors({ cabinetPlinth: 0, cabinetTopScribe: 50, cabinetTopTier: 500 }), [])
  assert.ok(errors({ cabinetPlinth: 100 }, 'Table').length)
  assert.ok(errors({ appliance: 'oven', builtIn: true, cabinetPlinth: 100 }, 'Appliance').length)
})

test('integrated fronts and built-in installations accept only compatible appliance types', () => {
  for (const appliance of ['fridge', 'dishwasher'] as const)
    assert.deepEqual(
      errors({ appliance, integrated: true, builtIn: true, cabinetPlinth: 100 }, 'Appliance'),
      [],
    )
  for (const appliance of ['fridge', 'dishwasher', 'oven', 'microwave'] as const)
    assert.deepEqual(errors({ appliance, builtIn: true }, 'Appliance'), [])
  for (const appliance of ['oven', 'microwave', 'washer'] as const)
    assert.ok(errors({ appliance, integrated: true }, 'Appliance').length)
  assert.ok(errors({ appliance: 'washer', builtIn: true }, 'Appliance').length)
  assert.ok(errors({ appliance: 'fridge', integrated: true }, 'Wardrobe').length)
  assert.ok(errors({ appliance: 'microwave', builtIn: true }, 'KitchenCabinet').length)
  assert.ok(errors({ appliance: 'invalid' } as unknown as Entity['params'], 'Appliance').length)
  for (const key of ['builtIn', 'integrated'] as const)
    for (const value of ['true', 1, null])
      assert.ok(
        errors({ appliance: 'fridge', [key]: value } as Entity['params'], 'Appliance').length,
      )
  assert.deepEqual(errors({ builtIn: false, integrated: false }, 'Table'), [])
})

test('built-in appliance dimensions leave positive body width, depth and plinth clearance', () => {
  for (const [axis, value] of [
    [0, 36],
    [2, 40],
    [1, 100],
  ] as const) {
    const e = entity({ appliance: 'fridge', integrated: true, cabinetPlinth: 100 }, 'Appliance')
    e.size[axis] = value
    assert.ok(validateApartment(input(e)).length)
  }
  const e = entity({ appliance: 'microwave', builtIn: true }, 'Appliance')
  e.size = [600, 450, 550]
  assert.deepEqual(validateApartment(input(e)), [])
})

test('hinged and sliding door styles belong only to cabinets', () => {
  for (const kind of ['KitchenCabinet', 'Wardrobe'] as const)
    for (const cabinetDoorStyle of ['hinged', 'sliding'] as const)
      assert.deepEqual(errors({ cabinetDoorStyle }, kind), [])
  assert.ok(errors({ cabinetDoorStyle: 'sliding' }, 'Appliance').length)
  assert.ok(errors({ cabinetDoorStyle: 'hinged' }, 'Table').length)
  assert.ok(errors({ cabinetDoorStyle: 'folding' } as unknown as Entity['params']).length)
})

test('open cabinet niches optionally retain their backboard with a boolean keepBack flag', () => {
  for (const keepBack of [true, false])
    assert.deepEqual(
      errors(
        { cabinetPlinth: 0, cabinetVoids: [{ bottom: 0, height: 2250, keepBack }] },
        'Wardrobe',
      ),
      [],
    )
  for (const keepBack of ['true', 1, null])
    assert.ok(
      errors(
        { cabinetVoids: [{ bottom: 0, height: 2250, keepBack }] } as unknown as Entity['params'],
        'Wardrobe',
      ).length,
    )
})
