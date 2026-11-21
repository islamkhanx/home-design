import path from 'node:path'
import { exportBrowserScene } from './export-scene.mjs'
import { launchBlender, loadLocalEnv, projectRoot, detectBlender } from './blender-runtime.mjs'
loadLocalEnv()
const args = process.argv.slice(2),
  preset = args[0] ?? 'quality',
  get = (k) => (args.includes(k) ? args[args.indexOf(k) + 1] : undefined)
let activeRender
const cancel = () => {
  process.exitCode = 130
  activeRender?.kill('SIGTERM')
}
process.once('SIGINT', cancel)
process.once('SIGTERM', cancel)
try {
  if (!detectBlender())
    throw new Error(
      'Blender not found. Install it and set BLENDER_PATH in .env; geometry is not rendered by a cloud service.',
    )
  const out = get('--output') ?? path.join(projectRoot, 'exports', preset)
  const files = args.includes('--reuse')
    ? {
        sceneFile: path.join(out, 'scene.glb'),
        metadataFile: path.join(out, 'scene.metadata.json'),
      }
    : await (
        args.includes('--headless')
          ? (await import('./export-headless.mjs')).exportHeadlessScene
          : exportBrowserScene
      )({
        input: get('--input'),
        output: out,
        view: get('--view') ?? 'dollhouse',
        lighting: get('--lighting') ?? 'day',
        room: get('--room') ?? 'all',
      })
  await launchBlender({
    ...files,
    output: path.join(out, 'render.png'),
    preset,
    look: get('--look') ?? 'review',
    device: get('--device') ?? process.env.CYCLES_DEVICE ?? 'auto',
    onLog: (s) => process.stdout.write(s),
    onSpawn: (child) => {
      activeRender = child
    },
  })
  console.log('Saved ' + path.join(out, 'render.png'))
} catch (e) {
  console.error(e.message)
  process.exitCode ||= 1
} finally {
  process.removeListener('SIGINT', cancel)
  process.removeListener('SIGTERM', cancel)
}
