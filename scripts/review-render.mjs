/** Reproducible, sequential stills of the current canonical apartment. Generated media stays local. */
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { createHash } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises'
import { finished } from 'node:stream/promises'
import { exportHeadlessScene } from './export-headless.mjs'
import { loadLocalEnv, projectRoot, detectBlender, launchBlender, PRESETS } from './blender-runtime.mjs'
import { parseApartment } from '../src/domain/schema.ts'
import { prepareWalkthroughApartment } from '../src/scene/walking-space.ts'

const camera = (position, target, fov = 58) => ({
  position: position.map((n) => n / 1000),
  target: target.map((n) => n / 1000),
  fov,
})
export const REVIEW_SHOTS = [
  { id: 'bathroom', room: 'bathroom', label: 'Санузел · основной вид' },
  { id: 'bedroom', room: 'bedroom', label: 'Спальня · основной вид' },
  { id: 'living', room: 'living', label: 'Гостиная · основной вид' },
  { id: 'kitchen', room: 'kitchen', label: 'Кухня-ниша · основной вид' },
  { id: 'dining', room: 'living', label: 'Обеденная зона · проход и посадка', camera: camera([2900, 1600, 6300], [1500, 1000, 4500]) },
  { id: 'hall', room: 'hall', label: 'Коридор · основной вид' },
  { id: 'loggia', room: 'loggia', label: 'Лоджия · основной вид' },
  { id: 'bathroom-reverse', room: 'bathroom', label: 'Санузел · обратный ракурс', camera: camera([900, 1600, 1000], [1300, 1250, 2200]) },
  { id: 'bathroom-wc', room: 'bathroom', label: 'Санузел · WC и доступ к тумбе', camera: camera([1200, 1600, 1350], [300, 850, 1750]) },
  { id: 'bathroom-shower', room: 'bathroom', label: 'Санузел · ванна и соединения душа', camera: camera([850, 1700, 850], [30, 1700, 342], 78) },
  { id: 'bedroom-reverse', room: 'bedroom', label: 'Спальня · обратный ракурс', camera: camera([2800, 1600, -3450], [1300, 1200, -400]) },
  { id: 'living-reverse', room: 'living', label: 'Гостиная · обратный ракурс', camera: camera([1450, 1600, 6300], [1800, 1150, 8850]) },
  { id: 'kitchen-storage', room: 'kitchen', label: 'Кухня · шкафы до потолка', camera: camera([1900, 1600, 5650], [600, 1750, 3650], 64) },
  { id: 'hall-storage', room: 'hall', label: 'Прихожая · шкаф и стыки стен', camera: camera([2200, 1600, 1050], [3800, 1750, 2100], 66) },
  { id: 'bathroom-storage', room: 'bathroom', label: 'Санузел · верхние секции и примыкание', camera: camera([900, 1650, 1000], [1350, 2100, 2140], 66) },
  { id: 'bathroom-wc-storage', room: 'bathroom', label: 'Санузел · шкаф над WC до потолка', camera: camera([1450, 1650, 1050], [150, 1900, 1860], 66) },
  // The full kitchen is viewed from the adjoining living-room floor; the indoor
  // camera validator uses its actual standing room, while all rooms stay visible.
  { id: 'kitchen-integrated', room: 'living', label: 'Кухня · единый встроенный гарнитур', camera: camera([2800, 1600, 6350], [600, 1500, 4300], 60) },
  { id: 'hall-integrated', room: 'hall', label: 'Прихожая · общий блок с нишей', camera: camera([3800, 1450, 900], [3950, 1425, 2217], 96) },
]
const hash = (value) => createHash('sha256').update(value).digest('hex')
const elapsed = (start) => Math.round((Date.now() - start) / 1000)
const help = `Проверочные рендеры квартиры: 6 помещений и дополнительные ракурсы.

npm run render:review
npm run render:review -- --preset quality
npm run render:review -- --rooms bathroom,kitchen,living-reverse --output exports/custom-review

Параметры:
  --preset draft|preview|quality|ultra   По умолчанию preview.
  --look photoreal|review         По умолчанию photoreal; review — ровный проверочный свет.
  --rooms ID,ID                   Выбранные ракурсы, в указанном порядке.
  --output PATH                   По умолчанию exports/review-2026-11-21.
  --device auto|cpu|gpu           По умолчанию CYCLES_DEVICE или auto.
  --help                         Показать справку без запуска Blender.

Ракурсы: ${REVIEW_SHOTS.map((s) => s.id).join(', ')}
Каждый выбранный ракурс пересчитывается заново; старые изображения не переиспользуются.`

export function parseReviewArgs(args) {
  const result = { preset: 'preview', look: 'photoreal', output: path.join(projectRoot, 'exports/review-2026-11-21'), device: process.env.CYCLES_DEVICE ?? 'auto', shots: REVIEW_SHOTS }
  for (let i = 0; i < args.length; i++) {
    const key = args[i]
    if (key === '--help') return { help: true }
    if (!['--preset', '--look', '--rooms', '--output', '--device'].includes(key)) throw new Error('Неизвестный параметр: ' + key)
    const value = args[++i]
    if (!value || value.startsWith('--')) throw new Error('Не задано значение ' + key)
    if (key === '--rooms') {
      const ids = [...new Set(value.split(',').map((id) => id.trim()))]
      result.shots = ids.map((id) => {
        const shot = REVIEW_SHOTS.find((s) => s.id === id)
        if (!shot) throw new Error('Неизвестный ракурс: ' + id)
        return shot
      })
    } else result[key.slice(2)] = value
  }
  if (!PRESETS[result.preset]) throw new Error('Неизвестный preset: ' + result.preset)
  if (!['photoreal', 'review'].includes(result.look)) throw new Error('Неизвестный свет рендера: ' + result.look)
  if (!['auto', 'cpu', 'gpu'].includes(result.device)) throw new Error('Неизвестное устройство: ' + result.device)
  result.output = path.resolve(result.output)
  return result
}

async function checkedResult(directory, metadata, preset, look) {
  const png = await readFile(path.join(directory, 'render.png'))
  const report = JSON.parse(await readFile(path.join(directory, 'render-report.json'), 'utf8'))
  const geometry = JSON.parse(await readFile(path.join(directory, 'geometry-validation.json'), 'utf8'))
  const dimensions = PRESETS[preset]
  if (png.length < 45 || !png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ||
      png.toString('ascii', 12, 16) !== 'IHDR' || png.readUInt32BE(16) !== dimensions.width || png.readUInt32BE(20) !== dimensions.height ||
      !png.subarray(-12).equals(Buffer.from([0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130])))
    throw new Error('Неполный PNG или неверное разрешение: ' + directory)
  if (report.preset !== preset || report.look !== look || report.sourceHash !== metadata.sourceHash || report.sourceRevision !== metadata.sourceRevision ||
      report.geometry?.passed !== true || geometry.passed !== true || geometry.meshParts !== metadata.geometry.length)
    throw new Error('Отчёт рендера не соответствует текущей сцене: ' + directory)
  return { pngValid: true, resolution: [dimensions.width, dimensions.height], geometry, device: report.device, sourceHash: report.sourceHash }
}

export async function renderReview(options) {
  if (!detectBlender()) throw new Error('Blender не найден. Задайте BLENDER_PATH в .env.')
  const start = Date.now(), output = options.output, look = options.look ?? 'photoreal'
  await mkdir(output, { recursive: true })
  // Read only now, after edits are finished. One immutable snapshot is shared by
  // every shot so a concurrent model edit cannot mix revisions within this batch.
  const sourceBytes = await readFile(path.join(projectRoot, 'src/data/apartment.json'), 'utf8')
  const source = parseApartment(JSON.parse(sourceBytes))
  const staged = prepareWalkthroughApartment(source), sourceHash = hash(JSON.stringify(staged))
  const sourceFile = path.join(output, 'source-apartment.json')
  await writeFile(sourceFile, JSON.stringify(source, null, 2))
  const index = {
    schemaVersion: 1, status: 'running', startedAt: new Date(start).toISOString(),
    sourceRevision: source.revision, sourceHash, sourceFileHash: hash(sourceBytes), sourceFile: 'source-apartment.json',
    preset: options.preset, look, lightingPreset: 'day', requestedDevice: options.device,
    completed: 0, total: options.shots.length, elapsedSeconds: 0,
    shots: options.shots.map((shot) => ({ id: shot.id, room: shot.room, label: shot.label, status: 'pending' })),
  }
  const saveIndex = async () => {
    index.elapsedSeconds = elapsed(start)
    await writeFile(path.join(output, 'index.json.tmp'), JSON.stringify(index, null, 2))
    await rename(path.join(output, 'index.json.tmp'), path.join(output, 'index.json'))
  }
  let active, interrupted = false
  const cancel = () => { interrupted = true; active?.kill('SIGTERM') }
  process.once('SIGINT', cancel)
  process.once('SIGTERM', cancel)
  await saveIndex()
  try {
    for (const [i, shot] of options.shots.entries()) {
      if (interrupted) throw new Error('Рендер остановлен пользователем.')
      const item = index.shots[i], shotStart = Date.now(), directory = path.join(output, shot.id)
      Object.assign(item, { status: 'exporting', startedAt: new Date().toISOString(), image: `${shot.id}/render.png`, metadata: `${shot.id}/scene.metadata.json`, report: `${shot.id}/render-report.json`, validation: `${shot.id}/geometry-validation.json`, log: `${shot.id}/render.log` })
      await saveIndex()
      console.log(`[${i + 1}/${index.total}] ${shot.label}: экспорт · прошло ${elapsed(start)} с`)
      const room = source.rooms.find((r) => r.id === shot.room)
      if (!room?.interiorCamera) throw new Error('Нет исходной камеры комнаты: ' + shot.room)
      const presentationCamera = shot.camera ?? camera(
        [room.interiorCamera.position[0], 1600, room.interiorCamera.position[2]],
        room.interiorCamera.target,
      )
      const files = await exportHeadlessScene({ input: sourceFile, output: directory, view: 'interior', room: shot.room, lighting: 'day', camera: presentationCamera })
      const metadata = JSON.parse(await readFile(files.metadataFile, 'utf8'))
      if (metadata.sourceHash !== sourceHash) throw new Error('Изменилась исходная сцена при подготовке ракурса.')
      Object.assign(item, { status: 'rendering', sourceHash, camera: metadata.camera })
      await saveIndex()
      if (interrupted) throw new Error('Рендер остановлен пользователем.')
      console.log(`[${i + 1}/${index.total}] ${shot.label}: Blender ${options.preset} · прошло ${elapsed(start)} с`)
      const log = createWriteStream(path.join(directory, 'render.log'), { flags: 'w' })
      const ticker = setInterval(() => console.log(`[${i + 1}/${index.total}] ${shot.label}: рендер ${elapsed(shotStart)} с · всего ${elapsed(start)} с`), 20000)
      try {
        await launchBlender({ ...files, output: path.join(directory, 'render.png'), preset: options.preset, look, device: options.device,
          onLog: (chunk) => log.write(chunk), onSpawn: (child) => { active = child } })
      } finally {
        clearInterval(ticker)
        active = undefined
        log.end()
        await finished(log)
      }
      const checks = await checkedResult(directory, metadata, options.preset, look)
      Object.assign(item, { status: 'completed', checks, elapsedSeconds: elapsed(shotStart), finishedAt: new Date().toISOString() })
      index.completed++
      await saveIndex()
      console.log(`[${i + 1}/${index.total}] ${shot.label}: готово и проверено · ${item.elapsedSeconds} с · всего ${elapsed(start)} с`)
    }
    index.status = 'completed'
    index.finishedAt = new Date().toISOString()
    await saveIndex()
    console.log('Обзор сохранён: ' + path.join(output, 'index.json'))
    return index
  } catch (error) {
    index.status = interrupted ? 'interrupted' : 'failed'
    index.error = error.message
    index.finishedAt = new Date().toISOString()
    const item = index.shots.find((shot) => ['exporting', 'rendering'].includes(shot.status))
    if (item) Object.assign(item, { status: index.status, error: error.message })
    await saveIndex()
    throw error
  } finally {
    process.removeListener('SIGINT', cancel)
    process.removeListener('SIGTERM', cancel)
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    loadLocalEnv()
    const options = parseReviewArgs(process.argv.slice(2))
    if (options.help) console.log(help)
    else await renderReview(options)
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
