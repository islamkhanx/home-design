import {
  buildCanonical,
  applyVisibility,
  visibleEntities,
  disposeTree,
} from '../src/scene/canonical.ts'
import { lightingSpecs } from '../src/scene/lighting.ts'
import { renderNotice } from '../src/scene/provenance.ts'
import { prepareWalkthroughApartment, buildWalkthrough } from './walkthrough-path.mjs'

export const TOUR_PRESETS = {
  draft: { width: 480, height: 270, samples: 8, threshold: 0.12 },
  preview: { width: 960, height: 540, samples: 32, threshold: 0.07 },
  quality: { width: 1920, height: 1080, samples: 128, threshold: 0.025 },
}
export function validateTourOptions({
  preset = 'preview',
  seconds = 60,
  fps = 24,
  device = 'auto',
} = {}) {
  if (!Object.hasOwn(TOUR_PRESETS, preset)) throw new Error('Unknown tour preset')
  if (!Number.isFinite(seconds) || seconds < 2 || seconds > 180)
    throw new Error('Duration must be 2–180 seconds')
  if (![12, 24, 30].includes(fps)) throw new Error('FPS must be 12, 24 or 30')
  if (!['auto', 'cpu', 'gpu'].includes(device)) throw new Error('Unknown Cycles device')
  return {
    preset,
    seconds,
    fps,
    device,
    ...TOUR_PRESETS[preset],
    totalFrames: Math.round(seconds * fps),
  }
}
export async function buildTourPlan(a, options) {
  const settings = validateTourOptions(options),
    staged = prepareWalkthroughApartment(a),
    root = await buildCanonical(staged)
  try {
    applyVisibility(root, staged, 'all', 'interior', false, true)
    const walk = buildWalkthrough(staged, root, settings)
    const camera = {
      type: 'perspective',
      ...walk.frames[0],
      up: [0, 1, 0],
      fov: 62,
      verticalSpan: 5,
      near: 0.025,
      far: 200,
    }
    const shots = [
      {
        room: 'all',
        view: 'interior',
        title: 'Прогулка по квартире',
        startFrame: 1,
        endFrame: settings.totalFrames,
        camera,
        visibleEntityIds: visibleEntities(root),
        lights: lightingSpecs(staged, 'all', 'day'),
        lightingPreset: 'day',
        walkthroughRooms: staged.rooms,
        renderNotice: renderNotice(a, 'all'),
      },
    ]
    return {
      version: 2,
      sourceRevision: a.revision,
      settings,
      shots,
      walkthrough: walk,
      roomNames: Object.fromEntries(staged.rooms.map((r) => [r.id, r.name])),
      presentationNote:
        'Interior doors posed open for the walkthrough; source architecture and saved design unchanged.',
    }
  } finally {
    disposeTree(root)
  }
}
export function assertResume(stored, signature) {
  if (stored.signature !== signature)
    throw new Error(
      'Tour inputs or renderer changed. Use a new output folder; existing frames were preserved.',
    )
}
export function progressSummary(state, now = Date.now()) {
  const end = Date.parse(state.finishedAt ?? state.pausedAt ?? state.stoppedAt ?? '')
  const start = Date.parse(state.startedAt ?? '')
  const elapsed = Number.isFinite(start)
    ? Math.max(0, ((Number.isFinite(end) ? end : now) - start) / 1000)
    : 0
  const rendered = Math.max(0, (state.completed ?? 0) - (state.resumedFrames ?? 0))
  const eta =
    rendered > 0 && state.phase === 'rendering'
      ? (elapsed / rendered) * (state.total - state.completed)
      : null
  return {
    ...state,
    elapsedSeconds: elapsed,
    etaSeconds: eta,
    percent:
      state.phase === 'done'
        ? 100
        : Math.min(99, (99 * (state.completed ?? 0)) / Math.max(1, state.total ?? 1)),
  }
}
