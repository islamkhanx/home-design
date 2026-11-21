/** Loopback-only design image jobs. The host plugin supplies origin/token checks. */
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { projectRoot, detectBlender } from './blender-runtime.mjs'
import { REFERENCE_DESIGN_DEFAULTS, DESIGN_VARIANTS, allowedVariants, validateDesignOptions } from './design-images.mjs'
import { parseApartment } from '../src/domain/schema.ts'

const uuid = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
const validId = new RegExp(`^${uuid}$`)
const statuses = new Set(['done', 'prepared', 'cancelled', 'error'])
const variantIds = new Set(DESIGN_VARIANTS.map(v => v.id).filter(id => /^[a-z][a-z0-9-]*$/.test(id)))
const publicVariants = DESIGN_VARIANTS.map(({ id, label, description, swatches, category, features, lighting, reference }) => ({
  id, label, description, swatches, category, features, lighting, reference,
}))
export function designService({ env = process.env, isBusy = () => false } = {}) {
  const root = path.join(projectRoot, 'exports/design-images'), pointer = path.join(projectRoot, '.renders/design-images-latest.json')
  let child = null, starting = false, activeId = null
  const directory = (id) => {
    if (!validId.test(id)) throw new Error('Invalid design job ID.')
    return path.join(root, id)
  }
  const readState = async (id) => JSON.parse(await readFile(path.join(directory(id), 'manifest.json'), 'utf8'))
  const saveState = async (id, state) => {
    const file = path.join(directory(id), 'manifest.json')
    await writeFile(file + '.service.tmp', JSON.stringify(state, null, 2)); await rename(file + '.service.tmp', file)
  }
  const latest = async () => {
    try { const p = JSON.parse(await readFile(pointer, 'utf8')); return validId.test(p.id) ? p.id : null }
    catch (e) { if (e.code === 'ENOENT') return null; throw e }
  }
  const living = (pid) => { if (!Number.isInteger(pid) || pid < 1) return false; try { process.kill(pid, 0); return true } catch (e) { return e.code !== 'ESRCH' } }
  const busy = async () => {
    if (starting || child) return true
    const id = await latest()
    if (!id) return false
    try { const s = await readState(id); return !statuses.has(s.status) && living(s.pid) }
    catch (e) { if (e.code === 'ENOENT') return false; throw e }
  }
  const publicState = async (id) => {
    const state = await readState(id)
    if (!statuses.has(state.status) && id !== activeId && !living(state.pid)) {
      state.status = 'error'; state.error = 'Процесс генерации остановлен. Готовые изображения сохранены.'; state.message = state.error
    }
    const assetUrl = (file) => `/__local/design/asset/${id}/${file}`
    const result = { ...state, elapsedSeconds: statuses.has(state.status) ? state.elapsedSeconds : Math.round((Date.now() - Date.parse(state.startedAt)) / 1000),
      items: state.items.map(item => ({ ...item,
        ...(item.image ? { image: assetUrl(item.image) } : {}), ...(item.plan ? { plan: assetUrl(item.plan) } : {}),
        ...(item.roomPlan ? { roomPlan: assetUrl(item.roomPlan) } : {}), ...(item.prompt ? { prompt: assetUrl(item.prompt) } : {}),
        ...(item.conceptImage ? { conceptImage: assetUrl(item.conceptImage) } : {}),
        ...(item.elevations ? { elevations: item.elevations.map(assetUrl) } : {}),
      })) }
    delete result.pid
    return result
  }
  const handle = async (req, res, pathname, send) => {
    if (!pathname.startsWith('/__local/design/')) return false
    if (pathname === '/__local/design/catalog' && req.method === 'GET') {
      const source = parseApartment(JSON.parse(await readFile(path.join(projectRoot, 'src/data/apartment.json'), 'utf8')))
      send(res, 200, { available: !!detectBlender(env), latestJobId: await latest(),
        defaultVariants: REFERENCE_DESIGN_DEFAULTS,
        rooms: source.rooms.filter(r => r.polygon).map(r => ({ id: r.id, name: r.name, allowedVariants: allowedVariants(r.id) })),
        variants: publicVariants,
        message: 'Для создания изображений нужен локальный Blender.' })
      return true
    }
    if (pathname === '/__local/design/start' && req.method === 'POST') {
      if (await busy() || await isBusy()) { send(res, 409, { error: 'Другой рендер уже выполняется.' }); return true }
      // Reserve before request parsing or writes; release on every rejected start.
      if (starting || child) { send(res, 409, { error: 'Генерация уже запускается.' }); return true }
      starting = true
      try {
        let size = 0, body = ''
        for await (const chunk of req) { size += chunk.length; if (size > 2048) { send(res, 413, { error: 'Request too large.' }); return true }; body += chunk }
        const requested = JSON.parse(body || '{}')
        const options = { room: requested.room ?? 'living', variants: requested.variants ?? (requested.room === 'bathroom' ? ['current'] : REFERENCE_DESIGN_DEFAULTS), preset: requested.preset ?? 'draft', device: requested.device ?? 'auto' }
        const source = parseApartment(JSON.parse(await readFile(path.join(projectRoot, 'src/data/apartment.json'), 'utf8')))
        const room = validateDesignOptions(options, source)
        if (!detectBlender(env)) { send(res, 503, { error: 'Blender не найден. Задайте BLENDER_PATH в .env.' }); return true }
        const id = randomUUID(), out = directory(id)
        await mkdir(out, { recursive: true }); await mkdir(path.dirname(pointer), { recursive: true })
        await saveState(id, { id, status: 'starting', room: room.id, roomName: room.name, preset: options.preset, startedAt: new Date().toISOString(), elapsedSeconds: 0,
          completed: 0, total: options.variants.length, percent: 0, message: 'Запускаю генератор схем и изображений',
          items: options.variants.map(v => ({ id: v, label: DESIGN_VARIANTS.find(x => x.id === v).label, status: 'pending' })) })
        await writeFile(pointer, JSON.stringify({ id }))
        const worker = spawn(process.execPath, ['--experimental-strip-types', path.join(projectRoot, 'scripts/design-images.mjs'), '--id', id, '--room', options.room,
          '--variants', options.variants.join(','), '--preset', options.preset, '--device', options.device, '--output', out],
          { cwd: projectRoot, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] })
        child = worker; activeId = id
        let tail = ''
        const log = chunk => { tail = (tail + chunk).slice(-4000) }
        worker.stdout.on('data', log); worker.stderr.on('data', log)
        const failed = async (message) => {
          try { const s = await readState(id); if (!statuses.has(s.status)) await saveState(id, { ...s, status: 'error', error: message, message }) } catch {}
        }
        worker.on('error', error => { void failed(error.message); if (child === worker) { child = null; activeId = null } })
        worker.on('close', code => { if (code !== 0) void failed('Генерация остановлена: ' + tail); if (child === worker) { child = null; activeId = null } })
        send(res, 202, { id, status: 'starting' }); return true
      } finally { starting = false }
    }
    const job = pathname.match(new RegExp(`^/__local/design/(jobs|cancel)/(${uuid})$`))
    if (job) {
      try {
        if (job[1] === 'jobs' && req.method === 'GET') { send(res, 200, await publicState(job[2])); return true }
        if (job[1] === 'cancel' && req.method === 'POST') {
          const state = await readState(job[2])
          if (!statuses.has(state.status)) {
            // Only signal a child owned by this server. An abandoned job can be
            // inspected after restart, but arbitrary saved PIDs are never killed.
            if (activeId !== job[2] || !child) { send(res, 409, { error: 'Процесс не принадлежит этому серверу. Остановите его в исходном терминале.' }); return true }
            child.kill('SIGTERM')
          }
          send(res, 200, { id: job[2], status: statuses.has(state.status) ? state.status : 'cancelling' }); return true
        }
      } catch (e) { if (e.code === 'ENOENT') { send(res, 404, { error: 'Неизвестная генерация.' }); return true }; throw e }
    }
    const asset = pathname.match(new RegExp(`^/__local/design/asset/(${uuid})/([a-z][a-z0-9-]*)/(render\\.png|concept\\.(?:png|jpg)|plan\\.svg|room\\.svg|prompt\\.txt|elevation-[1-9][0-9]*\\.svg)$`))
    if (asset && variantIds.has(asset[2]) && req.method === 'GET') {
      try {
        const file = asset[3], data = await readFile(path.join(directory(asset[1]), asset[2], file))
        res.setHeader('Content-Type', file.endsWith('.png') ? 'image/png' : file.endsWith('.jpg') ? 'image/jpeg' : file.endsWith('.svg') ? 'image/svg+xml' : 'text/plain; charset=utf-8')
        res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Cache-Control', 'no-store'); res.end(data)
      } catch (e) { if (e.code === 'ENOENT') send(res, 404, { error: 'Файл ещё не готов.' }); else throw e }
      return true
    }
    send(res, 404, { error: 'Unknown design route.' }); return true
  }
  handle.isActive = () => starting || !!child
  handle.isBusy = busy
  handle.close = () => { child?.kill('SIGTERM') }
  return handle
}
