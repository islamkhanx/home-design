import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Euler, Matrix4, Vector3 } from 'three'

// A projection of the saved canonical model, not a new architectural drawing.
// node scripts/review-overall-plan.mjs [--input apartment.json] [--out plan.svg]
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const option = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback)
const input = path.resolve(option('--input', path.join(root, 'src/data/apartment.json')))
const output = path.resolve(
  option('--out', path.join(root, 'exports/review-2026-11-21/overall-plan.svg')),
)
const source = await readFile(input, 'utf8'),
  apartment = JSON.parse(source)
const floors = apartment.objects.filter((o) => o.kind === 'Floor')
const walls = apartment.objects.filter((o) => o.kind === 'Wall' && o.wall)
if (floors.length !== apartment.rooms.length || floors.some((o) => !o.surface?.polygon))
  throw new Error(
    'Every room needs its canonical floor polygon; bounding boxes are not floor plans.',
  )
const escape = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c],
  )
const n = (value) => Number(value.toFixed(3))
// Use makeRotationFromEuler directly, preserving object translations and rotations.
const transform = (o, [x, z], y = 0) => {
  const p = new Vector3(x, y, z).applyMatrix4(
    new Matrix4().makeRotationFromEuler(new Euler(...o.rotation.map((v) => (v * Math.PI) / 180))),
  )
  return [p.x + o.position[0], p.z + o.position[2]]
}
const polygon = (o, ring) => ring.map((p) => transform(o, p))
const rectangle = (o, width = o.size[0], depth = o.size[2], cx = 0, cz = 0) =>
  polygon(o, [
    [cx - width / 2, cz - depth / 2],
    [cx + width / 2, cz - depth / 2],
    [cx + width / 2, cz + depth / 2],
    [cx - width / 2, cz + depth / 2],
  ])
const wallPoint = (o, along, side = 0) => {
  const w = o.wall,
    dx = w.end[0] - w.start[0],
    dz = w.end[1] - w.start[1],
    length = Math.hypot(dx, dz)
  return transform(o, [
    w.start[0] + (dx / length) * along - (dz / length) * side,
    w.start[1] + (dz / length) * along + (dx / length) * side,
  ])
}
const extents = [
  ...floors.flatMap((o) => polygon(o, o.surface.polygon)),
  ...walls.flatMap((o) => {
    const w = o.wall,
      length = Math.hypot(w.end[0] - w.start[0], w.end[1] - w.start[1])
    return [
      wallPoint(o, 0, -w.thickness / 2),
      wallPoint(o, length, -w.thickness / 2),
      wallPoint(o, length, w.thickness / 2),
      wallPoint(o, 0, w.thickness / 2),
    ]
  }),
]
const minX = Math.min(...extents.map((p) => p[0])),
  maxX = Math.max(...extents.map((p) => p[0])),
  minZ = Math.min(...extents.map((p) => p[1])),
  maxZ = Math.max(...extents.map((p) => p[1]))
const width = 1800,
  height = 1050,
  scale = Math.min(1680 / (maxZ - minZ), 560 / (maxX - minX))
const left = (width - (maxZ - minZ) * scale) / 2,
  top = 180 + (560 - (maxX - minX) * scale) / 2
// Rotate the long apartment axis onto the horizontal sheet; no geometry changes.
const xy = ([x, z]) => [left + (z - minZ) * scale, top + (maxX - x) * scale]
const point = (p) => xy(p).map(n).join(',')
const pathRing = (ring) => ring.map((p, i) => `${i ? 'L' : 'M'}${point(p)}`).join(' ') + ' Z'
const line = (from, to, attrs = '') =>
  `<line x1="${n(xy(from)[0])}" y1="${n(xy(from)[1])}" x2="${n(xy(to)[0])}" y2="${n(xy(to)[1])}" ${attrs}/>`
const text = (x, y, value, size = 16, attrs = '') =>
  `<text x="${n(x)}" y="${n(y)}" font-size="${size}" ${attrs}>${escape(value)}</text>`
const zones = [
  { id: 'hall', number: 1, color: '#eee6dc' },
  { id: 'bathroom', number: 2, color: '#ddebe7' },
  { id: 'bedroom', number: 3, color: '#e9e4da' },
  { id: 'loggia', number: 4, color: '#e3ecd8' },
  { id: 'kitchen', number: 5, color: '#f2e6ce' },
  { id: 'living', number: 6, color: '#e3e8df' },
]
const zone = (id) => zones.find((z) => z.id === id)
const area = (ring) =>
  Math.abs(
    ring.reduce((sum, p, i) => {
      const q = ring[(i + 1) % ring.length]
      return sum + p[0] * q[1] - q[0] * p[1]
    }, 0),
  ) / 2
const inside = (p, ring) => {
  let hit = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const u = ring[i],
      v = ring[j]
    if (
      u[1] > p[1] !== v[1] > p[1] &&
      p[0] < ((v[0] - u[0]) * (p[1] - u[1])) / (v[1] - u[1]) + u[0]
    )
      hit = !hit
  }
  return hit
}
const segmentDistance = (p, a, b) => {
  const dx = b[0] - a[0],
    dz = b[1] - a[1],
    t = Math.max(
      0,
      Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / (dx * dx + dz * dz || 1)),
    )
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dz)
}
const ringDistance = (p, ring) =>
  Math.min(...ring.map((a, i) => segmentDistance(p, a, ring[(i + 1) % ring.length])))
const omit = new Set([
  'Wall',
  'Floor',
  'Ceiling',
  'Door',
  'Window',
  'Socket',
  'Switch',
  'Spotlight',
  'TrackLight',
  'Pendant',
  'LEDStrip',
  'DimensionLine',
  'RoomLabel',
])
const furniture = apartment.objects.filter((o) => !omit.has(o.kind))
const labels = new Map([
  ['bathtub', 'Ванна'],
  ['vanity', 'Тумба'],
  ['toilet', 'WC'],
  ['laundry-tower', 'Колонна'],
  ['auto-bedroom-Кровать', 'Кровать'],
  ['auto-bedroom-Шкаф', 'Шкаф'],
  ['auto-hall-Шкаф у входа', 'Хранение'],
  ['auto-hall-Банкетка', 'Банкетка'],
  ['auto-kitchen-Холодильник', 'Хол.'],
  ['auto-living-Диван', 'Диван'],
  ['auto-living-Обеденный стол', 'Стол'],
  ['auto-living-Рабочий стол', 'Рабочий стол'],
  ['auto-loggia-Скамья', 'Скамья'],
])
let body = `<rect width="${width}" height="${height}" fill="#f7f6f1"/>
${text(60, 48, 'HOME / ARENA CITY LIFE', 15, 'fill="#788272" letter-spacing="2"')}
${text(60, 103, 'Общий план расстановки', 40, 'font-weight="600" fill="#293b34"')}
${text(60, 139, `Ревизия ${apartment.revision} · 21 ноября 2026 · проекция canonical geometry`, 18, 'fill="#667165"')}
${text(1740, 54, 'ПЛАН ПОВЁРНУТ НА 90°', 13, 'text-anchor="end" fill="#788272"')}
<rect x="42" y="164" width="1716" height="600" rx="16" fill="white" stroke="#e2e4dc"/>`
for (const floor of floors) {
  const rings = [floor.surface.polygon, ...(floor.surface.holes ?? [])].map((r) =>
    polygon(floor, r),
  )
  body += `<path data-floor-id="${escape(floor.id)}" d="${rings.map(pathRing).join(' ')}" fill="${zone(floor.roomId)?.color ?? '#eee'}" fill-rule="evenodd" stroke="#c0c9bc" stroke-width="1"><title>${escape(floor.id)} · исходный контур пола</title></path>`
}
// Rugs are under furnishings; overhead pieces remain dashed, not silently removed.
const sorted = furniture.toSorted(
  (a, b) =>
    (a.params?.fixture === 'rug' ? -1 : b.params?.fixture === 'rug' ? 1 : 0) ||
    a.position[1] - b.position[1],
)
for (const o of sorted) {
  const overhead = o.position[1] >= 1200,
    rug = o.params?.fixture === 'rug'
  const material = apartment.materials.find((m) => m.id === o.material)
  let color = material?.color ?? '#d5c6af'
  if (o.material === 'ink') color = '#64736a'
  if (o.kind === 'Appliance') color = '#eceeeb'
  if (o.id === 'source-service-strip') color = 'url(#service)'
  const ring = o.surface?.polygon ? polygon(o, o.surface.polygon) : rectangle(o)
  let d = pathRing(ring)
  if (o.params?.sinkCutout) {
    const h = o.params.sinkCutout
    d += ' ' + pathRing(rectangle(o, h.size[0], h.size[1], ...h.center))
  }
  body += `<path data-entity-id="${escape(o.id)}" d="${d}" fill="${overhead ? 'none' : color}" fill-rule="evenodd" fill-opacity="${rug ? '.38' : '.86'}" stroke="${overhead ? '#869887' : '#777e70'}" stroke-width="${rug ? '.7' : '1'}"${overhead ? ' stroke-dasharray="5 3"' : ''}><title>${escape(o.id)} · ${o.size.join(' × ')} мм · поворот ${o.rotation[1]}°</title></path>`
}
// Keep fronts legible where a countertop has the same footprint as its base.
for (const o of furniture) {
  if (['Wardrobe', 'KitchenCabinet'].includes(o.kind) && o.params?.fixture !== 'blindCorner') {
    const overhead = o.position[1] >= 1200
    const y = o.size[2] / 2,
      ends = polygon(o, [
        [-o.size[0] / 2, y],
        [o.size[0] / 2, y],
      ])
    body += line(
      ends[0],
      ends[1],
      `stroke="#596e59" stroke-width="2.3"${overhead ? ' stroke-dasharray="5 3"' : ''}`,
    )
  }
}
// A horizontal plan section at1200mm: only real openings intersecting it cut walls.
const cutHeight = 1200
for (const o of walls) {
  const w = o.wall,
    length = Math.hypot(w.end[0] - w.start[0], w.end[1] - w.start[1])
  const openings = w.openings.filter(
    (q) => q.bottom <= cutHeight && q.bottom + q.height > cutHeight,
  )
  const stops = [
    ...new Set([0, length, ...openings.flatMap((q) => [q.offset, q.offset + q.width])]),
  ].sort((a, b) => a - b)
  for (let i = 0; i < stops.length - 1; i++) {
    const lo = stops[i],
      hi = stops[i + 1],
      middle = (lo + hi) / 2
    if (openings.some((q) => middle > q.offset && middle < q.offset + q.width)) continue
    const corners = [
      wallPoint(o, lo, -w.thickness / 2),
      wallPoint(o, hi, -w.thickness / 2),
      wallPoint(o, hi, w.thickness / 2),
      wallPoint(o, lo, w.thickness / 2),
    ]
    body += `<path data-wall-id="${escape(o.id)}" d="${pathRing(corners)}" fill="#46554d" stroke="#46554d" stroke-width=".4"/>`
  }
  for (const q of openings) {
    const openingEntity = apartment.objects.find(
      (e) => e.attach?.wallId === o.id && e.attach.openingId === q.id,
    )
    const color = q.kind === 'window' ? '#4798a8' : '#b07c46'
    for (const offset of [q.offset, q.offset + q.width])
      body += line(
        wallPoint(o, offset, -w.thickness / 2),
        wallPoint(o, offset, w.thickness / 2),
        `stroke="${color}" stroke-width="1.8"`,
      )
    if (q.kind === 'window')
      for (const side of [-14, 14])
        body += line(
          wallPoint(o, q.offset, side),
          wallPoint(o, q.offset + q.width, side),
          `stroke="${color}" stroke-width="1.5"`,
        )
    else {
      // Factory hinge is40mm in from the opening; respect saved doorAngle.
      const angle = ((openingEntity?.params?.doorAngle ?? 0) * Math.PI) / 180
      const hinge = q.offset + 40,
        length = q.width - 80
      body += line(
        wallPoint(o, hinge, 0),
        wallPoint(o, hinge + length * Math.cos(angle), -length * Math.sin(angle)),
        `data-door-id="${escape(q.id)}" stroke="${color}" stroke-width="2"`,
      )
    }
  }
}
for (const o of furniture.filter((o) => labels.has(o.id))) {
  const [x, y] = xy(o.position.filter((_, i) => i !== 1))
  body += text(
    x,
    y + 4,
    labels.get(o.id),
    12,
    'text-anchor="middle" fill="#304238" font-weight="600" paint-order="stroke" stroke="#ffffff" stroke-width="3" stroke-opacity=".85"',
  )
}
// Place one room number in free model floor area. These are labels, not paths.
for (const room of apartment.rooms) {
  const f = floors.find((o) => o.roomId === room.id),
    ring = polygon(f, f.surface.polygon)
  const xs = ring.map((p) => p[0]),
    zs = ring.map((p) => p[1]),
    obstacles = furniture
      .filter((o) => o.roomId === room.id && o.position[1] < 1200 && o.params?.fixture !== 'rug')
      .map((o) => rectangle(o))
  let best = null,
    score = -Infinity
  for (let x = Math.min(...xs) + 80; x < Math.max(...xs); x += 100)
    for (let z = Math.min(...zs) + 80; z < Math.max(...zs); z += 100) {
      const p = [x, z]
      if (!inside(p, ring) || obstacles.some((r) => inside(p, r))) continue
      const distance = Math.min(ringDistance(p, ring), ...obstacles.map((r) => ringDistance(p, r)))
      if (distance > score) {
        best = p
        score = distance
      }
    }
  if (!best) throw new Error(`Cannot place room label within ${room.id}`)
  const [x, y] = xy(best),
    number = zone(room.id).number
  body += `<circle cx="${n(x)}" cy="${n(y)}" r="16" fill="#344e43" stroke="white" stroke-width="2"/>${text(x, y + 6, number, 17, 'text-anchor="middle" fill="white" font-weight="600"')}`
}
body += text(60, 800, 'ПОМЕЩЕНИЯ', 14, 'letter-spacing="1.5" fill="#788272"')
for (const [i, z] of zones.entries()) {
  const room = apartment.rooms.find((r) => r.id === z.id),
    floor = floors.find((o) => o.roomId === z.id),
    x = 60 + i * 282
  const modelArea =
    (area(polygon(floor, floor.surface.polygon)) -
      (floor.surface.holes ?? []).reduce((sum, h) => sum + area(polygon(floor, h)), 0)) /
    1e6
  body += `<rect x="${x}" y="818" width="266" height="88" rx="10" fill="${z.color}"/>`
  body += text(x + 14, 846, `${z.number}  ${room.name}`, 19, 'font-weight="600" fill="#34483d"')
  body += text(
    x + 14,
    871,
    `Модель: ${modelArea.toFixed(2).replace('.', ',')} м²`,
    14,
    'fill="#62715e"',
  )
  body += text(
    x + 14,
    891,
    `Исходный план: ${String(room.documentedArea).replace('.', ',')} м²`,
    13,
    'fill="#62715e"',
  )
}
body += `<rect x="60" y="934" width="24" height="10" fill="#46554d"/>${text(94, 944, 'стены в сечении 1200 мм', 14, 'fill="#53624f"')}
<line x1="335" y1="939" x2="363" y2="939" stroke="#4798a8" stroke-width="3"/>${text(373, 944, 'окна', 14, 'fill="#53624f"')}
<line x1="455" y1="939" x2="483" y2="939" stroke="#b07c46" stroke-width="3"/>${text(493, 944, 'полотна дверей: сохранённое положение', 14, 'fill="#53624f"')}
<line x1="857" y1="939" x2="885" y2="939" stroke="#869887" stroke-width="2" stroke-dasharray="5 3"/>${text(895, 944, 'мебель выше 1200 мм', 14, 'fill="#53624f"')}
<line x1="1155" y1="939" x2="1183" y2="939" stroke="#596e59" stroke-width="3"/>${text(1193, 944, 'фасады', 14, 'fill="#53624f"')}`
body += text(
  60,
  981,
  'Мебель показана повёрнутыми габаритами модели. Потолки, свет и электроточки — на отдельных листах.',
  15,
  'fill="#687364"',
)
body += text(
  60,
  1007,
  'Приближённая геометрия из исходного плана, масштаб по окну 2400 мм. Это не обмер и не монтажный чертёж.',
  15,
  'fill="#687364"',
)
const metadata = {
  revision: apartment.revision,
  source: 'src/data/apartment.json',
  sha256: createHash('sha256').update(source).digest('hex'),
  floorCount: floors.length,
  wallCount: walls.length,
  furnitureCount: furniture.length,
  sectionHeightMm: cutHeight,
}
const svg = `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="title desc" font-family="Arial, Helvetica, sans-serif"><title id="title">Общий план расстановки квартиры, ревизия ${apartment.revision}</title><desc id="desc">Полы по фактическим полигонам canonical-модели, все стены с дверными и оконными проёмами, повёрнутые габариты мебели. Геометрия приближённая, не обмер.</desc><metadata>${escape(JSON.stringify(metadata))}</metadata><defs><pattern id="service" width="8" height="8" patternUnits="userSpaceOnUse"><rect width="8" height="8" fill="#c4cdc4"/><path d="M-2,2 L2,-2 M0,8 L8,0 M6,10 L10,6" stroke="#8a9789" stroke-width="1"/></pattern></defs>${body}</svg>\n`
await mkdir(path.dirname(output), { recursive: true })
await writeFile(output, svg)
console.log(JSON.stringify({ output, ...metadata }))
