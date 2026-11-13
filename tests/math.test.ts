import test from 'node:test'
import assert from 'node:assert/strict'
import {
  mm,
  meters,
  deg,
  polygonArea,
  pointInPolygon,
  selfIntersects,
  wallCells,
} from '../src/domain/math.ts'
import type { Opening, V2 } from '../src/domain/math.ts'
test('millimeters convert once, including fractional millimeters', () => {
  assert.equal(mm(1700), 1.7)
  assert.deepEqual(meters([1800, 2700, 2470]), [1.8, 2.7, 2.47])
  assert.equal(mm(0.1), 0.0001)
  assert.equal(deg(90), Math.PI / 2)
})
test('shoelace area preserves concave L polygon and winding', () => {
  const p: V2[] = [
    [0, 0],
    [3000, 0],
    [3000, 600],
    [600, 600],
    [600, 1800],
    [0, 1800],
  ]
  assert.equal(polygonArea(p), 2520000)
  assert.equal(polygonArea([...p].reverse()), 2520000)
  assert.equal(pointInPolygon([400, 1500], p), true)
  assert.equal(pointInPolygon([2000, 1500], p), false)
  assert.equal(pointInPolygon([600, 1000], p), true)
})
test('self-crossing footprint rejected; legitimate concavity accepted', () => {
  assert.equal(
    selfIntersects([
      [0, 0],
      [3, 3],
      [0, 3],
      [3, 0],
    ]),
    true,
  )
  assert.equal(
    selfIntersects([
      [0, 0],
      [3, 0],
      [3, 1],
      [1, 1],
      [1, 3],
      [0, 3],
    ]),
    false,
  )
})
test('wall solids leave an actual door void and header', () => {
  const door: Opening = { id: 'd', kind: 'door', offset: 850, width: 900, bottom: 0, height: 2100 }
  const cells = wallCells(2470, 2700, [door])
  assert.equal(
    cells.reduce((s, c) => s + c.width * c.height, 0),
    2470 * 2700 - 900 * 2100,
  )
  assert.equal(
    cells.some((c) => 1300 > c.x && 1300 < c.x + c.width && 1000 > c.y && 1000 < c.y + c.height),
    false,
  )
  assert.equal(
    cells.some((c) => 1300 > c.x && 1300 < c.x + c.width && 2400 > c.y && 2400 < c.y + c.height),
    true,
  )
})
test('overlapping openings subtract their union once', () => {
  const openings: Opening[] = [
    { id: 'a', kind: 'window', offset: 500, width: 1000, bottom: 500, height: 1000 },
    { id: 'b', kind: 'window', offset: 1000, width: 1000, bottom: 1000, height: 1000 },
  ]
  const c = wallCells(3000, 3000, openings)
  assert.equal(
    c.reduce((a, b) => a + b.width * b.height, 0),
    9000000 - 2000000 + 250000,
  )
  for (let i = 0; i < c.length; i++)
    for (let j = i + 1; j < c.length; j++) {
      const a = c[i],
        b = c[j]
      assert.ok(
        Math.min(a.x + a.width, b.x + b.width) <= Math.max(a.x, b.x) ||
          Math.min(a.y + a.height, b.y + b.height) <= Math.max(a.y, b.y),
      )
    }
})
