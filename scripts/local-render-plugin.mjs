import { randomBytes, randomUUID } from 'node:crypto'
import { mkdir, writeFile, readFile } from 'node:fs/promises'
import path from 'node:path'
import { detectBlender, launchBlender, projectRoot, PRESETS } from './blender-runtime.mjs'
import { tourService } from './tour-service.mjs'
import { designService } from './design-service.mjs'
import { validateBundle } from './render-bundle.mjs'
export { validateBundle } from './render-bundle.mjs'
// Service/storage injection keeps integration tests independent of real,
// possibly still-running jobs. Production always uses persisted service locks.
export function localRenderPlugin(env = process.env, {
  createTourService = tourService,
  createDesignService = designService,
  renderDirectory = path.join(projectRoot, '.renders'),
} = {}) {
  const handleTour=createTourService()
  const token = randomBytes(32).toString('hex'),
    jobs = new Map()
  let active = null
  let reserved = false
  const handleDesign = createDesignService({env, isBusy: async () => !!active || await handleTour.isBusy()})
  const send = (res, code, data) => {
    res.statusCode = code
    res.setHeader('Content-Type', 'application/json')
    res.setHeader('Cache-Control', 'no-store')
    res.end(JSON.stringify(data))
  }
  return {
    name: 'local-blender-runner',
    configureServer(server) {
      server.httpServer?.on('close', () => {
        for (const j of jobs.values()) j.child?.kill('SIGTERM')
        handleDesign.close()
      })
      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith('/__local/')) return next()
        try {
          const host = req.headers.host ?? ''
          if (!/^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/.test(host))
            return send(res, 403, { error: 'Loopback host required.' })
          if (req.headers.origin && req.headers.origin !== 'http://' + host)
            return send(res, 403, { error: 'Same-origin access required.' })
          if (req.headers['sec-fetch-site'] === 'cross-site')
            return send(res, 403, { error: 'Cross-site request rejected.' })
          const pathname = new URL(req.url, 'http://' + host).pathname
          if (pathname === '/__local/status' && req.method === 'GET') {
            const available = !!detectBlender(env)
            return send(res, 200, {
              available,
              token,
              busy: !!active || reserved || await handleDesign.isBusy() || await handleTour.isBusy(),
              message: available
                ? 'Blender найден. Рендер выполняется на этом компьютере.'
                : 'Blender не установлен или не найден. Задай BLENDER_PATH в .env.',
            })
          }
          if (req.method === 'POST' && req.headers['x-render-token'] !== token)
            return send(res, 403, { error: 'Invalid local render token.' })
          const isStart = req.method === 'POST' && (pathname === '/__local/render' || /^\/__local\/tour\/(start|resume)$/.test(pathname) || pathname === '/__local/design/start')
          if (isStart && (active || reserved || await handleDesign.isBusy() || await handleTour.isBusy()))
            return send(res, 409, { error: 'A render or video tour is already running.' })
          // Another start may have reserved the slot while the disk lock was read.
          if (isStart && reserved) return send(res, 409, { error: 'A render is starting.' })
          if (isStart) reserved = true
          try {
          if (await handleDesign(req,res,pathname,send)) return
          if (await handleTour(req,res,pathname,send)) return
          if (pathname === '/__local/render' && req.method === 'POST') {
            if (active) return send(res, 409, { error: 'A render is already running.' })
            let size = 0,
              chunks = []
            for await (const chunk of req) {
              size += chunk.length
              if (size > 100 * 1024 * 1024)
                return send(res, 413, { error: 'Scene exceeds 100 MB.' })
              chunks.push(chunk)
            }
            const body = JSON.parse(Buffer.concat(chunks).toString()),
              glb = Buffer.from(body.glb ?? '', 'base64')
            validateBundle(glb, body.metadata)
            const look = body.look ?? 'photoreal'
            if (!PRESETS[body.preset] || !['auto', 'cpu', 'gpu'].includes(body.device) || !['photoreal','review'].includes(look))
              return send(res, 400, { error: 'Invalid preset or device.' })
            if (!detectBlender(env))
              return send(res, 503, { error: 'Blender not found. Set BLENDER_PATH.' })
            // Reserve the slot before asynchronous disk I/O to prevent concurrent starts.
            if (active) return send(res, 409, { error: 'A render is already running.' })
            const id = randomUUID()
            active = id
            try {
              const dir = path.join(renderDirectory, id)
              await mkdir(dir, { recursive: true })
              const sceneFile = path.join(dir, 'scene.glb'),
                metadataFile = path.join(dir, 'scene.metadata.json'),
                output = path.join(dir, 'render.png')
              await writeFile(sceneFile, glb)
              await writeFile(metadataFile, JSON.stringify(body.metadata, null, 2))
              const job = { id, status: 'running', phase: 'starting', progress: 0, log: '', output, startedAt: Date.now(), preset: body.preset, look }
              jobs.set(id, job)
              launchBlender(
                {
                  sceneFile,
                  metadataFile,
                  output,
                  preset: body.preset,
                  device: body.device,
                  look,
                  onProgress: (update) => { if(job.status === 'running') Object.assign(job, update) },
                  onLog: (s) => {
                    job.log = (job.log + s).slice(-24000)
                  },
                  onSpawn: (c) => (job.child = c),
                },
                env,
              )
                .then(() => {
                  if (job.status !== 'cancelled') { job.status = 'done'; job.phase = 'done'; job.progress = 1 }
                })
                .catch((e) => {
                  if (job.status !== 'cancelled') {
                    job.status = 'error'
                    job.phase = 'error'
                    job.error = e.message
                  }
                })
                .finally(() => {
                  job.finishedAt = Date.now()
                  active = null
                  delete job.child
                })
              return send(res, 202, { id, status: 'running' })
            } catch (e) {
              active = null
              throw e
            }
          }
          const match = pathname.match(/^\/__local\/(jobs|image|cancel)\/([0-9a-f-]{36})$/)
          if (match) {
            const j = jobs.get(match[2])
            if (!j) return send(res, 404, { error: 'Unknown render job.' })
            if (match[1] === 'jobs' && req.method === 'GET')
              return send(res, 200, { id: j.id, status: j.status, phase:j.phase, progress:j.progress, samplesCompleted:j.samplesCompleted, samplesTotal:j.samplesTotal, device:j.device, elapsedSeconds:((j.finishedAt ?? Date.now())-j.startedAt)/1000, log: j.log, error: j.error, preset:j.preset, look:j.look })
            if (match[1] === 'cancel' && req.method === 'POST') {
              if (j.status !== 'running') return send(res, 409, {error:'This render is no longer running.'})
              j.status = 'cancelled'
              j.phase = 'cancelled'
              j.child?.kill('SIGTERM')
              return send(res, 200, { status: 'cancelled' })
            }
            if (match[1] === 'image' && req.method === 'GET' && j.status === 'done') {
              res.setHeader('Content-Type', 'image/png')
              res.setHeader('Cache-Control', 'no-store')
              res.end(await readFile(j.output))
              return
            }
          }
          send(res, 404, { error: 'Unknown local route.' })
          } finally { if (isStart) reserved = false }
        } catch (e) {
          send(res, 400, { error: e.message })
        }
      })
    },
  }
}
