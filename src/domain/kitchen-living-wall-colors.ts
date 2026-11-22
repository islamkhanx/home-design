import type { Apartment, MaterialDef, WallFace } from './schema.ts'
import { wallFaceForRoom } from './wall-finishes.ts'

export const kitchenLivingDefaultWallColor = { id: 'taupe', name: 'Тауп', code: 'NCS S 3005-Y20R', color: '#bab09e' } as const
export const kitchenLivingDefaultWallMaterialId = `kitchen-living-wall-${kitchenLivingDefaultWallColor.id}`
export const kitchenLivingFloorMaterialId = 'kitchen-living-floor'

// Screen previews of the shortlisted samples. The paint codes identify physical swatches.
export const kitchenLivingWallColors = [
  { id: 'hague-blue', name: 'Hague Blue', code: 'Farrow & Ball No. 30', color: '#2c424c' },
  { id: 'studio-green', name: 'Studio Green', code: 'Farrow & Ball No. 93', color: '#344139' },
  { id: 'petrol', name: 'Петроль', code: 'NCS S 5020-B10G', color: '#4c6d78' },
  { id: 'olive', name: 'Олива', code: 'NCS S 4020-G50Y', color: '#898e69' },
  { id: 'warm-beige', name: 'Тёплый беж', code: 'NCS S 1505-Y20R', color: '#dfd7c5' },
  kitchenLivingDefaultWallColor,
] as const

type WallColor = (typeof kitchenLivingWallColors)[number]
export const isKitchenLiving = (id: string) => id === 'kitchen' || id === 'living'
const faces: WallFace[] = ['left', 'right']

export function applyKitchenLivingWallColor(source: Apartment, choice: WallColor): Apartment {
  const finish: MaterialDef = {
    id: `kitchen-living-wall-${choice.id}`,
    name: `${choice.name} · ${choice.code}`,
    color: choice.color,
    roughness: 0.9,
    metalness: 0,
    surface: 'plain',
  }
  const objects = source.objects.map(object => {
    const wall = object.wall
    if (!wall || object.visible === false) return object
    const adjacent = source.rooms.flatMap(room => {
      const face = wallFaceForRoom(object, room)
      return face ? [{ room, face }] : []
    })
    const paintedSides = faces.filter(face => {
      const neighbours = adjacent.filter(side => side.face === face)
      return neighbours.length > 0 && neighbours.every(({ room }) => isKitchenLiving(room.id))
    })
    if (!paintedSides.length) return object
    const materials = { ...wall.materials }
    for (const face of paintedSides) materials[face] = finish.id
    // A reveal shared across rooms uses a single finish in the model.
    if (adjacent.every(({ room }) => isKitchenLiving(room.id))) materials.edge = finish.id
    return { ...object, wall: { ...wall, materials } }
  })
  const materials = source.materials.some(material => material.id === finish.id)
    ? source.materials.map(material => material.id === finish.id ? finish : material)
    : [...source.materials, finish]
  return { ...source, objects, materials }
}
