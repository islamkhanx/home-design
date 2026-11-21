import { deg, pointInPolygon } from './math.ts'
import type { V2 } from './math.ts'
import type { Entity, Room, WallFace } from './schema.ts'

/** Room-facing finish of a vertical wall; ambiguous/unrelated rooms are not guessed. */
export function wallFaceForRoom(wall: Entity, room: Room): WallFace | undefined {
  const w = wall.wall, polygon = room.polygon
  if (!w || !polygon || wall.rotation[0] || wall.rotation[2]) return undefined
  const angle = deg(wall.rotation[1]), c = Math.cos(angle), s = Math.sin(angle)
  const world = ([x, z]: V2): V2 => [wall.position[0] + c * x + s * z, wall.position[2] - s * x + c * z]
  const start = world(w.start), end = world(w.end)
  const dx = end[0] - start[0], dz = end[1] - start[1], length = Math.hypot(dx, dz)
  if (!length) return undefined
  const along: V2 = [dx / length, dz / length], left: V2 = [-along[1], along[0]]
  // Room-vertex projections divide long shared walls into their actual room spans.
  const cuts = [...new Set([0, length, ...polygon.map(p => Math.max(0, Math.min(length,
    (p[0] - start[0]) * along[0] + (p[1] - start[1]) * along[1])))])].sort((a, b) => a - b)
  const coverage = { left: 0, right: 0 }
  for (let i = 1; i < cuts.length; i++) {
    const span = cuts[i] - cuts[i - 1], t = (cuts[i] + cuts[i - 1]) / 2
    if (span < 1e-6) continue
    for (const [face, sign] of [['left', 1], ['right', -1]] as const) {
      // The trace and nominal thickness can differ by a few mm. Probe nearby
      // floor space without changing any wall or room coordinates.
      if ([1, 10, 25, 50].some(gap => pointInPolygon([
        start[0] + along[0] * t + left[0] * sign * (w.thickness / 2 + gap),
        start[1] + along[1] * t + left[1] * sign * (w.thickness / 2 + gap),
      ], polygon))) coverage[face] += span
    }
  }
  if (coverage.left > 0 && coverage.right === 0) return 'left'
  if (coverage.right > 0 && coverage.left === 0) return 'right'
  return undefined
}

export function wallMaterialForRoom(wall: Entity, room: Room): string {
  const face = wallFaceForRoom(wall, room)
  return (face && wall.wall?.materials?.[face]) || wall.material
}
