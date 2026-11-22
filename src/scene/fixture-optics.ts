import { mm } from '../domain/math.ts'
import type { V3 } from '../domain/math.ts'
import type { Entity } from '../domain/schema.ts'

export interface FixtureOptic {
  suffix?: string
  shape: 'disc' | 'bar' | 'globe'
  type: 'spot' | 'area' | 'point'
  /** Diffuser center, extents and light origin in the same local metre frame. */
  center: V3
  size: V3
  origin: V3
  direction: V3
  tangent?: V3
  width?: number
  height?: number
}

const down: V3 = [0, -1, 0]
const lensClearance = .002

export function fixtureColor(entity: Entity) {
  return entity.params?.color ?? '#ffe6bc'
}

function downlight(
  shape: FixtureOptic['shape'], type: FixtureOptic['type'], center: V3, size: V3,
  suffix?: string,
): FixtureOptic {
  return {
    shape, type, center, size, suffix, direction: down,
    origin: [center[0], center[1] - size[1] / 2 - lensClearance, center[2]],
    ...(type === 'area' ? { width: size[0], height: size[2], tangent: [1, 0, 0] as V3 } : {}),
  }
}

/** The visible diffuser and its corresponding direct light share this placement. */
export function fixtureOptics(entity: Entity): FixtureOptic[] {
  const [w, h, d] = entity.size.map(mm)
  const style = entity.params?.designStyle
  const radius = Math.min(w, d) / 2
  if (entity.kind === 'TrackLight') {
    if (style === 'hitech')
      return [downlight('bar', 'area', [0, h * .61, 0], [w * .94, h * .08, d * .7])]
    return [-1, 0, 1].map((offset, index) => {
      const x = offset * w * .33, suffix = `lamp-${index + 1}`
      if (style === 'classic' || style === 'japandi') {
        const shadeRadius = Math.min(d * .45, w * .1, h * .28)
        const height = Math.min(shadeRadius * 1.3, h * .25) * 2
        return downlight('globe', 'spot', [x, h * .3, 0], [shadeRadius * 2, height, shadeRadius * 2], suffix)
      }
      const lensRadius = Math.min(.035, w * .12, d * .45) * .84
      const thickness = Math.min(.003, h * .08)
      return downlight('disc', 'spot', [x, h * .1 + thickness / 2, 0], [lensRadius * 2, thickness, lensRadius * 2], suffix)
    })
  }
  if (entity.kind === 'Spotlight') {
    if (style === 'hitech') {
      const thickness = Math.min(h * .1, .003)
      return [downlight('bar', 'spot', [0, thickness / 2, 0], [w * .72, thickness, d * .72])]
    }
    const thickness = Math.min(.003, .75 * Math.min(.004, h * .2))
    return [downlight('disc', 'spot', [0, thickness / 2, 0], [radius * 1.68, thickness, radius * 1.68])]
  }
  if (entity.kind === 'LEDStrip') {
    const center: V3 = [0, h / 2, 0], size: V3 = [w, h, d]
    if (h > w && h > d) {
      return [{ shape: 'bar', type: 'area', center, size, origin: [w / 2 + lensClearance, h / 2, 0],
        direction: [1, 0, 0], tangent: [0, 0, 1], width: d, height: h }]
    }
    if (style && entity.roomId !== 'bathroom' && entity.params?.group === 'accent') {
      return [{ shape: 'bar', type: 'area', center, size, origin: [0, -lensClearance, d * .34],
        direction: [0, -1, -.3], tangent: [1, 0, 0], width: w, height: d }]
    }
    return [downlight('bar', 'area', center, size)]
  }
  if (entity.kind !== 'Pendant') return []

  const form = entity.params?.lightForm
  const studyShadeHeight = Math.min(h * .56, radius * 1.42)
  if (form === 'cluster') {
    const globe = Math.min(w * .115, d * .17, h * .105)
    return [-1, 0, 1].map((offset, index) =>
      downlight('globe', 'point', [offset * w * .28, globe + index * studyShadeHeight * .22, 0],
        [globe * 2, globe * 2, globe * 2], `globe-${index + 1}`))
  }
  if (form === 'disc') {
    const rim = studyShadeHeight * .18
    return [downlight('disc', 'area', [0, rim * .2, 0], [w * .88, rim * .17, d * .88])]
  }
  if (form === 'lantern')
    return [downlight('globe', 'point', [0, studyShadeHeight / 2, 0], [radius * 1.04, studyShadeHeight * .78, radius * 1.04])]
  if (form === 'ribbed')
    return [downlight('globe', 'point', [0, studyShadeHeight / 2, 0], [w * .7, studyShadeHeight * .92, d * .7])]
  if (form === 'opal')
    return [downlight('globe', 'point', [0, studyShadeHeight / 2, 0], [w * .96, studyShadeHeight, d * .96])]

  if (style === 'hitech') {
    const barHeight = Math.min(h * .12, .045), depth = Math.min(d * .65, .07)
    const thickness = Math.min(.004, barHeight * .12)
    return [downlight('bar', 'area', [0, thickness / 2, 0], [w * .94, thickness, depth * .75])]
  }
  if (style === 'classic') {
    const globe = Math.min(radius * .21, h * .09), centerY = Math.max(globe * 1.6, h * .2)
    return Array.from({ length: 5 }, (_, index) => {
      const angle = Math.PI * 2 * index / 5
      return downlight('globe', 'point', [Math.cos(angle) * w * .3, centerY + globe * 1.8, Math.sin(angle) * d * .3],
        [globe * 2, globe * 2.2, globe * 2], `globe-${index + 1}`)
    })
  }
  if (style === 'japandi') {
    const height = Math.min(h * .32, radius * .72) * 2
    return [downlight('globe', 'point', [0, height / 2, 0], [w * .98, height, d * .98])]
  }
  const thickness = Math.min(.006, h * .02)
  const diameter = style === 'loft' ? radius * 1.36 : w * .68
  return [downlight('disc', 'spot', [0, thickness / 2, 0], [diameter, thickness, diameter * d / w])]
}
