import test from 'node:test'
import assert from 'node:assert/strict'
import { makeLKitchen } from '../src/domain/kitchen.ts'
import { polygonArea } from '../src/domain/math.ts'
const p = {
  id: 'demo',
  roomId: 'k',
  origin: [0, 0, 0] as [number, number, number],
  longRun: 3000,
  returnRun: 1800,
  depth: 600,
  height: 900,
  counterThickness: 40,
  moduleWidth: 600,
  material: 'oak',
  counterMaterial: 'stone',
  evidence: 'assumed' as const,
}
test('L composition shares corner once and countertop has matching footprint', () => {
  const entities = makeLKitchen(p),
    c = entities.filter((e) => e.kind === 'KitchenCabinet'),
    top = entities.find((e) => e.kind === 'Countertop')!
  assert.equal(c.length, 7)
  assert.equal(
    c.reduce((s, e) => s + e.size[0] * e.size[2], 0),
    2520000,
  )
  assert.equal(polygonArea(top.surface!.polygon), 2520000)
  assert.ok(
    c.filter((e) => e.rotation[1] === 90).every((e) => e.position[2] - e.size[0] / 2 >= 600),
  )
  assert.equal(top.position[1], 900)
})
test('rotating composition transforms all modules with the same origin', () => {
  const base = makeLKitchen(p),
    turned = makeLKitchen({ ...p, origin: [1000, 50, 2000], rotationY: 90 })
  for (let i = 0; i < base.length; i++) {
    assert.ok(Math.abs(turned[i].position[0] - (1000 + base[i].position[2])) < 1e-6)
    assert.ok(Math.abs(turned[i].position[2] - (2000 - base[i].position[0])) < 1e-6)
  }
})
test('invalid kitchen dimensions rejected', () => {
  assert.throws(() => makeLKitchen({ ...p, returnRun: 300 }))
  assert.throws(() => makeLKitchen({ ...p, moduleWidth: 0 }))
})
