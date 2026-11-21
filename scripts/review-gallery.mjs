import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const value = (key) => (args.includes(key) ? args[args.indexOf(key) + 1] : undefined)
const batch = path.resolve(value('--input') ?? path.join(root, 'exports/review-2026-11-21/final'))
const review = path.dirname(batch)
const output = path.resolve(value('--output') ?? path.join(review, 'review.html'))
const json = async (file) => JSON.parse(await readFile(file, 'utf8'))
const optional = async (file) => {
  try {
    return await json(file)
  } catch (e) {
    if (e.code === 'ENOENT') return null
    throw e
  }
}
const escape = (s) =>
  String(s ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  )
const inline = (s) =>
  escape(s)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
const index = await json(path.join(batch, 'index.json'))
const model = await json(path.join(batch, index.sourceFile ?? 'source-apartment.json'))
const report = await readFile(path.join(root, 'docs/ROOM_REVIEW_2026-11-21.md'), 'utf8')
const sections = Object.fromEntries(
  report
    .split(/^## /m)
    .slice(1)
    .map((s) => {
      const at = s.indexOf('\n')
      return [s.slice(0, at).trim(), s.slice(at + 1).trim()]
    }),
)
const verification = await optional(
  path.resolve(value('--verification') ?? path.join(review, 'verification.json')),
)
const qualityPath = value('--quality') ? path.resolve(value('--quality')) : null
const quality = qualityPath ? await optional(path.join(qualityPath, 'index.json')) : null
const images = {},
  imageKeys = new Map()
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')
function jpegDimensions(bytes) {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff)
    throw new Error('Invalid JPEG display image signature')
  const sof = new Set([
    0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
  ])
  let pos = 2
  while (pos + 4 <= bytes.length) {
    if (bytes[pos] !== 0xff) throw new Error('Invalid JPEG marker')
    while (bytes[pos + 1] === 0xff) pos++
    const marker = bytes[pos + 1]
    if (marker === 0xda || marker === 0xd9) break
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) {
      pos += 2
      continue
    }
    const length = bytes.readUInt16BE(pos + 2)
    if (length < 2 || pos + 2 + length > bytes.length)
      throw new Error('Invalid JPEG segment length')
    if (sof.has(marker)) {
      if (length < 8) throw new Error('Invalid JPEG frame header')
      return [bytes.readUInt16BE(pos + 7), bytes.readUInt16BE(pos + 5)]
    }
    pos += 2 + length
  }
  throw new Error('JPEG display image has no readable dimensions')
}
async function picture(file, mime = 'image/png') {
  const abs = path.resolve(file)
  if (imageKeys.has(abs)) return imageKeys.get(abs)
  const bytes = await readFile(abs)
  if (
    mime === 'image/png' &&
    !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  )
    throw new Error(`Invalid PNG: ${file}`)
  if (mime === 'image/jpeg') jpegDimensions(bytes)
  const id = `image-${imageKeys.size}`
  images[id] = `data:${mime};base64,${bytes.toString('base64')}`
  imageKeys.set(abs, id)
  return id
}
const image = (id, label, cls = '') =>
  `<button class="image-button ${cls}" data-enlarge="${id}" aria-label="Увеличить: ${escape(label)}"><img data-image="${id}" alt="${escape(label)}" loading="lazy"></button>`
const markdown = (text = '') =>
  text
    .split(/\n\s*\n/)
    .map((block) => {
      const lines = block.trim().split('\n')
      if (lines[0]?.startsWith('|')) {
        const rows = lines
          .filter((l) => !/^\|[\s:|\-]+\|$/.test(l))
          .map((l) =>
            l
              .replace(/^\||\|$/g, '')
              .split('|')
              .map((c) => c.trim()),
          )
        return `<div class="table-scroll"><table><thead><tr>${rows
          .shift()
          .map((c) => `<th>${inline(c)}</th>`)
          .join(
            '',
          )}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`
      }
      if (lines.every((l) => /^\d+\. /.test(l)))
        return `<ol>${lines.map((l) => `<li>${inline(l.replace(/^\d+\. /, ''))}</li>`).join('')}</ol>`
      return `<p>${inline(lines.join(' '))}</p>`
    })
    .join('')
const roomNames = {
  bathroom: 'Санузел',
  bedroom: 'Спальня',
  living: 'Гостиная',
  kitchen: 'Кухня-ниша',
  hall: 'Прихожая',
  loggia: 'Лоджия',
}
const sectionNames = { ...roomNames, living: 'Гостиная и рабочее место' }
const summaries = {
  bathroom:
    'Сохранена композиция A3 и выбранная отделка. Пересобраны зазоры у WC, колонны и дверного проёма; розетки выведены из пересечений.',
  bedroom:
    'Большой шкаф обращён в комнату, кровать и тумбы согласованы с электрическими точками. Экран смотрит к кровати.',
  living:
    'Мягкий диван, овальный журнальный стол и отдельные стулья. Рабочее кресло развёрнуто к столу; монитор опирается на столешницу.',
  kitchen:
    'Столешницы получили опору, мойка — настоящую вырезку и посадочный бортик. Добавлены смеситель и корпус вытяжки.',
  hall: 'Неглубокое хранение, компактная мягкая банкетка и зеркало у стены. Проход проверен в закрытом положении мебели.',
  loggia:
    'Компактная скамья обращена вдоль лоджии; столик смещён к наружной стороне. Зона выхода освобождена.',
}
const get = (id) => {
  const e = model.objects.find((o) => o.id === id)
  if (!e) throw new Error(`Missing model object: ${id}`)
  return e
}
const bounds = (id) => {
  const e = get(id),
    t = (e.rotation[1] * Math.PI) / 180,
    x = (Math.abs(Math.cos(t)) * e.size[0] + Math.abs(Math.sin(t)) * e.size[2]) / 2,
    z = (Math.abs(Math.sin(t)) * e.size[0] + Math.abs(Math.cos(t)) * e.size[2]) / 2
  return {
    minX: e.position[0] - x,
    maxX: e.position[0] + x,
    minZ: e.position[2] - z,
    maxZ: e.position[2] + z,
  }
}
const mm = (n) => `${Math.round(n).toLocaleString('ru-RU')} мм`
const metrics = [
  [
    'bathroom',
    'WC → боковой край тумбы',
    get('toilet').position[2] - bounds('vanity').maxZ,
    'Зазор от центра WC; проверить на полноразмерной разметке.',
  ],
  [
    'bathroom',
    'WC → колонна, проекции по Z',
    bounds('laundry-tower').minZ - bounds('toilet').maxZ,
    'Критичный узел. Это разделение габаритов, а не проход или монтажный допуск.',
  ],
  [
    'bedroom',
    'Шкаф → кровать',
    bounds('auto-bedroom-Шкаф').minZ - bounds('auto-bedroom-Кровать').maxZ,
    'Общий зазор; открытые фасады займут его часть.',
  ],
  [
    'living',
    'Диван → журнальный стол',
    bounds('auto-living-Диван').minX - bounds('auto-living-Журнальный стол').maxX,
    'В закрытом состоянии предметов; не паспортная оценка эргономики.',
  ],
  [
    'living',
    'ТВ-тумба → журнальный стол',
    bounds('auto-living-Журнальный стол').minX - bounds('auto-living-ТВ-тумба').maxX,
    'Линейный зазор между ближайшими габаритами.',
  ],
  [
    'kitchen',
    'Кухонный ряд → обеденный стол',
    bounds('auto-living-Обеденный стол').minX - bounds('auto-kitchen-Боковой ряд 1').maxX,
    'Открытые фасады и техника здесь не учтены.',
  ],
  [
    'hall',
    'Банкетка → шкаф',
    bounds('auto-hall-Шкаф у входа').minZ - bounds('auto-hall-Банкетка').maxZ,
    'Проход при закрытых фасадах.',
  ],
  [
    'loggia',
    'Столик → перегородка',
    Math.max(...model.rooms.find((r) => r.id === 'loggia').polygon.map((p) => p[1])) -
      bounds('auto-loggia-Кофейный столик').maxZ,
    'Поперечное расстояние; проверить эксплуатацию окон и двери.',
  ],
]

// Compact overview uses only source polygons and object footprints, without inferring dimensions.
function overviewSvg() {
  const points = model.rooms.flatMap((r) => r.polygon ?? []),
    minX = Math.min(...points.map((p) => p[0])),
    minZ = Math.min(...points.map((p) => p[1])),
    maxX = Math.max(...points.map((p) => p[0])),
    maxZ = Math.max(...points.map((p) => p[1])),
    scale = Math.min(360 / (maxX - minX), 740 / (maxZ - minZ)),
    p = (x, z) => [50 + (x - minX) * scale, 45 + (z - minZ) * scale],
    text = (x, y, s, size = 16) =>
      `<text x="${x}" y="${y}" font-family="Arial,sans-serif" font-size="${size}" fill="#344637">${escape(s)}</text>`,
    names = Object.keys(roomNames)
  let content = `<rect width="780" height="830" fill="#faf9f4"/>`
  for (const r of model.rooms)
    content += `<polygon points="${r.polygon.map(([x, z]) => p(x, z).join(',')).join(' ')}" fill="${r.id === 'bathroom' ? '#e7dfcf' : '#eeeae0'}" stroke="#778370" stroke-width="1.1"/>`
  const excluded = [
    'Wall',
    'Door',
    'Window',
    'Floor',
    'Ceiling',
    'Socket',
    'Switch',
    'TrackLight',
    'Spotlight',
    'LEDStrip',
    'Pendant',
    'DimensionLine',
    'RoomLabel',
  ]
  for (const o of model.objects.filter(
    (o) => !excluded.includes(o.kind) && o.position[1] < 1200 && o.size[1] < 2800,
  )) {
    const t = (o.rotation[1] * Math.PI) / 180
    const poly = [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ]
      .map(([x, z]) => {
        const dx = (x * o.size[0]) / 2,
          dz = (z * o.size[2]) / 2
        return p(
          o.position[0] + dx * Math.cos(t) + dz * Math.sin(t),
          o.position[2] - dx * Math.sin(t) + dz * Math.cos(t),
        ).join(',')
      })
      .join(' ')
    content += `<polygon points="${poly}" fill="${o.material === 'sage' ? '#a1ad94' : o.material === 'oak' ? '#c7b494' : '#e1ddcf'}" fill-opacity=".75" stroke="#8e9784" stroke-width=".6"/>`
  }
  names.forEach((id, i) => {
    const r = model.rooms.find((v) => v.id === id),
      xs = r.polygon.map((v) => v[0]),
      zs = r.polygon.map((v) => v[1]),
      [x, y] = p(
        xs.reduce((a, b) => a + b, 0) / xs.length,
        zs.reduce((a, b) => a + b, 0) / zs.length,
      )
    content += `<circle cx="${x}" cy="${y}" r="13" fill="#425a42"/><text x="${x}" y="${y + 5}" text-anchor="middle" font-family="Arial" font-size="14" fill="white">${i + 1}</text>`
    content += text(400, 100 + i * 76, `${String(i + 1).padStart(2, '0')}  ${roomNames[id]}`)
  })
  content +=
    text(400, 610, 'Контуры исходной модели', 14) +
    text(400, 636, 'Масштаб по окну 2400 мм', 14) +
    text(400, 662, 'План требует фактического обмера', 14)
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 780 830">${content}</svg>`
}
let overview
try {
  overview = await readFile(path.join(review, 'overall-plan.svg'), 'utf8')
  const rawMetadata = overview.match(/<metadata(?:\s[^>]*)?>([\s\S]*?)<\/metadata>/)?.[1]
  if (rawMetadata) {
    const metadata = JSON.parse(
      rawMetadata.replace(
        /&(quot|apos|lt|gt|amp);/g,
        (_, key) => ({ quot: '"', apos: "'", lt: '<', gt: '>', amp: '&' })[key],
      ),
    )
    if (metadata.sha256 && index.sourceFileHash && metadata.sha256 !== index.sourceFileHash)
      throw new Error(
        'The overall plan belongs to a different source model. Regenerate overall-plan.svg before packaging this batch.',
      )
    if (metadata.revision !== undefined && metadata.revision !== index.sourceRevision)
      throw new Error('The overall plan revision does not match this render batch.')
  }
} catch (e) {
  if (e.code !== 'ENOENT') throw e
  overview = overviewSvg()
}
images.overview = `data:image/svg+xml;base64,${Buffer.from(overview).toString('base64')}`
const shots = []
for (const s of index.shots.filter((s) => s.status === 'completed')) {
  let dir = batch,
    chosen = s
  const alternative = quality?.shots?.find(
    (q) => q.id === s.id && q.status === 'completed' && q.sourceHash === s.sourceHash,
  )
  if (alternative) {
    dir = qualityPath
    chosen = alternative
  }
  const renderReport = await json(path.join(dir, chosen.report))
  const validation = await json(path.join(dir, chosen.validation))
  if (!validation.passed || renderReport.sourceHash !== s.sourceHash)
    throw new Error(`Unverified or stale render: ${s.id}`)
  const originalFile = path.join(dir, chosen.image)
  const display = await optional(path.join(path.dirname(originalFile), 'display-image.json'))
  let imageFile = originalFile,
    imageMime = 'image/png'
  if (display) {
    if (
      typeof display.file !== 'string' ||
      path.basename(display.file) !== display.file ||
      display.file.includes('\\') ||
      !/\.jpe?g$/i.test(display.file)
    )
      throw new Error(`Display image must be a JPEG basename: ${s.id}`)
    const source = await readFile(originalFile)
    if (
      source.length < 24 ||
      !source.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ||
      sha256(source) !== display.sourceSha256
    )
      throw new Error(`Display image source PNG checksum mismatch: ${s.id}`)
    imageFile = path.join(path.dirname(originalFile), display.file)
    const jpeg = await readFile(imageFile)
    if (sha256(jpeg) !== display.sha256) throw new Error(`Display JPEG checksum mismatch: ${s.id}`)
    const dimensions = jpegDimensions(jpeg),
      originalDimensions = [source.readUInt32BE(16), source.readUInt32BE(20)]
    if (
      dimensions[0] !== display.width ||
      dimensions[1] !== display.height ||
      dimensions.some((n, i) => n !== renderReport.resolution[i] || n !== originalDimensions[i])
    )
      throw new Error(`Display JPEG dimensions do not match the original render: ${s.id}`)
    imageMime = 'image/jpeg'
  }
  shots.push({
    ...s,
    imageKey: await picture(imageFile, imageMime),
    displayJpeg: !!display,
    originalBitDepth: renderReport.bitDepth,
    resolution: renderReport.resolution,
    device: renderReport.device,
    geometry: validation,
  })
}
const plans = []
for (const room of Object.keys(roomNames)) {
  const file = room === 'bathroom' ? '03-coordination.svg' : `A-${room}.svg`
  try {
    plans.push({
      room,
      key: await picture(path.join(review, 'documents/drawings', file), 'image/svg+xml'),
    })
  } catch (e) {
    if (e.code !== 'ENOENT') throw e
  }
}
const extraPlans = []
for (const room of Object.keys(roomNames))
  for (const prefix of ['E', 'C']) {
    try {
      extraPlans.push({
        label: `${roomNames[room]} · ${prefix === 'E' ? 'электрика' : 'потолок'}`,
        key: await picture(
          path.join(review, 'documents/drawings', `${prefix}-${room}.svg`),
          'image/svg+xml',
        ),
      })
    } catch (e) {
      if (e.code !== 'ENOENT') throw e
    }
  }
const before = []
for (const room of ['living', 'bathroom']) {
  const dir = path.join(review, 'before', room),
    proof = await optional(path.join(dir, 'render-report.json'))
  if (proof?.geometry?.passed)
    before.push({
      room,
      key: await picture(path.join(dir, 'render.png')),
      lighting: proof.lightingPreset,
    })
}
const metricTable = `<div class="table-scroll"><table><thead><tr><th>Помещение / узел</th><th>В модели</th><th>Как читать</th></tr></thead><tbody>${metrics.map(([room, label, n, note]) => `<tr><td><small>${roomNames[room]}</small>${escape(label)}</td><td class="number">${mm(n)}</td><td>${escape(note)}</td></tr>`).join('')}</tbody></table></div>`
const shotHtml = (s) =>
  `<figure id="shot-${escape(s.id)}">${image(s.imageKey, s.label)}<figcaption><span>${escape(s.label)}</span><small>${s.resolution.join(' × ')} · ${escape(s.device)} · проверка геометрии пройдена${s.displayJpeg ? `<br>JPEG для просмотра в HTML; исходный ${escape(s.originalBitDepth)}-битный PNG — в архиве проверки` : ''}</small></figcaption></figure>`
const roomsHtml = Object.entries(roomNames)
  .map(([id, title], i) => {
    const main = shots.find((s) => s.id === id),
      more = shots.filter((s) => s.room === id && s.id !== id),
      plan = plans.find((p) => p.room === id),
      roomMetrics = metrics.filter((m) => m[0] === id)
    return `<section id="${id}" class="room"><div class="section-heading"><span class="eyebrow">${String(i + 1).padStart(2, '0')} / ${escape(title)}</span><h2>${escape(title)}</h2><p>${escape(summaries[id])}</p></div>${main ? shotHtml(main) : '<p class="notice">Кадр ещё не завершён и не включён в выпуск.</p>'}<div class="metrics">${roomMetrics.map(([, label, n]) => `<div><b>${mm(n)}</b><span>${escape(label)}</span></div>`).join('')}</div>${more.map(shotHtml).join('')}<details><summary>Разбор деталей и план помещения</summary><div class="details-body">${plan ? image(plan.key, `${title} · план`, 'plan-image') : ''}${markdown(sections[sectionNames[id]])}</div></details></section>`
  })
  .join('')
const devices = [...new Set(shots.map((s) => s.device))].join(', ')
const maxError = Math.max(0, ...shots.map((s) => s.geometry.maxBoundsErrorMeters * 1000))
const testsText = verification?.tests
  ? `${verification.tests.passed}/${verification.tests.total} тестов`
  : null
const buildText = verification?.build?.passed ? 'Сборка пройдена' : null
const html = `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Home · проверка интерьера</title><style>
:root{--bg:#f5f3ed;--paper:#fffefa;--ink:#293c2e;--muted:#6e786b;--line:#d9ded2;--sage:#536c4e;--sand:#e9dfca}*{box-sizing:border-box}html{scroll-behavior:smooth;scroll-padding-top:80px}body{margin:0;background:var(--bg);color:var(--ink);font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;line-height:1.65}nav{position:sticky;top:0;z-index:5;background:#f5f3edf2;border-bottom:1px solid var(--line);backdrop-filter:blur(12px)}.nav-inner{max-width:1200px;padding:15px 28px;margin:auto;display:flex;align-items:center;gap:22px;overflow:auto;white-space:nowrap}nav a{color:var(--muted);font-size:12px;text-decoration:none}nav a:hover{color:var(--ink)}.brand{font-weight:750;letter-spacing:.14em;margin-right:auto;color:var(--ink)}main{max-width:1200px;margin:auto;padding:0 28px 70px}.hero{padding:74px 0 45px;max-width:970px}.eyebrow{font-size:11px;letter-spacing:.18em;text-transform:uppercase;color:var(--sage);font-weight:650}h1{font-size:clamp(36px,6vw,70px);font-weight:430;line-height:1.08;letter-spacing:-.045em;margin:18px 0 25px}h2{font-size:clamp(28px,4vw,42px);font-weight:450;line-height:1.2;letter-spacing:-.03em;margin:10px 0 14px}h3{font-weight:550}.hero>p{font-size:18px;max-width:770px;color:var(--muted)}.badges{display:flex;gap:9px;flex-wrap:wrap;margin:24px 0}.badge{background:#e8ecdf;padding:6px 12px;border-radius:100px;font-size:12px}.notice{padding:18px 22px;background:var(--sand);font-size:13px;border-radius:12px;max-width:1000px}.intro-grid{display:grid;grid-template-columns:1fr;gap:24px;align-items:start}.intro-grid .panel>p{max-width:90ch}.panel{background:var(--paper);border:1px solid var(--line);padding:28px;border-radius:18px}.panel p{color:var(--muted)}.panel h3{margin-top:0}.section-heading{max-width:780px}.section-heading p{color:var(--muted)}section{margin-top:65px}.room{border-top:1px solid var(--line);padding-top:48px}.image-button{display:block;width:100%;padding:0;border:0;background:transparent;cursor:zoom-in;border-radius:14px;overflow:hidden}.image-button img{display:block;width:100%;height:auto;max-height:900px;object-fit:contain;background:#e5e4dc}figure{margin:28px 0 20px;background:var(--paper);border:1px solid var(--line);border-radius:16px;overflow:hidden}figure .image-button{border-radius:0}figcaption{padding:14px 20px;display:flex;justify-content:space-between;gap:20px;font-size:13px;flex-wrap:wrap}small{font-size:11px;color:var(--muted)}.metrics{display:flex;gap:15px;flex-wrap:wrap;margin:20px 0 28px}.metrics>div{padding:15px 20px;border:1px solid var(--line);background:var(--paper);border-radius:10px;flex:1;min-width:180px}.metrics b{display:block;font-size:25px;font-weight:500}.metrics span{font-size:12px;color:var(--muted)}details{background:var(--paper);border:1px solid var(--line);border-radius:12px;margin:18px 0;overflow:hidden}summary{padding:17px 22px;cursor:pointer;font-size:14px;font-weight:550}.details-body{padding:0 24px 24px}.plan-image{max-width:850px;margin:20px auto}.table-scroll{overflow:auto;margin:20px 0}table{width:100%;border-collapse:collapse;font-size:13px;min-width:620px;text-align:left}th,td{padding:14px 16px;vertical-align:top;border-bottom:1px solid var(--line)}th{background:#e9eddf;font-size:11px;text-transform:uppercase;letter-spacing:.05em}td small{display:block}.number{white-space:nowrap;font-size:18px;font-variant-numeric:tabular-nums}.details-body table{min-width:850px;font-size:12px}.details-body p,.details-body li{font-size:13px}code{font-size:.88em;overflow-wrap:anywhere;background:#efefe7;padding:2px 4px;border-radius:3px}.comparison{display:grid;grid-template-columns:1fr 1fr;gap:22px}.comparison figure{margin:14px 0}.caption-note{font-size:12px;color:var(--muted)}.plan-grid{display:grid;grid-template-columns:1fr 1fr;gap:20px}.plan-grid figure{margin:0}.checks{display:grid;grid-template-columns:repeat(3,1fr);gap:20px}.check b{display:block;font-size:24px;font-weight:500}.check span{display:block;font-size:12px;color:var(--muted)}footer{margin-top:65px;padding-top:25px;border-top:1px solid var(--line);font-size:12px;color:var(--muted)}dialog{border:0;padding:20px;background:#faf9f4;max-width:96vw;max-height:96vh;border-radius:14px}dialog::backdrop{background:#14251ccc}dialog img{display:block;max-width:90vw;max-height:82vh;object-fit:contain}dialog button{display:block;margin-left:auto;margin-bottom:12px;padding:9px 18px;border:1px solid var(--line);border-radius:8px;background:white;color:var(--ink);cursor:pointer}.sr{position:absolute;left:-10000px}@media(max-width:760px){main{padding:0 16px 45px}.nav-inner{padding:12px 16px;gap:15px}.hero{padding-top:42px}.intro-grid,.comparison,.plan-grid{grid-template-columns:1fr}.panel{padding:21px}.checks{grid-template-columns:1fr}.room{padding-top:32px}section{margin-top:45px}.metrics>div{min-width:140px}figcaption{padding:12px 14px}.details-body{padding:0 14px 18px}h1{font-size:45px}}@media print{nav,dialog{display:none}.image-button{break-inside:avoid}details{display:block}.hero{padding:20px 0}section{break-before:page}body{background:white}}
</style></head><body><nav><div class="nav-inner"><a class="brand" href="#top">HOME / REVIEW</a>${Object.entries(
  roomNames,
)
  .map(([id, title]) => `<a href="#${id}">${title}</a>`)
  .join(
    '',
  )}<a href="#measurements">Обмеры</a></div></nav><main id="top"><header class="hero"><span class="eyebrow">Arena City Life · интерьер · ревизия ${escape(index.sourceRevision)}</span><h1>Квартира,<br>проверенная в деталях.</h1><p>Расстановка, проходы, мебель и свет. Реальные кадры Blender из одной канонической модели — от общего плана до каждого помещения.</p><div class="badges"><span class="badge">${shots.length} из ${index.total} кадров готовы</span><span class="badge">${escape(devices)}</span><span class="badge">Геометрия проверена</span>${testsText ? `<span class="badge">${escape(testsText)}</span>` : ''}${buildText ? `<span class="badge">${buildText}</span>` : ''}</div><div class="notice">Интерьер — автоматическое предложение. Контуры восстановлены по исходному плану и масштабированы по окну 2400 мм. Расстояния расчётные; нужны фактические обмеры. Этот выпуск не разрешает монтаж или заказ мебели.</div></header>
<div class="intro-grid"><article class="panel"><h3>Что стало удобнее</h3><p>Шкаф спальни развёрнут в комнату; рабочее место получило правильную ориентацию. У санузла устранены пересечения колонны, электрических точек и оборудования. Кухонные столешницы, мойка и техника согласованы по высотам.</p><p>Мебель получила мягкие формы и отдельные конструкции для стульев, кресла и скамьи. Палитра объединяет светлый дуб, светлый камень, тёплый текстиль и приглушённый зелёный.</p><h3>Что ещё требует проверки</h3><p>Узел WC/колонны, паспортные зазоры стиральной машины, открывание фасадов и техники, электрические зоны, вентиляция и реальные монтажные привязки.</p></article><article class="panel"><span class="eyebrow">Общая компоновка</span>${image('overview', 'Общий план квартиры')}<p class="caption-note">Схема из исходных контуров и габаритов мебели. Подробные планы раскрываются под каждой комнатой.</p></article></div>
${roomsHtml}
<section id="clearances"><div class="section-heading"><span class="eyebrow">Размеры в модели</span><h2>Ключевые зазоры.</h2><p>Числа описывают текущие габариты. Проверка не заменяет обмеры, нормативный расчёт или паспортные требования изделий.</p></div>${metricTable}</section>
${
  before.length
    ? `<section><span class="eyebrow">История изменений</span><h2>До и после.</h2><p class="caption-note">Это сравнение двух итераций, а не контрольный тест освещения: ракурсы и свет отличаются. Исходные изображения сохранены без перерисовки.</p>${before
        .map((b) => {
          const after = shots.find((s) => s.id === b.room)
          return `<h3>${roomNames[b.room]}</h3><div class="comparison"><figure>${image(b.key, `${roomNames[b.room]} до изменений`)}<figcaption>До · исходная ревизия 9</figcaption></figure>${after ? `<figure>${image(after.imageKey, `${roomNames[b.room]} после изменений`)}<figcaption>После · текущая ревизия ${index.sourceRevision}</figcaption></figure>` : ''}</div>`
        })
        .join('')}</section>`
    : ''
}
<section><details><summary>Электрика и потолки · ${extraPlans.length} схем</summary><div class="details-body plan-grid">${extraPlans.map((p) => `<figure>${image(p.key, p.label)}<figcaption>${escape(p.label)}</figcaption></figure>`).join('')}</div></details><details><summary>Проверки и границы достоверности</summary><div class="details-body"><div class="checks"><div class="check"><b>${shots.length}/${shots.length}</b><span>Включённых кадров с пройденной проверкой геометрии Blender</span></div><div class="check"><b>${maxError.toFixed(4)} мм</b><span>Максимальная погрешность габаритов при импорте; это точность переноса модели, а не обмера квартиры</span></div><div class="check"><b>${escape(devices)}</b><span>Устройство фактического рендера по сохранённым отчётам</span></div></div>${testsText ? `<p>${escape(testsText)}${buildText ? '; production build пройден' : ''}. Результат сохранён в протоколе этой проверки.</p>` : ''}${markdown(sections['Что проверено автоматически'])}<p>Свет и материалы — визуальное приближение. Эти кадры не являются расчётом люксов или проверкой электрических зон.</p></div></details></section>
<section id="measurements"><span class="eyebrow">Следующий практический шаг</span><h2>Что замерить до заказа.</h2><article class="panel">${markdown(sections['Перед монтажом и заказами'])}</article></section><footer>Home Design · 21 ноября 2026 · ревизия ${escape(index.sourceRevision)}<br>Офлайн-галерея: изображения и схемы включены в файл. Нажмите на изображение, чтобы рассмотреть крупнее.</footer></main><dialog id="viewer"><button id="close-viewer">Закрыть · Esc</button><img id="large-image" alt="Увеличенное изображение"></dialog><script type="application/json" id="image-data">${JSON.stringify(images)}</script><script>
const images=JSON.parse(document.getElementById('image-data').textContent);document.querySelectorAll('img[data-image]').forEach(img=>img.src=images[img.dataset.image]);const dialog=document.getElementById('viewer');document.querySelectorAll('[data-enlarge]').forEach(button=>button.addEventListener('click',()=>{const img=document.getElementById('large-image');img.src=images[button.dataset.enlarge];img.alt=button.querySelector('img').alt;dialog.showModal()}));document.getElementById('close-viewer').addEventListener('click',()=>dialog.close());dialog.addEventListener('click',event=>{if(event.target===dialog)dialog.close()});
</script></body></html>`
const bytes = Buffer.byteLength(html)
if (bytes > 20 * 1024 * 1024)
  throw new Error(
    `Gallery exceeds 20 MiB (${(bytes / 1024 / 1024).toFixed(2)}); use preview renders or fewer quality replacements.`,
  )
await mkdir(path.dirname(output), { recursive: true })
await writeFile(output, html)
console.log(
  `Saved ${output} · ${shots.length} verified renders · ${(bytes / 1024 / 1024).toFixed(2)} MiB · ${Object.keys(images).length} embedded assets`,
)
