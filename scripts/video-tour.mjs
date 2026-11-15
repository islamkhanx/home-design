import fs from 'node:fs/promises'
import { existsSync, openSync, closeSync } from 'node:fs'
import path from 'node:path'
import { spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { detectBlender, loadLocalEnv, projectRoot } from './blender-runtime.mjs'
import { exportHeadlessScene } from './export-headless.mjs'
import { buildTourPlan, validateTourOptions, assertResume, progressSummary } from './tour-plan.mjs'

export const defaultTourDirectory=path.join(projectRoot,'exports/video-tour')
const hash=data=>createHash('sha256').update(data).digest('hex')
export async function readTourStatus(out=defaultTourDirectory) {
  try {return progressSummary(JSON.parse(await fs.readFile(path.join(out,'progress.json'),'utf8')))}
  catch(error){if(error.code==='ENOENT')return {phase:'idle',completed:0,total:0,percent:0};throw error}
}
async function atomicJson(file,value) {
  const temp=file+'.node.tmp';await fs.writeFile(temp,JSON.stringify(value,null,2));await fs.rename(temp,file)
}
const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))
const duration=s=>s==null?'Calculating…':`${Math.floor(s/3600)}h ${Math.floor(s%3600/60)}m ${Math.floor(s%60)}s`
async function writeMonitor(out,state) {
  const live=!['done','paused','error'].includes(state.phase)
  const image=state.lastCompletedFrame?`<img src="frames/${String(state.lastCompletedFrame).padStart(6,'0')}.png" onerror="this.style.display='none'" alt="Latest rendered frame">`:''
  const html=`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${live?'<meta http-equiv="refresh" content="4">':''}<title>Home · Blender video tour</title><style>body{font:16px/1.6 system-ui;background:#f4f3ed;color:#344130;max-width:1050px;margin:50px auto;padding:24px}h1{font-size:42px;font-weight:500}small{letter-spacing:2px}progress{width:100%;height:22px;accent-color:#607b4b}section{display:flex;gap:40px;margin:24px 0;flex-wrap:wrap}strong{display:block;font-size:24px}img,video{width:100%;border-radius:14px}code{overflow-wrap:anywhere}a{color:#415e32}.note{color:#757b6c}</style><small>HOME / BLENDER CYCLES</small><h1>Apartment video tour</h1><p>${escape(state.phase)} · ${escape(state.shot??state.message)}</p><progress max="100" value="${state.percent??0}"></progress><section><div><strong>${Math.round(state.percent??0)}%</strong>${state.completed??0} / ${state.total??0} frames</div><div><strong>${duration(state.elapsedSeconds)}</strong>elapsed this run</div><div><strong>${duration(state.etaSeconds)}</strong>estimated render time remaining</div><div><strong>${escape(state.device??'Detecting…')}</strong>Cycles device</div></section><p>${escape(state.message)}</p>${state.phase==='done'?'<video controls src="tour.mp4"></video><p><a href="tour.mp4" download>Download MP4</a></p>':image}<p class="note">Camera tour of the current canonical model. Generated interior; dimensions require site measurement. ETA is based on completed frames and excludes final encoding.</p><p>Pause after the current frame:<br><code>npm run tour:pause -- --output ${escape(out)}</code></p><p>Continue safely:<br><code>npm run tour -- --resume --output ${escape(out)}</code></p><p class="note">This file refreshes every 4 seconds while the worker is running. Full render output: render.log</p></html>`
  const temp=path.join(out,'progress.tmp.html');await fs.writeFile(temp,html);await fs.rename(temp,path.join(out,'progress.html'))
}
function executable(name,envKey) {
  const candidate=process.env[envKey]??name
  const test=spawnSync(candidate,['-version'],{stdio:'ignore'})
  if(test.error||test.status!==0)throw new Error(`${name} not found. Set ${envKey} to its executable.`)
  return candidate
}
async function subprocess(binary,args,log,{onSpawn=()=>{}}={}) {
  await new Promise((resolve,reject)=>{
    const child=spawn(binary,args,{cwd:projectRoot,stdio:['ignore','pipe','pipe'],shell:false})
    onSpawn(child)
    child.stdout.on('data',c=>log.write(c));child.stderr.on('data',c=>log.write(c))
    child.on('error',reject)
    child.on('close',(code,signal)=>code===0?resolve():reject(new Error(`${path.basename(binary)} stopped (${signal??code}). See render.log; saved frames can be resumed.`)))
  })
}
export async function runTour({out=defaultTourDirectory,resume=false,...requested}={}) {
  loadLocalEnv();out=path.resolve(out)
  const blender=detectBlender();if(!blender)throw new Error('Blender not found; set BLENDER_PATH.')
  const ffmpeg=executable('ffmpeg','FFMPEG_PATH'),ffprobe=executable('ffprobe','FFPROBE_PATH')
  await fs.mkdir(out,{recursive:true})
  const lockPath=path.join(out,'worker.lock')
  // Exclusive lock survives crashes. Check the recorded PID before replacing a stale lock.
  try {const old=JSON.parse(await fs.readFile(lockPath,'utf8'));let alive=true;try{process.kill(old.pid,0)}catch(e){if(e.code==='ESRCH')alive=false}
    if(alive)throw new Error(`A tour worker is already active (PID ${old.pid}).`)
    await fs.unlink(lockPath)
  }catch(e){if(e.code!=='ENOENT')throw e}
  const lock=await fs.open(lockPath,'wx');await lock.writeFile(JSON.stringify({pid:process.pid}));await lock.close()
  let timer,child,cancelled=false,log
  const pause=()=>{cancelled=true;fs.writeFile(path.join(out,'pause.request'),'pause\n').catch(()=>{})}
  process.on('SIGINT',pause);process.on('SIGTERM',pause)
  try {
    const storedPath=path.join(out,'tour.json')
    if(existsSync(storedPath)&&!resume)throw new Error('This folder already contains a tour. Use --resume or choose another --output folder.')
    if(resume&&!existsSync(storedPath))throw new Error('No tour to resume in this folder.')
    const stored=resume?JSON.parse(await fs.readFile(storedPath,'utf8')):null
    const options=stored?.settings??validateTourOptions(requested)
    const modelText=await fs.readFile(path.join(projectRoot,'src/data/apartment.json'),'utf8')
    // Includes renderer/planner/exporter code, model content, settings, and Blender version.
    const code=await Promise.all(['scripts/blender/tour.py','scripts/blender/render.py','scripts/tour-plan.mjs','scripts/video-tour.mjs','scripts/export-headless.mjs','src/scene/materials.ts','src/scene/lighting.ts','src/scene/cameras.ts','src/scene/canonical.ts','src/scene/components.ts'].map(f=>fs.readFile(path.join(projectRoot,f),'utf8')))
    const version=spawnSync(blender,['--version'],{encoding:'utf8'}).stdout?.split('\n')[0]
    const signature=hash(JSON.stringify([JSON.parse(modelText),options,code,version]))
    if(stored)assertResume(stored,signature)
    await fs.rm(path.join(out,'pause.request'),{force:true})
    await atomicJson(path.join(out,'progress.json'),{phase:'exporting',message:'Preparing canonical model',startedAt:new Date().toISOString(),completed:0,total:options.totalFrames,resumedFrames:0,pid:process.pid,settings:options})
    let ticking=false
    const tick=async()=>{if(ticking)return;ticking=true;try{const s=await readTourStatus(out);await writeMonitor(out,s)
      const line=`${s.phase} | ${s.completed}/${s.total} frames | ${Math.round(s.percent)}% | ${s.shot??''} | ETA ${duration(s.etaSeconds)}`
      if(process.stdout.isTTY)process.stdout.write('\r\x1b[2K'+line)
      else if(line!==tick.last){console.log(line);tick.last=line}
    }catch{}finally{ticking=false}}
    await tick();timer=setInterval(tick,1500)
    if(!stored){
      await exportHeadlessScene({output:out,room:'all',view:'dollhouse',lighting:'day'})
      const plan=await buildTourPlan(JSON.parse(modelText),options)
      await atomicJson(storedPath,{...plan,signature,blenderVersion:version,glbHash:hash(await fs.readFile(path.join(out,'scene.glb'))),metadataHash:hash(await fs.readFile(path.join(out,'scene.metadata.json')))})
    } else {
      if(hash(await fs.readFile(path.join(out,'scene.glb')))!==stored.glbHash||hash(await fs.readFile(path.join(out,'scene.metadata.json')))!==stored.metadataHash)throw new Error('Export bundle changed; refusing to combine mismatched frames.')
    }
    if(cancelled){const s=await readTourStatus(out);await atomicJson(path.join(out,'progress.json'),{...s,phase:'paused',pausedAt:new Date().toISOString(),message:'Paused; ready to resume'});await tick();return}
    const {createWriteStream}=await import('node:fs');log=createWriteStream(path.join(out,'render.log'),{flags:'a'})
    await subprocess(blender,['--background','--factory-startup','--python-exit-code','1','--python',path.join(projectRoot,'scripts/blender/tour.py'),'--','--directory',out],log,{onSpawn:c=>{child=c}})
    let s=await readTourStatus(out)
    if(s.phase==='paused'||cancelled){await atomicJson(path.join(out,'progress.json'),{...s,phase:'paused',pausedAt:new Date().toISOString(),message:'Paused; use Resume to continue'});await tick();return}
    const pending=path.join(out,'tour.partial.mp4')
    await subprocess(ffmpeg,['-hide_banner','-loglevel','warning','-y','-framerate',String(options.fps),'-start_number','1','-i',path.join(out,'frames/%06d.png'),'-frames:v',String(options.totalFrames),'-c:v','libx264','-preset','medium','-crf','18','-pix_fmt','yuv420p','-movflags','+faststart',pending],log,{onSpawn:c=>{child=c}})
    const probe=spawnSync(ffprobe,['-v','error','-count_frames','-select_streams','v:0','-show_entries','stream=width,height,nb_read_frames,codec_name:format=duration','-of','json',pending],{encoding:'utf8'})
    if(probe.status!==0)throw new Error('Cannot verify encoded MP4')
    const video=JSON.parse(probe.stdout),stream=video.streams[0]
    if(stream.width!==options.width||stream.height!==options.height||Number(stream.nb_read_frames)!==options.totalFrames||Math.abs(Number(video.format.duration)-options.totalFrames/options.fps)>.1)throw new Error('Encoded video does not match the requested frame count/resolution/duration')
    await fs.rename(pending,path.join(out,'tour.mp4'))
    await atomicJson(path.join(out,'video-report.json'),{...video,signature,sourceRevision:JSON.parse(modelText).revision,settings:options})
    s=await readTourStatus(out);await atomicJson(path.join(out,'progress.json'),{...s,phase:'done',message:'MP4 verified and ready',finishedAt:new Date().toISOString()});await tick()
    console.log('\nSaved '+path.join(out,'tour.mp4'))
  }catch(error){
    const s=await readTourStatus(out)
    // Preserve a previous successful status when a new invocation was refused.
    if(s.pid===process.pid){const state={...s,phase:'error',stoppedAt:new Date().toISOString(),message:error.message};await atomicJson(path.join(out,'progress.json'),state);await writeMonitor(out,progressSummary(state))}
    throw error
  }finally{clearInterval(timer);log?.end();process.off('SIGINT',pause);process.off('SIGTERM',pause);await fs.rm(lockPath,{force:true})}
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const args=process.argv.slice(2),options={}
  try{
    for(let i=0;i<args.length;i++){
      const key=args[i]
      if(['--resume','--background','--pause'].includes(key)){options[key.slice(2)]=true;continue}
      if(!['--output','--preset','--seconds','--fps','--device'].includes(key)||!args[i+1])throw new Error('Usage: npm run tour -- [--preset draft|preview|quality] [--seconds 32] [--fps 24] [--device auto|cpu|gpu] [--output DIR] [--resume] [--background] [--pause]')
      options[key==='--output'?'out':key.slice(2)]=['--seconds','--fps'].includes(key)?Number(args[++i]):args[++i]
    }
    options.out=path.resolve(options.out??defaultTourDirectory)
    if(options.pause){await fs.mkdir(options.out,{recursive:true});await fs.writeFile(path.join(options.out,'pause.request'),'pause\n');console.log('Pause requested; current frame will finish.')}
    else if(options.background){
      await fs.mkdir(options.out,{recursive:true});const fd=openSync(path.join(options.out,'worker.log'),'a')
      const child=spawn(process.execPath,['--experimental-strip-types',fileURLToPath(import.meta.url),...args.filter(a=>a!=='--background')],{cwd:projectRoot,detached:true,stdio:['ignore',fd,fd]});child.unref();closeSync(fd)
      console.log(`Started worker ${child.pid}\nProgress: ${path.join(options.out,'progress.html')}\nLog: ${path.join(options.out,'worker.log')}`)
    }else await runTour(options)
  }catch(error){console.error(error.message);process.exitCode=1}
}
