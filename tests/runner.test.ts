import test from 'node:test'
import assert from 'node:assert/strict'
import { validateBundle, localRenderPlugin } from '../scripts/local-render-plugin.mjs'
import { detectBlender, launchBlender, PRESETS } from '../scripts/blender-runtime.mjs'
import { Readable } from 'node:stream'
import { mkdtemp, writeFile, chmod, rm } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
function isolatedService(isBusy = () => false) {
  return Object.assign(async () => false, {
    isBusy: async () => isBusy(), isActive: isBusy, close() {},
  })
}
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
test('explicit render lighting accepts an all-off schedule and validates window shapes', () => {
  const window = {
    id: 'window', type: 'area', position: [0, 1, 0], target: [0, 1, 1],
    color: '#f1f7ff', power: 1000, width: 1.2, height: 1.5,
  }
  for (const windows of [[], [window]])
    assert.equal(validateBundle(bundle(), { ...metadata(), lightingSchedule: { fixtures: [], windows } }), true)
  assert.throws(() => validateBundle(bundle(), {
    ...metadata(), lightingSchedule: { fixtures: [], windows: [{ ...window, type: 'spot' }] },
  }), /Invalid window light source/)
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
  const plugin = localRenderPlugin({ BLENDER_PATH: '/no/such/blender' }, {
    createTourService: () => isolatedService(), createDesignService: () => isolatedService(),
  })
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

test('local still jobs serialize starts, report real samples, and cancel without serving a stale image', async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'home-render-test-'))
  const binary = path.join(temporary, 'blender-test')
  await writeFile(binary, `#!${process.execPath}\nconsole.log('CYCLES_DEVICE CPU'); console.log('Sample 12/32'); setTimeout(()=>{},10000);\n`)
  await chmod(binary, 0o755)
  let middleware: any, close: () => void = () => {}, jobId = ''
  let tourBusy = false, designBusy = false, stillOrTourBusy: () => Promise<boolean> = async () => false
  const plugin = localRenderPlugin({ BLENDER_PATH: binary }, {
    createTourService: () => isolatedService(() => tourBusy),
    createDesignService: ({ isBusy = () => false } = {}) => {
      stillOrTourBusy = async () => await isBusy()
      return isolatedService(() => designBusy)
    },
    renderDirectory: path.join(temporary, 'renders'),
  })
  plugin.configureServer({ httpServer: { on(event: string, callback: () => void) { if(event==='close') close=callback } }, middlewares: { use(fn: any) { middleware=fn } } })
  const call = async (url: string, method='GET', body='', token='') => {
    const req: any = Readable.from(body ? [Buffer.from(body)] : [])
    Object.assign(req, { url, method, headers: { host:'localhost:5173', 'x-render-token': token } })
    let output = ''
    const res: any = { statusCode:200, setHeader() {}, end(data: string) { output=data } }
    await middleware(req,res,()=>{})
    return { code:res.statusCode, data:JSON.parse(output || '{}') }
  }
  try {
    const { data: { token } } = await call('/__local/status')
    const payload = JSON.stringify({ glb:bundle().toString('base64'), metadata:metadata(), preset:'preview',device:'cpu',look:'photoreal' })
    designBusy = true
    assert.equal((await call('/__local/render','POST',payload,token)).code,409)
    assert.equal((await call('/__local/status')).data.busy,true)
    designBusy = false; tourBusy = true
    assert.equal((await call('/__local/render','POST',payload,token)).code,409)
    assert.equal(await stillOrTourBusy(),true)
    tourBusy = false
    const starts = await Promise.all([call('/__local/render','POST',payload,token),call('/__local/render','POST',payload,token)])
    assert.deepEqual(starts.map(s=>s.code).sort(),[202,409])
    jobId=starts.find(s=>s.code===202)!.data.id
    let state: any
    for(let i=0;i<100;i++) {
      state=(await call('/__local/jobs/'+jobId)).data
      if(state.samplesCompleted) break
      await new Promise(resolve=>setTimeout(resolve,20))
    }
    assert.equal(state.samplesCompleted,12)
    assert.equal(state.samplesTotal,32)
    assert.equal(state.device,'CPU')
    assert.equal(state.look,'photoreal')
    assert.equal(await stillOrTourBusy(),true)
    assert.equal((await call('/__local/tour/start','POST','{}',token)).code,409)
    assert.equal((await call('/__local/design/start','POST','{}',token)).code,409)
    assert.equal((await call('/__local/cancel/'+jobId,'POST','',token)).code,200)
    assert.equal((await call('/__local/cancel/'+jobId,'POST','',token)).code,409)
    assert.equal((await call('/__local/jobs/'+jobId)).data.status,'cancelled')
    assert.equal((await call('/__local/image/'+jobId)).code,404)
  } finally {
    close()
    await rm(temporary,{recursive:true,force:true})
  }
})
