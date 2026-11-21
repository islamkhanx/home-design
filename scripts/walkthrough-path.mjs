import { walkingSpace, EYE_HEIGHT, CLEARANCE } from '../src/scene/walking-space.ts'
export { EYE_HEIGHT, CLEARANCE } from '../src/scene/walking-space.ts'
const STEP = 0.08
const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1])
const mix = (a, b, t) => a.map((n, i) => n + (b[i] - n) * t)

export { prepareWalkthroughApartment } from '../src/scene/walking-space.ts'
function inside(p, polygon) {
  let yes = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i],
      b = polygon[j]
    if (
      a[1] > p[1] !== b[1] > p[1] &&
      p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]
    )
      yes = !yes
  }
  return yes
}
export function navigationSpace(a, root) {
  const { free, segment: sampledSegment, obstacles, polygons } = walkingSpace(a, root)
  // Sampling alone can miss a furniture corner between samples, then give a
  // different answer after the same line is shortened during smoothing.
  const segment = (from, to) =>
    sampledSegment(from, to) &&
    !obstacles.some((box) => crossesObstacle(from, to, box, CLEARANCE))
  const points = polygons.flat(),
    min = [Math.min(...points.map((p) => p[0])), Math.min(...points.map((p) => p[1]))]
  const nx = Math.ceil((Math.max(...points.map((p) => p[0])) - min[0]) / STEP) + 1,
    nz = Math.ceil((Math.max(...points.map((p) => p[1])) - min[1]) / STEP) + 1
  const point = (i) => [min[0] + (i % nx) * STEP, min[1] + Math.floor(i / nx) * STEP]
  const valid = Array.from({ length: nx * nz }, (_, i) => free(point(i)))
  function nearest(p) {
    let best = -1,
      d = Infinity
    for (let i = 0; i < valid.length; i++)
      if (valid[i]) {
        const n = distance(p, point(i))
        if (n < d) {
          d = n
          best = i
        }
      }
    if (best < 0 || d > 0.6) throw new Error(`Walkthrough anchor has no free space nearby: ${p}`)
    return best
  }
  function route(from, to) {
    const start = nearest(from),
      goal = nearest(to),
      open = [start],
      scores = new Map([[start, 0]]),
      parents = new Map(),
      closed = new Set()
    while (open.length) {
      let best = 0
      for (let i = 1; i < open.length; i++)
        if (
          scores.get(open[i]) + distance(point(open[i]), point(goal)) <
          scores.get(open[best]) + distance(point(open[best]), point(goal))
        )
          best = i
      const current = open.splice(best, 1)[0]
      if (current === goal) {
        const result = [point(current)]
        let n = current
        while (parents.has(n)) {
          n = parents.get(n)
          result.push(point(n))
        }
        result.reverse()
        // Line-of-sight simplification never cuts through an inflated obstacle.
        const simple = [result[0]]
        let i = 0
        while (i < result.length - 1) {
          let j = result.length - 1
          while (j > i + 1 && !segment(result[i], result[j])) j--
          simple.push(result[j])
          i = j
        }
        return simple
      }
      closed.add(current)
      for (const [dx, dz] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
        [1, 1],
        [1, -1],
        [-1, 1],
        [-1, -1],
      ]) {
        const x = (current % nx) + dx,
          z = Math.floor(current / nx) + dz,
          next = z * nx + x
        if (
          x < 0 ||
          x >= nx ||
          z < 0 ||
          z >= nz ||
          !valid[next] ||
          closed.has(next) ||
          !segment(point(current), point(next))
        )
          continue
        const score = scores.get(current) + Math.hypot(dx, dz) * STEP
        if (score < (scores.get(next) ?? Infinity)) {
          scores.set(next, score)
          parents.set(next, current)
          if (!open.includes(next)) open.push(next)
        }
      }
    }
    throw new Error(
      `No collision-free walking route from ${from} to ${to}. Check furniture and door clearance.`,
    )
  }
  return { free, segment, route, obstacles }
}
export function crossesObstacle(from, to, box, clearance = CLEARANCE) {
  let enter = 0, leave = 1
  for (const [axis, world] of [[0, 0], [1, 2]]) {
    const lo = box.min[world] - clearance, hi = box.max[world] + clearance
    const delta = to[axis] - from[axis]
    if (Math.abs(delta) < 1e-12) {
      if (from[axis] <= lo || from[axis] >= hi) return false
      continue
    }
    const a = (lo - from[axis]) / delta, b = (hi - from[axis]) / delta
    enter = Math.max(enter, Math.min(a, b))
    leave = Math.min(leave, Math.max(a, b))
    if (enter >= leave) return false
  }
  return enter < 1 && leave > 0
}
export function roundedWalkingPath(route, nav) {
  if (!route.length) throw new Error('A walking route must contain a starting point')
  const rounded = [route[0]]
  for (let i = 1; i < route.length - 1; i++) {
    const prev = route[i - 1], corner = route[i], next = route[i + 1]
    const before = distance(prev, corner), after = distance(corner, next)
    let accepted = false
    // A progressively smaller radius preserves gentle turns where possible.
    // Check entry/exit connectors as well as every sampled curve edge.
    for (let radius = Math.min(.35, before * .3, after * .3); radius >= .01; radius /= 2) {
      const entry = mix(corner, prev, radius / before), exit = mix(corner, next, radius / after)
      const curve = Array.from({ length: 13 }, (_, j) => {
        const t = j / 12
        return mix(mix(entry, corner, t), mix(corner, exit, t), t)
      })
      if (nav.segment(rounded.at(-1), entry) && nav.segment(exit, next) &&
          curve.every((p, j) => nav.free(p) && (!j || nav.segment(curve[j - 1], p)))) {
        rounded.push(...curve)
        accepted = true
        break
      }
    }
    if (!accepted) rounded.push(corner)
  }
  if (route.length > 1) rounded.push(route.at(-1))
  for (let i = 1; i < rounded.length; i++)
    if (!nav.segment(rounded[i - 1], rounded[i])) throw new Error('Unsafe rounded walking path')
  return rounded
}
function positionAlongPath(path, lengths, d) {
  let i = 1
  while (i < lengths.length - 1 && lengths[i] < d) i++
  return mix(path[i - 1], path[i], Math.max(0, Math.min(1,
    (d - lengths[i - 1]) / Math.max(0.0001, lengths[i] - lengths[i - 1]))))
}
export function safeWalkingSample(path, lengths, previousDistance, desiredDistance, nav) {
  const from = positionAlongPath(path, lengths, previousDistance)
  const desired = positionAlongPath(path, lengths, desiredDistance)
  if (nav.segment(from, desired)) return { point: desired, distance: desiredDistance }
  // A frame can skip several safe curve edges and cut across their obstacle.
  // Stop at a visible crossed vertex instead; the next frame continues from
  // this actual distance, including when it lags behind the nominal timing.
  for (let i = path.length - 1; i > 0; i--)
    if (lengths[i] > previousDistance && lengths[i] <= desiredDistance && nav.segment(from, path[i]))
      return { point: [...path[i]], distance: lengths[i] }
  throw new Error('No safe frame step along the walking path')
}
export function buildWalkthrough(a, root, settings) {
  const nav = navigationSpace(a, root)
  function roomReviewStop(room, fallback) {
    const camera = a.rooms.find((r) => r.id === room)?.interiorCamera
    if (!camera) return { room, ...fallback }
    return {
      room,
      p: [camera.position[0] / 1000, camera.position[2] / 1000],
      look: camera.target.map((n) => n / 1000),
    }
  }
  // Survey stops are chosen inside the modeled circulation space. The navigation
  // grid finds the route between them through actual modeled door openings.
  // These two overview stops share the reviewed room cameras so an open door
  // cannot leave the video using an obsolete, obstructed presentation viewpoint.
  const stops = [
    { room: 'hall', p: [4.35, 1.5] },
    { room: 'bathroom', p: [1.1, 1.4], look: [0.3, 1.25, 0.6] },
    { room: 'hall', p: [2.55, 1.55] },
    { room: 'bedroom', p: [2.65, -1.6], look: [1.2, 1.2, -2.6] },
    roomReviewStop('loggia', { p: [1.95, -4.7], look: [0.3, 0.8, -4.75] }),
    { room: 'bedroom', p: [2.65, -1.6] },
    roomReviewStop('hall', { p: [2.2, 2.25], look: [3.8, 1.15, 1.0] }),
    { room: 'kitchen', p: [1.35, 5.25], look: [0.5, 1.3, 3.5] },
    { room: 'living', p: [1.15, 8.7], look: [2.4, 1.3, 7.3] },
  ]
  const sections = []
  let last = stops[0].p, totalLength = 0
  for (const stop of stops.slice(1)) {
    const route = nav.route(last, stop.p)
    // Round each corner with an inset quadratic Bezier only when the entire
    // rounded path is clear. A blocked corner stays a safe stop-and-turn.
    const rounded = roundedWalkingPath(route, nav)
    const lengths = [0]
    for (let i = 1; i < rounded.length; i++)
      lengths.push(lengths.at(-1) + distance(rounded[i - 1], rounded[i]))
    sections.push({ ...stop, path: rounded, lengths, length: lengths.at(-1), startDistance: totalLength })
    totalLength += lengths.at(-1)
    last = route.at(-1)
  }
  // Travel at an even pace with a short pause/look at each destination.
  const nominal = sections.reduce((sum, s) => sum + s.length / 0.7 + 2.4, 0)
  const frames = []
  const path = sections.flatMap((s, i) => i ? s.path.slice(1) : s.path), lengths = [0]
  for (let i = 1; i < path.length; i++) lengths.push(lengths.at(-1) + distance(path[i - 1], path[i]))
  let previousYaw = null, previousDistance = 0
  for (let frame = 0; frame < settings.totalFrames; frame++) {
    let time = (frame / Math.max(1, settings.totalFrames - 1)) * nominal,
      s = sections.at(-1)
    for (const candidate of sections) {
      s = candidate
      const duration = s.length / 0.7 + 2.4
      if (time <= duration) break
      time -= duration
    }
    const travel = s.length / 0.7
    let progress = Math.min(1, time / travel)
    // Cubic ease at the beginning/end of a leg avoids an abrupt walking start.
    const ease =
      progress < 0.12
        ? (progress * progress) / 0.24
        : progress > 0.88
          ? 0.88 - (1 - progress) ** 2 / 0.24
          : progress - 0.06
    const d = Math.min(s.length, (s.length * ease) / 0.88)
    const sample = safeWalkingSample(path, lengths, previousDistance, s.startDistance + d, nav)
    previousDistance = sample.distance
    if (sample.distance < s.startDistance) {
      s = sections.find((candidate) => sample.distance <= candidate.startDistance + candidate.length)
      progress = Math.min(1, (sample.distance - s.startDistance) / s.length)
    }
    const p = sample.point,
      ahead = positionAlongPath(s.path, s.lengths,
        Math.min(s.length, sample.distance - s.startDistance + 0.65))
    const base = distance(p, ahead) > 0.01 ? ahead : s.path.at(-1)
    let look = [base[0], EYE_HEIGHT - 0.03, base[1]]
    if (s.look && progress > 0.82) {
      const t = Math.min(1, (progress - 0.82) / 0.18)
      look = mix(look, s.look, t * t * (3 - 2 * t))
    }
    let yaw = Math.atan2(look[0] - p[0], look[2] - p[1])
    if (distance(p, [look[0], look[2]]) < 0.01 && previousYaw !== null) yaw = previousYaw
    if (previousYaw !== null) {
      let delta = Math.atan2(Math.sin(yaw - previousYaw), Math.cos(yaw - previousYaw))
      const maxTurn = (1.4 * nominal) / Math.max(1, settings.totalFrames - 1)
      yaw = previousYaw + Math.max(-maxTurn, Math.min(maxTurn, delta))
    }
    previousYaw = yaw
    const eye = [p[0], EYE_HEIGHT, p[1]],
      target = [p[0] + Math.sin(yaw) * 2, look[1], p[1] + Math.cos(yaw) * 2]
    const currentRoom = a.rooms.find(
      (r) =>
        r.polygon &&
        inside(
          p,
          r.polygon.map((q) => q.map((n) => n / 1000)),
        ),
    )
    frames.push({ position: eye, target, room: currentRoom?.id ?? s.room })
  }
  if (Math.abs(previousDistance - totalLength) > 1e-6)
    throw new Error('Too few frames to follow the complete walking path safely; increase duration or FPS')
  // Validate both rendered eye positions and their actual between-frame chords.
  for (let i = 0; i < frames.length; i++) {
    const p = [frames[i].position[0], frames[i].position[2]]
    if (!nav.free(p)) throw new Error(`Camera collision at frame ${i + 1}`)
    if (i && !nav.segment([frames[i - 1].position[0], frames[i - 1].position[2]], p))
      throw new Error(`Camera collision between frames ${i} and ${i + 1}`)
  }
  return {
    frames,
    sections: sections.map((s) => ({ room: s.room, lengthMeters: s.length, path: s.path })),
    distanceMeters: sections.reduce((n, s) => n + s.length, 0),
    clearanceMeters: CLEARANCE,
    eyeHeightMeters: EYE_HEIGHT,
    nominalSeconds: nominal,
  }
}
