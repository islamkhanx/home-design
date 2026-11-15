import { mkdir, writeFile, readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { projectRoot, loadLocalEnv } from './blender-runtime.mjs'
export async function exportBrowserScene({
  input,
  output = path.join(projectRoot, 'exports/latest'),
  view = 'dollhouse',
  lighting = 'day',
  room = 'all',
} = {}) {
  loadLocalEnv()
  const { createServer } = await import('vite'),
    { chromium } = await import('playwright')
  const server = await createServer({
    root: projectRoot,
    server: { host: '127.0.0.1', port: 0, strictPort: false },
    logLevel: 'error',
  })
  await server.listen()
  const address = server.httpServer.address()
  const chrome =
    process.env.CHROME_PATH ??
    (existsSync('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
      ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
      : undefined)
  let browser
  try {
    browser = await chromium.launch({
      headless: true,
      executablePath: chrome,
      args: ['--enable-webgl', '--enable-unsafe-swiftshader'],
    })
    const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
    const errors = []
    page.on('pageerror', (e) => errors.push(e.message))
    await page.goto('http://127.0.0.1:' + address.port + '/?export=1')
    await page.waitForFunction(() => window.__HOME_DESIGN__?.ready, {}, { timeout: 60000 })
    if (input) {
      const json = JSON.parse(await readFile(path.resolve(input), 'utf8'))
      await page.evaluate((a) => window.__HOME_DESIGN__.setModel(a), json)
      await page.waitForFunction(() => window.__HOME_DESIGN__.ready)
    }
    await page.evaluate((r) => window.__HOME_DESIGN__.setRoom(r), room)
    await page.evaluate((v) => window.__HOME_DESIGN__.setView(v), view)
    await page.evaluate((value) => window.__HOME_DESIGN__.setLighting(value), lighting)
    const payload = await page.evaluate(() => window.__HOME_DESIGN__.export())
    if (errors.length) throw new Error('Browser errors: ' + errors.join('\n'))
    await mkdir(output, { recursive: true })
    const glb = Buffer.from(payload.glb, 'base64')
    const { validateBundle } = await import('./local-render-plugin.mjs')
    validateBundle(glb, payload.metadata)
    await writeFile(path.join(output, 'scene.glb'), glb)
    await writeFile(
      path.join(output, 'scene.metadata.json'),
      JSON.stringify(payload.metadata, null, 2),
    )
    await writeFile(
      path.join(output, 'apartment.json'),
      JSON.stringify(payload.metadata.sourceApartment, null, 2),
    )
    const screenshot = await page.evaluate(() => window.__HOME_DESIGN__.screenshot())
    await writeFile(path.join(output, 'fast.png'), Buffer.from(screenshot.split(',')[1], 'base64'))
    return {
      sceneFile: path.join(output, 'scene.glb'),
      metadataFile: path.join(output, 'scene.metadata.json'),
      output,
      parts: payload.metadata.geometry.length,
    }
  } finally {
    await browser?.close()
    await server.close()
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2),
    get = (k) => (args.includes(k) ? args[args.indexOf(k) + 1] : undefined)
  exportBrowserScene({
    input: get('--input'),
    output: get('--output'),
    view: get('--view') ?? 'dollhouse',
    lighting: get('--lighting') ?? 'day',
    room: get('--room') ?? 'all',
  })
    .then((r) => console.log('Exported ' + r.parts + ' mesh parts to ' + r.output))
    .catch((e) => {
      console.error(e.message)
      process.exitCode = 1
    })
}
