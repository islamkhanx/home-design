import * as T from 'three'
import type { ViewMode } from './canonical.ts'
import type { Apartment } from '../domain/schema.ts'
import { pointInPolygon } from '../domain/math.ts'
import type { V2 } from '../domain/math.ts'
import { safeWalkingStart, walkingSpace } from './walking-space.ts'
export interface CameraSpec {
  type: 'orthographic' | 'perspective'
  position: number[]
  target: number[]
  up: number[]
  fov: number
  verticalSpan: number
  near: number
  far: number
}
export function roomSelectionView(mode: ViewMode, room: string): ViewMode {
  if (['plan', 'electrical', 'ceiling'].includes(mode)) return mode
  return room === 'all' ? 'dollhouse' : 'interior'
}
export function presets(root: T.Group, interiorRoom?: string): Record<ViewMode, CameraSpec> {
  const b = new T.Box3()
  for (const child of root.children) if (child.visible) b.expandByObject(child)
  if (b.isEmpty()) b.set(new T.Vector3(0, 0, 0), new T.Vector3(3, 2.7, 4))
  const c = b.getCenter(new T.Vector3()),
    s = b.getSize(new T.Vector3()),
    span = Math.max(s.x, s.z, 2) * 1.4
  const common = { fov: 58, verticalSpan: span, near: 0.02, far: 200, up: [0, 1, 0] }
  const target = [c.x, c.y, c.z]
  const floors = root.children.filter((o) => o.visible && o.userData.kind === 'Floor')
  const wholeHome = floors.length > 1
  const interior =
    root.userData.interiorCameras?.[interiorRoom ?? root.userData.activeRoom] ??
    (wholeHome ? undefined : root.userData.interiorCameras?.[floors[0]?.userData.roomId])
  return {
    dollhouse: {
      ...common,
      type: 'orthographic',
      position: wholeHome
        ? [c.x + span, c.y + span * 1.5, c.z + span]
        : interior
          ? [c.x + span * 0.65, c.y + span * 2.2, c.z + span]
          : [c.x + span * 1.5, c.y + span * 0.8, c.z - span * 0.25],
      target,
    },
    electrical: {
      ...common,
      type: 'orthographic',
      position: [c.x + span, c.y + span * 1.4, c.z + span],
      target,
    },
    ceiling: {
      ...common,
      type: 'orthographic',
      position: [c.x, b.min.y - span * 2, c.z],
      target,
      up: [0, 0, 1],
    },
    plan: {
      ...common,
      type: 'orthographic',
      position: [c.x, b.max.y + span * 2, c.z],
      target: [c.x, 0, c.z],
      up: [0, 0, -1],
    },
    interior: {
      ...common,
      type: 'perspective',
      position: interior?.position.map((n: number) => n / 1000) ?? [
        b.min.x + s.x * 0.91,
        Math.min(1.55, b.max.y - 0.1),
        b.min.z + s.z * 0.65,
      ],
      target: interior?.target.map((n: number) => n / 1000) ?? [
        b.min.x + s.x * 0.17,
        1.25,
        b.min.z + s.z * 0.34,
      ],
    },
    free: {
      ...common,
      type: 'perspective',
      position: [c.x + span, c.y + span * 0.65, c.z + span],
      target,
    },
  }
}

/** Match the browser's collision correction while retaining the camera's look direction. */
export function safeIndoorCamera(
  spec: CameraSpec,
  apartment: Apartment,
  root: T.Group,
  room: string,
): CameraSpec {
  const polygon = apartment.rooms.find((r) => r.id === room)?.polygon
  if (!polygon) throw new Error('An indoor camera requires a room with a floor polygon.')
  const position = [...spec.position]
  const floor = polygon.map((p) => p.map((n) => n / 1000) as V2)
  const space = walkingSpace(apartment, root)
  const safe = safeWalkingStart(
    [position[0], position[2]],
    { free: (p) => pointInPolygon(p as V2, floor) && space.free(p) },
    floor,
  )
  const dx = safe[0] - position[0], dz = safe[1] - position[2]
  position[0] = safe[0]
  position[2] = safe[1]
  return {
    ...spec,
    position,
    target: [spec.target[0] + dx, spec.target[1], spec.target[2] + dz],
    up: [...spec.up],
  }
}
export function makeCamera(
  spec: CameraSpec,
  aspect: number,
): T.PerspectiveCamera | T.OrthographicCamera {
  const camera =
    spec.type === 'orthographic'
      ? new T.OrthographicCamera(
          (-spec.verticalSpan * aspect) / 2,
          (spec.verticalSpan * aspect) / 2,
          spec.verticalSpan / 2,
          -spec.verticalSpan / 2,
          spec.near,
          spec.far,
        )
      : new T.PerspectiveCamera(spec.fov, aspect, spec.near, spec.far)
  camera.position.fromArray(spec.position)
  camera.up.fromArray(spec.up)
  camera.lookAt(new T.Vector3().fromArray(spec.target))
  camera.updateMatrixWorld()
  return camera
}
export function snapshotCamera(camera: T.Camera): CameraSpec {
  const direction = camera.getWorldDirection(new T.Vector3()),
    position = camera.getWorldPosition(new T.Vector3())
  const q = camera.getWorldQuaternion(new T.Quaternion()),
    up = new T.Vector3(0, 1, 0).applyQuaternion(q)
  const o = camera as T.OrthographicCamera,
    p = camera as T.PerspectiveCamera
  return {
    type: o.isOrthographicCamera ? 'orthographic' : 'perspective',
    position: position.toArray(),
    target: position.clone().add(direction).toArray(),
    up: up.toArray(),
    fov: p.fov ?? 65,
    verticalSpan: o.isOrthographicCamera ? (o.top - o.bottom) / o.zoom : 5,
    near: p.near ?? 0.02,
    far: p.far ?? 200,
  }
}

/** Fit the projected bounds, including narrow mobile viewports, without changing scene scale. */
export function fitOrthographic(spec: CameraSpec, root: T.Group, aspect: number): CameraSpec {
  if (spec.type !== 'orthographic') return spec
  const camera = makeCamera(spec, aspect),
    bounds = new T.Box3()
  for (const child of root.children) if (child.visible) bounds.expandByObject(child)
  if (bounds.isEmpty()) return spec
  const point = new T.Vector3()
  let extent = 0
  for (const x of [bounds.min.x, bounds.max.x])
    for (const y of [bounds.min.y, bounds.max.y])
      for (const z of [bounds.min.z, bounds.max.z]) {
        point.set(x, y, z).applyMatrix4(camera.matrixWorldInverse)
        extent = Math.max(extent, Math.abs(point.y), Math.abs(point.x) / Math.max(0.1, aspect))
      }
  return { ...spec, verticalSpan: extent * 2 * 1.18 }
}
