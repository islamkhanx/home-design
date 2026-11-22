import { Vector3 } from 'three'
import type { Group } from 'three'
import type { Apartment } from '../domain/schema.ts'
import { CLEARANCE, walkingSpace } from '../scene/walking-space.ts'
import type { ReviewFinding } from './types.ts'

type Point = [number, number]
interface NavigationTargetIdentity {
  id: string
  roomId?: string
}
export type NavigationTarget = NavigationTargetIdentity &
  (
    | {
        /** Fixed source-model coordinates [X, Z], in millimetres. */
        positionMm: Point
        entityId?: string
        entityOffsetMm?: never
      }
    | {
        /** Canonical entity whose current transform defines the activity point. */
        entityId: string
        /** Local [X, Z] at local Y0, in millimetres; follows movement and rotation. */
        entityOffsetMm: Point
        positionMm?: never
      }
  )
interface ResolvedNavigationTarget extends NavigationTargetIdentity {
  positionMm: Point
  entityId?: string
  entityOffsetMm?: Point
}
export interface NavigationOptions {
  /** A deliberately selected circulation point; never snapped to a free point. */
  startMm: Point
  targets?: NavigationTarget[]
  includeRoomCameras?: boolean
  gridMm?: number
  maxCells?: number
}
export interface NavigationResult extends ResolvedNavigationTarget {
  status: 'reachable' | 'blocked' | 'disconnected' | 'start-blocked'
  routeMm?: Point[]
}

const metres = (p: Point): Point => [p[0] / 1000, p[1] / 1000]
// Keep validated grid vertices intact: rounding can move a point across an
// obstacle boundary when a caller uses submillimetre grid coordinates.
const millimetres = (p: Point): Point => [p[0] * 1000, p[1] * 1000]
const finitePoint = (p: unknown): p is Point =>
  Array.isArray(p) && p.length === 2 && p.every(Number.isFinite)

/** Continuous segment/rectangle test, including the walkthrough clearance.
 * Checking only regularly spaced samples can jump a thin obstacle or clip a corner.
 * The open boundary convention matches walkingSpace.free().
 */
function crossesObstacle(from: Point, to: Point, box: { min: number[]; max: number[] }) {
  let enter = 0,
    leave = 1
  for (const [axis, world] of [
    [0, 0],
    [1, 2],
  ]) {
    const lo = box.min[world] - CLEARANCE,
      hi = box.max[world] + CLEARANCE
    const delta = to[axis] - from[axis]
    if (Math.abs(delta) < 1e-12) {
      if (from[axis] <= lo || from[axis] >= hi) return false
    } else {
      const a = (lo - from[axis]) / delta,
        b = (hi - from[axis]) / delta
      enter = Math.max(enter, Math.min(a, b))
      leave = Math.min(leave, Math.max(a, b))
      if (enter >= leave) return false
    }
  }
  return enter < 1 && leave > 0
}

/** Review reachability in the SAME obstacle envelopes as the walking viewer.
 * Pass a canonical root built from the supplied apartment, with the intended door
 * poses already applied. This function changes neither model nor scene. A successful
 * result is a camera route, not a human clearance or building-code certification.
 * Disconnected means no route at this grid resolution, not proof of no possible route.
 */
export function auditNavigation(apartment: Apartment, root: Group, options: NavigationOptions) {
  const gridMm = options.gridMm ?? 80,
    maxCells = options.maxCells ?? 500_000
  if (!finitePoint(options.startMm))
    throw new RangeError('Navigation startMm must be a finite [X, Z] point')
  if (!Number.isFinite(gridMm) || gridMm <= 0)
    throw new RangeError('Navigation gridMm must be positive')
  if (!Number.isSafeInteger(maxCells) || maxCells < 1)
    throw new RangeError('Navigation maxCells must be a positive integer')
  const cameraTargets: NavigationTarget[] =
    options.includeRoomCameras === false
      ? []
      : apartment.rooms
          .filter((room) => room.interiorCamera)
          .map((room) => ({
            id: `room:${room.id}`,
            roomId: room.id,
            positionMm: [room.interiorCamera!.position[0], room.interiorCamera!.position[2]],
          }))
  const requestedTargets = [...cameraTargets, ...(options.targets ?? [])]
  const ids = new Set<string>()
  for (const target of requestedTargets) {
    if (!target.id || ids.has(target.id))
      throw new Error(`Navigation target ID must be unique: ${target.id}`)
    const absolute = target.positionMm !== undefined,
      relative = target.entityOffsetMm !== undefined
    if (absolute === relative)
      throw new Error(
        `Navigation target ${target.id} requires exactly one of positionMm or entityOffsetMm`,
      )
    if (!finitePoint(absolute ? target.positionMm : target.entityOffsetMm))
      throw new RangeError(`Navigation target ${target.id} must be a finite [X, Z] point`)
    if (relative && !target.entityId)
      throw new Error(`Navigation target ${target.id} requires an entityId for entityOffsetMm`)
    ids.add(target.id)
  }
  root.updateMatrixWorld(true)
  const space = walkingSpace(apartment, root),
    start = metres(options.startMm),
    step = gridMm / 1000
  const findings: ReviewFinding[] = [],
    results: NavigationResult[] = []
  const metrics = {
    gridMm,
    clearanceMm: CLEARANCE * 1000,
    roomTargets: cameraTargets.length,
    activityTargets: options.targets?.length ?? 0,
    unresolvedTargets: 0,
    visitedNodes: 0,
    totalNodes: 0,
  }
  const targets: ResolvedNavigationTarget[] = []
  for (const target of requestedTargets) {
    if (target.entityOffsetMm !== undefined) {
      const entity = apartment.objects.find((entity) => entity.id === target.entityId)
      const group = root.children.find((group) => group.userData.entityId === target.entityId)
      if (!entity || !group) {
        metrics.unresolvedTargets++
        findings.push({
          rule: 'navigation.target-entity-missing',
          severity: 'error',
          entityIds: [target.entityId],
          message: `Navigation target ${target.id} cannot resolve its entity ${target.entityId} in the model and canonical scene.`,
          details: {
            targetId: target.id,
            entityOffsetMm: target.entityOffsetMm,
            missingModelEntity: !entity,
            missingSceneGroup: !group,
          },
        })
        continue
      }
      const local = new Vector3(target.entityOffsetMm[0] / 1000, 0, target.entityOffsetMm[1] / 1000)
      const world = local.applyMatrix4(group.matrixWorld)
      targets.push({
        ...target,
        roomId: target.roomId ?? entity.roomId,
        positionMm: [world.x * 1000, world.z * 1000],
      })
    } else targets.push({ ...target, positionMm: [...target.positionMm!] })
  }
  if (options.includeRoomCameras !== false)
    for (const room of apartment.rooms.filter((room) => !room.interiorCamera)) {
      findings.push({
        rule: 'navigation.room-target-missing',
        severity: 'warning',
        entityIds: [],
        message: `Room ${room.id} has no interior camera target, so its reachability was not checked.`,
        details: { roomId: room.id },
      })
    }
  const obstructionIds = (p: Point) => [
    ...new Set(
      space.obstacles
        .filter(
          (box) =>
            p[0] > box.min[0] - CLEARANCE &&
            p[0] < box.max[0] + CLEARANCE &&
            p[1] > box.min[2] - CLEARANCE &&
            p[1] < box.max[2] + CLEARANCE,
        )
        .map((box) => box.entityId),
    ),
  ]
  if (!space.free(start)) {
    findings.push({
      rule: 'navigation.start-blocked',
      severity: 'error',
      entityIds: obstructionIds(start),
      message: 'The exact navigation start is obstructed or outside the modeled walking surface.',
      details: { startMm: options.startMm },
    })
    for (const target of targets) results.push({ ...target, status: 'start-blocked' })
    return { findings, targets: results, metrics }
  }
  const points = space.polygons.flat()
  // A free start implies a polygon or a portal. An empty polygon set must not
  // accidentally create an unbounded/empty grid that looks like a passed audit.
  if (!points.length) throw new Error('Navigation review requires room polygons')
  const minX = Math.floor(Math.min(...points.map((p) => p[0])) / step) * step
  const minZ = Math.floor(Math.min(...points.map((p) => p[1])) / step) * step
  const nx = Math.ceil((Math.max(...points.map((p) => p[0])) - minX) / step) + 1
  const nz = Math.ceil((Math.max(...points.map((p) => p[1])) - minZ) / step) + 1
  if (nx * nz > maxCells)
    throw new RangeError(`Navigation grid needs ${nx * nz} cells; limit is ${maxCells}`)
  metrics.totalNodes = nx * nz
  const point = (index: number): Point => [
    minX + (index % nx) * step,
    minZ + Math.floor(index / nx) * step,
  ]
  const valid = new Uint8Array(nx * nz)
  for (let i = 0; i < valid.length; i++) valid[i] = Number(space.free(point(i)))
  const segment = (a: Point, b: Point) =>
    space.segment(a, b) && !space.obstacles.some((box) => crossesObstacle(a, b, box))
  // Link the exact point only to local, line-of-sight grid nodes. We never use the
  // tour's nearest-free-node fallback, which can hide an obstructed requested stop.
  const connectors = (p: Point) => {
    const result: number[] = []
    const x = Math.floor((p[0] - minX) / step),
      z = Math.floor((p[1] - minZ) / step)
    for (let dz = -1; dz <= 2; dz++)
      for (let dx = -1; dx <= 2; dx++) {
        const cx = x + dx,
          cz = z + dz,
          index = cz * nx + cx
        if (
          cx >= 0 &&
          cx < nx &&
          cz >= 0 &&
          cz < nz &&
          valid[index] &&
          Math.hypot(point(index)[0] - p[0], point(index)[1] - p[1]) <= step * 1.5 &&
          segment(p, point(index))
        )
          result.push(index)
      }
    return result
  }
  const parent = new Int32Array(nx * nz).fill(-2),
    queue: number[] = []
  for (const index of connectors(start)) {
    parent[index] = -1
    queue.push(index)
  }
  const neighbours = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
    [1, 1],
    [1, -1],
    [-1, 1],
    [-1, -1],
  ]
  for (let head = 0; head < queue.length; head++) {
    const current = queue[head],
      currentPoint = point(current)
    for (const [dx, dz] of neighbours) {
      const x = (current % nx) + dx,
        z = Math.floor(current / nx) + dz,
        next = z * nx + x
      if (
        x < 0 ||
        x >= nx ||
        z < 0 ||
        z >= nz ||
        !valid[next] ||
        parent[next] !== -2 ||
        !segment(currentPoint, point(next))
      )
        continue
      parent[next] = current
      queue.push(next)
    }
  }
  metrics.visitedNodes = queue.length
  for (const target of targets) {
    const goal = metres(target.positionMm),
      entityIds = target.entityId ? [target.entityId] : []
    if (!space.free(goal)) {
      results.push({ ...target, status: 'blocked' })
      findings.push({
        rule: 'navigation.target-blocked',
        severity: 'error',
        entityIds: [...new Set([...entityIds, ...obstructionIds(goal)])],
        message: `Navigation target ${target.id} is obstructed or outside the modeled walking surface.`,
        details: { targetId: target.id, roomId: target.roomId, positionMm: target.positionMm },
      })
      continue
    }
    let route: Point[] | undefined
    if (segment(start, goal)) route = [start, goal]
    else {
      const goalIndex = connectors(goal).find((index) => parent[index] !== -2)
      if (goalIndex !== undefined) {
        route = [goal]
        for (let index = goalIndex; index !== -1; index = parent[index]) route.push(point(index))
        route.push(start)
        route.reverse()
      }
    }
    if (!route) {
      results.push({ ...target, status: 'disconnected' })
      findings.push({
        rule: 'navigation.disconnected',
        severity: 'warning',
        entityIds,
        message: `No route to ${target.id} was found at ${gridMm} mm grid spacing.`,
        details: {
          targetId: target.id,
          roomId: target.roomId,
          positionMm: target.positionMm,
          gridMm,
          clearanceMm: metrics.clearanceMm,
          limitation:
            'Conservative camera envelopes and a sampled grid; not a human-access certification.',
        },
      })
    } else {
      // Collapse only identical adjacent points. Keeping each checked edge makes
      // the result reproducible without a second, potentially unsafe smoothing pass.
      const routeMm = route
        .filter((p, i) => !i || Math.hypot(p[0] - route![i - 1][0], p[1] - route![i - 1][1]) > 1e-9)
        .map(millimetres)
      // Preserve caller's exact endpoints across the metre conversion.
      routeMm[0] = [...options.startMm]
      routeMm[routeMm.length - 1] = [...target.positionMm]
      results.push({ ...target, status: 'reachable', routeMm })
    }
  }
  return { findings, targets: results, metrics }
}
