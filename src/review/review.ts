import { parseApartment } from '../domain/schema.ts'
import type { Apartment } from '../domain/schema.ts'
import { buildCanonical, disposeTree } from '../scene/canonical.ts'
import { prepareWalkthroughApartment } from '../scene/walking-space.ts'
import { auditWallIntersections, collectReviewParts } from './geometry.ts'
import { auditAttachments } from './attachments.ts'
import { auditPlacement } from './placement.ts'
import { auditNavigation } from './navigation.ts'
import { auditMotion, frontPartsAtDepth, openingMotion, applianceFrontBox } from './motion.ts'
import type { ReviewProfile } from './profile.ts'
import type { ReviewFinding } from './types.ts'

/** Headless QA uses the same factories as FAST and Blender. It never regenerates
 * interiors: auditing a damaged input must not silently repair that input. */
export async function reviewApartment(input: Apartment, profile?: ReviewProfile) {
  const apartment = parseApartment(input)
  if (profile?.apartmentId && profile.apartmentId !== apartment.id)
    throw new Error(`Review profile ${profile.id} belongs to a different apartment`)
  const root = await buildCanonical(apartment)
  let navigation: ReturnType<typeof auditNavigation> | undefined
  try {
    const parts = collectReviewParts(root)
    const findings: ReviewFinding[] = [
      ...auditWallIntersections(root),
      ...auditAttachments(apartment, root),
      ...auditPlacement(apartment, root, profile?.placement),
    ]
    const groups = new Map(root.children.map((g) => [g.userData.entityId as string, g]))
    const motions = {
      plans: profile?.motions?.length ?? 0,
      movingParts: 0,
      sampledPoses: 0,
      stepDegrees: 2,
      translationStepMm: 25,
    }
    for (const plan of profile?.motions ?? []) {
      const entity = apartment.objects.find((e) => e.id === plan.entityId),
        group = groups.get(plan.entityId)
      if (!entity || !group) {
        findings.push({
          rule: 'motion.missing-entity',
          severity: 'error',
          entityIds: [plan.entityId],
          message: 'A declared moving entity is missing.',
        })
        continue
      }
      // Clone shares geometry/materials; only its transform changes. Root owns disposal.
      const local = group.clone(true)
      local.position.set(0, 0, 0)
      local.rotation.set(0, 0, 0)
      local.scale.set(1, 1, 1)
      local.updateMatrixWorld(true)
      const own = parts.filter((p) => p.entityId === entity.id)
      const ownIds = own.map(({ entityId, partId }) => ({ entityId, partId }))
      const leaves =
        plan.kind === 'cabinet'
          ? frontPartsAtDepth(local, entity.size[2])
          : collectReviewParts(local)
      if (
        plan.kind === 'cabinet' &&
        (leaves.length === 0 || leaves.length !== plan.hinges.length)
      ) {
        findings.push({
          rule: 'motion.front-coverage',
          severity: 'error',
          entityIds: [entity.id],
          message: 'Every modeled cabinet front requires an explicit opening proposal.',
          details: { modeled: leaves.length, proposed: plan.hinges.length },
        })
        continue
      }
      const moving =
        plan.kind === 'appliance'
          ? [
              {
                box: applianceFrontBox(entity),
                partId: `${entity.id}/proposed-front`,
                solidBox: false,
              },
            ]
          : leaves
      for (const [index, part] of moving.entries()) {
        const motion =
          plan.kind === 'pullout'
            ? {
                kind: 'translation' as const,
                direction: [0, 0, -1] as [number, number, number],
                from: 0,
                to: plan.distanceMm,
                step: motions.translationStepMm,
              }
            : openingMotion(
                part.box,
                plan.kind === 'cabinet' ? plan.hinges[index] : plan.hinge,
                plan.kind === 'cabinet' ? 'y' : plan.axis,
                motions.stepDegrees,
              )
        const result = auditMotion({
          entityId: entity.id,
          partId: part.partId,
          localBox: part.box,
          solidBox: part.solidBox,
          parentMatrix: group.matrixWorld,
          motion,
          obstacles: parts,
          excludedParts:
            plan.kind === 'cabinet' ? [{ entityId: entity.id, partId: part.partId }] : ownIds,
        })
        motions.movingParts++
        motions.sampledPoses += result.sampleCount
        findings.push(...result.findings)
      }
    }
    if (profile?.navigation) {
      for (const target of profile.navigation.targets ?? [])
        if (target.entityId && !apartment.objects.some((e) => e.id === target.entityId))
          findings.push({
            rule: 'navigation.missing-entity',
            severity: 'error',
            entityIds: [target.entityId],
            message: `Activity target ${target.id} refers to a missing entity.`,
          })
      const walkingApartment = prepareWalkthroughApartment(apartment),
        walkingRoot = await buildCanonical(walkingApartment)
      try {
        navigation = auditNavigation(walkingApartment, walkingRoot, profile.navigation)
      } finally {
        disposeTree(walkingRoot)
      }
      findings.push(...navigation.findings)
    }
    findings.sort(
      (a, b) =>
        a.rule.localeCompare(b.rule) ||
        a.entityIds.join('/').localeCompare(b.entityIds.join('/')) ||
        a.message.localeCompare(b.message),
    )
    const errors = findings.filter((f) => f.severity === 'error').length,
      warnings = findings.length - errors
    return {
      schemaVersion: 1,
      apartmentId: apartment.id,
      revision: apartment.revision,
      profile: profile?.id ?? null,
      status: errors
        ? 'failed'
        : warnings || profile?.manualReview?.length
          ? 'review-required'
          : 'passed',
      errors,
      warnings,
      coverage: {
        rooms: apartment.rooms.length,
        entities: apartment.objects.length,
        meshParts: parts.length,
        walls: apartment.objects.filter((e) => e.wall).length,
        electricalPoints: apartment.objects.filter(
          (e) => ['Socket', 'Switch'].includes(e.kind) && e.visible !== false,
        ).length,
        sampledCeilingJoins: apartment.objects.filter((e) => e.params?.cabinetTopScribe).length,
        declaredPlacementRelations: profile?.placement.length ?? 0,
        motions,
        navigation: navigation?.metrics ?? null,
      },
      findings,
      ...(navigation ? { navigation: navigation.targets } : {}),
      manualReview: profile?.manualReview ?? [],
      limits: [
        'All wall cells and electrical attachments are checked; furniture separation is limited to declared pairs, not every object pair.',
        'Non-box intersections use conservative oriented bounds and remain review candidates.',
        'Ceiling joins use five footprint rays. Motion checks sample angles/distances and do not prove continuous swept clearance.',
        'Navigation checks camera clearance using modeled obstacle envelopes and declared door poses, not human accessibility.',
        ...(!profile
          ? [
              'No project profile supplied: activity routes, placement relations and motion proposals were not checked.',
            ]
          : []),
      ],
    }
  } finally {
    disposeTree(root)
  }
}
