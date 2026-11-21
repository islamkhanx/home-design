import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { parseApartment } from '../src/domain/schema.ts'
import { freshDraft, parseDraft, estimateLines, priceLines, estimateTotals, estimateCsv } from '../src/domain/estimate.ts'
import { buildDossier, dossierHtml } from '../src/domain/dossier.ts'

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..')
const args=process.argv.slice(2)
const options={out:'exports/documents',model:'src/data/apartment.json',draft:null}
let pdf=false
for(let i=0;i<args.length;i++) {
  if(args[i]==='--pdf') { pdf=true; continue }
  const key=args[i].replace(/^--/,'')
  if(!['out','model','draft'].includes(key)||!args[i+1]||args[i+1].startsWith('--')) throw new Error('Usage: npm run documents:generate -- [--out DIR] [--model FILE] [--draft FILE] [--pdf]')
  options[key]=args[++i]
}
const a=parseApartment(JSON.parse(await fs.readFile(path.resolve(root,options.model),'utf8')))
const spec=JSON.parse(await fs.readFile(path.join(root,'docs/bathroom-spec.json'),'utf8'))
if(!a.rooms.some(r=>r.id==='bathroom'))throw new Error('Current specification requires room bathroom.')
const draft=options.draft?parseDraft(JSON.parse(await fs.readFile(path.resolve(root,options.draft),'utf8')),a,spec):freshDraft(a,spec)
const dossier=buildDossier(a,spec,draft)
const out=path.resolve(root,options.out)
// Generating into a pre-existing directory is explicit via --out; unrelated files are never removed.
await fs.mkdir(path.join(out,'drawings'),{recursive:true})
// Remove only obsolete drawing files owned by the previous generated manifest.
let previous
try { previous=JSON.parse(await fs.readFile(path.join(out,'manifest.json'),'utf8')) }
catch(error) { if(error.code!=='ENOENT') throw error }
const currentDrawings=new Set(dossier.sheets.filter(s=>s.svg).map(s=>s.id))
for(const sheet of previous?.sheets??[]) {
  if(typeof sheet.id==='string' && /^[A-Za-z0-9-]+$/.test(sheet.id) && !currentDrawings.has(sheet.id))
    await fs.rm(path.join(out,'drawings',sheet.id+'.svg'),{force:true})
}
const priced=priceLines(estimateLines(a,spec),draft)
const files={
  'documents.html':dossierHtml(dossier),
  'dossier.json':JSON.stringify(dossier,null,2),
  'estimate-draft.json':JSON.stringify(draft,null,2),
  'estimate.csv':estimateCsv(priced),
  'studio-coverage.json':JSON.stringify({reference:dossier.reference,revision:dossier.revision,coverage:dossier.coverage},null,2),
  'manifest.json':JSON.stringify({revision:dossier.revision,generatedAt:dossier.generatedAt,scope:dossier.scope,status:'preliminary-not-for-construction',reference:dossier.reference,coverage:dossier.coverage,totals:estimateTotals(priced,draft.reservePercent),sheets:dossier.sheets.map(({id,title,status})=>({id,title,status}))},null,2),
}
for(const [name,content] of Object.entries(files))await fs.writeFile(path.join(out,name),content)
for(const sheet of dossier.sheets)if(sheet.svg)await fs.writeFile(path.join(out,'drawings',sheet.id+'.svg'),sheet.svg)
if(pdf) {
  if(process.platform!=='darwin') throw new Error(`PDF backend requires macOS. Open ${path.join(out,'documents.html')} in a browser and print to PDF.`)
  const selected=spawnSync('xcrun',['--find','swift'],{encoding:'utf8',timeout:10000})
  const swift=selected.status===0?selected.stdout.trim():'swift'
  const swiftFlags=[]
  // Some Command Line Tools installations ship the identical SwiftBridging
  // declaration twice. Mask only that exact duplicate for this invocation;
  // leave the installed toolchain and all other module declarations untouched.
  if(path.isAbsolute(swift)) {
    const include=path.resolve(path.dirname(swift),'../include/swift')
    const original=path.join(include,'module.modulemap')
    const maps=await Promise.all([original,path.join(include,'bridging.modulemap')].map(file=>fs.readFile(file,'utf8').catch(error=>{if(error.code==='ENOENT')return '';throw error})))
    const definition=text=>text.replace(/\/\/[^\n]*/g,'').replace(/\s+/g,' ').trim()
    if(maps.every(text=>definition(text)==='module SwiftBridging { header "bridging" export * }')) {
      const support=path.join(root,'.artifacts/document-swift')
      await fs.mkdir(support,{recursive:true})
      const empty=path.join(support,'empty.modulemap'),overlay=path.join(support,'overlay.json')
      await fs.writeFile(empty,'// Duplicate SwiftBridging is provided by bridging.modulemap.\n')
      await fs.writeFile(overlay,JSON.stringify({version:0,roots:[{type:'file',name:original,'external-contents':empty}]}))
      swiftFlags.push('-vfsoverlay',overlay)
    }
  }
  const cache=path.join(root,swiftFlags.length?'.artifacts/swift-document-vfs-cache':'.artifacts/swift-module-cache')
  await fs.mkdir(cache,{recursive:true})
  const result=spawnSync(swift,[...swiftFlags,'-module-cache-path',cache,path.join(root,'scripts/print-documents.swift'),path.join(out,'dossier.json'),path.join(out,'documents.pdf'),path.join(out,'qa')],{stdio:'inherit',timeout:180000,killSignal:'SIGKILL'})
  if(result.error)throw result.error
  if(result.status!==0)throw new Error(`PDF generation failed (${result.signal??result.status}); HTML and CSV are available in ${out}`)
}
console.log(JSON.stringify({output:out,documentTypes:dossier.coverage.length,sheets:dossier.sheets.length,drawings:dossier.sheets.filter(s=>s.svg).length,lines:priced.length,status:'preliminary'},null,2))
