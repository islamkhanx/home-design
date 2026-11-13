import * as T from 'three'
import type { Apartment } from '../domain/schema.ts'
import { mm } from '../domain/math.ts'
import { polygonArea } from '../domain/math.ts'
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
    sprite = new T.Sprite(new T.SpriteMaterial({ map, depthTest: false, transparent: true }))
  sprite.position.copy(position)
  sprite.scale.set(0.66, 0.103, 1)
  sprite.renderOrder = 1000
  return sprite
}
export function makeAnnotations(
  a: Apartment,
  room: string,
  root: T.Group,
  selected?: string | null,
) {
  const g = new T.Group()
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
