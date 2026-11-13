import { randomBytes, randomUUID } from 'node:crypto'
import { mkdir, writeFile, readFile } from 'node:fs/promises'
import path from 'node:path'
import { detectBlender, launchBlender, projectRoot, PRESETS } from './blender-runtime.mjs'
export function validateBundle(glb, metadata) {
  if (
    !Buffer.isBuffer(glb) ||
    glb.length < 20 ||
    glb.readUInt32LE(0) !== 0x46546c67 ||
    glb.readUInt32LE(4) !== 2 ||
    glb.readUInt32LE(8) !== glb.length
  )
    throw new Error('Invalid GLB header or length.')
  const jsonLength = glb.readUInt32LE(12)
  if (glb.readUInt32LE(16) !== 0x4e4f534a || jsonLength > glb.length - 20)
    throw new Error('Missing GLB JSON.')
  const data = JSON.parse(glb.subarray(20, 20 + jsonLength).toString())
  for (const asset of [...(data.images ?? []), ...(data.buffers ?? [])])
    if (asset.uri && !asset.uri.startsWith('data:'))
      throw new Error('GLB must embed textures and buffers.')
  if (
    metadata?.schemaVersion !== 1 ||
    metadata.units !== 'm' ||
    !Array.isArray(metadata.geometry) ||
    metadata.geometry.length > 100000 ||
    !Array.isArray(metadata.visibleEntityIds) ||
    !metadata.camera
  )
    throw new Error('Invalid scene metadata.')
  const finiteVector = (v) =>
    Array.isArray(v) &&
    v.length === 3 &&
    v.every((x) => typeof x === 'number' && Number.isFinite(x) && Math.abs(x) < 1e5)
  for (const p of metadata.geometry)
    if (typeof p.id !== 'string' || !finiteVector(p.min) || !finiteVector(p.max))
      throw new Error('Invalid geometry manifest.')
  for (const key of ['position', 'target', 'up'])
    if (!finiteVector(metadata.camera[key])) throw new Error('Invalid camera.')
  return true
}
export function localRenderPlugin(env = process.env) {
  const token = randomBytes(32).toString('hex'),
    jobs = new Map()
  let active = null
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
              message: available
                ? 'Blender найден. Рендер выполняется на этом компьютере.'
                : 'Blender не установлен или не найден. Задай BLENDER_PATH в .env.',
            })
          }
          if (req.method === 'POST' && req.headers['x-render-token'] !== token)
            return send(res, 403, { error: 'Invalid local render token.' })
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
            if (!PRESETS[body.preset] || !['auto', 'cpu', 'gpu'].includes(body.device))
              return send(res, 400, { error: 'Invalid preset or device.' })
            if (!detectBlender(env))
              return send(res, 503, { error: 'Blender not found. Set BLENDER_PATH.' })
            // Reserve the slot before asynchronous disk I/O to prevent concurrent starts.
            if (active) return send(res, 409, { error: 'A render is already running.' })
            const id = randomUUID()
            active = id
            try {
              const dir = path.join(projectRoot, '.renders', id)
              await mkdir(dir, { recursive: true })
              const sceneFile = path.join(dir, 'scene.glb'),
                metadataFile = path.join(dir, 'scene.metadata.json'),
                output = path.join(dir, 'render.png')
              await writeFile(sceneFile, glb)
              await writeFile(metadataFile, JSON.stringify(body.metadata, null, 2))
              const job = { id, status: 'running', log: '', output }
              jobs.set(id, job)
              launchBlender(
                {
                  sceneFile,
                  metadataFile,
                  output,
                  preset: body.preset,
                  device: body.device,
                  onLog: (s) => {
                    job.log = (job.log + s).slice(-24000)
                  },
                  onSpawn: (c) => (job.child = c),
                },
                env,
              )
                .then(() => {
                  if (job.status !== 'cancelled') job.status = 'done'
                })
                .catch((e) => {
                  if (job.status !== 'cancelled') {
                    job.status = 'error'
                    job.error = e.message
                  }
                })
                .finally(() => {
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
              return send(res, 200, { id: j.id, status: j.status, log: j.log, error: j.error })
            if (match[1] === 'cancel' && req.method === 'POST') {
              j.status = 'cancelled'
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
        } catch (e) {
          send(res, 400, { error: e.message })
        }
      })
    },
  }
}
