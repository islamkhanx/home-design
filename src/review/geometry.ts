import * as T from 'three'
import type { Object3D } from 'three/src/core/Object3D.js'
import { OBB } from 'three/addons/math/OBB.js'
import type { ReviewFinding } from './types.ts'
export type { ReviewFinding } from './types.ts'

/** World geometry is in metres; public tolerances are explicitly in millimetres. */
export interface ReviewPart {
  entityId: string
  partId: string
  kind: string
  box: T.Box3
  obb: OBB
  /** True only for undeformed rectangular solids, including wall opening cells. */
  solidBox: boolean
  mesh: T.Mesh
}

/**
 * OBB.applyMatrix4 does not rotate an offset local centre. Construct all world
 * axes, dimensions and the centre explicitly. A shear is not an oriented box.
 */
export function transformedBoxObb(localBox: T.Box3, matrix: T.Matrix4): OBB {
  if (
    localBox.isEmpty() ||
    ![...localBox.min, ...localBox.max, ...matrix.elements].every(Number.isFinite)
  )
    throw new RangeError('Review bounds and transforms must be nonempty and finite')
  const axes = [0, 1, 2].map((column) => new T.Vector3().setFromMatrixColumn(matrix, column))
  const scales = axes.map((axis) => axis.length())
  if (scales.some((scale) => scale <= 1e-12))
    throw new RangeError('Review transforms must have nonzero scale')
  axes.forEach((axis, i) => axis.divideScalar(scales[i]))
  if (axes.some((axis, i) => axes.some((other, j) => i < j && Math.abs(axis.dot(other)) > 1e-8)))
    throw new RangeError('A sheared transform cannot be represented by an OBB')
  const rotation = new T.Matrix3().set(
    axes[0].x,
    axes[1].x,
    axes[2].x,
    axes[0].y,
    axes[1].y,
    axes[2].y,
    axes[0].z,
    axes[1].z,
    axes[2].z,
  )
  return new OBB(
    localBox.getCenter(new T.Vector3()).applyMatrix4(matrix),
    localBox
      .getSize(new T.Vector3())
      .multiplyScalar(0.5)
      .multiply(new T.Vector3(...scales)),
    rotation,
  )
}

function boxAxes(box: OBB) {
  const e = box.rotation.elements
  return [
    new T.Vector3(e[0], e[1], e[2]),
    new T.Vector3(e[3], e[4], e[5]),
    new T.Vector3(e[6], e[7], e[8]),
  ]
}

/** SAT over face normals and cross axes; touching faces are not intersections. */
export function overlapBoxParts(
  a: Pick<ReviewPart, 'obb'>,
  b: Pick<ReviewPart, 'obb'>,
  toleranceMm = 0.1,
): boolean {
  if (!Number.isFinite(toleranceMm) || toleranceMm < 0)
    throw new RangeError('Tolerance must be finite and nonnegative')
  const aa = boxAxes(a.obb),
    bb = boxAxes(b.obb)
  const axes = [...aa, ...bb]
  for (const left of aa)
    for (const right of bb) {
      const cross = new T.Vector3().crossVectors(left, right)
      if (cross.lengthSq() > 1e-16) axes.push(cross.normalize())
    }
  const radius = (box: OBB, directions: T.Vector3[], axis: T.Vector3) =>
    directions.reduce(
      (sum, direction, i) => sum + Math.abs(axis.dot(direction)) * box.halfSize.getComponent(i),
      0,
    )
  const tolerance = toleranceMm / 1000
  return axes.every((axis) => {
    const ac = a.obb.center.dot(axis),
      bc = b.obb.center.dot(axis)
    const ar = radius(a.obb, aa, axis),
      br = radius(b.obb, bb, axis)
    const overlap = Math.min(ac + ar, bc + br) - Math.max(ac - ar, bc - br)
    return overlap > tolerance + 1e-10
  })
}

function rectangularGeometry(geometry: T.BufferGeometry, bounds: T.Box3) {
  // RoundedBoxGeometry inherits BoxGeometry, so instanceof alone is unsafe.
  if (!(geometry instanceof T.BoxGeometry)) return false
  const position = geometry.attributes.position,
    corners = new Set<number>()
  if (!position) return false
  for (let i = 0; i < position.count; i++) {
    let corner = 0
    for (let axis = 0; axis < 3; axis++) {
      const value = position.getComponent(i, axis)
      if (Math.abs(value - bounds.min.getComponent(axis)) < 1e-8) continue
      if (Math.abs(value - bounds.max.getComponent(axis)) < 1e-8) corner |= 1 << axis
      else return false
    }
    corners.add(corner)
  }
  return corners.size === 8
}

export function collectReviewParts(root: Object3D): ReviewPart[] {
  root.updateWorldMatrix(true, true)
  const result: ReviewPart[] = [],
    ids = new Set<string>()
  root.traverse((object) => {
    if (!(object instanceof T.Mesh)) return
    const { entityId, partId, kind } = object.userData
    if (![entityId, partId, kind].every((value) => typeof value === 'string' && value.length > 0))
      throw new Error(
        `Review mesh ${object.name || '(unnamed)'} lacks stable entityId, partId or kind`,
      )
    if (ids.has(partId)) throw new Error(`Duplicate review part ID: ${partId}`)
    ids.add(partId)
    object.geometry.computeBoundingBox()
    const local = object.geometry.boundingBox!
    const box = new T.Box3().setFromObject(object, true)
    let obb: OBB,
      solidBox = rectangularGeometry(object.geometry, local)
    try {
      obb = transformedBoxObb(local, object.matrixWorld)
    } catch (error) {
      // Nested nonuniform scales can shear a mesh. AABB remains a conservative
      // candidate, never proof of a solid intersection in that case.
      if (!(error instanceof RangeError) || !error.message.includes('sheared')) throw error
      obb = new OBB().fromBox3(box)
      solidBox = false
    }
    if (object instanceof T.InstancedMesh || object instanceof T.SkinnedMesh)
      throw new Error(`Review does not support instanced or skinned mesh: ${partId}`)
    result.push({ entityId, partId, kind, box, obb, solidBox, mesh: object })
  })
  return result.sort(
    (a, b) => a.entityId.localeCompare(b.entityId) || a.partId.localeCompare(b.partId),
  )
}

export interface PartIntersection {
  a: ReviewPart
  b: ReviewPart
  certainty: 'solid-box' | 'bounds-candidate'
}

export function findPartIntersections(
  parts: ReviewPart[],
  options: {
    leftEntityIds?: readonly string[]
    rightEntityIds?: readonly string[]
    toleranceMm?: number
    includeCandidates?: boolean
    includeSameEntity?: boolean
  } = {},
): PartIntersection[] {
  const toleranceMm = options.toleranceMm ?? 0.1
  if (!Number.isFinite(toleranceMm) || toleranceMm < 0)
    throw new RangeError('Tolerance must be finite and nonnegative')
  const left = options.leftEntityIds ? new Set(options.leftEntityIds) : undefined
  const right = options.rightEntityIds ? new Set(options.rightEntityIds) : undefined
  const available = new Set(parts.map((part) => part.entityId))
  for (const id of [...(left ?? []), ...(right ?? [])])
    if (!available.has(id)) throw new Error(`Unknown review entity: ${id}`)
  const selected = (a: ReviewPart, b: ReviewPart) =>
    (!left || left.has(a.entityId)) && (!right || right.has(b.entityId))
  const result: PartIntersection[] = []
  for (let i = 0; i < parts.length; i++)
    for (let j = i + 1; j < parts.length; j++) {
      const a = parts[i],
        b = parts[j]
      if (!options.includeSameEntity && a.entityId === b.entityId) continue
      if (!(selected(a, b) || selected(b, a)) || !a.box.intersectsBox(b.box)) continue
      const certainty = a.solidBox && b.solidBox ? 'solid-box' : 'bounds-candidate'
      if (certainty === 'bounds-candidate' && options.includeCandidates === false) continue
      if (overlapBoxParts(a, b, toleranceMm)) result.push({ a, b, certainty })
    }
  return result
}

/** All actual wall cells are checked, so a door/window void is not filled by a wall envelope. */
export function auditWallIntersections(root: Object3D, toleranceMm = 0.1): ReviewFinding[] {
  const collisions = findPartIntersections(
    collectReviewParts(root).filter((part) => part.kind === 'Wall'),
    { toleranceMm },
  )
  const grouped = new Map<string, PartIntersection[]>()
  for (const collision of collisions) {
    const key = JSON.stringify([collision.a.entityId, collision.b.entityId, collision.certainty])
    grouped.set(key, [...(grouped.get(key) ?? []), collision])
  }
  return [...grouped.values()].map((hits) => {
    const hit = hits[0],
      proven = hit.certainty === 'solid-box'
    return {
      rule: 'geometry.wall-intersection',
      severity: proven ? 'error' : 'warning',
      entityIds: [hit.a.entityId, hit.b.entityId],
      message: proven
        ? 'Wall solids overlap beyond the configured tolerance.'
        : 'Wall bounds overlap; non-box geometry needs a mesh review.',
      details: {
        toleranceMm,
        certainty: hit.certainty,
        parts: hits.map(({ a, b }) => [a.partId, b.partId]),
      },
    }
  })
}
