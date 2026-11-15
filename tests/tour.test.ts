import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { buildTourPlan, validateTourOptions, assertResume, progressSummary } from '../scripts/tour-plan.mjs'
import { buildCanonical, geometryManifest, disposeTree } from '../src/scene/canonical.ts'
import { parseApartment } from '../src/domain/schema.ts'

const apartment = parseApartment(JSON.parse(readFileSync(new URL('../src/data/apartment.json', import.meta.url), 'utf8')))

test('tour covers every frame, every room, provenance and ceiling fixtures', async () => {
  const plan = await buildTourPlan(apartment, { seconds: 7.25, fps: 24 })
  assert.equal(plan.shots[0].startFrame, 1)
  assert.equal(plan.shots.at(-1).endFrame, 174)
  for (let i=1;i<plan.shots.length;i++) assert.equal(plan.shots[i].startFrame, plan.shots[i-1].endFrame+1)
  for (const room of apartment.rooms) assert.ok(plan.shots.some(s=>s.room===room.id))
  const root = await buildCanonical(apartment)
  try {
    const parts = geometryManifest(root)
    for (const shot of plan.shots) {
      assert.ok(shot.renderNotice.length)
      assert.ok(shot.endFrame>=shot.startFrame)
      assert.ok(shot.visibleEntityIds.every((id:string)=>apartment.objects.some(o=>o.id===id)))
      if(shot.camera.type==='perspective') {
        const p:number[]=shot.camera.position
        const enclosing=parts.filter(b=>shot.visibleEntityIds.includes(b.entityId)&&p.every((n,i)=>n>b.min[i]&&n<b.max[i]))
        assert.deepEqual(enclosing.map(b=>b.entityId),[],`${shot.title}: eye must not be inside a mesh`)
        assert.ok(apartment.objects.some(o=>o.kind==='Ceiling'&&shot.visibleEntityIds.includes(o.id)))
      }
      for(const o of apartment.objects.filter(o=>o.electrical&&shot.visibleEntityIds.includes(o.id)))
        assert.ok(shot.visibleEntityIds.includes(o.electrical!.wallId))
    }
  } finally {disposeTree(root)}
})

test('invalid video settings and mismatched resume inputs fail explicitly', () => {
  for(const options of [{preset:'ultra'},{seconds:NaN},{seconds:181},{seconds:0},{fps:60},{device:'anything'}])
    assert.throws(()=>validateTourOptions(options))
  assert.throws(()=>assertResume({signature:'old'},'new'),/preserved/)
  assert.doesNotThrow(()=>assertResume({signature:'same'},'same'))
})

test('ETA excludes restored frames; completed and paused elapsed time stops', () => {
  const startedAt='2026-11-15T10:00:00Z', now=Date.parse(startedAt)+10000
  const state={startedAt,phase:'rendering',completed:85,resumedFrames:80,total:100}
  assert.equal(progressSummary(state,now).etaSeconds,30)
  assert.equal(progressSummary({...state,completed:80},now).etaSeconds,null)
  const done=progressSummary({...state,phase:'done',completed:100,finishedAt:'2026-11-15T10:00:20Z'},now+600000)
  assert.equal(done.percent,100);assert.equal(done.elapsedSeconds,20)
  assert.equal(progressSummary({...state,phase:'paused',pausedAt:'2026-11-15T10:00:08Z'},now).elapsedSeconds,8)
  assert.equal(progressSummary({phase:'idle'}).elapsedSeconds,0)
})
