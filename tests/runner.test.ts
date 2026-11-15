import test from 'node:test'
import assert from 'node:assert/strict'
import { validateBundle, localRenderPlugin } from '../scripts/local-render-plugin.mjs'
import { detectBlender, launchBlender, PRESETS } from '../scripts/blender-runtime.mjs'
import { Readable } from 'node:stream'
function bundle(doc: object = { asset: { version: '2.0' } }) {
  const json = Buffer.from(
    JSON.stringify(doc).padEnd(Math.ceil(JSON.stringify(doc).length / 4) * 4, ' '),
  )
  const b = Buffer.alloc(20 + json.length)
  b.writeUInt32LE(0x46546c67, 0)
  b.writeUInt32LE(2, 4)
  b.writeUInt32LE(b.length, 8)
  b.writeUInt32LE(json.length, 12)
  b.writeUInt32LE(0x4e4f534a, 16)
  json.copy(b, 20)
  return b
}
const metadata = () => ({
  schemaVersion: 1,
  units: 'm',
  geometry: [],
  visibleEntityIds: [],
  camera: { position: [1, 2, 3], target: [0, 0, 0], up: [0, 1, 0] },
})
test('GLB version, size, JSON and meter metadata validated', () => {
  assert.equal(validateBundle(bundle(), metadata()), true)
  assert.throws(() => validateBundle(Buffer.from('bad'), metadata()))
  const b = bundle()
  b.writeUInt32LE(5, 8)
  assert.throws(() => validateBundle(b, metadata()))
  assert.throws(() => validateBundle(bundle(), { ...metadata(), units: 'mm' }))
})
test('GLB cannot reference external files or remote textures', () => {
  for (const uri of ['/etc/passwd', 'file:///tmp/a', 'https://example.com/a'])
    assert.throws(() => validateBundle(bundle({ images: [{ uri }] }), metadata()))
})
test('camera NaN and corrupt bounds rejected', () => {
  const m = metadata()
  m.camera.position = [NaN, 0, 0]
  assert.throws(() => validateBundle(bundle(), m))
  assert.throws(() =>
    validateBundle(bundle(), {
      ...metadata(),
      geometry: [{ id: 'a', min: [0, 0, 0], max: [null, 1, 1] }],
    }),
  )
})
test('presets are explicit and missing Blender fails immediately', () => {
  assert.deepEqual(
    [PRESETS.preview.width, PRESETS.quality.width, PRESETS.ultra.width],
    [960, 1920, 3840],
  )
  assert.equal(detectBlender({ BLENDER_PATH: '/no/such/blender' }), null)
  assert.throws(() =>
    launchBlender({ sceneFile: 'a', metadataFile: 'b', output: 'c', preset: 'shell command' }, {}),
  )
  assert.throws(() =>
    launchBlender(
      { sceneFile: 'a', metadataFile: 'b', output: 'c' },
      { BLENDER_PATH: '/no/such/blender' },
    ),
  )
})
async function request(url: string, headers: Record<string, string>, method = 'GET', body = '') {
  let middleware: any
  const plugin = localRenderPlugin({ BLENDER_PATH: '/no/such/blender' })
  plugin.configureServer({
    httpServer: { on() {} },
    middlewares: {
      use(fn: any) {
        middleware = fn
      },
    },
  })
  const req: any = Readable.from(body ? [Buffer.from(body)] : [])
  Object.assign(req, { url, headers, method })
  let result = ''
  const res: any = {
    statusCode: 200,
    setHeader() {},
    end(s: string) {
      result = s
    },
  }
  await middleware(req, res, () => {
    res.statusCode = 404
  })
  return { code: res.statusCode, data: JSON.parse(result || '{}') }
}
test('runner rejects remote hosts, cross origins and missing token', async () => {
  assert.equal((await request('/__local/status', { host: 'evil.example' })).code, 403)
  assert.equal(
    (await request('/__local/status', { host: 'localhost:5173', origin: 'https://evil.example' }))
      .code,
    403,
  )
  assert.equal(
    (await request('/__local/render', { host: 'localhost:5173' }, 'POST', '{}')).code,
    403,
  )
  const status = await request('/__local/status', { host: 'localhost:5173' })
  assert.equal((await request('/__local/tour/start', { host: 'localhost:5173' }, 'POST', '{}')).code,403)
  assert.equal(status.code, 200)
  assert.equal(status.data.available, false)
  assert.equal(status.data.token.length, 64)
})
