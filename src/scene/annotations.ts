import * as T from 'three'
import type { Apartment } from '../domain/schema.ts'
import { mm } from '../domain/math.ts'
import { polygonArea } from '../domain/math.ts'
import { dimensionGuides } from './dimensions.ts'
import { roomElectricalPoints } from '../domain/electrical.ts'
function label(text: string, position: T.Vector3) {
  const c = document.createElement('canvas')
  c.width = 640
  c.height = 100
  const x = c.getContext('2d')!
  x.fillStyle = '#f6f6ee'
  x.fillRect(0, 0, 640, 100)
  x.font = 'bold 38px Arial'
  x.textAlign = 'center'
  x.textBaseline = 'middle'
  x.fillStyle = '#163b43'
  x.fillText(text, 320, 50)
  const map = new T.CanvasTexture(c),
    sprite = new T.Sprite(new T.SpriteMaterial({ map, depthTest: false, depthWrite: false, transparent: true }))
  sprite.position.copy(position)
  sprite.scale.set(0.66, 0.103, 1)
  sprite.renderOrder = 1000
  sprite.userData.label = text
  return sprite
}
export function makeAnnotations(
  a: Apartment,
  room: string,
  root: T.Group,
  selected?: string | null,
  ceiling = false,
) {
  const g = new T.Group()
  g.name = 'dimensions'
  const guides = dimensionGuides(a, room, ceiling)
  for (const guide of guides) {
    const material = new T.LineBasicMaterial({ color: '#216c76', depthTest: false, depthWrite: false })
    const start = new T.Vector3(...guide.start), end = new T.Vector3(...guide.end)
    const tick = new T.Vector3(0, 1, 0).cross(end.clone().sub(start).normalize()).multiplyScalar(0.055)
    const points = [start, end,
      new T.Vector3(...guide.wallStart), start, new T.Vector3(...guide.wallEnd), end,
      start.clone().sub(tick), start.clone().add(tick), end.clone().sub(tick), end.clone().add(tick)]
    const line = new T.LineSegments(new T.BufferGeometry().setFromPoints(points), material)
    line.renderOrder = 999
    const mark = label(`${Math.round(guide.millimeters)} мм`, new T.Vector3(...guide.label))
    mark.userData.dimension = true
    mark.userData.roomId = guide.roomId
    if (room === 'all') mark.scale.multiplyScalar(1.45)
    g.add(line, mark)
  }
  for (const e of a.objects) {
    if (e.visible === false || (room !== 'all' && e.roomId !== room)) continue
    const start = new T.Vector3(...(e.position.map(mm) as [number, number, number]))
    if (e.kind === 'RoomLabel') {
      const r = a.rooms.find((r) => r.id === e.roomId)
      g.add(
        label(
          r?.polygon
            ? (polygonArea(r.polygon) / 1e6).toFixed(2) + ' м² · модель'
            : (e.params?.text ?? e.name),
          start,
        ),
      )
      continue
    }
    if (e.kind !== 'DimensionLine' || !e.params?.end) continue
    if (guides.some((guide) => guide.roomId === e.roomId)) continue
    const end = new T.Vector3(...(e.params.end.map(mm) as [number, number, number]))
    if (e.params.measure) {
      const object = root.children.find((v) => v.userData.entityId === e.params!.measure!.entityId)
      if (!object) continue
      const b = new T.Box3().setFromObject(object, true),
        axis = e.params.measure.axis
      start[axis] = b.min[axis]
      end[axis] = b.max[axis]
    }
    const line = new T.Line(
      new T.BufferGeometry().setFromPoints([start, end]),
      new T.LineBasicMaterial({ color: '#216c76', depthTest: false }),
    )
    line.renderOrder = 999
    g.add(line)
    const axis = end.clone().sub(start).normalize(),
      tick = new T.Vector3(0, 1, 0).cross(axis).multiplyScalar(0.045)
    for (const p of [start, end])
      g.add(
        new T.Line(
          new T.BufferGeometry().setFromPoints([p.clone().sub(tick), p.clone().add(tick)]),
          new T.LineBasicMaterial({ color: '#216c76', depthTest: false }),
        ),
      )
    g.add(
      label(
        Math.round(start.distanceTo(end) * 1000) + ' мм',
        start
          .clone()
          .lerp(end, 0.5)
          .add(new T.Vector3(0, 0.05, 0)),
      ),
    )
  }
  const object = root.children.find((v) => v.userData.entityId === selected && v.visible)
  if (!ceiling && room !== 'all') {
    for (const e of a.objects.filter(e => e.roomId === room && ['Vanity', 'Wardrobe', 'Cabinet', 'Bed', 'Sofa', 'Table'].includes(e.kind))) {
      const mesh = root.children.find(v => v.userData.entityId === e.id && v.visible)
      if (!mesh) continue
      const bounds = new T.Box3().setFromObject(mesh, true)
      const center = bounds.getCenter(new T.Vector3())
      const mark = label(e.size.map(Math.round).join(' × ') + ' мм', new T.Vector3(center.x, bounds.max.y + 0.08, center.z))
      mark.scale.set(0.9, 0.14, 1)
      mark.userData.dimension = true
      mark.userData.entityId = e.id
      g.add(mark)
    }
  }
  if (object) {
    const b = new T.Box3().setFromObject(object, true),
      s = b.getSize(new T.Vector3())
    if (!b.isEmpty())
      g.add(
        label(
          s
            .toArray()
            .map((n) => Math.round(n * 1000))
            .join(' × ') + ' мм',
          new T.Vector3(
            b.getCenter(new T.Vector3()).x,
            b.max.y + 0.12,
            b.getCenter(new T.Vector3()).z,
          ),
        ),
      )
  }
  return g
}

export function makeElectricalAnnotations(a: Apartment, room: string, root: T.Group) {
  const group = new T.Group()
  for (const e of roomElectricalPoints(a, room)) {
    if (!root.children.some((o) => o.visible && o.userData.entityId === e.id)) continue
    const p = new T.Vector3(
      e.position[0] / 1000,
      (e.position[1] + e.size[1] / 2 + 160) / 1000,
      e.position[2] / 1000,
    )
    const mark = label(`${e.id} · h ${Math.round(e.position[1] + e.size[1] / 2)}`, p)
    mark.scale.set(0.7, 0.11, 1)
    group.add(mark)
  }
  return group
}
