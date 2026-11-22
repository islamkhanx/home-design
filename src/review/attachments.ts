import * as T from 'three'
import type { Object3D } from 'three/src/core/Object3D.js'
import type { Apartment } from '../domain/schema.ts'
import type { ReviewFinding } from './types.ts'

export interface AttachmentAuditOptions {
  /** Millimetres; geometry is in metres. Shared-face numerical noise is ignored. */
  toleranceMm?: number
  /** A straight, sampled approach to each contact; not a hand/plug service simulation. */
  accessDepthMm?: number
}

/**
 * Audit all explicitly wall-attached electrical points against the canonical scene.
 * No object IDs or room names encode exceptions. Furniture occlusion remains a
 * warning: a closed service cabinet can be intentional, but access is not proven.
 * This is geometric QA, not an electrical zoning or installation-compliance check.
 */
export function auditAttachments(
  apartment: Apartment,
  root: T.Group,
  options: AttachmentAuditOptions = {},
): ReviewFinding[] {
  const toleranceMm = options.toleranceMm ?? 0.1
  const accessDepthMm = options.accessDepthMm ?? 700
  if (
    !Number.isFinite(toleranceMm) ||
    toleranceMm < 0 ||
    !Number.isFinite(accessDepthMm) ||
    accessDepthMm <= 0
  )
    throw new Error(
      'Attachment audit requires a nonnegative tolerance and positive access depth in mm.',
    )
  root.updateMatrixWorld(true)
  const findings: ReviewFinding[] = []
  const entities = new Map(apartment.objects.map((entity) => [entity.id, entity]))
  const groups = new Map<string, Object3D>()
  const meshes: T.Mesh[] = []
  root.traverse((object) => {
    const id = object.userData.entityId as string | undefined
    if (id && !groups.has(id)) groups.set(id, object)
    // Presentation cutaways must not make an obstruction disappear from QA.
    if (object instanceof T.Mesh && id && entities.get(id)?.visible !== false) meshes.push(object)
  })
  const add = (
    rule: string,
    entityIds: string[],
    message: string,
    details?: Record<string, unknown>,
    severity: 'error' | 'warning' = 'error',
  ) => findings.push({ rule, severity, entityIds, message, ...(details ? { details } : {}) })
  for (const entity of apartment.objects) {
    if (!['Socket', 'Switch'].includes(entity.kind) || entity.visible === false) continue
    const metadata = entity.electrical
    if (!metadata) {
      add(
        'attachment.metadata',
        [entity.id],
        'Electrical point has no wall attachment metadata; mounting cannot be checked.',
      )
      continue
    }
    const host = entities.get(metadata.wallId),
      wall = host?.wall
    const group = groups.get(entity.id),
      hostGroup = groups.get(metadata.wallId)
    if (!wall || !group || !hostGroup) {
      add(
        'attachment.host',
        [entity.id, metadata.wallId],
        'Electrical point or its wall is missing from the canonical scene.',
      )
      continue
    }
    const dx = wall.end[0] - wall.start[0],
      dz = wall.end[1] - wall.start[1],
      length = Math.hypot(dx, dz)
    if (!(length > 0)) {
      add('attachment.host', [entity.id, host!.id], 'Electrical host wall has zero length.')
      continue
    }
    const along = new T.Vector3(dx / length, 0, dz / length)
    const normal = new T.Vector3((-dz / length) * metadata.side, 0, (dx / length) * metadata.side)
    const inverseHost = hostGroup.matrixWorld.clone().invert()
    const localOrigin = group
      .getWorldPosition(new T.Vector3())
      .applyMatrix4(inverseHost)
      .multiplyScalar(1000)
    const relative = localOrigin.clone().sub(new T.Vector3(wall.start[0], 0, wall.start[1]))
    const actualAlong = relative.dot(along),
      actualNormal = relative.dot(normal)
    const expectedNormal =
      wall.thickness / 2 + (metadata.surfaceOffset ?? 0) + entity.size[2] / 2 + 1
    if (
      Math.abs(actualAlong - metadata.offset) > toleranceMm ||
      Math.abs(actualNormal - expectedNormal) > toleranceMm
    )
      add(
        'attachment.alignment',
        [entity.id, host!.id],
        'Electrical point does not follow its declared wall offset and finished mounting plane.',
        {
          alongMm: actualAlong,
          expectedAlongMm: metadata.offset,
          normalMm: actualNormal,
          expectedNormalMm: expectedNormal,
        },
      )
    const worldNormal = normal.clone().transformDirection(hostGroup.matrixWorld)
    const facing = new T.Vector3(0, 0, 1).transformDirection(group.matrixWorld)
    if (facing.dot(worldNormal) < 1 - 1e-6)
      add(
        'attachment.facing',
        [entity.id, host!.id],
        'Electrical face does not point out of the selected wall side.',
        { normalDot: facing.dot(worldNormal) },
      )

    // Project the complete nominal frame onto the host plane, including yaw and
    // any enclosing scene transform. The origin alone cannot detect a frame in a reveal.
    const corners: T.Vector3[] = []
    for (const x of [-entity.size[0] / 2, entity.size[0] / 2])
      for (const y of [0, entity.size[1]])
        for (const z of [-entity.size[2] / 2, entity.size[2] / 2])
          corners.push(
            new T.Vector3(x / 1000, y / 1000, z / 1000)
              .applyMatrix4(group.matrixWorld)
              .applyMatrix4(inverseHost)
              .multiplyScalar(1000),
          )
    const u = corners.map((p) =>
      p
        .clone()
        .sub(new T.Vector3(wall.start[0], 0, wall.start[1]))
        .dot(along),
    )
    const y = corners.map((p) => p.y)
    const minU = Math.min(...u),
      maxU = Math.max(...u),
      minY = Math.min(...y),
      maxY = Math.max(...y)
    if (
      minU < -toleranceMm ||
      maxU > length + toleranceMm ||
      minY < -toleranceMm ||
      maxY > wall.height + toleranceMm
    )
      add(
        'attachment.wall-boundary',
        [entity.id, host!.id],
        'Electrical frame extends beyond its host wall.',
        { minAlongMm: minU, maxAlongMm: maxU, bottomMm: minY, topMm: maxY },
      )
    const openings = wall.openings.filter(
      (opening) =>
        Math.min(maxU, opening.offset + opening.width) - Math.max(minU, opening.offset) >
          toleranceMm &&
        Math.min(maxY, opening.bottom + opening.height) - Math.max(minY, opening.bottom) >
          toleranceMm,
    )
    if (openings.length)
      add(
        'attachment.opening',
        [entity.id, host!.id],
        'Electrical frame overlaps a door or window opening.',
        { openingIds: openings.map((opening) => opening.id) },
      )

    const blockers = new Map<string, { samples: number; rearPanel: boolean }>()
    let missing = 0,
      sampleCount = 0
    const depth = accessDepthMm / 1000
    for (let gang = 0; gang < metadata.gangs; gang++) {
      const centerX = (gang - (metadata.gangs - 1) / 2) * 0.071
      for (const [sampleX, sampleY] of [
        [0, 0],
        [-0.015, 0],
        [0.015, 0],
        [0, -0.015],
        [0, 0.015],
      ]) {
        sampleCount++
        const target = new T.Vector3(
          centerX + sampleX,
          entity.size[1] / 2000 + sampleY,
          entity.size[2] / 2000,
        ).applyMatrix4(group.matrixWorld)
        const ray = new T.Raycaster(
          target.clone().addScaledVector(worldNormal, depth),
          worldNormal.clone().negate(),
          0,
          depth + entity.size[2] / 500 + 0.01,
        )
        const hits = ray.intersectObjects(meshes, false)
        const own = hits.find((hit) => hit.object.userData.entityId === entity.id)
        if (!own) {
          missing++
          continue
        }
        // Collect every blocker, not only the closest cabinet facade: an opaque
        // finish behind that facade must still be reported as a buried socket.
        const obstructing = hits.filter(
          (hit) =>
            hit.object.userData.entityId !== entity.id &&
            hit.distance < own.distance - toleranceMm / 1000,
        )
        for (const id of new Set(
          obstructing.map((hit) => hit.object.userData.entityId as string),
        )) {
          const blocker = entities.get(id)!,
            blockerGroup = groups.get(id)!
          const previous = blockers.get(id)
          const rearPanel =
            ['KitchenCabinet', 'Wardrobe', 'Vanity'].includes(blocker.kind) &&
            obstructing
              .filter((hit) => hit.object.userData.entityId === id)
              .some((hit) => {
                const mesh = hit.object as T.Mesh
                mesh.geometry.computeBoundingBox()
                const local = mesh.geometry
                  .boundingBox!.clone()
                  .applyMatrix4(
                    blockerGroup.matrixWorld.clone().invert().multiply(mesh.matrixWorld),
                  )
                // A cabinet's +Z is its facade. Rear panels cannot be opened like a
                // front; a service aperture has to exist in the actual mesh.
                return (
                  local.min.z >= -blocker.size[2] / 2000 - 0.005 &&
                  local.max.z <= -blocker.size[2] / 2000 + Math.min(0.04, blocker.size[2] / 5000)
                )
              })
          blockers.set(id, {
            samples: (previous?.samples ?? 0) + 1,
            rearPanel: previous?.rearPanel === true || rearPanel,
          })
        }
      }
    }
    if (missing)
      add(
        'attachment.face-missing',
        [entity.id],
        'Some sampled electrical contact faces cannot be hit from their declared outward side.',
        { missingSamples: missing, sampleCount },
      )
    for (const [id, blockerInfo] of blockers) {
      const blocker = entities.get(id)!
      const hardSurface =
        blockerInfo.rearPanel ||
        blocker.kind === 'Wall' ||
        blocker.kind === 'WallPanel' ||
        blocker.params?.fixture === 'joineryPanel'
      add(
        hardSurface ? 'attachment.buried-face' : 'attachment.access-review',
        [entity.id, id],
        hardSurface
          ? 'A fixed wall, finish or cabinet rear panel screens the electrical face.'
          : 'An object screens the electrical face; opening or service access needs explicit review.',
        {
          blockedSamples: blockerInfo.samples,
          sampleCount,
          approachMm: accessDepthMm,
          ...(blockerInfo.rearPanel ? { rearPanel: true } : {}),
        },
        hardSurface ? 'error' : 'warning',
      )
    }
  }
  return findings
}
