import { Euler, Matrix4, Vector3 } from 'three'
import { deg } from './math.ts'
import type { Apartment, Entity } from './schema.ts'
import { roomElectricalPoints } from './electrical.ts'

export const escapeHtml = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!))
const n = (v: number) => Math.round(v * 100) / 100
function transform(o: Entity, x: number, y: number, z: number) {
  const matrix = new Matrix4().makeRotationFromEuler(new Euler(...o.rotation.map(deg) as [number, number, number]))
  const p = new Vector3(x, y, z).applyMatrix4(matrix)
  return [p.x + o.position[0], p.y + o.position[1], p.z + o.position[2]]
}
const svgText = (x: number, y: number, text: string, size = 13, anchor = 'middle') => `<text x="${n(x)}" y="${n(y)}" font-family="Arial, sans-serif" font-size="${size}" fill="#343a32" text-anchor="${anchor}">${escapeHtml(text)}</text>`
const line = (x1: number, y1: number, x2: number, y2: number, color = '#68765e', width = 1) => `<line x1="${n(x1)}" y1="${n(y1)}" x2="${n(x2)}" y2="${n(y2)}" stroke="${color}" stroke-width="${width}"/>`
const wrap = (title: string, body: string) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 820 660" role="img" aria-label="${escapeHtml(title)}"><rect width="820" height="660" fill="#ffffff"/>${body}</svg>`
export function planEntities(a: Apartment, roomId: string) {
  return a.objects.filter(o => o.roomId === roomId && !['Floor','Ceiling','Wall','Door','Window','Socket','Switch','DimensionLine','RoomLabel','Spotlight','LEDStrip','TrackLight','Pendant'].includes(o.kind))
}
export function planSvg(a: Apartment, roomId: string, layer: 'furniture' | 'ceiling' | 'electrical' | 'coordination' = 'furniture'): string {
  const room = a.rooms.find(r => r.id === roomId)
  const furniture = layer === 'furniture' || layer === 'coordination'
  if (!room?.polygon) return wrap('Нет геометрии', svgText(410, 320, 'Для плана необходимы обмеры и геометрия.'))
  const xs = room.polygon.map(p => p[0]), zs = room.polygon.map(p => p[1])
  const minX = Math.min(...xs), maxX = Math.max(...xs), minZ = Math.min(...zs), maxZ = Math.max(...zs)
  const scale = Math.min(580 / (maxX - minX), (layer === 'coordination' ? 450 : 490) / (maxZ - minZ))
  const ox = 410 - (maxX + minX) / 2 * scale, oz = 315 - (maxZ + minZ) / 2 * scale
  const xy = (x: number, z: number) => [ox + x * scale, oz + z * scale]
  const polygon = (points: number[][], fill: string, stroke = '#757a6a', dashed = false) => `<polygon points="${points.map(p => xy(p[0], p[1]).map(n).join(',')).join(' ')}" fill="${fill}" stroke="${stroke}" stroke-width="1.3"${dashed ? ' stroke-dasharray="4 3"' : ''}/>`
  let body = polygon(room.polygon, '#f5f3ec')
  for (const o of a.objects.filter(o => (o.roomId === roomId || o.sharedWith?.includes(roomId)) && o.wall)) {
    const w = o.wall!, dx = w.end[0] - w.start[0], dz = w.end[1] - w.start[1], length = Math.hypot(dx, dz)
    const intervals = [...new Set([0, length, ...w.openings.flatMap(q => [q.offset, q.offset + q.width])])].sort((a,b) => a-b)
    const wp = (t: number, side: number) => { const p = transform(o, w.start[0] + dx / length * t - dz / length * side, 0, w.start[1] + dz / length * t + dx / length * side); return [p[0],p[2]] }
    for(let i = 0; i < intervals.length - 1; i++) {
      const start = intervals[i], end = intervals[i+1], center = (start + end) / 2
      const opening = w.openings.find(q => center > q.offset && center < q.offset + q.width)
      body += polygon([wp(start,-w.thickness/2),wp(end,-w.thickness/2),wp(end,w.thickness/2),wp(start,w.thickness/2)], opening ? '#fff' : '#c5c9bd', opening ? '#9aa18d' : '#56644f', !!opening)
      if(opening) { const p = wp(center, 0), [x,y] = xy(...p as [number,number]); body += svgText(x + 30,y,`${opening.kind === 'door' ? 'Д' : 'О'} ${opening.width}`,11,'start') }
    }
  }
  const items = planEntities(a, roomId)
  const markers: {x:number;y:number;index:number}[] = []
  items.forEach((o, i) => {
    const [w,,d] = o.size
    const points = (o.surface?.polygon ?? [[-w/2,-d/2],[w/2,-d/2],[w/2,d/2],[-w/2,d/2]]).map(([x,z]) => { const p = transform(o,x,0,z); return [p[0],p[2]] })
    const mat = a.materials.find(m => m.id === o.material)
    body += polygon(points, !furniture ? '#f3f3ee' : mat?.color ?? '#ddd', '#777c70', o.kind === 'Appliance')
    const [x,y] = xy(o.position[0],o.position[2])
    if (furniture) markers.push({x,y,index:i+1})
  })
  const placed: {x:number;y:number}[] = []
  for (const m of markers) {
    let {x,y}=m
    while(placed.some(p=>Math.hypot(p.x-x,p.y-y)<24)){x+=18;y-=16}
    if(x!==m.x||y!==m.y)body+=line(m.x,m.y,x,y)
    body += `<circle cx="${n(x)}" cy="${n(y)}" r="10" fill="#ffffff" stroke="#738069"/>` + svgText(x,y+4,String(m.index),11)
    placed.push({x,y})
  }
  if(layer === 'ceiling') {
    a.objects.filter(o => o.roomId === roomId && ['Spotlight','LEDStrip','TrackLight','Pendant'].includes(o.kind) && o.params?.group !== 'night').forEach((o,i) => {
      const [x,y] = xy(o.position[0],o.position[2])
      body += `<circle cx="${n(x)}" cy="${n(y)}" r="13" fill="#f3dfaa" stroke="#947a32"/>` + svgText(x,y+4,`L${i+1}`,10)
    })
  }
  if(layer === 'electrical' || layer === 'coordination') {
    const labels: {x:number;y:number}[]=[]
    for(const e of roomElectricalPoints(a,roomId)) {
      const [x,y]=xy(e.position[0],e.position[2]);const color=e.kind==='Socket'?'#245b59':'#a56b28'
      let lx=layer === 'coordination' ? 725 : Math.max(120,Math.min(690,x+(x<410?90:-90))),ly=y
      while(labels.some(p=>Math.abs(p.x-lx)<150&&Math.abs(p.y-ly)<26))ly+=26
      labels.push({x:lx,y:ly})
      body+=line(x,y,lx,ly,color)+`<circle cx="${n(x)}" cy="${n(y)}" r="7" fill="${color}"/>`
      body+=`<rect x="${n(lx-72)}" y="${n(ly-13)}" width="144" height="25" rx="3" fill="#ffffff" stroke="${color}"/>`
      body+=svgText(lx,ly+4,`${e.id} ×${e.electrical!.gangs} · h ${Math.round(e.position[1]+e.size[1]/2)}`,11)
    }
    body+=svgText(410,592,'E — розетки / S — выключатели · h до центра · предложение',12)
  }
  if(layer === 'coordination') {
    const measured = items.map((o,i)=>({o,index:i+1})).filter(({o})=>['Vanity','Wardrobe','Appliance','Bathtub','Toilet'].includes(o.kind) || o.id==='mirror').sort((a,b)=>a.o.position[2]-b.o.position[2])
    measured.forEach(({o,index},i)=>{
      const [x,y]=xy(o.position[0],o.position[2]),ly=100+i*(440/Math.max(1,measured.length-1))
      body+=line(x,y,200,ly,'#8b9586')
      body+=`<rect x="6" y="${n(ly-22)}" width="194" height="44" rx="3" fill="#ffffff" stroke="#8b9586"/>`
      body+=svgText(103,ly-6,`${index}. ${o.name.replace('A3 · ','')}`,9)
      body+=svgText(103,ly+11,o.size.join(' × '),12)
    })
    body+=svgText(410,572,'Габариты: Ш × В × Г, мм · локальные оси до поворота',12)
  }
  if(layer === 'ceiling')body+=svgText(410,592,`Матовый потолок · отметка ${a.objects.find(o=>o.roomId===roomId&&o.kind==='Ceiling')?.position[1] ?? '—'} мм · предложение`,12)
  const [left,top] = xy(minX,minZ), [right,bottom] = xy(maxX,maxZ)
  body += line(left,top-35,right,top-35) + line(left,top-42,left,top-23) + line(right,top-42,right,top-23) + svgText((left+right)/2,top-43,`${n(maxX-minX)} мм`)
  body += line(right+35,top,right+35,bottom) + line(right+27,top,right+43,top) + line(right+27,bottom,right+43,bottom) + svgText(right+48,(top+bottom)/2,`${n(maxZ-minZ)} мм`,12,'start')
  body += svgText(410,625,'УСЛОВНАЯ МОДЕЛЬ · миллиметры · не обмер и не монтажный план',12)
  return wrap(layer === 'coordination' ? 'Мебель, размеры и электрические точки' : layer === 'furniture' ? 'План расстановки' : layer === 'electrical' ? 'Предложение электрики' : 'Предложение потолка и света', body)
}

export function elevationSvg(o: Entity, tile: [number, number]): string {
  const w = o.wall!
  const length = Math.hypot(w.end[0]-w.start[0],w.end[1]-w.start[1])
  const scale = Math.min(610 / length, 470 / w.height), left = (820-length*scale)/2, top = 85
  const width = length*scale, height = w.height*scale
  let body = `<rect x="${n(left)}" y="${top}" width="${n(width)}" height="${n(height)}" fill="#ede9df" stroke="#7d8472"/>`
  for(let x = tile[0]; x < length; x += tile[0]) body += line(left+x*scale,top,left+x*scale,top+height,'#b5b7aa')
  for(let y = tile[1]; y < w.height; y += tile[1]) body += line(left,top+height-y*scale,left+width,top+height-y*scale,'#b5b7aa')
  for(const q of w.openings) {
    body += `<rect x="${n(left+q.offset*scale)}" y="${n(top+(w.height-q.bottom-q.height)*scale)}" width="${n(q.width*scale)}" height="${n(q.height*scale)}" fill="#fff" stroke="#69765d"/>`
    body += svgText(left+(q.offset+q.width/2)*scale,top+(w.height-q.bottom-q.height/2)*scale,`${q.width} × ${q.height}`,12)
  }
  body += line(left,top-24,left+width,top-24) + svgText(left+width/2,top-32,`${n(length)} мм`)
  body += line(left+width+22,top,left+width+22,top+height) + svgText(left+width+30,top+height/2,`${w.height} мм`,12,'start')
  body += svgText(410,590,'T1 · сетка номинального формата; старт и швы не утверждены',12)
  body += svgText(410,618,'Базовая плоскость без коробов, мебели и монтажных привязок. НЕ карта реза.',12)
  return wrap(o.name,body)
}
