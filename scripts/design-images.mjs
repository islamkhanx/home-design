/** Schema → immutable material alternatives → schemes + camera → Cycles images.
 * This pipeline never writes back to the apartment or its decisions.
 */
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { createHash, randomUUID } from 'node:crypto'
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises'
import { createWriteStream } from 'node:fs'
import { finished } from 'node:stream/promises'
import { parseApartment } from '../src/domain/schema.ts'
import { apartmentPlanSvg, roomCornersSvg, roomElevationSvg } from '../src/domain/studio-drawings.ts'
import { projectRoot, PRESETS, loadLocalEnv, detectBlender, launchBlender } from './blender-runtime.mjs'
import { allowedVariants, createDesignStudy, DEFAULT_DESIGN_VARIANTS, DESIGN_VARIANTS } from '../src/domain/design-variants.ts'
import { sceneGeometrySnapshot } from '../src/domain/design-composition.ts'
import { architectureFingerprint } from './design-concepts.mjs'
export { DEFAULT_DESIGN_VARIANTS, DESIGN_VARIANTS, allowedVariants, architectureFingerprint }
export { REFERENCE_DESIGN_DEFAULTS } from '../src/domain/design-variants.ts'

const sha = value => createHash('sha256').update(value).digest('hex')
export const geometryFingerprint = apartment => sha(JSON.stringify(sceneGeometrySnapshot(apartment)))
export function validateDesignOptions(options, apartment) {
  const room = apartment.rooms.find(r => r.id === options.room && r.polygon)
  if (!room) throw new Error('Выберите помещение с геометрией из текущей модели.')
  if (!Array.isArray(options.variants) || !options.variants.length || options.variants.length > DESIGN_VARIANTS.length || new Set(options.variants).size !== options.variants.length)
    throw new Error(`Выберите от одного до ${DESIGN_VARIANTS.length} разных вариантов.`)
  if (options.variants.some(id => !allowedVariants(room.id).includes(id)))
    throw new Error('Неизвестный вариант. Подтверждённая отделка санузла защищена: доступен текущий проект.')
  if (!PRESETS[options.preset] || !['auto', 'cpu', 'gpu'].includes(options.device)) throw new Error('Неверные настройки рендера.')
  return room
}
export function createDesignVariant(source, roomId, variantId) {
  validateDesignOptions({ room: roomId, variants: [variantId], preset: 'preview', device: 'auto' }, source)
  return createDesignStudy(source, variantId, roomId)
}
export function designPrompt(source, roomId, variant, decisions) {
  const room = source.rooms.find(r => r.id === roomId)
  return `Create one photorealistic interior design concept for ${room.name} (${room.id}).\n\nSOURCE PRIORITY\nUse render.png as the fixed camera and geometry reference. Use plan.svg and elevation-*.svg to verify the room, openings and furniture placement. The source JSON uses millimeters; dimensions are traced model dimensions, not verified measurements. Preserve camera, wall outlines, window/door locations, ceiling height, furniture positions and circulation. Do not enlarge this compact apartment or invent architecture, equipment or objects beyond the exported concept. The furniture silhouettes, wall panels and lighting in the reference are deliberate design changes, not a new measured floor plan.\n\nDESIGN DIRECTION\n${variant.label}: ${variant.description}${variant.reference ? `\nProject reference: ${variant.reference.title} by ${variant.reference.studio} (${variant.reference.url}).\nAdapted principle: ${variant.reference.lesson}` : ''}\nPalette: ${variant.swatches.join(', ')}.\nWalls: ${variant.features.walls}\nFurniture: ${variant.features.furniture}\nLighting: ${variant.features.lighting}\nMaterials: ${variant.features.materials}\nKeep the material assignments, wall composition, furniture style and fixtures visible in render.png. Improve believable wood pores, textile weave, soft contact shadows, glazing and daylight; restrained architectural photography, physically plausible exposure, no dollhouse or miniature look.\n\nLOCKED DECISIONS\nBathroom A3 / M1 / T1 / U1 / D2 is unchanged. HPL furniture, bathtub and hygienic shower remain. No boiler, underfloor heating or night lighting.\n${JSON.stringify(decisions.confirmed ?? {}, null, 2)}\n\nPROVENANCE\nSource revision ${source.revision}; source SHA-256 ${sha(JSON.stringify(source))}. This is a visual concept proposal. An AI image is not a measured drawing, evidence of exact geometry, or an approved design. Do not apply it to the canonical model automatically.\n`
}
async function saveJson(file, value) {
  await writeFile(file + '.tmp', JSON.stringify(value, null, 2))
  await rename(file + '.tmp', file)
}
export async function generateDesignImages(options, hooks = {}) {
  const sourceText = await readFile(options.input ?? path.join(projectRoot, 'src/data/apartment.json'), 'utf8')
  const source = parseApartment(JSON.parse(sourceText)), room = validateDesignOptions(options, source)
  const decisions = JSON.parse(await readFile(path.join(projectRoot, 'docs/bathroom-spec.json'), 'utf8'))
  if (!options.prepareOnly && !detectBlender()) throw new Error('Blender не найден. Задайте BLENDER_PATH в .env.')
  const output = path.resolve(options.output), started = Date.now()
  await mkdir(output, { recursive: true })
  const state = { schemaVersion: 1, id: options.id ?? path.basename(output), pid: process.pid, status: 'running', room: room.id, roomName: room.name,
    preset: options.preset, requestedDevice: options.device, renderer: 'blender-cycles', classification: 'proposal',
    sourceRevision: source.revision, sourceHash: sha(JSON.stringify(source)), sourceFileHash: sha(sourceText), sourceGeometryHash: geometryFingerprint(source), sourceArchitectureHash: architectureFingerprint(source),
    startedAt: new Date().toISOString(), elapsedSeconds: 0, percent: 0, completed: 0, total: options.variants.length,
    message: 'Подготавливаю схемы и варианты отделки',
    items: options.variants.map(id => ({ id, label: DESIGN_VARIANTS.find(v => v.id === id).label, status: 'pending' })),
  }
  let child, cancelled = false, saving = Promise.resolve()
  const cancel = () => { cancelled = true; child?.kill('SIGTERM') }
  const persist = () => {
    state.elapsedSeconds = Math.round((Date.now() - started) / 1000)
    const snapshot = structuredClone(state)
    saving = saving.then(() => saveJson(path.join(output, 'manifest.json'), snapshot))
    hooks.onProgress?.(snapshot)
    return saving
  }
  const checkCancellation = () => { if (cancelled || hooks.signal?.aborted) throw new Error('Генерация остановлена. Готовые изображения сохранены.') }
  process.once('SIGINT', cancel); process.once('SIGTERM', cancel)
  hooks.signal?.addEventListener('abort', cancel, { once: true })
  try {
    await writeFile(path.join(output, 'source-apartment.json'), JSON.stringify(source, null, 2))
    await writeFile(path.join(output, 'source-decisions.json'), JSON.stringify(decisions, null, 2))
    await persist()
    // The default CLI output participates in the same local gallery as UI jobs.
    if (path.dirname(output) === path.join(projectRoot, 'exports/design-images') && path.basename(output) === state.id && /^[0-9a-f-]{36}$/.test(state.id)) {
      await mkdir(path.join(projectRoot, '.renders'), { recursive: true })
      await saveJson(path.join(projectRoot, '.renders/design-images-latest.json'), { id: state.id })
    }
    for (const [index, id] of options.variants.entries()) {
      checkCancellation()
      const item = state.items[index], directory = path.join(output, id)
      const referenceStudy = DESIGN_VARIANTS.find(candidate => candidate.id === id)?.reference
      const scope = referenceStudy ? 'all' : room.id
      const { apartment, variant, changedMaterials, retainedWallFaces, geometryUnchanged, architectureUnchanged, sceneDifferences, changes, changeSummary, conceptPlacements } = createDesignStudy(source, id, scope)
      item.status = 'preparing'; state.message = `${variant.label}: схемы и экспорт сцены`
      await persist(); await mkdir(directory, { recursive: true })
      const input = path.join(directory, 'variant-apartment.json')
      await writeFile(input, JSON.stringify(apartment, null, 2))
      await writeFile(path.join(directory, 'plan.svg'), apartmentPlanSvg(apartment, 'furniture'))
      await writeFile(path.join(directory, 'room.svg'), roomCornersSvg(apartment, room.id))
      for (let edge = 0; edge < room.polygon.length; edge++) await writeFile(path.join(directory, `elevation-${edge + 1}.svg`), roomElevationSvg(apartment, room.id, edge))
      await writeFile(path.join(directory, 'prompt.txt'), designPrompt(source, room.id, variant, decisions))
      Object.assign(item, { category: variant.category, features: variant.features, lighting: variant.lighting, reference: variant.reference, scope, changes, changeSummary, conceptPlacements, changedMaterials, retainedWallFaces, sourceHash: state.sourceHash, variantHash: sha(JSON.stringify(apartment)), geometryUnchanged, architectureUnchanged, sceneDifferences,
        plan: `${id}/plan.svg`, roomPlan: `${id}/room.svg`, prompt: `${id}/prompt.txt`, elevations: room.polygon.map((_, i) => `${id}/elevation-${i + 1}.svg`) })
      await persist(); checkCancellation()
      if (options.prepareOnly) { item.status = 'prepared'; continue }
      // Scheme-only preparation does not need the heavier scene exporter.
      // Export validation is deliberately independent of the HTTP middleware.
      const { exportHeadlessScene } = await import('./export-headless.mjs')
      const files = await exportHeadlessScene({ input, output: directory, view: 'interior', room: room.id, lighting: 'day',
        ...(variant.category === 'concept' ? { conceptLighting: { roomId: room.id, style: variant.id, label: variant.label,
          ...(referenceStudy ? { roomIds: apartment.rooms.filter(r => r.id !== 'bathroom').map(r => r.id) } : {}) } } : {}) })
      const metadata = JSON.parse(await readFile(files.metadataFile, 'utf8'))
      item.status = 'rendering'; item.camera = metadata.camera
      state.message = `${variant.label}: Cycles ${options.preset}`
      await persist(); checkCancellation()
      const log = createWriteStream(path.join(directory, 'render.log'))
      let lastSaved = 0
      try {
        await launchBlender({ ...files, output: path.join(directory, 'render.png'), preset: options.preset, device: options.device, look: 'photoreal',
          onSpawn: (active) => { child = active; if (cancelled) active.kill('SIGTERM') },
          onLog: (chunk) => log.write(chunk),
          onProgress: (progress) => {
            if (progress.device) item.device = progress.device
            if (Number.isFinite(progress.progress)) state.percent = Math.max(state.percent, Math.round(100 * (index + 0.08 + 0.9 * Math.min(1, progress.progress)) / state.total))
            if (progress.phase) item.phase = progress.phase
            if (Date.now() - lastSaved > 1000) { lastSaved = Date.now(); persist().catch(() => {}) }
          },
        })
      } finally { child = null; log.end(); await finished(log) }
      checkCancellation()
      const geometry = JSON.parse(await readFile(path.join(directory, 'geometry-validation.json'), 'utf8'))
      const report = JSON.parse(await readFile(path.join(directory, 'render-report.json'), 'utf8'))
      const png = await readFile(path.join(directory, 'render.png')), size = PRESETS[options.preset]
      if (!png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) || png.readUInt32BE(16) !== size.width || png.readUInt32BE(20) !== size.height ||
          geometry.passed !== true || report.geometry?.passed !== true || report.sourceHash !== metadata.sourceHash || geometry.meshParts !== metadata.geometry.length)
        throw new Error('Не пройдена проверка изображения или геометрии после Blender.')
      Object.assign(item, { status: 'done', image: `${id}/render.png`, geometryPassed: true, device: report.device, resolution: [size.width, size.height] })
      state.completed++; state.percent = Math.round(state.completed / state.total * 100)
      await persist()
    }
    checkCancellation()
    state.status = options.prepareOnly ? 'prepared' : 'done'
    state.message = options.prepareOnly ? 'Схемы, варианты и задания готовы; рендер ещё не выполнен.' : 'Изображения готовы. Это предложения, исходный проект сохранён.'
    if (!options.prepareOnly) state.percent = 100
    state.finishedAt = new Date().toISOString()
    await persist()
    return state
  } catch (error) {
    const wasCancelled = cancelled || hooks.signal?.aborted
    state.status = wasCancelled ? 'cancelled' : 'error'
    state.error = wasCancelled ? 'Генерация остановлена. Готовые изображения сохранены.' : error.message
    state.message = state.error
    const item = state.items.find(i => ['preparing', 'rendering'].includes(i.status)); if (item) item.status = state.status
    await persist()
    if (wasCancelled) throw new Error(state.message, { cause: error })
    throw error
  } finally {
    process.removeListener('SIGINT', cancel); process.removeListener('SIGTERM', cancel)
    hooks.signal?.removeEventListener('abort', cancel)
  }
}
export function parseDesignArgs(args) {
  const id = randomUUID()
  const result = { id, room: 'living', variants: [...DEFAULT_DESIGN_VARIANTS], preset: 'draft', device: 'auto', output: path.join(projectRoot, 'exports/design-images', id) }
  for (let i = 0; i < args.length; i++) {
    const key = args[i]
    if (key === '--help') return { help: true }
    if (key === '--prepare-only') { result.prepareOnly = true; continue }
    if (!['--room', '--variants', '--preset', '--device', '--output', '--input', '--id', '--import-concept', '--job', '--variant'].includes(key) || !args[i + 1] || args[i + 1].startsWith('--')) throw new Error('Неверный параметр: ' + key)
    const value = args[++i]; result[key.slice(2)] = key === '--variants' ? value.split(',') : value
  }
  if (result.room === 'bathroom' && !args.includes('--variants')) result.variants = ['current']
  return result
}
/** An externally generated concept is a separate asset, never a replacement
 * for the schema-verified Cycles reference or a canonical model update. */
export async function importDesignConcept({ job, variant, image, referenceSourceHash = null }) {
  if (!job || !variant || !image) throw new Error('Укажите --job, --variant и --import-concept.')
  const output = path.resolve(job), manifestFile = path.join(output, 'manifest.json')
  if (referenceSourceHash !== null && !/^[0-9a-f]{64}$/.test(referenceSourceHash)) throw new Error('Invalid reference source SHA-256.')
  const state = JSON.parse(await readFile(manifestFile, 'utf8'))
  if (!['done', 'cancelled', 'error'].includes(state.status)) throw new Error('Дождитесь завершения рендера перед добавлением концепта.')
  const item = state.items?.find(i => i.id === variant && i.status === 'done')
  if (!item || !DESIGN_VARIANTS.some(v => v.id === variant)) throw new Error('Нет проверенного опорного изображения этого варианта.')
  const bytes = await readFile(path.resolve(image))
  const extension = bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ? 'png'
    : bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff ? 'jpg' : null
  if (!extension || bytes.length < 100 || bytes.length > 25 * 1024 * 1024) throw new Error('Концепт должен быть PNG или JPEG до 25 МБ.')
  const relative = `${variant}/concept.${extension}`
  await writeFile(path.join(output, relative), bytes)
  Object.assign(item, { conceptImage: relative, conceptLabel: 'AI-концепт · геометрия не проверена',
    conceptProvenance: { type: 'external-ai-concept', importedAt: new Date().toISOString(), sha256: sha(bytes), targetSourceHash: state.sourceHash, referenceSourceHash, geometryVerified: false, appliedToModel: false } })
  await saveJson(manifestFile, state)
  return { image: path.join(output, relative), manifest: manifestFile }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    loadLocalEnv()
    const options = parseDesignArgs(process.argv.slice(2))
    if (options.help) console.log('node --experimental-strip-types scripts/design-images.mjs --room living --variants current,loft,hitech,classic --preset draft --device auto\nOptional: --prepare-only (schemes and AI handoff without rendering), --output PATH, --input PATH. Bathroom: current only. Source model is never modified.\nAI concept import: --import-concept /absolute/image.png --job /absolute/job-directory --variant current')
    else if (options['import-concept']) console.log(await importDesignConcept({ job: options.job, variant: options.variant, image: options['import-concept'] }))
    else await generateDesignImages(options, { onProgress: state => console.log(`${state.percent}% · ${state.completed}/${state.total} · ${state.message}`) })
  } catch (error) { console.error(error.message); process.exitCode = 1 }
}
