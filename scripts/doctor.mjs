import { spawnSync } from 'node:child_process'
import { detectBlender, loadLocalEnv } from './blender-runtime.mjs'
loadLocalEnv()
console.log('Node: ' + process.version)
let missing = false
for (const p of ['vue', 'vite', 'three', '@tresjs/core', '@tresjs/cientos', 'playwright']) {
  try {
    console.log(p + ': ' + import.meta.resolve(p))
  } catch {
    console.log(p + ': MISSING (run npm install)')
    missing = true
  }
}
const blender = detectBlender()
if (blender) {
  const r = spawnSync(blender, ['--version'], { encoding: 'utf8' })
  console.log((r.stdout ?? '').split('\n')[0])
} else console.log('Blender: MISSING. Set BLENDER_PATH after installing Blender.')
process.exitCode = missing || !blender ? 1 : 0
