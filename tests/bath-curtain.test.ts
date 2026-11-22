import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import * as T from 'three'
import { applyBathCurtain } from '../src/domain/bath-curtain.ts'
import { parseApartment } from '../src/domain/schema.ts'
import { buildCanonical, applyVisibility, disposeTree } from '../src/scene/canonical.ts'
const a=parseApartment(JSON.parse(fs.readFileSync(new URL('../src/data/apartment.json',import.meta.url),'utf8')))
test('ceiling curtain preserves bath space, follows ceiling height and replaces the glass screen',async()=>{
 const result=applyBathCurtain(a),track=result.objects.find(o=>o.id==='bath-curtain-track')!,bath=result.objects.find(o=>o.id==='bathtub')!,ceiling=result.objects.find(o=>o.id==='ceiling')!
 assert.deepEqual(applyBathCurtain(result),result)
 assert.ok(!result.objects.some(o=>o.id==='screen'))
 assert.equal(track.position[1]+track.size[1],ceiling.position[1])
 assert.equal(track.position[2],bath.position[2]+bath.size[2]/2)
 assert.equal(track.size[0],1839)
 const changed=structuredClone(a);changed.objects.find(o=>o.id==='ceiling')!.position[1]-=100
 assert.equal(applyBathCurtain(changed).objects.find(o=>o.id===track.id)!.position[1],track.position[1]-100)
 const root=await buildCanonical(result),cloth=root.children.find(o=>o.userData.entityId==='bath-curtain')!
 const bounds=new T.Box3().setFromObject(cloth,true)
 assert.ok(bounds.max.z-bounds.min.z>0.02,'fabric must have actual folds')
 assert.ok(bounds.min.y<bath.size[1]/1000,'hem drops below rim')
 assert.ok(bounds.min.z<track.position[2]/1000,'hem turns into bath')
 applyVisibility(root,result,'bathroom','ceiling',false)
 assert.ok(root.children.find(o=>o.userData.entityId===track.id)!.visible)
 disposeTree(root)
})
