import { buildCanonical, applyVisibility, visibleEntities, disposeTree } from '../src/scene/canonical.ts'
import { presets, fitOrthographic } from '../src/scene/cameras.ts'
import { lightingSpecs } from '../src/scene/lighting.ts'
import { renderNotice } from '../src/scene/provenance.ts'

export const TOUR_PRESETS = {
  draft: { width: 480, height: 270, samples: 8, threshold: .12 },
  preview: { width: 960, height: 540, samples: 32, threshold: .07 },
  quality: { width: 1920, height: 1080, samples: 128, threshold: .025 },
}
export function validateTourOptions({ preset='preview', seconds=32, fps=24, device='auto' }={}) {
  if (!Object.hasOwn(TOUR_PRESETS,preset)) throw new Error('Unknown tour preset')
  if (!Number.isFinite(seconds)||seconds<2||seconds>180) throw new Error('Duration must be 2–180 seconds')
  if (![12,24,30].includes(fps)) throw new Error('FPS must be 12, 24 or 30')
  if (!['auto','cpu','gpu'].includes(device)) throw new Error('Unknown Cycles device')
  return {preset,seconds,fps,device,...TOUR_PRESETS[preset],totalFrames:Math.round(seconds*fps)}
}
export async function buildTourPlan(a, options) {
  const settings=validateTourOptions(options), root=await buildCanonical(a)
  const rooms=a.rooms.filter(r=>r.polygon)
  if(!rooms.length)throw new Error('No room geometry available for a tour')
  // Separate shots, not a fabricated walking route through unverified doorways.
  const views=[{room:'all',view:'dollhouse',title:'Общий вид'},
    ...rooms.map(r=>({room:r.id,view:'interior',title:r.name})),
    {room:'living',view:'interior',title:'Потолок и свет · гостиная',ceilingDetail:true}]
  try {
    const shots=views.map((v,i)=>{
      applyVisibility(root,a,v.room,v.view,true)
      let camera=fitOrthographic(presets(root)[v.view],root,settings.width/settings.height)
      // Presentation-only camera adjustments; the exported geometry stays untouched.
      if(v.room==='bathroom')camera={...camera,position:[1.6,1.6,1.3],target:[.35,1.1,.85],fov:70}
      if(v.ceilingDetail)camera={...camera,position:[1.4,1.25,8.5],target:[1.7,2.85,7.5],fov:62}
      const startFrame=Math.floor(i*settings.totalFrames/views.length)+1
      const endFrame=Math.floor((i+1)*settings.totalFrames/views.length)
      return {...v,startFrame,endFrame,camera,
        visibleEntityIds:visibleEntities(root),lights:lightingSpecs(a,v.room,'day'),
        lightingPreset:'day',renderNotice:renderNotice(a,v.room)}
    })
    return {version:1,sourceRevision:a.revision,settings,shots}
  } finally {disposeTree(root)}
}
export function assertResume(stored, signature) {
  if(stored.signature!==signature)throw new Error('Tour inputs or renderer changed. Use a new output folder; existing frames were preserved.')
}
export function progressSummary(state, now=Date.now()) {
  const end=Date.parse(state.finishedAt??state.pausedAt??state.stoppedAt??'')
  const start=Date.parse(state.startedAt??'')
  const elapsed=Number.isFinite(start)?Math.max(0,((Number.isFinite(end)?end:now)-start)/1000):0
  const rendered=Math.max(0,(state.completed??0)-(state.resumedFrames??0))
  const eta=rendered>0 && state.phase==='rendering' ? elapsed/rendered*(state.total-state.completed) : null
  return {...state,elapsedSeconds:elapsed,etaSeconds:eta,
    percent:state.phase==='done'?100:Math.min(99,99*(state.completed??0)/Math.max(1,state.total??1))}
}
