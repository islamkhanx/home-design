import { Euler, Matrix4, Vector3 } from 'three'
import type { Apartment, Entity, Room } from './schema.ts'
import type { V2, V3 } from './math.ts'
import { deg, pointInPolygon, polygonArea } from './math.ts'
import { escapeHtml, planEntities } from './drawings.ts'

// Keep these diagrams compatible with the native PDF renderer: no SVG paths,
// groups, transforms, clipping paths or external resources. Coordinates are mm
// until projected onto the shared 820 × 660 drawing canvas.
type PlanLayer = 'architecture' | 'furniture' | 'floors' | 'openings' | 'plumbing' | 'decor'
type Projection = { at: (p: V2) => V2; scale: number }
const ink = '#344432', muted = '#78816f', accent = '#527a78'
const n = (value: number) => Math.round(value * 100) / 100
const fmt = (value: number) => new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(value)
const attrs = (values: Record<string, string | number> = {}) => Object.entries(values).map(([key, value]) => ` ${key}="${escapeHtml(value)}"`).join('')
const text = (x: number, y: number, value: string, size = 12, anchor = 'start', color = ink) => `<text x="${n(x)}" y="${n(y)}" font-family="Arial, sans-serif" font-size="${size}" text-anchor="${anchor}" fill="${color}">${escapeHtml(value)}</text>`
const line = (a: V2, b: V2, color = muted, dashed = false, extra: Record<string, string | number> = {}) => `<line x1="${n(a[0])}" y1="${n(a[1])}" x2="${n(b[0])}" y2="${n(b[1])}" stroke="${color}" stroke-width="1"${dashed ? ' stroke-dasharray="4 3"' : ''}${attrs(extra)}/>`
const polygon = (points: V2[], fill = '#f1f1eb', stroke = muted, extra: Record<string, string | number> = {}) => `<polygon points="${points.map(p => p.map(n).join(',')).join(' ')}" fill="${fill}" stroke="${stroke}" stroke-width="1"${attrs(extra)}/>`
const circle = (p: V2, label: string, color = accent, radius = 9, extra: Record<string, string | number> = {}) => `<circle cx="${n(p[0])}" cy="${n(p[1])}" r="${radius}" fill="#ffffff" stroke="${color}"${attrs(extra)}/>` + text(p[0], p[1] + 3, label, 9, 'middle', color)
const page = (title: string, body: string, note = 'Размеры модели · не обмер и не монтажный чертёж') => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 820 660" role="img" aria-label="${escapeHtml(title)}"><rect width="820" height="660" fill="#ffffff"/>${text(28, 28, title, 17)}${line([28, 40], [792, 40])}${body}${line([28, 612], [792, 612])}${text(28, 632, note, 11)}${text(28, 649, 'ПРЕДВАРИТЕЛЬНО · НЕ ДЛЯ ПРОИЗВОДСТВА РАБОТ', 10, 'start', muted)}</svg>`
const missing = (title: string, message = 'Нет геометрии помещения. Требуются исходные данные и обмер.') => page(title, text(410, 310, message, 13, 'middle'))

function transform(o: Entity, p: V3): V3 {
  const matrix = new Matrix4().makeRotationFromEuler(new Euler(...o.rotation.map(deg) as V3))
  const q = new Vector3(...p).applyMatrix4(matrix)
  return [q.x + o.position[0], q.y + o.position[1], q.z + o.position[2]]
}
const xz = (p: V3): V2 => [p[0], p[2]]
function footprint(o: Entity): V2[] {
  const [w, , d] = o.size
  return (o.surface?.polygon ?? [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]])
    .map(p => xz(transform(o, [p[0], 0, p[1]])))
}
function bounds(points: V2[]) {
  const xs = points.map(p => p[0]), zs = points.map(p => p[1])
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minZ: Math.min(...zs), maxZ: Math.max(...zs) }
}
function projection(points: V2[], box: [number, number, number, number]): Projection {
  const b = bounds(points), [x, y, width, height] = box
  const scale = Math.min(width / Math.max(1, b.maxX - b.minX), height / Math.max(1, b.maxZ - b.minZ))
  return { scale, at: p => [x + width / 2 + (p[0] - (b.minX + b.maxX) / 2) * scale, y + height / 2 + (p[1] - (b.minZ + b.maxZ) / 2) * scale] }
}
function wallPoint(o: Entity, distance: number, side = 0, y = 0): V3 {
  const w = o.wall!, dx = w.end[0] - w.start[0], dz = w.end[1] - w.start[1], length = Math.hypot(dx, dz)
  return transform(o, [w.start[0] + dx / length * distance - dz / length * side, y, w.start[1] + dz / length * distance + dx / length * side])
}
function wallPoints(o: Entity): V2[] {
  const w = o.wall!, length = Math.hypot(w.end[0] - w.start[0], w.end[1] - w.start[1])
  return [[0, -1], [length, -1], [length, 1], [0, 1]].map(([t, side]) => xz(wallPoint(o, t, side * w.thickness / 2)))
}
function drawWalls(walls: Entity[], p: Projection) {
  return walls.map(o => {
    const w = o.wall!, length = Math.hypot(w.end[0] - w.start[0], w.end[1] - w.start[1])
    const cuts = [...new Set([0, length, ...w.openings.flatMap(q => [q.offset, q.offset + q.width])])].filter(t => t >= 0 && t <= length).sort((a, b) => a - b)
    return cuts.slice(1).map((end, i) => {
      const start = cuts[i], center = (start + end) / 2
      const opening = w.openings.find(q => center > q.offset && center < q.offset + q.width)
      return polygon([[start, -1], [end, -1], [end, 1], [start, 1]].map(([t, side]) => p.at(xz(wallPoint(o, t, side * w.thickness / 2)))), opening ? opening.kind === 'window' ? '#e4eff0' : '#ffffff' : '#bcc4b5', opening ? '#92a4a1' : '#56644f', { 'data-wall-id': o.id, ...(opening ? { 'data-opening-id': opening.id, 'stroke-dasharray': '4 3' } : {}) })
    }).join('')
  }).join('')
}
function labelPoint(ring: V2[]): V2 {
  const b = bounds(ring), center: V2 = [(b.minX + b.maxX) / 2, (b.minZ + b.maxZ) / 2]
  if (pointInPolygon(center, ring)) return center
  // A concave room's bounding-box centre can lie outside the room. Search for
  // an interior point with the greatest distance from its boundary instead.
  let best = ring[0], distance = -1
  for (let x = 1; x < 16; x++) for (let z = 1; z < 16; z++) {
    const p: V2 = [b.minX + (b.maxX - b.minX) * x / 16, b.minZ + (b.maxZ - b.minZ) * z / 16]
    if (!pointInPolygon(p, ring)) continue
    const clearance = Math.min(...ring.map((a, i) => {
      const c = ring[(i + 1) % ring.length], dx = c[0] - a[0], dz = c[1] - a[1]
      const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / (dx * dx + dz * dz)))
      return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dz)
    }))
    if (clearance > distance) { best = p; distance = clearance }
  }
  return best
}
function floorData(a: Apartment, roomId: string) {
  return a.objects.filter(o => o.kind === 'Floor' && o.roomId === roomId && o.surface && o.visible !== false).map(o => ({
    o, outer: footprint(o), holes: (o.surface!.holes ?? []).map(ring => ring.map(p => xz(transform(o, [p[0], 0, p[1]])))),
    area: (polygonArea(o.surface!.polygon) - (o.surface!.holes ?? []).reduce((sum, hole) => sum + polygonArea(hole), 0)) / 1e6,
  }))
}
function short(value: string, length = 43) { return value.length <= length ? value : value.slice(0, length - 1) + '…' }
function dimensions(p: Projection, points: V2[]) {
  const b = bounds(points), left = p.at([b.minX, b.minZ]), right = p.at([b.maxX, b.minZ]), bottom = p.at([b.maxX, b.maxZ])
  return line([left[0], left[1] - 17], [right[0], right[1] - 17]) + text((left[0] + right[0]) / 2, left[1] - 22, `${fmt(b.maxX - b.minX)} мм`, 10, 'middle')
    + line([right[0] + 16, right[1]], [bottom[0] + 16, bottom[1]]) + text(right[0] + 21, (right[1] + bottom[1]) / 2, `${fmt(b.maxZ - b.minZ)} мм`, 10)
}

export function apartmentPlanSvg(a: Apartment, layer: PlanLayer = 'architecture'): string {
  const rooms = a.rooms.filter((r): r is Room & { polygon: V2[] } => !!r.polygon)
  if (!rooms.length) return missing('План квартиры')
  const walls = a.objects.filter(o => o.wall && o.visible !== false)
  const points = [...rooms.flatMap(r => r.polygon), ...walls.flatMap(wallPoints)]
  const p = projection(points, [46, 82, 388, 494])
  const titles: Record<PlanLayer, string> = { architecture: 'Архитектурная схема квартиры', furniture: 'Расстановка мебели · квартира', floors: 'Покрытия пола · квартира', openings: 'Дверные и оконные проёмы', plumbing: 'Сантехника и водопотребители', decor: 'Размещение декора' }
  let body = rooms.map(r => polygon(r.polygon.map(p.at), '#f5f4ef', '#c9cfc2', { 'data-room-id': r.id })).join('')
  if (layer === 'floors') for (const room of rooms) for (const floor of floorData(a, room.id)) {
    body += polygon(floor.outer.map(p.at), a.materials.find(m => m.id === floor.o.material)?.color ?? '#e2ded1', '#b0b5a5', { 'data-floor-id': floor.o.id, 'data-area-m2': floor.area })
    for (const hole of floor.holes) body += polygon(hole.map(p.at), '#ffffff')
  }
  body += drawWalls(walls, p)
  const roomId = (r: Room) => `R${String(a.rooms.findIndex(q => q.id === r.id) + 1).padStart(2, '0')}`
  for (const room of rooms) {
    const at = p.at(labelPoint(room.polygon))
    body += circle(at, roomId(room), ink, 13, { 'data-room-id': room.id })
  }
  let items: Entity[] = []
  if (layer === 'furniture') items = rooms.flatMap(r => planEntities(a, r.id)).filter(o => o.visible !== false)
  if (layer === 'plumbing') items = a.objects.filter(o => o.visible !== false && (['Bathtub', 'Shower', 'Toilet', 'Vanity', 'Sink'].includes(o.kind) || (o.kind === 'Appliance' && ['washer', 'dishwasher'].includes(o.params?.appliance ?? '')) || o.params?.fixture === 'hygienicShower' || o.params?.fixture === 'kitchenTap' || o.params?.fixture === 'dropInSink'))
  if (layer === 'decor') items = a.objects.filter(o => o.visible !== false && (o.params?.fixture === 'artwork' || o.params?.fixture === 'rug'))
  items.forEach((o, i) => {
    body += polygon(footprint(o).map(p.at), layer === 'furniture' ? a.materials.find(m => m.id === o.material)?.color ?? '#e1ded3' : '#dde9e6', '#63796d', { 'data-object-id': o.id })
    const room = a.rooms.find(r => r.id === o.roomId), localIndex = planEntities(a, o.roomId).findIndex(item => item.id === o.id) + 1
    const marker = layer === 'furniture' ? `${a.rooms.indexOf(room!) + 1}.${localIndex}` : `${layer === 'plumbing' ? 'W' : 'D'}${i + 1}`
    body += text(...p.at(xz(o.position)), marker, 8, 'middle')
  })
  body += text(500, 78, 'ПОМЕЩЕНИЯ / ИСХОДНЫЕ ДАННЫЕ', 11)
  let y = 104
  for (const room of rooms) {
    body += text(500, y, `${roomId(room)} · ${room.name}`, 12)
    if (layer === 'floors') {
      const floors = floorData(a, room.id)
      body += text(500, y + 16, floors.length ? `${fmt(floors.reduce((s, f) => s + f.area, 0))} м² · геометрия Floor` : 'Пол не задан', 10)
      const finishes = [...new Set(floors.map(f => a.materials.find(m => m.id === f.o.material)?.name ?? f.o.material))]
      body += text(500, y + 31, short(finishes.join('; ') || 'Отделка не задана'), 10)
      y += 58
    } else {
      body += text(500, y + 15, room.id + (layer === 'furniture' ? ` · объектов ${items.filter(o => o.roomId === room.id).length}` : ''), 10, 'start', muted)
      y += 36
    }
  }
  if (layer === 'openings') {
    // The attached Door/Window object's placeholder position is deliberately
    // ignored: opening geometry belongs to its transformed host wall.
    const openings = walls.flatMap(o => o.wall!.openings.map(q => ({ o, q })))
    y += 8
    openings.forEach(({ o, q }, i) => {
      body += circle(p.at(xz(wallPoint(o, q.offset + q.width / 2))), String(i + 1), accent, 8, { 'data-opening-id': q.id })
      body += text(500, y, `${i + 1}. ${short(q.id, 25)} · ${q.width} × ${q.height}`, 10)
      y += 20
    })
  } else if (layer === 'plumbing' || layer === 'decor') {
    y += 8
    items.slice(0, 13).forEach((o, i) => {
      body += text(500, y, `${layer === 'plumbing' ? 'W' : 'D'}${i + 1} · ${short(o.name, 39)}`, 10)
      body += text(500, y + 13, short(o.id, 47), 8, 'start', muted)
      y += 31
    })
    if (!items.length) body += text(500, y, 'Объекты этого раздела не заданы.', 11)
  } else if (layer === 'furniture') {
    body += text(500, y + 15, 'Метки: номер комнаты.номер объекта', 11)
    body += text(500, y + 33, 'Номера объектов — в экспликации комнаты.', 10)
  }
  body += dimensions(p, rooms.flatMap(r => r.polygon))
  return page(titles[layer], body, layer === 'plumbing' ? 'Габариты потребителей из модели. Выводы, трассы и диаметры не назначены.' : layer === 'floors' ? 'Площади Floor минус отверстия; без запаса. Артикулы и состав пола уточнить.' : 'Миллиметры модели · линейные размеры требуют обмера')
}

export function roomCornersSvg(a: Apartment, roomId: string): string {
  const room = a.rooms.find(r => r.id === roomId)
  if (!room?.polygon) return missing('Нумерация углов')
  const p = projection(room.polygon, [70, 95, 390, 438]), ring = room.polygon
  let body = polygon(ring.map(p.at), '#f4f3ec', '#6d7a61')
  body += text(505, 85, 'УГЛЫ В СИСТЕМЕ МОДЕЛИ', 11)
  const placed: V2[] = []
  ring.forEach((corner, i) => {
    const id = `${roomId}-C${i + 1}`, at = p.at(corner)
    const label: V2 = [at[0] - 13, at[1] - 15]
    while (placed.some(q => Math.hypot(q[0] - label[0], q[1] - label[1]) < 24)) label[1] -= 24
    placed.push(label)
    body += line(at, label) + circle(label, `C${i + 1}`, accent, 11, { 'data-corner-id': id })
    body += text(505, 112 + i * 56, id, 12)
    body += text(505, 129 + i * 56, `X ${fmt(corner[0])} · Z ${fmt(corner[1])} мм`, 10)
    const next = ring[(i + 1) % ring.length]
    body += text(505, 145 + i * 56, `C${i + 1} → C${(i + 1) % ring.length + 1}: ${fmt(Math.hypot(next[0] - corner[0], next[1] - corner[1]))} мм`, 10, 'start', muted)
  })
  body += text(55, 582, 'Порядок углов соответствует полигону комнаты и листам развёрток.', 11)
  return page(`Нумерация углов · ${room.name}`, body)
}

function edgeWalls(a: Apartment, roomId: string, start: V2, end: V2) {
  const length = Math.hypot(end[0] - start[0], end[1] - start[1]), u: V2 = [(end[0] - start[0]) / length, (end[1] - start[1]) / length]
  const along = (p: V2) => (p[0] - start[0]) * u[0] + (p[1] - start[1]) * u[1]
  const across = (p: V2) => (p[0] - start[0]) * -u[1] + (p[1] - start[1]) * u[0]
  const walls = a.objects.filter(o => {
    if (!o.wall || o.visible === false || (o.roomId !== roomId && !o.sharedWith?.includes(roomId))) return false
    const w = o.wall, l = Math.hypot(w.end[0] - w.start[0], w.end[1] - w.start[1])
    const p = xz(wallPoint(o, 0)), q = xz(wallPoint(o, l)), span = Math.hypot(q[0] - p[0], q[1] - p[1])
    if (span < 1 || Math.abs(((q[0] - p[0]) * u[0] + (q[1] - p[1]) * u[1]) / span) < 0.999) return false
    return Math.max(Math.abs(across(p)), Math.abs(across(q))) <= w.thickness / 2 + 25 && Math.min(length, Math.max(along(p), along(q))) - Math.max(0, Math.min(along(p), along(q))) > 1
  })
  return { walls, along, across, length }
}
function clipRectangle(input: V2[], minX: number, maxX: number, minY: number, maxY: number): V2[] {
  let output = input
  for (const [axis, bound, sign] of [[0, minX, 1], [0, maxX, -1], [1, minY, 1], [1, maxY, -1]]) {
    const source = output; output = []
    source.forEach((p, i) => {
      const q = source[(i + 1) % source.length], insideP = (p[axis] - bound) * sign >= 0, insideQ = (q[axis] - bound) * sign >= 0
      if (insideP) output.push(p)
      if (insideP !== insideQ) { const t = (bound - p[axis]) / (q[axis] - p[axis]); output.push([p[0] + t * (q[0] - p[0]), p[1] + t * (q[1] - p[1])]) }
    })
  }
  return output
}
function hull(points: V2[]): V2[] {
  const sorted = points.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1])
  const cross = (a: V2, b: V2, c: V2) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
  const half = (values: V2[]) => { const result: V2[] = []; for (const p of values) { while (result.length >= 2 && cross(result[result.length - 2], result[result.length - 1], p) <= 0) result.pop(); result.push(p) }; return result.slice(0, -1) }
  return [...half(sorted), ...half(sorted.slice().reverse())]
}
export function roomElevationSvg(a: Apartment, roomId: string, edgeIndex: number): string {
  const room = a.rooms.find(r => r.id === roomId), ring = room?.polygon
  if (!room || !ring || !Number.isInteger(edgeIndex) || edgeIndex < 0 || edgeIndex >= ring.length) return missing('Развёртка помещения')
  const start = ring[edgeIndex], end = ring[(edgeIndex + 1) % ring.length]
  const edge = edgeWalls(a, roomId, start, end), from = `${roomId}-C${edgeIndex + 1}`, to = `${roomId}-C${(edgeIndex + 1) % ring.length + 1}`
  const title = `${room.name} · C${edgeIndex + 1} → C${(edgeIndex + 1) % ring.length + 1}`
  if (!edge.walls.length) return page(title, text(50, 120, `${from} → ${to} · ${fmt(edge.length)} мм`, 15)
    + line([70, 350], [750, 350], muted, true)
    + text(410, 310, 'На этой границе в модели нет подтверждённой плоскости стены.', 13, 'middle')
    + text(410, 385, 'Открытая граница / недостаточно данных. Конструкцию не назначаем.', 12, 'middle'))
  const heights = edge.walls.flatMap(o => {
    const w = o.wall!, length = Math.hypot(w.end[0] - w.start[0], w.end[1] - w.start[1])
    return [wallPoint(o, 0, 0, 0)[1], wallPoint(o, length, 0, w.height)[1]]
  })
  const floor = Math.min(...heights), top = Math.max(...heights), height = top - floor
  if (height <= 0 || edge.length <= 0) return missing(title, 'Не определены корректные габариты плоскости.')
  const scale = Math.min(650 / edge.length, 335 / height), left = (820 - edge.length * scale) / 2, base = 455
  const at = (p: V2): V2 => [left + p[0] * scale, base - (p[1] - floor) * scale]
  let body = text(28, 65, `${from} → ${to}`, 12)
  // Draw each actual wall span, not a filled rectangle across open boundaries.
  for (const o of edge.walls) {
    const w = o.wall!, length = Math.hypot(w.end[0] - w.start[0], w.end[1] - w.start[1])
    const face = [wallPoint(o, 0), wallPoint(o, length), wallPoint(o, length, 0, w.height), wallPoint(o, 0, 0, w.height)].map(p => [edge.along(xz(p)), p[1]] as V2)
    body += polygon(clipRectangle(face, 0, edge.length, floor, top).map(at), '#efede5', '#727d68', { 'data-wall-id': o.id })
    for (const q of w.openings) {
      const corners = [wallPoint(o, q.offset, 0, q.bottom), wallPoint(o, q.offset + q.width, 0, q.bottom), wallPoint(o, q.offset + q.width, 0, q.bottom + q.height), wallPoint(o, q.offset, 0, q.bottom + q.height)].map(p => [edge.along(xz(p)), p[1]] as V2)
      const clipped = clipRectangle(corners, 0, edge.length, floor, top)
      if (clipped.length < 3) continue
      body += polygon(clipped.map(at), q.kind === 'window' ? '#e4eff0' : '#ffffff', '#789491', { 'data-opening-id': q.id })
      const center = clipped.reduce((v, p) => [v[0] + p[0] / clipped.length, v[1] + p[1] / clipped.length] as V2, [0, 0] as V2)
      const label = at(center)
      body += text(label[0], label[1], q.id, 10, 'middle') + text(label[0], label[1] + 15, `${q.width} × ${q.height}`, 10, 'middle')
    }
  }
  const signed = ring.reduce((sum, p, i) => { const q = ring[(i + 1) % ring.length]; return sum + p[0] * q[1] - q[0] * p[1] }, 0) >= 0 ? 1 : -1
  const candidates = a.objects.filter(o => o.roomId === roomId && o.visible !== false && !['Wall', 'Floor', 'Ceiling', 'Door', 'Window', 'DimensionLine', 'RoomLabel', 'Spotlight', 'TrackLight', 'Pendant'].includes(o.kind))
  const shown: Entity[] = []
  for (const o of candidates) {
    const plan = footprint(o), distances = plan.map(p => edge.across(p) * signed)
    // Only objects touching/near this interior face are projected. Objects on
    // the opposite side of the wall and distant furniture are not elevations.
    if (Math.min(...distances) > 200 || Math.max(...distances) < -20) continue
    if (o.electrical && !edge.walls.some(w => w.id === o.electrical!.wallId)) continue
    const [width, h, depth] = o.size
    const vertices: V3[] = []
    for (const x of [-width / 2, width / 2]) for (const y of [0, h]) for (const z of [-depth / 2, depth / 2]) vertices.push(transform(o, [x, y, z]))
    const projected = clipRectangle(hull(vertices.map(p => [edge.along(xz(p)), p[1]])), 0, edge.length, floor, top)
    if (projected.length < 3 || polygonArea(projected) < 1) continue
    shown.push(o)
    body += polygon(projected.map(at), o.electrical ? '#d9e9e8' : a.materials.find(m => m.id === o.material)?.color ?? '#e0dccf', o.electrical ? accent : '#8a8c7c', { 'data-object-id': o.id })
    const b = bounds(projected), label = at([(b.minX + b.maxX) / 2, (b.minZ + b.maxZ) / 2])
    body += circle(label, String(shown.length), o.electrical ? accent : ink, 8)
  }
  body += line([left, base + 23], [left + edge.length * scale, base + 23]) + text(410, base + 40, `${fmt(edge.length)} мм`, 12, 'middle')
  body += text(left - 12, base + 15, `C${edgeIndex + 1}`, 10, 'middle') + text(left + edge.length * scale + 12, base + 15, `C${(edgeIndex + 1) % ring.length + 1}`, 10, 'middle')
  body += text(790, 95, `H плоскости ${fmt(height)} мм`, 11, 'end')
  shown.slice(0, 15).forEach((o, i) => { body += text(28 + (i % 3) * 263, 523 + Math.floor(i / 3) * 16, `${i + 1}. ${short(o.id, 35)}`, 9) })
  if (shown.length > 15) body += text(28, 604, 'Продолжение перечня — в экспликации помещения.', 9)
  if (!shown.length) body += text(28, 535, 'Возле этой плоскости нет размещённых объектов для проекции.', 11)
  return page(title, body, 'Габаритные проекции возле стены, без деталировки изделий. Привязки требуют обмера.')
}

export function roomSwitchingSvg(a: Apartment, roomId: string): string {
  const room = a.rooms.find(r => r.id === roomId)
  if (!room) return missing('Управление освещением')
  const local = new Set(a.objects.filter(o => o.roomId === roomId && o.visible !== false).map(o => o.id))
  const switches = a.objects.filter(o => o.kind === 'Switch' && o.visible !== false && o.electrical && (o.roomId === roomId || o.electrical.controls.some(id => local.has(id))))
  const links = switches.flatMap(s => s.electrical!.controls.map(id => ({ s, id, target: a.objects.find(o => o.id === id) })))
  const unassigned = a.objects.filter(o => o.roomId === roomId && o.visible !== false && o.params?.lumens && o.params.group !== 'night' && !a.objects.some(s => s.kind === 'Switch' && s.visible !== false && s.electrical?.controls.includes(o.id)))
  if (!switches.length && !unassigned.length) return missing(`Управление светом · ${room.name}`, 'Выключатели и связи со светильниками в модели не заданы.')
  let body = text(28, 69, 'Связи выключателей и светильников из модели. Линии не обозначают кабельные трассы.', 11)
  const rows = Math.max(1, links.length + unassigned.length + switches.filter(s => !s.electrical!.controls.length).length)
  const step = Math.min(70, 455 / rows), rowY = (i: number) => 110 + i * step
  let offset = 0
  for (const s of switches) {
    const targets = links.filter(l => l.s.id === s.id), span = Math.max(1, targets.length), y = rowY(offset + (span - 1) / 2)
    body += `<rect x="30" y="${n(y - 26)}" width="242" height="52" fill="#f6efe1" stroke="#ac824b" data-switch-id="${escapeHtml(s.id)}"/>`
    body += text(42, y - 8, `${s.id} · ${s.electrical!.gangs} кл.`, 12)
    body += text(42, y + 10, short(a.rooms.find(r => r.id === s.roomId)?.name ?? s.roomId, 31) + (s.roomId !== roomId ? ' · снаружи' : ''), 10)
    if (!targets.length) body += text(460, y + 3, 'Связи управления не назначены', 12)
    targets.forEach((l, i) => {
      const ty = rowY(offset + i), targetRoom = a.rooms.find(r => r.id === l.target?.roomId)
      body += line([272, y], [454, ty], accent, true, { 'data-switch-id': s.id, 'data-target-id': l.id })
      body += `<rect x="454" y="${n(ty - Math.min(25, step / 2 - 2))}" width="335" height="${n(Math.min(50, step - 4))}" fill="#edf1e7" stroke="#8b9b7b"/>`
      body += text(465, ty - 6, short(l.id, 49), 10)
      body += text(465, ty + 10, short(l.target ? `${targetRoom?.name ?? l.target.roomId} · ${l.target.name}` : 'Объект отсутствует: уточнить связь', 49), 10)
    })
    offset += span
  }
  unassigned.forEach((o, i) => {
    const y = rowY(offset + i)
    body += text(30, y, 'Управление не задано', 11, 'start', '#987036')
    body += text(465, y, short(o.id, 49), 10)
  })
  body += text(28, 593, 'Поклавишное разделение, типы управления, кабели и защита уточняются отдельно.', 11)
  return page(`Управление светом · ${room.name}`, body, 'Показаны только записанные связи Switch.electrical.controls; внешние комнаты подписаны.')
}

// Intersect a world-axis grid line with arbitrary concave floor polygons and
// their holes. Testing midpoint intervals avoids drawing through voids, without
// relying on unsupported SVG clipPath or assuming a rectangular room.
function gridSegments(outer: V2[], holes: V2[][], axis: 0 | 1, value: number): [V2, V2][] {
  const other = axis === 0 ? 1 : 0, cuts: number[] = []
  for (const ring of [outer, ...holes]) ring.forEach((p, i) => {
    const q = ring[(i + 1) % ring.length]
    if ((p[axis] <= value && q[axis] > value) || (q[axis] <= value && p[axis] > value)) cuts.push(p[other] + (q[other] - p[other]) * (value - p[axis]) / (q[axis] - p[axis]))
  })
  const ordered = [...new Set(cuts.map(n))].sort((a, b) => a - b), segments: [V2, V2][] = []
  const at = (v: number): V2 => axis === 0 ? [value, v] : [v, value]
  for (let i = 1; i < ordered.length; i++) {
    const midpoint = at((ordered[i - 1] + ordered[i]) / 2)
    if (pointInPolygon(midpoint, outer) && !holes.some(hole => pointInPolygon(midpoint, hole))) segments.push([at(ordered[i - 1]), at(ordered[i])])
  }
  return segments
}
export function roomTileFloorSvg(a: Apartment, roomId: string, tile: [number, number]): string {
  const room = a.rooms.find(r => r.id === roomId)
  if (!room?.polygon) return missing('Номинальная сетка плитки пола')
  if (tile.some(v => !Number.isFinite(v) || v <= 0)) return missing(`Плитка пола · ${room.name}`, 'Формат плитки не задан. Нужен подтверждённый размер изделия.')
  const floors = floorData(a, roomId), areas = floors.length ? floors : [{ outer: room.polygon, holes: [] as V2[][], area: null }]
  const points = areas.flatMap(floor => floor.outer), b = bounds(points), p = projection(points, [110, 100, 570, 430])
  let body = areas.map(floor => polygon(floor.outer.map(p.at), '#eee9de')).join('')
  const gridCount = Math.ceil((b.maxX - b.minX) / tile[0]) + Math.ceil((b.maxZ - b.minZ) / tile[1])
  if (gridCount > 1000) return missing(`Плитка пола · ${room.name}`, 'Формат слишком мал для читаемой схемы. Уточните размер плитки в миллиметрах.')
  for (const axis of [0, 1] as const) {
    const min = axis === 0 ? b.minX : b.minZ, max = axis === 0 ? b.maxX : b.maxZ
    for (let value = min + tile[axis]; value < max; value += tile[axis]) for (const floor of areas) {
      for (const [start, end] of gridSegments(floor.outer, floor.holes, axis, value)) body += line(p.at(start), p.at(end), '#b0aa98', false, { 'data-grid-axis': axis, 'data-model-start': start.join(','), 'data-model-end': end.join(',') })
    }
  }
  for (const floor of areas) for (const hole of floor.holes) body += polygon(hole.map(p.at), '#ffffff', '#818573')
  body += dimensions(p, points)
  body += text(28, 570, `Номинальный формат ${tile[0]} × ${tile[1]} мм · ${floors.length ? `${fmt(floors.reduce((sum, floor) => sum + floor.area, 0))} м² Floor минус отверстия` : 'контур комнаты; объект Floor не задан'}`, 12)
  body += text(28, 590, 'Сетка от минимальных X/Z контура. Старт, шов, калибр и подрезки не утверждены.', 11)
  return page(`Плитка пола · ${room.name}`, body, 'Номинальная сетка формата, не карта реза и не закупочная ведомость.')
}
