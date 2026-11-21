import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { parseApartment } from '../src/domain/schema.ts'
import { applyBathroomPlan } from '../src/domain/bathroom-plan.ts'
import { estimateLines, freshDraft, priceLines, estimateTotals, parseDraft, bathroomBudget } from '../src/domain/estimate.ts'
import { buildDossier } from '../src/domain/dossier.ts'
import { buildCanonical, disposeTree } from '../src/scene/canonical.ts'
import * as T from 'three'
import { lightingSpecs } from '../src/scene/lighting.ts'
const a=parseApartment(JSON.parse(readFileSync(new URL('../src/data/apartment.json',import.meta.url),'utf8')))
const spec=JSON.parse(readFileSync(new URL('../docs/bathroom-spec.json',import.meta.url),'utf8'))
test('published bathroom budget includes shower supply and labor exactly once and reconciles with workbook',()=>{
 const d=freshDraft(a,spec),lines=priceLines(estimateLines(a,spec),d),t=estimateTotals(lines,d.reservePercent)
 assert.equal(t.missing,0);assert.equal(lines.length,49);assert.ok(Math.abs(t.withReserve!-3912244)<1)
 const shower=lines.filter(l=>l.name.startsWith('Гигиенический душ'))
 assert.equal(shower.length,2);assert.equal(shower.reduce((s,l)=>s+l.amount!,0),65000)
 assert.equal(bathroomBudget.options.length,0)
 const leak=lines.filter(l=>l.name.startsWith('Защита от протечек'))
 assert.equal(leak.length,2);assert.equal(leak.reduce((s,l)=>s+l.amount!,0),150000)
 assert.equal(spec.confirmed.boiler,false);assert.equal(spec.confirmed.underfloor_heating,false)
 assert.deepEqual(parseDraft(d,a,spec),d)
 assert.ok(buildDossier(a,spec,d).sheets.some(s=>s.id==='budget-schedule'))
 d.inputs[lines[0].id].price!+=1000
 assert.ok(estimateTotals(priceLines(estimateLines(a,spec),d),15).withReserve!>t.withReserve!)
})
test('bathroom proposal is idempotent, keeps architecture and limits product stone to bathroom',()=>{
 assert.deepEqual(applyBathroomPlan(a),a)
 const other=a.objects.filter(o=>o.roomId!=='bathroom')
 assert.ok(other.every(o=>o.material!=='bathroom-stone'&&o.material!=='floor-stone'))
 assert.equal(a.objects.find(o=>o.id==='floor')!.material,'floor-stone')
 assert.equal(a.objects.filter(o=>o.id==='hygienic-shower').length,1)
})
test('bathroom task lighting reaches both renderers and evening uses only dimmed mirror',()=>{
 const clean=lightingSpecs(a,'bathroom','clean'),evening=lightingSpecs(a,'bathroom','evening')
 assert.equal(clean.length,4);assert.equal(clean.reduce((sum,l)=>sum+l.power,0),2400)
 assert.ok(clean.every(l=>l.color==='#ffe4ce'))
 assert.equal(evening.length,2);assert.ok(evening.every(l=>l.id.startsWith('mirror-light-')&&l.power===140))
 assert.ok(buildDossier(a,spec,freshDraft(a,spec)).sheets.some(s=>s.id.startsWith('bathroom-decisions')))
})
test('photo surfaces retain metric UVs for headless scene and fixtures contain actual geometry',async()=>{
 const root=await buildCanonical(a)
 for(const id of ['hygienic-shower','towel-warmer']) {
  const g=root.children.find(c=>c.userData.entityId===id)!
  assert.ok(g);assert.ok(g.children.length>=3,id+' must not be a generic box')
 }
 let checked=false
 root.traverse(o=>{if(!(o instanceof T.Mesh)||Array.isArray(o.material))return
  if(o.material.name==='bathroom-stone') {assert.deepEqual(o.material.userData.metersPerTile,[1.2,.6]);assert.ok(o.geometry.getAttribute('uv'));checked=true}
 })
 assert.ok(checked);disposeTree(root)
})
