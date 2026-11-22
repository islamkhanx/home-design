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
import { createEntity } from '../src/scene/components.ts'
const a=parseApartment(JSON.parse(readFileSync(new URL('../src/data/apartment.json',import.meta.url),'utf8')))
const spec=JSON.parse(readFileSync(new URL('../docs/bathroom-spec.json',import.meta.url),'utf8'))
test('bath shower keeps its 250 mm head and physical parts inside the declared envelope',()=>{
 const e=structuredClone(a.objects.find(o=>o.id==='shower')!)
 e.position=[0,0,0];e.rotation=[0,0,0]
 const mat=new T.MeshPhysicalMaterial(),root=createEntity(e,a,new Map(a.materials.map(m=>[m.id,mat])))
 root.updateMatrixWorld(true)
 const found=root.children.find(o=>o.userData.fixturePart==='overhead-250')
 assert.ok(found)
 const size=new T.Box3().setFromObject(found!).getSize(new T.Vector3())
 assert.ok(Math.abs(size.x-.25)<1e-6&&Math.abs(size.z-.25)<1e-6)
 const bounds=new T.Box3().setFromObject(root)
 assert.ok(bounds.min.y>=-1e-6&&bounds.max.y<=e.size[1]/1000+1e-6)
 assert.ok(bounds.min.x>=-e.size[0]/2000-1e-6&&bounds.max.x<=e.size[0]/2000+1e-6)
 assert.ok(bounds.min.z>=-e.size[2]/2000-1e-6&&bounds.max.z<=e.size[2]/2000+1e-6)
 disposeTree(root)
})
test('published bathroom budget includes shower supply and labor exactly once and reconciles with the 22 November procurement revision',()=>{
 const d=freshDraft(a,spec),lines=priceLines(estimateLines(a,spec),d),t=estimateTotals(lines,d.reservePercent)
 assert.equal(t.missing,0);assert.equal(lines.length,49);assert.ok(Math.abs(t.withReserve!-4598866.58)<1)
 const shower=lines.filter(l=>l.name.startsWith('Гигиенический душ'))
 assert.equal(shower.length,2);assert.equal(shower.reduce((s,l)=>s+l.amount!,0),65000)
 assert.equal(bathroomBudget.options.length,0)
 assert.equal(lines.find(l=>l.id==='budget-17')!.amount,286300)
 assert.equal(lines.find(l=>l.id==='budget-18')!.amount,70600)
 assert.equal(lines.find(l=>l.id==='budget-25')!.amount,180000)
 assert.equal(lines.find(l=>l.id==='budget-19')!.amount,0)
 const leak=lines.filter(l=>['budget-48','budget-49'].includes(l.id))
 assert.equal(leak.length,2);assert.equal(leak.reduce((s,l)=>s+l.amount!,0),155640)
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
