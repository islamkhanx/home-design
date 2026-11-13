import assert from 'node:assert/strict'
import { mkdir, writeFile, readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { createServer } from 'vite'
import { chromium } from 'playwright'
import { projectRoot, loadLocalEnv, detectBlender, launchBlender } from './blender-runtime.mjs'
import { validateBundle } from './local-render-plugin.mjs'
loadLocalEnv()
const out = path.join(projectRoot, '.artifacts/smoke')
await mkdir(out, { recursive: true })
const server = await createServer({
  root: projectRoot,
  server: { host: '127.0.0.1', port: 0, strictPort: false },
  logLevel: 'error',
})
let browser
try {
  await server.listen()
  const executablePath =
    process.env.CHROME_PATH ??
    (existsSync('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
      ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
      : undefined)
  browser = await chromium.launch({
    headless: true,
    executablePath,
    args: ['--enable-webgl', '--enable-unsafe-swiftshader'],
  })
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } }),
    errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('http://127.0.0.1:' + server.httpServer.address().port + '/?export=1')
  await page.waitForFunction(() => window.__HOME_DESIGN__?.ready, null, { timeout: 60000 })
  assert.equal(
    await page.locator('input[type=number], input[type=color], textarea, input[type=file]').count(),
    0,
    'Public UI must be read-only',
  )
  assert.equal(
    await page.getByRole('button', { name: /Export|Удалить|Добавить|PERFECT/ }).count(),
    0,
  )
  const sourceBefore = await page.evaluate(() => JSON.stringify(window.__HOME_DESIGN__.model))
  for (const [label, type] of [
    ['План', 'orthographic'],
    ['Внутри', 'perspective'],
    ['Общий вид', 'orthographic'],
  ]) {
    await page.getByRole('button', { name: label, exact: true }).click()
    const result = await page.evaluate(() => window.__HOME_DESIGN__.export())
    assert.equal(result.metadata.camera.type, type)
    assert.equal(result.metadata.roundTrip.passed, true)
  }
  for (const label of ['Основной', 'Вечер', 'Материалы']) {
    await page.getByRole('button', { name: label, exact: true }).click()
    assert.equal(
      await page.getByRole('button', { name: label, exact: true }).getAttribute('aria-pressed'),
      'true',
    )
  }
  assert.equal(
    await page.evaluate(() => JSON.stringify(window.__HOME_DESIGN__.model)),
    sourceBefore,
    'View controls must not change the design',
  )
  const payload = await page.evaluate(() => window.__HOME_DESIGN__.export()),
    glb = Buffer.from(payload.glb, 'base64')
  validateBundle(glb, payload.metadata)
  await writeFile(path.join(out, 'scene.glb'), glb)
  await writeFile(path.join(out, 'scene.metadata.json'), JSON.stringify(payload.metadata, null, 2))
  await page.screenshot({ path: path.join(out, 'viewer.png'), fullPage: true })
  const png = await page.evaluate(() => window.__HOME_DESIGN__.screenshot())
  assert.ok(png.startsWith('data:image/png;base64,'))
  await writeFile(path.join(out, 'fast.png'), Buffer.from(png.split(',')[1], 'base64'))
  assert.deepEqual(errors, [], 'No browser runtime errors')
  if (process.argv.includes('--blender')) {
    assert.ok(detectBlender(), 'Blender required for --blender smoke test')
    const output = path.join(out, 'perfect.png')
    await launchBlender({
      sceneFile: path.join(out, 'scene.glb'),
      metadataFile: path.join(out, 'scene.metadata.json'),
      output,
      preset: 'preview',
      device: 'cpu',
      onLog: (s) => process.stdout.write(s),
    })
    const image = await readFile(output)
    assert.equal(image.readUInt32BE(16), 960)
    assert.equal(image.readUInt32BE(20), 540)
    const check = JSON.parse(await readFile(path.join(out, 'geometry-validation.json'), 'utf8'))
    assert.equal(check.passed, true)
    assert.equal(check.meshParts, payload.metadata.geometry.length)
  }
  console.log(
    'PASS: read-only UI, cameras, lighting controls, canonical GLB round trip, PNG' +
      (process.argv.includes('--blender') ? ', Cycles import and render' : ''),
  )
} finally {
  await browser?.close()
  await server.close()
}
