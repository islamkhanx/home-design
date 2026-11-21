import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import type { Apartment, Entity } from '../src/domain/schema.ts'
import type { V2 } from '../src/domain/math.ts'
import { parseApartment } from '../src/domain/schema.ts'
import { pointInPolygon } from '../src/domain/math.ts'
import { apartmentPlanSvg, roomCornersSvg, roomElevationSvg, roomSwitchingSvg, roomTileFloorSvg } from '../src/domain/studio-drawings.ts'

const apartment = parseApartment(JSON.parse(readFileSync(new URL('../src/data/apartment.json', import.meta.url), 'utf8')))
function fixture(polygon: V2[]): Apartment {
  return { schemaVersion: 1, id: 'test', name: 'Test', revision: 1, units: 'mm', documentedArea: 999,
    rooms: [{ id: 'room', name: 'Комната', documentedArea: 999, evidence: 'assumed', note: '', polygon, height: 3000 }],
    materials: [{ id: 'finish', name: 'Покрытие из модели', color: '#dad6ca', roughness: 1, metalness: 0 }], notes: [], objects: [] }
}
function entity(id: string, kind: Entity['kind'], overrides: Partial<Entity> = {}): Entity {
  return { id, name: id, kind, roomId: 'room', position: [0, 0, 0], rotation: [0, 0, 0], size: [100, 100, 100], material: 'finish', evidence: 'assumed', ...overrides }
}
function svgPolygon(svg: string, attribute: string, value: string): V2[] {
  const tag = [...svg.matchAll(/<polygon\b[^>]*>/g)].map(match => match[0]).find(tag => tag.includes(`${attribute}="${value}"`))
  assert.ok(tag, `${attribute}=${value}`)
  return tag.match(/points="([^"]+)"/)![1].split(' ').map(pair => pair.split(',').map(Number) as V2)
}
function span(points: V2[], axis: number) { const values = points.map(p => p[axis]); return Math.max(...values) - Math.min(...values) }

test('all studio diagrams use finite native-PDF primitives and preserve user text escaping', () => {
  const a = structuredClone(apartment)
  a.rooms[0].name = '<img onerror="bad">'
  const diagrams = [
    ...(['architecture', 'furniture', 'floors', 'openings', 'plumbing', 'decor'] as const).map(layer => apartmentPlanSvg(a, layer)),
    ...a.rooms.flatMap(r => [roomCornersSvg(a, r.id), roomSwitchingSvg(a, r.id), roomTileFloorSvg(a, r.id, [600, 600]), ...(r.polygon ?? []).map((_, i) => roomElevationSvg(a, r.id, i))]),
  ]
  for (const svg of diagrams) {
    assert.ok(svg.includes('viewBox="0 0 820 660"'))
    assert.doesNotMatch(svg, /NaN|Infinity|<img/)
    for (const match of svg.matchAll(/<([a-zA-Z][\w:-]*)\b/g)) assert.ok(['svg', 'rect', 'circle', 'line', 'polygon', 'text'].includes(match[1]), match[1])
    assert.match(svg, /НЕ ДЛЯ ПРОИЗВОДСТВА РАБОТ/)
  }
  assert.ok(roomCornersSvg(a, a.rooms[0].id).includes('&lt;img'))
})

test('floor finishes use actual slab area minus holes, never documented room area', () => {
  const a = fixture([[0, 0], [4000, 0], [4000, 3000], [0, 3000]])
  a.objects.push(entity('floor', 'Floor', { surface: { polygon: a.rooms[0].polygon!, holes: [[[1000, 1000], [2000, 1000], [2000, 2000], [1000, 2000]]], thickness: 70 } }))
  const svg = apartmentPlanSvg(a, 'floors')
  assert.ok(svg.includes('data-area-m2="11"'))
  assert.ok(svg.includes('11 м²'))
  assert.ok(svg.includes('Покрытие из модели'))
  a.rooms[0].documentedArea = 12345
  a.documentedArea = 99999
  assert.equal(apartmentPlanSvg(a, 'floors'), svg)
})

test('tile grid is clipped to a concave floor and excludes holes', () => {
  const outer: V2[] = [[0, 0], [3000, 0], [3000, 1200], [1200, 1200], [1200, 3000], [0, 3000]]
  const hole: V2[] = [[300, 300], [900, 300], [900, 900], [300, 900]]
  const a = fixture(outer)
  a.objects.push(entity('floor', 'Floor', { surface: { polygon: outer, holes: [hole], thickness: 70 } }))
  const svg = roomTileFloorSvg(a, 'room', [600, 600])
  const segments = [...svg.matchAll(/data-model-start="([^"]+)" data-model-end="([^"]+)"/g)].map(m => [m[1].split(',').map(Number), m[2].split(',').map(Number)] as [V2, V2])
  assert.ok(segments.length > 5)
  assert.ok(segments.some(([p, q]) => p.join(',') === '600,0' && q.join(',') === '600,300'))
  assert.ok(segments.some(([p, q]) => p.join(',') === '600,900' && q.join(',') === '600,3000'))
  assert.ok(segments.some(([p, q]) => p.join(',') === '1800,0' && q.join(',') === '1800,1200'))
  for (const [p, q] of segments) {
    const middle: V2 = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2]
    assert.ok(pointInPolygon(middle, outer))
    assert.ok(!pointInPolygon(middle, hole))
  }
  assert.match(svg, /не карта реза/)
})

test('room elevations transform host openings and adjacent objects and do not invent open walls', () => {
  const a = fixture([[1000, 2000], [3000, 2000], [3000, 4000], [1000, 4000]])
  a.objects.push(entity('rotated-wall', 'Wall', { position: [1000, 0, 4000], rotation: [0, 90, 0], wall: { start: [0, 0], end: [2000, 0], thickness: 100, height: 3000, openings: [{ id: 'known-opening', kind: 'window', offset: 500, width: 700, bottom: 100, height: 2000 }] } }))
  a.objects.push(entity('nearby-cabinet', 'Wardrobe', { position: [1210, 0, 3000], rotation: [0, 90, 0], size: [600, 800, 400] }))
  a.objects.push(entity('distant-cabinet', 'Wardrobe', { position: [2500, 0, 3000], size: [200, 800, 400] }))
  const svg = roomElevationSvg(a, 'room', 3)
  const wall = svgPolygon(svg, 'data-wall-id', 'rotated-wall'), opening = svgPolygon(svg, 'data-opening-id', 'known-opening')
  assert.ok(Math.abs(span(opening, 0) / span(wall, 0) - 700 / 2000) < 0.001)
  assert.ok(Math.abs(span(opening, 1) / span(wall, 1) - 2000 / 3000) < 0.001)
  assert.ok(Math.abs((Math.min(...opening.map(p => p[0])) - Math.min(...wall.map(p => p[0]))) / span(wall, 0) - 500 / 2000) < 0.001)
  const cabinet = svgPolygon(svg, 'data-object-id', 'nearby-cabinet')
  assert.ok(Math.abs(span(cabinet, 0) / span(wall, 0) - 600 / 2000) < 0.001)
  assert.ok(!svg.includes('data-object-id="distant-cabinet"'))
  assert.ok(svg.includes('room-C4 → room-C1'))
  const open = roomElevationSvg(a, 'room', 0)
  assert.ok(open.includes('Открытая граница'))
  assert.ok(!open.includes('data-wall-id'))
})

test('opening plan uses host geometry rather than attached object placeholder position', () => {
  const a = fixture([[0, 0], [3000, 0], [3000, 3000], [0, 3000]])
  a.objects.push(entity('wall', 'Wall', { wall: { start: [0, 0], end: [3000, 0], thickness: 100, height: 3000, openings: [{ id: 'door', kind: 'door', offset: 500, width: 900, bottom: 0, height: 2100 }] } }))
  a.objects.push(entity('door', 'Door', { attach: { wallId: 'wall', openingId: 'door' }, position: [999999, 0, 999999] }))
  const first = apartmentPlanSvg(a, 'openings')
  a.objects[1].position = [-999999, 0, -999999]
  assert.equal(apartmentPlanSvg(a, 'openings'), first)
  assert.ok(first.includes('900 × 2100'))
})

test('plumbing overview includes the hygienic shower without counting its washer cabinet as another appliance', () => {
  const svg = apartmentPlanSvg(apartment, 'plumbing')
  assert.ok(svg.includes('data-object-id="washer"'))
  assert.ok(svg.includes('data-object-id="hygienic-shower"'))
  assert.ok(!svg.includes('data-object-id="laundry-tower"'))
  assert.ok(svg.includes('Выводы, трассы и диаметры не назначены'))
})

test('switching uses actual controls and includes the bathroom switch outside its room', () => {
  const svg = roomSwitchingSvg(apartment, 'bathroom')
  const s = apartment.objects.find(o => o.id === 'S01')!
  assert.equal(s.roomId, 'hall')
  assert.ok(svg.includes('Коридор · снаружи'))
  assert.ok(!svg.includes('назначение клавиш'))
  for (const id of s.electrical!.controls) assert.ok(svg.includes(`data-switch-id="S01" data-target-id="${id}"`))
  const a = structuredClone(apartment)
  a.objects.find(o => o.id === 'S01')!.electrical!.controls = ['spot-0']
  const updated = roomSwitchingSvg(a, 'bathroom')
  assert.ok(updated.includes('data-target-id="spot-0"'))
  assert.ok(!updated.includes('data-target-id="mirror-light-0"'))
  assert.ok(updated.includes('Управление не задано'))
})

test('corner labels are stable and absent geometry or invalid grid dimensions stay explicit', () => {
  for (const room of apartment.rooms) {
    const svg = roomCornersSvg(apartment, room.id)
    room.polygon?.forEach((_, i) => assert.ok(svg.includes(`data-corner-id="${room.id}-C${i + 1}"`)))
  }
  for (const svg of [roomCornersSvg(apartment, 'missing'), roomElevationSvg(apartment, 'bathroom', 99), roomTileFloorSvg(apartment, 'bathroom', [0, 600])]) {
    assert.doesNotMatch(svg, /NaN|Infinity/)
    assert.match(svg, /Нет геометрии|не задан/)
  }
})
