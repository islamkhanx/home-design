import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parseApartment } from '../src/domain/schema.ts'
import { freshDraft, priceLines, estimateLines, estimateTotals } from '../src/domain/estimate.ts'
import { buildDossier, dossierHtml } from '../src/domain/dossier.ts'

const model = parseApartment(JSON.parse(readFileSync(new URL('../src/data/apartment.json', import.meta.url), 'utf8')))
const spec = JSON.parse(readFileSync(new URL('../docs/bathroom-spec.json', import.meta.url), 'utf8'))
const date = '2026-11-21T15:00:00.000Z'

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
