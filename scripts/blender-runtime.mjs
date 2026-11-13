import { accessSync, constants, existsSync, statSync, rmSync } from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
export const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
export const PRESETS = {
  preview: { width: 960, height: 540, samples: 32, threshold: 0.08 },
  quality: { width: 1920, height: 1080, samples: 256, threshold: 0.02 },
  ultra: { width: 3840, height: 2160, samples: 1024, threshold: 0.008 },
}
export function detectBlender(env = process.env) {
  const configured = env.BLENDER_PATH
  const candidates = configured
    ? [configured]
    : [
        '/Applications/Blender.app/Contents/MacOS/Blender',
        ...(env.PATH ?? '')
          .split(path.delimiter)
          .map((p) => path.join(p, process.platform === 'win32' ? 'blender.exe' : 'blender')),
        ...['4.5', '4.4', '4.3', '4.2', '5.0', '5.1'].map(
          (v) => 'C:\\Program Files\\Blender Foundation\\Blender ' + v + '\\blender.exe',
        ),
      ]
  for (const c of candidates)
    try {
      accessSync(c, constants.X_OK)
      if (statSync(c).isFile()) return c
    } catch {}
  return null
}
export function loadLocalEnv() {
  try {
    if (existsSync(path.join(projectRoot, '.env')))
      process.loadEnvFile(path.join(projectRoot, '.env'))
  } catch (e) {
    throw new Error('Cannot read .env: ' + e.message)
  }
}
export function launchBlender(
  {
    sceneFile,
    metadataFile,
    output,
    preset = 'quality',
    device = 'auto',
    onLog = () => {},
    onSpawn = () => {},
  },
  env = process.env,
) {
  if (!PRESETS[preset]) throw new Error('Unknown render preset')
  if (!['auto', 'cpu', 'gpu'].includes(device)) throw new Error('Unknown Cycles device')
  const binary = detectBlender(env)
  if (!binary) throw new Error('Blender not found. Install Blender or set BLENDER_PATH in .env.')
  const args = [
    '--background',
    '--factory-startup',
    '--python-exit-code',
    '1',
    '--python',
    path.join(projectRoot, 'scripts/blender/render.py'),
    '--',
    '--scene',
    path.resolve(sceneFile),
    '--metadata',
    path.resolve(metadataFile),
    '--output',
    path.resolve(output),
    '--preset',
    preset,
    '--device',
    device,
  ]
  // An old PNG must never be mistaken for the result of a failed new run.
  rmSync(path.resolve(output), { force: true })
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, {
      cwd: projectRoot,
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: false,
    })
    onSpawn(child)
    let errorTail = '',
      finished = false
    const timeout = setTimeout(
      () => {
        child.kill('SIGTERM')
        reject(new Error('Render exceeded 60 minutes. Process terminated.'))
      },
      60 * 60 * 1000,
    )
    const log = (chunk) => {
      const s = String(chunk)
      errorTail = (errorTail + s).slice(-4000)
      onLog(s)
    }
    child.stdout.on('data', log)
    child.stderr.on('data', log)
    child.on('error', (e) => {
      clearTimeout(timeout)
      if (!finished) {
        finished = true
        reject(e)
      }
    })
    child.on('close', (code) => {
      clearTimeout(timeout)
      if (finished) return
      finished = true
      if (code === 0 && existsSync(output)) resolve({ output })
      else reject(new Error('Blender exited ' + code + '\n' + errorTail))
    })
  })
}
