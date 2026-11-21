import {readFile,writeFile,mkdir} from 'node:fs/promises'
import {createHash} from 'node:crypto'
const directory=new URL('../public/textures/laparet-noa/',import.meta.url)
const manifest=JSON.parse(await readFile(new URL('sources.json',directory),'utf8'))
const digest=bytes=>createHash('sha256').update(bytes).digest('hex')
const optional=process.argv.includes('--optional')
await mkdir(directory,{recursive:true})
for(const entry of manifest.images){
 if(!/^[a-z-]+\.jpg$/.test(entry.file))throw new Error('Invalid texture filename')
 const destination=new URL(entry.file,directory)
 let existingMismatch=false
 try { if(digest(await readFile(destination))===entry.sha256){console.log('Verified '+entry.file);continue} existingMismatch=true }
 catch(e){if(e.code!=='ENOENT')throw e}
 let response
 try {
  response=await fetch(entry.imageUrl,{signal:AbortSignal.timeout(30000)})
  if(!response.ok)throw new Error(`${entry.file}: HTTP ${response.status}`)
 } catch(error) {
  if(!optional||existingMismatch)throw error
  console.warn(`${entry.file}: photograph unavailable; procedural material will be used. Run npm run textures:fetch to retry.`)
  continue
 }
 const bytes=Buffer.from(await response.arrayBuffer())
 if(digest(bytes)!==entry.sha256)throw new Error(`${entry.file}: source image changed; review before replacing`)
 await writeFile(destination,bytes);console.log('Downloaded '+entry.file)
}
