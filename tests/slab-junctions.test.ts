import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import * as T from 'three'
import { stitchSlabJunctions } from '../src/domain/slab-junctions.ts'
import { parseApartment } from '../src/domain/schema.ts'
import type { Entity } from '../src/domain/schema.ts'
import { pointInPolygon, polygonArea, selfIntersects } from '../src/domain/math.ts'
import type { V2 } from '../src/domain/math.ts'
import { createEntity } from '../src/scene/components.ts'

function sourceSlabs() {
  const a = parseApartment(
    JSON.parse(readFileSync(new URL('../src/data/apartment.json', import.meta.url), 'utf8')),
  )
  // Start from the trace, even after the generated apartment includes stitching.
  for (const e of a.objects)
    if (['Floor', 'Ceiling'].includes(e.kind))
      e.surface!.polygon = structuredClone(a.rooms.find((r) => r.id === e.roomId)!.polygon!)
  const east = a.objects.find((e) => e.id === 'wall-east')!
  east.sharedWith = [...new Set([...(east.sharedWith ?? []), 'bedroom', 'hall'])]
  return a
}
function raySurfaces(a: ReturnType<typeof sourceSlabs>, kind: 'Floor' | 'Ceiling') {
  const materials = new Map(
    a.materials.map((m) => [m.id, new T.MeshPhysicalMaterial({ side: T.DoubleSide })]),
  )
  const surfaces = a.objects
    .filter((e) => e.kind === kind)
    .map((e) => ({ id: e.id, mesh: createEntity(e, a, materials) }))
  return (point: V2) =>
    surfaces
      .filter(
        (s) =>
          new T.Raycaster(
            new T.Vector3(point[0] / 1000, kind === 'Floor' ? 0.1 : 2.9, point[1] / 1000),
            new T.Vector3(0, -1, 0),
            0,
            0.2,
          ).intersectObject(s.mesh, true).length,
      )
      .map((s) => s.id)
}

test('paired floor finishes cover three internal door thresholds and meet only at the wall axis', () => {
  const a = sourceSlabs(),
    before = raySurfaces(a, 'Floor'),
    b = stitchSlabJunctions(a),
    after = raySurfaces(b, 'Floor')
  for (const id of ['wall-east', 'source-bedroom-entry', 'source-loggia-access']) {
    const w = a.objects.find((e) => e.id === id)!.wall!,
      opening = w.openings.find((o) => o.kind === 'door')!
    const delta: V2 = [w.end[0] - w.start[0], w.end[1] - w.start[1]],
      len = Math.hypot(...delta)
    const along: V2 = [delta[0] / len, delta[1] / len],
      normal: V2 = [-along[1], along[0]]
    for (const fraction of [0.17, 0.49, 0.83]) {
      const u = opening.offset + opening.width * fraction
      const center: V2 = [w.start[0] + along[0] * u, w.start[1] + along[1] * u]
      assert.deepEqual(before(center), [], `${id} had no floor under its doorway`)
      assert.equal(
        b.objects.filter((e) => e.kind === 'Floor' && pointInPolygon(center, e.surface!.polygon))
          .length,
        2,
        `${id}: finishes meet on the axis`,
      )
      assert.ok(after(center).length >= 1, `${id}: the shared mesh edge has no hole`)
      // Sample both halves, including the former 6/9-mm trace-to-face gaps.
      for (const side of [-1, 1])
        for (const distance of [3, w.thickness / 2 - 1, w.thickness / 2 + 2]) {
          const p: V2 = [
            center[0] + normal[0] * distance * side,
            center[1] + normal[1] * distance * side,
          ]
          assert.equal(after(p).length, 1, `${id}: exactly one slab at ${p}`)
        }
    }
  }
  // Windows stay unchanged; the entrance sill ends at the outer jamb face.
  assert.deepEqual(after([1400, -4141]), [])
  for (const x of [4660, 4680, 4709, 4758]) assert.deepEqual(after([x, 1500]), ['source-hall-floor'])
  assert.deepEqual(after([4760, 1500]), [])
})

test('small trace gaps close at wall faces for floors and ceilings without bridging ceilings through lintels', () => {
  const a = sourceSlabs(),
    b = stitchSlabJunctions(a)
  const gaps: V2[] = [
    [1000, -103],
    [3050, 710],
    [1962, 1900],
    [1000, -4244],
    [1850, 2515],
  ]
  for (const kind of ['Floor', 'Ceiling'] as const) {
    const before = raySurfaces(a, kind),
      after = raySurfaces(b, kind)
    for (const p of gaps) {
      assert.deepEqual(before(p), [], `${kind} before ${p}`)
      assert.equal(after(p).length, 1, `${kind} after ${p}`)
    }
  }
  assert.deepEqual(
    raySurfaces(b, 'Ceiling')([1909, 1344]),
    [],
    'lintel occupies this ceiling-level span',
  )
  const livingBefore = a.objects.find(e => e.id === 'source-living-floor')!.surface!.polygon
  const livingAfter = b.objects.find(e => e.id === 'source-living-floor')!.surface!.polygon
  assert.equal(polygonArea(livingAfter) - polygonArea(livingBefore), 600,
    'only the 6 × 100 mm wall-backed slit is closed, not the full open boundary')
  assert.ok(pointInPolygon([1962, 2450], livingAfter))
  assert.ok(!pointInPolygon([1962, 3000], livingAfter), 'open kitchen/living boundary stays in place')
})

test('stitching is pure, idempotent and preserves source room geometry and all non-slab data', () => {
  const a = sourceSlabs(),
    original = structuredClone(a),
    b = stitchSlabJunctions(a)
  assert.deepEqual(a, original)
  assert.deepEqual(b.rooms, original.rooms)
  assert.deepEqual(stitchSlabJunctions(b), b)
  assert.equal(b.objects.filter((e) => e.kind === 'Floor').length, 6)
  assert.equal(b.objects.filter((e) => e.kind === 'Ceiling').length, 6)
  const stripped = (e: Entity) => {
    const copy = structuredClone(e)
    if (['Floor', 'Ceiling'].includes(copy.kind)) copy.surface!.polygon = []
    return copy
  }
  assert.deepEqual(b.objects.map(stripped), original.objects.map(stripped))
  for (const e of b.objects.filter((e) => ['Floor', 'Ceiling'].includes(e.kind))) {
    assert.equal(selfIntersects(e.surface!.polygon), false, e.id)
    for (const p of a.rooms.find((r) => r.id === e.roomId)!.polygon!)
      assert.ok(pointInPolygon(p, e.surface!.polygon), `${e.id} must retain the source room area`)
  }
  parseApartment(b)
})

test('collinear end caps keep bedroom slabs flush at the corrected bathroom butt joints', () => {
  const a = sourceSlabs()
  const north = a.objects.find((e) => e.id === 'wall-north')!.wall!
  const south = a.objects.find((e) => e.id === 'wall-south')!.wall!
  const east = a.objects.find((e) => e.id === 'wall-east')!.wall!
  north.end[0] = 1959
  south.end[0] = 1959
  east.start[1] = 0
  east.end[1] = 2412
  east.openings.find((o) => o.kind === 'door')!.offset = 894
  const b = stitchSlabJunctions(a)
  for (const kind of ['Floor', 'Ceiling'] as const) {
    const rays = raySurfaces(b, kind)
    for (const p of [
      [1962, -50],
      [1962, 200],
      [1962, 690],
    ] as V2[])
      assert.equal(rays(p).length, 1, `${kind} reaches the collinear cap/face at ${p}`)
  }
  assert.deepEqual(stitchSlabJunctions(b), b)
})

test('door stitching follows a rotated wall and declines to bridge floors at different levels', () => {
  const a = sourceSlabs(),
    template = a.objects.find((e) => e.kind === 'Floor')!
  const floor = (id: string, roomId: string, polygon: V2[]): Entity => ({
    ...structuredClone(template),
    id,
    roomId,
    position: [1000, 0, -500],
    rotation: [0, 31, 0],
    surface: { polygon, thickness: 70 },
  })
  const left = floor('left-floor', 'bedroom', [
    [0, 60],
    [1000, 60],
    [1000, 600],
    [0, 600],
  ])
  const right = floor('right-floor', 'hall', [
    [0, -600],
    [1000, -600],
    [1000, -60],
    [0, -60],
  ])
  const wall: Entity = {
    ...structuredClone(a.objects.find((e) => e.kind === 'Wall')!),
    id: 'rotated-partition',
    roomId: 'bedroom',
    sharedWith: ['hall'],
    position: [1000, 0, -500],
    rotation: [0, 31, 0],
    wall: {
      start: [0, 0],
      end: [1000, 0],
      thickness: 100,
      height: 3000,
      openings: [
        { id: 'door-test', kind: 'door', offset: 200, width: 600, bottom: 0, height: 2300 },
      ],
    },
  }
  a.objects = [left, right, wall]
  const b = stitchSlabJunctions(a)
  for (const e of b.objects.filter((e) => e.kind === 'Floor')) {
    assert.ok(pointInPolygon([500, 0], e.surface!.polygon))
    assert.equal(selfIntersects(e.surface!.polygon), false)
    assert.equal(e.surface!.polygon.length, 8)
  }
  right.position[1] = 30
  const raised = stitchSlabJunctions(a)
  for (const e of raised.objects.filter((e) => e.kind === 'Floor'))
    assert.equal(pointInPolygon([500, 0], e.surface!.polygon), false)
})
