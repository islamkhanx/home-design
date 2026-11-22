import type { Apartment, Entity } from './schema.ts'

/** Selected ceiling curtain. Dimensions follow the traced room, not a site survey. */
export function applyBathCurtain(input: Apartment): Apartment {
  const a = structuredClone(input)
  const bath = a.objects.find(o => o.id === 'bathtub')
  const ceiling = a.objects.find(o => o.roomId === 'bathroom' && o.kind === 'Ceiling')
  const ring = a.rooms.find(r => r.id === 'bathroom')?.polygon
  if (!bath || !ceiling || !ring) return a
  const left = Math.min(...ring.map(p => p[0])) + 10
  const right = Math.max(...ring.map(p => p[0])) - 10
  const outerEdge = bath.position[2] + bath.size[2] / 2
  const top = ceiling.position[1]
  const bottom = bath.position[1] + bath.size[1] - 150
  const note = 'Потолочный трек обязателен, максимально широкий по обмеру. Ось над внешним бортом, без смещения к середине ванны. Закладная под трек; нижний край шторы внутри ванны. Показана собранная у торца штора; размеры и закрытие торцов проверить.'
  const items: Entity[] = [
    { id: 'bath-curtain-track', name: 'Потолочный трек шторы · на ширину санузла', kind: 'Shelf', roomId: 'bathroom', position: [(left + right) / 2, top - 20, outerEdge], size: [right-left, 20, 24], rotation: [0,0,0], material: 'white', evidence: 'assumed', params: { fixture: 'curtainTrack' }, note },
    { id: 'bath-curtain', name: 'Штора ванны · собрана у торца', kind: 'Shower', roomId: 'bathroom', position: [bath.position[0] + bath.size[0]/2 - 160, bottom, outerEdge-12], size: [300, top-bottom-20, 120], rotation: [0,0,0], material: 'bath-curtain-fabric', evidence: 'assumed', params: { fixture: 'bathCurtain' }, note },
  ]
  if (!a.materials.some(m=>m.id==='bath-curtain-fabric')) a.materials.push({id:'bath-curtain-fabric',name:'Штора ванной · светлая ткань, условный образец',color:'#e6e2d8',roughness:0.95,metalness:0})
  const ids = new Set(['screen',...items.map(o=>o.id)])
  a.objects = a.objects.filter(o=>!ids.has(o.id))
  a.objects.splice(a.objects.findIndex(o=>o.id===bath.id)+1,0,...items)
  return a
}
