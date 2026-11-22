import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parseApartment } from '../src/domain/schema.ts'
import { freshDraft, priceLines, estimateLines, estimateTotals } from '../src/domain/estimate.ts'
import { buildDossier, dossierHtml } from '../src/domain/dossier.ts'
import { buildStudioDocuments } from '../src/domain/studio-documents.ts'
import { roomElevationSvg } from '../src/domain/studio-drawings.ts'
import type { Apartment } from '../src/domain/schema.ts'
import { kitchenInteriors } from '../src/domain/kitchen-interior.ts'

const model = parseApartment(JSON.parse(readFileSync(new URL('../src/data/apartment.json', import.meta.url), 'utf8')))
const spec = JSON.parse(readFileSync(new URL('../docs/bathroom-spec.json', import.meta.url), 'utf8'))
const date = '2026-11-21T15:00:00.000Z'

test('kitchen inventory includes integrated appliances, microwave and joinery without counting hood volume as storage', () => {
  const a = structuredClone(model)
  const kitchen = kitchenInteriors(a)
  a.objects = [...a.objects.filter(o => o.roomId !== 'kitchen' || ['Wall', 'Floor', 'Ceiling'].includes(o.kind)), ...kitchen]
  const { sheets } = buildStudioDocuments(a, spec, [])
  const rows = sheets.filter(s => /^ST-kitchen-\d+$/.test(s.id)).flatMap(s => s.table!.rows)
  const row = (name: string) => {
    const found = rows.find(r => r[0] === `auto-kitchen-${name}`)
    assert.ok(found, name)
    return found
  }
  assert.match(row('Холодильник')[3], /за общим мебельным фасадом/)
  assert.match(row('Посудомойка')[3], /за общим мебельным фасадом/)
  assert.match(row('Духовка')[3], /в нише колонны/)
  assert.match(row('Микроволновка')[3], /в нише колонны/)
  assert.match(row('Вытяжка')[3], /Скрытый вкладыш/)
  assert.match(row('Корпус скрытой вытяжки')[3], /не считать полезным хранением/)
  for (const panel of kitchen.filter(o => o.params?.fixture === 'joineryPanel')) assert.ok(rows.some(r => r[0] === panel.id), panel.id)
  assert.equal(new Set(rows.map(r => r[0])).size, rows.length)
})

test('wall schedules and elevations show the finish facing each room across one shared partition', () => {
  const a: Apartment = {
    schemaVersion: 1, id: 'two-rooms', name: 'Two rooms', revision: 1, units: 'mm', documentedArea: 12, notes: [],
    rooms: [
      { id: 'bathroom', name: 'Санузел', documentedArea: 6, evidence: 'assumed', note: '', polygon: [[0, -2000], [3000, -2000], [3000, -50], [0, -50]], height: 3000 },
      { id: 'bedroom', name: 'Спальня', documentedArea: 6, evidence: 'assumed', note: '', polygon: [[0, 50], [3000, 50], [3000, 2000], [0, 2000]], height: 3000 },
    ],
    materials: [
      { id: 'tile', name: 'Плитка санузла', color: '#d8c6a4', roughness: 1, metalness: 0 },
      { id: 'paint', name: 'Краска спальни', color: '#f5f4ed', roughness: 1, metalness: 0 },
    ],
    objects: [{ id: 'shared-partition', name: 'Перегородка', kind: 'Wall', roomId: 'bathroom', sharedWith: ['bedroom'], position: [0, 0, 0], rotation: [0, 0, 0], size: [3000, 3000, 100], material: 'tile', evidence: 'assumed', wall: { start: [0, 0], end: [3000, 0], thickness: 100, height: 3000, openings: [], materials: { left: 'paint', right: 'tile', edge: 'paint' } } }],
  }
  const { sheets } = buildStudioDocuments(a, spec, [])
  const rows = sheets.filter(s => s.id.startsWith('ST-wall-finishes-')).flatMap(s => s.table!.rows)
  const wet = rows.find(row => row[0] === 'Санузел')!, dry = rows.find(row => row[0] === 'Спальня')!
  assert.equal(wet[2], 'Плитка санузла')
  assert.equal(dry[2], 'Краска спальни')
  assert.ok(wet[1].includes('shared-partition') && dry[1].includes('shared-partition'))
  const wetElevation = roomElevationSvg(a, 'bathroom', 2), dryElevation = roomElevationSvg(a, 'bedroom', 0)
  assert.match(wetElevation, /fill="#d8c6a4"[^>]*data-wall-id="shared-partition" data-material-id="tile"/)
  assert.match(dryElevation, /fill="#f5f4ed"[^>]*data-wall-id="shared-partition" data-material-id="paint"/)
  assert.ok(!dryElevation.includes('Плитка санузла'))
  assert.ok(!wetElevation.includes('Краска спальни'))
})

test('studio coverage resolves all 29 technical and 3 auxiliary document types to actual sheets', () => {
  const book = buildDossier(model, spec, freshDraft(model, spec), date)
  const expected = [
    ...Array.from({ length: 29 }, (_, i) => `T${String(i + 1).padStart(2, '0')}`),
    ...Array.from({ length: 3 }, (_, i) => `A${String(i + 1).padStart(2, '0')}`),
  ]
  assert.deepEqual(book.coverage.map(c => c.id).sort(), expected.sort())
  assert.equal(book.reference.url, 'https://земстандарт.рф/sheets')
  const sheets = new Map(book.sheets.map(s => [s.id, s]))
  assert.equal(sheets.size, book.sheets.length)
  for (const category of book.coverage) {
    assert.ok(category.sheetIds.length > 0, `${category.id} has no documents`)
    assert.equal(new Set(category.sheetIds).size, category.sheetIds.length)
    for (const id of category.sheetIds) assert.ok(sheets.has(id), `${category.id} references missing sheet ${id}`)
    assert.ok(['model', 'requires-input', 'excluded'].includes(category.status))
    if (category.status === 'requires-input') assert.ok(category.missing.length > 0, `${category.id} must explain missing inputs`)
  }
  for (const sheet of book.sheets) {
    if (sheet.table) for (const row of sheet.table.rows) assert.equal(row.length, sheet.table.headers.length, sheet.id)
    if (sheet.svg) assert.ok(!/NaN|Infinity|undefined/.test(sheet.svg), sheet.id)
  }
})

test('expanded documents preserve source model, confirmed exclusions, and bathroom estimate', () => {
  const source = JSON.stringify(model), decisions = JSON.stringify(spec)
  const draft = freshDraft(model, spec), draftBefore = JSON.stringify(draft)
  const before = estimateTotals(priceLines(estimateLines(model, spec), draft), draft.reservePercent)
  const book = buildDossier(model, spec, draft, date)
  assert.equal(JSON.stringify(model), source)
  assert.equal(JSON.stringify(spec), decisions)
  assert.equal(JSON.stringify(draft), draftBefore)
  assert.deepEqual(estimateTotals(priceLines(estimateLines(model, spec), draft), draft.reservePercent), before)
  assert.equal(spec.confirmed.boiler, false)
  assert.equal(spec.confirmed.underfloor_heating, false)
  const html = dossierHtml(book)
  assert.ok(html.includes('НЕ ДЛЯ ПРОИЗВОДСТВА РАБОТ'))
  assert.ok(html.includes('Бойлер') && html.includes('Исключены'))
  assert.ok(html.includes('смета на всю квартиру не сформирована'))
})

test('studio package supports sparse legacy geometry and escapes added document labels', () => {
  const legacy = parseApartment(JSON.parse(readFileSync(new URL('./fixtures/bathroom-study.json', import.meta.url), 'utf8')))
  const fixture = structuredClone(legacy)
  fixture.rooms[0].name = '<script>alert("room")</script>'
  const first = fixture.objects.find(o => o.wall)!
  first.name = '<img src=x onerror=alert(1)>'
  const book = buildDossier(fixture, spec, freshDraft(fixture, spec), date)
  const html = dossierHtml(book)
  assert.ok(!html.includes('<script>alert'))
  assert.ok(!html.includes('<img src=x'))
  assert.ok(html.includes('&lt;script&gt;'))
  assert.equal(book.coverage.length, 32)
  for (const sheet of book.sheets) if (sheet.svg) assert.ok(!/NaN|Infinity/.test(sheet.svg), sheet.id)
})
