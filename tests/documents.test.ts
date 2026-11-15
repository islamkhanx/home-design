import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parseApartment } from '../src/domain/schema.ts'
import { estimateLines, freshDraft, priceLines, estimateTotals, takeoff, parseDraft, modelKey, estimateCsv } from '../src/domain/estimate.ts'
import { buildDossier, dossierHtml } from '../src/domain/dossier.ts'
import { planSvg } from '../src/domain/drawings.ts'
import { reactive } from 'vue'
const a=parseApartment(JSON.parse(readFileSync(new URL('./fixtures/bathroom-study.json',import.meta.url),'utf8')))
const spec=JSON.parse(readFileSync(new URL('../docs/bathroom-spec.json',import.meta.url),'utf8'))
const base=estimateLines(a,spec)
test('reactive estimate can be saved and exported without cloning Vue proxies',()=>{
  const draft=reactive(freshDraft(a,spec))
  draft.custom.push({id:'custom-review',name:'Дополнительная работа',category:'Работы',unit:'компл.',quantity:null,source:'Проверка',note:'',waste:0,pack:null})
  const parsed=parseDraft(draft,a,spec)
  assert.equal(parsed.custom[0].name,'Дополнительная работа')
  assert.doesNotThrow(()=>structuredClone(parsed))
  draft.custom[0].name='Изменено'
  assert.equal(parsed.custom[0].name,'Дополнительная работа')
})
test('takeoff uses surfaces, not documented area; openings union is subtracted once',()=>{
  const fixture=structuredClone(a)
  fixture.rooms.find(r=>r.id==='bathroom')!.documentedArea=999
  const wall=fixture.objects.find(o=>o.id==='wall-east')!.wall!
  wall.openings=[{id:'one',kind:'door',offset:0,width:900,bottom:0,height:2100},{id:'two',kind:'door',offset:500,width:900,bottom:0,height:2100}]
  const q=takeoff(fixture,'bathroom')
  assert.equal(q.floor,4.446)
  assert.ok(Math.abs(q.walls.find(w=>w.id==='wall-east')!.net-(2.47*2.7-1.4*2.1))<1e-9)
  assert.equal(takeoff(fixture,'missing-room').floor,null)
})
test('material waste and whole packages never inflate labor quantities',()=>{
  const d=freshDraft(a,spec)
  d.inputs['tile-floor'].pack=1.44;d.inputs['tile-floor'].price=10000
  d.inputs['lay-floor'].price=5000
  const priced=priceLines(base,d)
  const tile=priced.find(l=>l.id==='tile-floor')!,labor=priced.find(l=>l.id==='lay-floor')!
  assert.equal(tile.packs,4);assert.equal(tile.order,5.76);assert.equal(tile.amount,57600)
  assert.equal(labor.order,4.446);assert.equal(labor.amount,22230)
  const t=estimateTotals(priced,10)
  assert.equal(t.subtotal,79830);assert.equal(t.reserve,7983);assert.equal(t.withReserve,87813)
  assert.equal(t.complete,false)
})
test('package boundary is stable, quantity overrides do not modify geometry',()=>{
  const d=freshDraft(a,spec)
  d.inputs['tile-floor'].quantity=10;d.inputs['tile-floor'].waste=10;d.inputs['tile-floor'].pack=1
  const p=priceLines(base,d).find(l=>l.id==='tile-floor')!
  assert.equal(p.order,11);assert.equal(p.packs,11);assert.equal(p.overridden,true)
  assert.equal(takeoff(a,'bathroom').floor,4.446)
})
test('blank prices are unknown, explicit zero is priced, exclusions are transparent',()=>{
  const d=freshDraft(a,spec)
  assert.equal(estimateTotals(priceLines(base,d),10).subtotal,null)
  d.inputs['tile-floor'].price=0
  let t=estimateTotals(priceLines(base,d),10)
  assert.equal(t.subtotal,0);assert.equal(t.priced,1);assert.equal(t.complete,false)
  d.inputs['tile-floor'].excluded=true
  t=estimateTotals(priceLines(base,d),10)
  assert.equal(t.subtotal,null);assert.equal(t.included,base.length-1)
  for(const v of Object.values(d.inputs))v.excluded=true
  assert.equal(estimateTotals(priceLines(base,d),10).complete,false)
})
test('unknown quantity stays unknown even when price exists',()=>{
  const d=freshDraft(a,spec);d.inputs['waterproof-work'].price=1500
  assert.equal(priceLines(base,d).find(l=>l.id==='waterproof-work')!.amount,null)
})
test('draft import checks current model and decisions and rejects nonfinite or negative inputs',()=>{
  const d=freshDraft(a,spec)
  assert.deepEqual(parseDraft(d,a,spec),d)
  const changed=structuredClone(a);changed.objects[0].size[0]+=10
  assert.notEqual(modelKey(changed,spec),d.modelKey)
  assert.throws(()=>parseDraft(d,changed,spec),/ревизии/)
  const changedSpec=structuredClone(spec);changedSpec.pending.push('Новый вопрос')
  assert.throws(()=>parseDraft(d,a,changedSpec),/ревизии/)
  for(const value of [-1,Infinity,NaN,'100']){
    const bad=structuredClone(d);bad.inputs['tile-floor'].price=value as number
    assert.throws(()=>parseDraft(bad,a,spec),/Некорректные значения/)
  }
  d.inputs['tile-floor'].pack=0;assert.throws(()=>parseDraft(d,a,spec))
})
test('draft import rejects dates, labor waste, duplicates and unknown row IDs',()=>{
  const d=freshDraft(a,spec)
  d.inputs['tile-floor'].quoteDate='2026-02-30';assert.throws(()=>parseDraft(d,a,spec))
  d.inputs['tile-floor'].quoteDate='2026-02-28';assert.doesNotThrow(()=>parseDraft(d,a,spec))
  d.inputs['lay-floor'].waste=10;assert.throws(()=>parseDraft(d,a,spec),/только к материалам/)
  d.inputs['lay-floor'].waste=0;d.inputs['unknown']=d.inputs['tile-floor'];assert.throws(()=>parseDraft(d,a,spec),/неизвестные/)
})
test('CSV preserves zero and missing distinctions and blocks spreadsheet formulas',()=>{
  const d=freshDraft(a,spec);d.inputs['tile-floor'].price=0;d.inputs['tile-floor'].supplier='=HYPERLINK("https://example.com")'
  const csv=estimateCsv(priceLines(base,d))
  assert.ok(csv.startsWith('\uFEFF'));assert.ok(csv.includes('"\'=HYPERLINK('));assert.ok(csv.includes('"0"'))
})
test('dossier has unique sheets, model-linked drawings, no false construction readiness',()=>{
  const book=buildDossier(a,spec,freshDraft(a,spec),'2026-11-13T00:00:00.000Z')
  assert.equal(new Set(book.sheets.map(s=>s.id)).size,book.sheets.length)
  assert.ok(book.sheets.filter(s=>s.svg).length>=6)
  for(const r of a.rooms.filter(r=>r.polygon&&r.id!=='bathroom')) assert.ok(book.sheets.some(s=>s.id===`A-${r.id}`))
  const html=dossierHtml(book)
  assert.ok(html.includes('НЕ ДЛЯ ПРОИЗВОДСТВА РАБОТ'));assert.ok(html.includes('Не рассчитано'))
  assert.ok(html.includes('1800 мм'));assert.ok(html.includes('2470 мм'))
  assert.ok(html.includes('Эпоксидная'));assert.ok(html.includes('Полотенцесушитель'))
})
test('user-supplied labels are escaped in HTML and SVG',()=>{
  const d=freshDraft(a,spec);d.inputs['tile-floor'].note='<img src=x onerror=alert(1)>'
  const html=dossierHtml(buildDossier(a,spec,d))
  assert.ok(!html.includes('<img src=x'));assert.ok(html.includes('&lt;img'))
  assert.ok(!planSvg(a,'missing').includes('NaN'))
})
