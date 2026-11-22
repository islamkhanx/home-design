import * as T from 'three'
import type { Object3D } from 'three/src/core/Object3D.js'
import { collectReviewParts, overlapBoxParts, transformedBoxObb } from './geometry.ts'
import type { ReviewPart } from './geometry.ts'
import type { ReviewFinding } from './types.ts'
import type { Entity } from '../domain/schema.ts'

export type Hinge = 'min' | 'max'

export type ReviewMotion =
  | {
      kind: 'rotation'
      axis: 'x' | 'y' | 'z'
      pivot: [number, number, number]
      from: number
      to: number
      step: number
    }
  | {
      kind: 'translation'
      direction: [number, number, number]
      from: number
      to: number
      step: number
    }

/** Standard proposed furniture hinge: side-opening leaves rotate outwards;
 * bottom-hinged appliance doors rotate downwards. Product data can supply a
 * different ReviewMotion instead of using this approximation.
 */
export function openingMotion(box: T.Box3, hinge: Hinge, axis: 'x' | 'y', step = 2): ReviewMotion {
  if (!['min', 'max'].includes(hinge) || !['x', 'y'].includes(axis))
    throw new Error('Opening hinge must be min/max and axis must be x/y.')
  if (box.isEmpty() || ![...box.min, ...box.max].every(Number.isFinite))
    throw new Error('Opening box must be nonempty and finite.')
  const sign = axis === 'x' || hinge === 'max' ? 1 : -1
  const motion: ReviewMotion = {
    kind: 'rotation',
    axis,
    pivot: [axis === 'y' ? box[hinge].x : 0, axis === 'x' ? box.min.y : 0, box.max.z],
    from: 0,
    to: 90 * sign,
    step,
  }
  validateMotion(motion)
  return motion
}

/** A conservative nominal fascia including fixed control panels. This is a
 * space reservation, not the moving geometry of a selected appliance product.
 */
export function applianceFrontBox(entity: Pick<Entity, 'size' | 'params'>): T.Box3 {
  const [width, height, depth] = entity.size.map((value) => value / 1000)
  const base = (entity.params?.cabinetPlinth ?? 0) / 1000
  if (
    ![width, height, depth, base].every(Number.isFinite) ||
    width <= 0.003 ||
    depth < 0.018 ||
    base < 0 ||
    height - base <= 0.003
  )
    throw new Error('Appliance dimensions must fit a positive front envelope.')
  return new T.Box3(
    new T.Vector3(-width / 2 + 0.0015, base + 0.0015, depth / 2 - 0.018),
    new T.Vector3(width / 2 - 0.0015, height - 0.0015, depth / 2),
  )
}

/** Select modeled thin front parts, not guessed door counts. Build the entity at
 * the origin with zero rotation before calling; returned boxes are in that frame.
 * Opening proposals must explicitly cover every returned leaf.
 */
export function frontPartsAtDepth(
  localRoot: Object3D,
  depthMm: number,
  maxThicknessMm = 21,
): ReviewPart[] {
  if (![depthMm, maxThicknessMm].every((value) => Number.isFinite(value) && value > 0))
    throw new Error('Front depth and maximum thickness must be finite and positive.')
  const parts = collectReviewParts(localRoot),
    identity = new T.Matrix4()
  if (
    !localRoot.matrixWorld.elements.every(
      (value, index) => Math.abs(value - identity.elements[index]) < 1e-10,
    )
  )
    throw new Error(
      'Front extraction needs an entity at the origin with zero rotation and unit scale.',
    )
  return parts
    .filter(
      (part) =>
        Math.abs(part.box.max.z - depthMm / 2000) < 1e-7 &&
        part.box.max.z - part.box.min.z < maxThicknessMm / 1000,
    )
    .sort(
      (a, b) =>
        a.box.min.y - b.box.min.y || a.box.min.x - b.box.min.x || a.partId.localeCompare(b.partId),
    )
}

function validateMotion(motion: ReviewMotion) {
  if (!motion || !['rotation', 'translation'].includes(motion.kind))
    throw new Error('Motion kind must be rotation or translation.')
  if (motion.kind === 'rotation' && !['x', 'y', 'z'].includes(motion.axis))
    throw new Error('Rotation axis must be x, y or z.')
  const vector = motion.kind === 'rotation' ? motion.pivot : motion.direction
  if (!Array.isArray(vector) || vector.length !== 3)
    throw new Error('Motion pivot or direction must contain three finite components.')
  const values = [motion.from, motion.to, motion.step, ...vector]
  if (!values.every(Number.isFinite) || motion.step <= 0)
    throw new Error('Motion values must be finite and the sampling step must be positive.')
  if (Math.ceil(Math.abs(motion.to - motion.from) / motion.step) > 10000)
    throw new Error('Motion review is limited to 10001 samples.')
  if (
    motion.kind === 'translation' &&
    Math.abs(new T.Vector3(...motion.direction).length() - 1) > 1e-8
  )
    throw new Error(
      'Translation direction must be a local unit vector; offsets and step are millimetres.',
    )
}

/** Parent/local boxes and pivots use metres; rotations use degrees and translations use mm.
 * The local transform precedes the supplied parent/world transform, including its rotation.
 */
export function motionMatrixAt(
  parentMatrix: T.Matrix4,
  motion: ReviewMotion,
  value: number,
): T.Matrix4 {
  validateMotion(motion)
  if (!Number.isFinite(value)) throw new Error('Motion sample must be finite.')
  if (motion.kind === 'translation')
    return parentMatrix
      .clone()
      .multiply(
        new T.Matrix4().makeTranslation(
          ...(motion.direction.map((component) => (component * value) / 1000) as [
            number,
            number,
            number,
          ]),
        ),
      )
  const pivot = new T.Vector3(...motion.pivot)
  const radians = T.MathUtils.degToRad(value)
  const rotation =
    motion.axis === 'x'
      ? new T.Matrix4().makeRotationX(radians)
      : motion.axis === 'y'
        ? new T.Matrix4().makeRotationY(radians)
        : new T.Matrix4().makeRotationZ(radians)
  return parentMatrix
    .clone()
    .multiply(new T.Matrix4().makeTranslation(pivot.x, pivot.y, pivot.z))
    .multiply(rotation)
    .multiply(new T.Matrix4().makeTranslation(-pivot.x, -pivot.y, -pivot.z))
}

/** Discrete review, not a continuous swept-volume proof. Includes both endpoints even
 * when the step does not divide the range. Only explicitly listed parts are excluded.
 * An explicitly solid moving box and box obstacle give a proven volume collision;
 * unspecified envelope geometry and other mesh bounds give review candidates.
 */
export function auditMotion(options: {
  entityId: string
  partId: string
  localBox: T.Box3
  /** True only when localBox is the actual moving solid, not an appliance envelope. */
  solidBox?: boolean
  parentMatrix: T.Matrix4
  motion: ReviewMotion
  obstacles: ReviewPart[]
  excludedParts?: Array<{ entityId: string; partId: string }>
  toleranceMm?: number
}): { sampleCount: number; findings: ReviewFinding[] } {
  const { motion } = options
  validateMotion(motion)
  const toleranceMm = options.toleranceMm ?? 0.1
  if (!Number.isFinite(toleranceMm) || toleranceMm < 0)
    throw new Error('Motion tolerance must be finite and non-negative.')
  if (
    options.localBox.isEmpty() ||
    options.localBox
      .getSize(new T.Vector3())
      .toArray()
      .some((size) => size <= 0)
  )
    throw new Error('Moving box must have a positive volume.')
  const distance = Math.abs(motion.to - motion.from)
  const direction = motion.to >= motion.from ? 1 : -1
  const count = Math.ceil(distance / motion.step)
  const exclusions = new Set(
    (options.excludedParts ?? []).map((part) => JSON.stringify([part.entityId, part.partId])),
  )
  const seen = new Set<string>(),
    findings: ReviewFinding[] = []
  for (let index = 0; index <= count; index++) {
    const value = motion.from + direction * Math.min(index * motion.step, distance)
    const moving = {
      obb: transformedBoxObb(options.localBox, motionMatrixAt(options.parentMatrix, motion, value)),
    }
    for (const obstacle of options.obstacles) {
      const key = JSON.stringify([obstacle.entityId, obstacle.partId])
      if (seen.has(key) || exclusions.has(key) || !overlapBoxParts(moving, obstacle, toleranceMm))
        continue
      seen.add(key)
      const solid = options.solidBox === true && obstacle.solidBox
      const certainty = solid ? 'solid-box' : 'bounds-candidate'
      const unit = motion.kind === 'rotation' ? 'degrees' : 'mm'
      findings.push({
        rule: 'motion.intersection',
        severity: solid ? 'error' : 'warning',
        entityIds: [...new Set([options.entityId, obstacle.entityId])],
        message: `${options.entityId}/${options.partId} meets ${obstacle.entityId}/${obstacle.partId} at ${value} ${unit}${solid ? '' : ' (bounds candidate)'}.`,
        details: {
          movingPartId: options.partId,
          obstacleEntityId: obstacle.entityId,
          obstaclePartId: obstacle.partId,
          motion: motion.kind,
          sample: value,
          unit,
          from: motion.from,
          to: motion.to,
          step: motion.step,
          toleranceMm,
          certainty,
          evaluation: 'sampled',
        },
      })
    }
  }
  return { sampleCount: count + 1, findings }
}
