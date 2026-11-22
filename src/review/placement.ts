import * as T from 'three'
import type { Apartment } from '../domain/schema.ts'
import type { ReviewFinding } from './types.ts'
import { collectReviewParts, findPartIntersections } from './geometry.ts'

/** Relations are design intentions supplied by a project, not inferred standards. */
export type PlacementConstraint =
  | { id: string; kind: 'separate'; left: string; right: string }
  | {
      id: string
      kind: 'gap'
      left: string
      right: string
      axis: 'x' | 'y' | 'z'
      minMm: number
      maxMm?: number
    }

export function auditPlacement(
  apartment: Apartment,
  root: T.Group,
  constraints: readonly PlacementConstraint[] = [],
  toleranceMm = 0.1,
): ReviewFinding[] {
  if (!Number.isFinite(toleranceMm) || toleranceMm < 0)
    throw new Error('Invalid placement tolerance')
  root.updateMatrixWorld(true)
  const findings: ReviewFinding[] = [],
    parts = collectReviewParts(root)
  const groups = new Map(root.children.map((g) => [g.userData.entityId as string, g]))
  const entities = new Map(apartment.objects.map((e) => [e.id, e]))
  const bounds = new Map<string, T.Box3>()
  for (const [id, group] of groups) bounds.set(id, new T.Box3().setFromObject(group, true))
  const ids = new Set<string>()
  for (const constraint of constraints) {
    if (!constraint.id || ids.has(constraint.id))
      throw new Error('Placement constraint IDs must be unique')
    ids.add(constraint.id)
    if (!['separate', 'gap'].includes(constraint.kind))
      throw new Error(`Unknown placement constraint kind: ${constraint.kind}`)
    if (constraint.left === constraint.right)
      throw new Error(`Placement constraint needs two distinct entities: ${constraint.id}`)
    if (
      constraint.kind === 'gap' &&
      (!['x', 'y', 'z'].includes(constraint.axis) ||
        !Number.isFinite(constraint.minMm) ||
        (constraint.maxMm !== undefined &&
          (!Number.isFinite(constraint.maxMm) || constraint.maxMm < constraint.minMm)))
    )
      throw new Error(`Invalid gap constraint: ${constraint.id}`)
    const entityIds = [constraint.left, constraint.right]
    if (entityIds.some((id) => !entities.has(id) || !bounds.has(id) || bounds.get(id)!.isEmpty())) {
      findings.push({
        rule: 'placement.missing-entity',
        severity: 'error',
        entityIds,
        message: `Cannot check ${constraint.id}: a required modeled entity is missing.`,
        details: { constraintId: constraint.id },
      })
      continue
    }
    if (constraint.kind === 'separate') {
      const collisions = findPartIntersections(parts, {
        leftEntityIds: [constraint.left],
        rightEntityIds: [constraint.right],
        toleranceMm,
        includeCandidates: true,
      })
      for (const hit of collisions)
        findings.push({
          rule: 'placement.intersection',
          severity: hit.certainty === 'solid-box' ? 'error' : 'warning',
          entityIds,
          message: `${constraint.id}: ${hit.certainty === 'solid-box' ? 'solid parts intersect' : 'part envelopes overlap; inspect actual surfaces'}.`,
          details: {
            constraintId: constraint.id,
            partIds: [hit.a.partId, hit.b.partId],
            certainty: hit.certainty,
            toleranceMm,
          },
        })
    } else {
      const left = bounds.get(constraint.left)!,
        right = bounds.get(constraint.right)!
      const gapMm = (right.min[constraint.axis] - left.max[constraint.axis]) * 1000
      if (
        gapMm < constraint.minMm - toleranceMm ||
        gapMm > (constraint.maxMm ?? Infinity) + toleranceMm
      )
        findings.push({
          rule: 'placement.gap',
          severity: 'error',
          entityIds,
          message: `${constraint.id}: ${gapMm.toFixed(2)} mm gap outside the declared design range.`,
          details: {
            constraintId: constraint.id,
            axis: constraint.axis,
            gapMm,
            minMm: constraint.minMm,
            ...(constraint.maxMm === undefined ? {} : { maxMm: constraint.maxMm }),
            toleranceMm,
          },
        })
    }
  }

  // A top scribe explicitly declares a ceiling join. Sample the real underside,
  // including its polygon holes, instead of assuming every room is 2850 mm high.
  // Five probes are a regression check, not proof of contact over the full area.
  const ceilings = root.children.filter(
    (g) => entities.get(g.userData.entityId)?.kind === 'Ceiling',
  )
  for (const entity of apartment.objects.filter((e) => (e.params?.cabinetTopScribe ?? 0) > 0)) {
    const group = groups.get(entity.id),
      box = bounds.get(entity.id)
    if (!group || !box || box.isEmpty()) {
      findings.push({
        rule: 'placement.missing-entity',
        severity: 'error',
        entityIds: [entity.id],
        message: 'Ceiling join has no geometry.',
      })
      continue
    }
    for (const [u, v] of [
      [0, 0],
      [-0.45, -0.45],
      [-0.45, 0.45],
      [0.45, -0.45],
      [0.45, 0.45],
    ]) {
      const point = new T.Vector3(
        (entity.size[0] / 1000) * u,
        0,
        (entity.size[2] / 1000) * v,
      ).applyMatrix4(group.matrixWorld)
      const origin = new T.Vector3(point.x, box.min.y - 1, point.z)
      const hit = new T.Raycaster(origin, new T.Vector3(0, 1, 0)).intersectObjects(
        ceilings,
        true,
      )[0]
      if (!hit) {
        findings.push({
          rule: 'placement.ceiling-missing',
          severity: 'error',
          entityIds: [entity.id],
          message: 'A declared ceiling-height cabinet has no ceiling above its sampled footprint.',
          details: { sampleMm: [point.x * 1000, point.z * 1000], evaluation: 'five-point-sample' },
        })
        break
      }
      const gapMm = (hit.point.y - box.max.y) * 1000
      if (Math.abs(gapMm) > toleranceMm) {
        findings.push({
          rule: 'placement.ceiling-join',
          severity: 'error',
          entityIds: [entity.id, hit.object.userData.entityId],
          message: `Ceiling join has ${gapMm.toFixed(2)} mm ${gapMm < 0 ? 'penetration' : 'gap'}.`,
          details: {
            gapMm,
            toleranceMm,
            sampleMm: [point.x * 1000, point.z * 1000],
            evaluation: 'five-point-sample',
          },
        })
        break
      }
    }
  }
  return findings
}
