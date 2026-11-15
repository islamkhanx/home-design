import fs from 'node:fs/promises'
import { createReadStream, existsSync } from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { projectRoot } from './blender-runtime.mjs'
import { progressSummary } from './tour-plan.mjs'

export function tourService() {
  let child=null,starting=false
  const pointer=path.join(projectRoot,'.renders/tour-directory.json')
  async function directory(){
    try{const name=JSON.parse(await fs.readFile(pointer,'utf8')).name
      if(!/^video-tour(?:-\d+)?$/.test(name))throw new Error('Invalid tour directory')
      return path.join(projectRoot,'exports',name)
    }catch(e){if(e.code==='ENOENT')return path.join(projectRoot,'exports/video-tour');throw e}
  }
  return async function handle(req,res,pathname,send){
    if(!pathname.startsWith('/__local/tour/'))return false
    const out=await directory(),action=pathname.slice('/__local/tour/'.length)
    if(action==='status'&&req.method==='GET'){
      let state={phase:'idle',completed:0,total:0}
      try{state=JSON.parse(await fs.readFile(path.join(out,'progress.json'),'utf8'))}catch(e){if(e.code!=='ENOENT')throw e}
      if(!['idle','done','error','paused'].includes(state.phase)&&state.pid){
        try{process.kill(state.pid,0)}catch(e){if(e.code==='ESRCH')state={...state,phase:'paused',message:'Worker stopped; saved frames can be resumed'}}
      }
      return send(res,200,{...progressSummary(state),canResume:existsSync(path.join(out,'tour.json'))}),true
    }
    if((action==='start'||action==='resume')&&req.method==='POST'){
      if(child||starting)return send(res,409,{error:'A video tour is already running.'}),true
      starting=true
      try {
      try{const lock=JSON.parse(await fs.readFile(path.join(out,'worker.lock'),'utf8'));process.kill(lock.pid,0);return send(res,409,{error:'A video tour is already running.'}),true}catch(e){if(!['ENOENT','ESRCH'].includes(e.code))throw e}
      let size=0,body='';for await(const chunk of req){size+=chunk.length;if(size>2048)return send(res,413,{error:'Request too large'}),true;body+=chunk}
      const options=JSON.parse(body||'{}')
      const preset=options.preset??'preview',seconds=options.seconds??32,fps=options.fps??24,device=options.device??'auto'
      if(!['draft','preview','quality'].includes(preset)||!Number.isFinite(seconds)||seconds<2||seconds>180||![12,24,30].includes(fps)||!['auto','gpu','cpu'].includes(device))return send(res,400,{error:'Invalid video settings'}),true
      if(action==='resume'&&!existsSync(path.join(out,'tour.json')))return send(res,400,{error:'No saved tour to resume.'}),true
      const target=action==='start'?path.join(projectRoot,'exports',`video-tour-${Date.now()}`):out
      await fs.mkdir(target,{recursive:true});await fs.mkdir(path.dirname(pointer),{recursive:true})
      await fs.writeFile(pointer,JSON.stringify({name:path.basename(target)}))
      await fs.writeFile(path.join(target,'progress.json'),JSON.stringify({phase:'starting',message:'Starting Blender worker',completed:0,total:Math.round(seconds*fps),startedAt:new Date().toISOString()}))
      const log=await fs.open(path.join(target,'worker.log'),'a')
      child=spawn(process.execPath,['--experimental-strip-types',path.join(projectRoot,'scripts/video-tour.mjs'),'--output',target,...(action==='resume'?['--resume']:['--preset',preset,'--seconds',String(seconds),'--fps',String(fps),'--device',device])],{cwd:projectRoot,detached:true,stdio:['ignore',log.fd,log.fd]})
      const worker=child;await log.close()
      const failed=async(message)=>{try{const s=JSON.parse(await fs.readFile(path.join(target,'progress.json'),'utf8'));await fs.writeFile(path.join(target,'progress.json'),JSON.stringify({...s,phase:'error',message}))}catch{}}
      worker.on('error',e=>{failed(e.message);child=null})
      worker.on('exit',code=>{if(code!==0)failed('Worker stopped. Saved frames are retained; see exports/'+path.basename(target)+'/worker.log.');child=null})
      worker.unref()
      return send(res,202,{phase:'starting'}),true
      } finally {starting=false}
    }
    if(action==='pause'&&req.method==='POST'){
      await fs.mkdir(out,{recursive:true});await fs.writeFile(path.join(out,'pause.request'),'pause\n')
      return send(res,202,{message:'Pausing after the current frame.'}),true
    }
    if(action==='video'&&req.method==='GET'){
      const file=path.join(out,'tour.mp4')
      let stat;try{stat=await fs.stat(file)}catch(e){if(e.code==='ENOENT')return send(res,404,{error:'Video is not ready yet'}),true;throw e}
      const range=req.headers.range?.match(/^bytes=(\d+)-(\d*)$/)
      let start=0,end=stat.size-1
      if(range){start=Number(range[1]);end=range[2]?Math.min(Number(range[2]),end):end
        if(start>end||start>=stat.size){res.statusCode=416;res.setHeader('Content-Range',`bytes */${stat.size}`);res.end();return true}
        res.statusCode=206;res.setHeader('Content-Range',`bytes ${start}-${end}/${stat.size}`)
      }
      res.setHeader('Content-Type','video/mp4');res.setHeader('Accept-Ranges','bytes');res.setHeader('Content-Length',end-start+1);res.setHeader('Cache-Control','no-store')
      createReadStream(file,{start,end}).pipe(res);return true
    }
    send(res,404,{error:'Unknown tour action'});return true
  }
}
