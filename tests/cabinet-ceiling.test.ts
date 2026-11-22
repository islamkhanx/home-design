import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import * as T from 'three'
import type { Object3D } from 'three/src/core/Object3D.js'
import { parseApartment } from '../src/domain/schema.ts'
import type { Entity } from '../src/domain/schema.ts'
import { restoreSourcePlan } from '../src/domain/source-plan.ts'
import { generateSourceInteriors } from '../src/domain/interior-preset.ts'
import { generateElectrical } from '../src/domain/electrical.ts'
import { applyBathroomPlan } from '../src/domain/bathroom-plan.ts'
import { createEntity } from '../src/scene/components.ts'

const read = (path: string) => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'))
const seed = parseApartment(read('../src/data/apartment.json'))
const bathroom = read('../src/data/bathroom-interior.json') as Entity[]
const source = restoreSourcePlan(seed, bathroom)
const a = applyBathroomPlan(generateElectrical(generateSourceInteriors(source)))
const materials = new Map(a.materials.map((m) => [m.id, new T.MeshPhysicalMaterial()]))
const groups = new Map(a.objects.map((e) => [e.id, createEntity(e, a, materials)]))
const cabinet = (id: string) => a.objects.find((e) => e.id === id)!
const bounds = (id: string) => new T.Box3().setFromObject(groups.get(id)!, true)
function parts(root: Object3D) {
  const result: T.Mesh[] = []
  root.traverse((o) => {
    if (o instanceof T.Mesh) result.push(o)
  })
  return result
}
function overlap(a: T.Box3, b: T.Box3) {
  return ['x', 'y', 'z'].every(
    (axis) =>
      Math.min(a.max[axis as 'x'], b.max[axis as 'x']) -
        Math.max(a.min[axis as 'x'], b.min[axis as 'x']) >
      1e-5,
  )
}
const panelBounds = new Map<string, T.Box3[]>()
function panels(id: string) {
  if (!panelBounds.has(id))
    panelBounds.set(
      id,
      parts(groups.get(id)!).map((p) => new T.Box3().setFromObject(p, true)),
    )
  return panelBounds.get(id)!
}
function assertSeparate(left: string, right: string) {
  for (const p of panels(left))
    for (const q of panels(right))
      assert.ok(!overlap(p, q), `${left}: actual panel intersects ${right}`)
}

test('tall storage and kitchen mezzanines meet the ceiling above continuous lower assemblies', () => {
  const ids = [
    'auto-bedroom-Шкаф',
    'auto-hall-Шкаф у входа',
    'auto-hall-Входная ниша',
    'wc-storage',
    'laundry-tower',
    ...[
      'Антресоль угловая',
      'Антресоль северная',
      'Антресоль над вытяжкой',
      'Антресоль рабочей секции',
      'Колонна духовки и СВЧ',
      'Колонна холодильника',
    ].map((id) => `auto-kitchen-${id}`),
  ]
  for (const id of ids) {
    const e = cabinet(id)
    assert.ok(e, `missing ceiling assembly ${id}`)
    const b = bounds(id)
    assert.equal(e.position[1] + e.size[1], 2850, id)
    assert.equal(e.params?.cabinetTopScribe, 50, id)
    assert.ok(Math.abs(b.max.y - 2.85) < 1e-6, `${id}: actual mesh ceiling contact`)
    const filler = parts(groups.get(id)!).some((m) => {
      const p = new T.Box3().setFromObject(m, true)
      return Math.abs(p.min.y - 2.8) < 1e-6 && Math.abs(p.max.y - 2.85) < 1e-6
    })
    assert.ok(filler, `${id}: missing separately fitted top filler`)
    // All panel vertices, including the recessed scribe, stay within the model envelope.
    const local = createEntity({ ...e, position: [0, 0, 0], rotation: [0, 0, 0] }, a, materials)
    const localBounds = new T.Box3().setFromObject(local, true)
    assert.ok(
      localBounds.min.x >= -e.size[0] / 2000 - 1e-6 && localBounds.max.x <= e.size[0] / 2000 + 1e-6,
    )
    assert.ok(
      localBounds.min.z >= -e.size[2] / 2000 - 1e-6 && localBounds.max.z <= e.size[2] / 2000 + 1e-6,
    )
    assert.ok(localBounds.min.y >= -1e-6 && localBounds.max.y <= e.size[1] / 1000 + 1e-6)
  }
  // Shallow work-zone units end at the mezzanine joint; deeper units above
  // complete the same assembly to the ceiling. They are not floating cupboards.
  const lowerUppers = a.objects.filter(
    (e) => e.roomId === 'kitchen' && e.kind === 'Wardrobe' && e.position[1] === 1550,
  )
  assert.ok(lowerUppers.length >= 4)
  for (const lower of lowerUppers) {
    const b = bounds(lower.id)
    assert.ok(Math.abs(b.min.y - 1.55) < 1e-6 && Math.abs(b.max.y - 2.3) < 1e-6)
    assert.ok(
      ids.some((id) => {
        const upper = bounds(id)
        return (
          Math.abs(upper.min.y - b.max.y) < 1e-6 &&
          upper.min.x <= b.min.x + 1e-6 &&
          upper.max.x >= b.max.x - 1e-6 &&
          upper.min.z <= b.min.z + 1e-6 &&
          upper.max.z >= b.max.z - 1e-6
        )
      }),
      `${lower.name}: missing contiguous upper assembly`,
    )
  }
  assert.equal(cabinet('auto-living-ТВ-тумба').size[1], 360, 'low media unit keeps its purpose')
  assert.equal(cabinet('auto-kitchen-Нижний ряд 1').size[1], 870, 'worktop height stays unchanged')
})

test('fitted kitchen panels clear appliances, lighting and adjoining cabinets around real cavities', () => {
  const cabinets = a.objects.filter(
    (e) => e.roomId === 'kitchen' && ['Wardrobe', 'KitchenCabinet'].includes(e.kind),
  )
  const obstacles = a.objects.filter(
    (e) =>
      e.roomId === 'kitchen' &&
      (e.kind === 'Appliance' || ['TrackLight', 'Shower', 'Door', 'Window'].includes(e.kind)),
  )
  for (const upper of cabinets)
    for (const obstacle of obstacles) assertSeparate(upper.id, obstacle.id)
  for (let i = 0; i < cabinets.length; i++)
    for (let j = i + 1; j < cabinets.length; j++) assertSeparate(cabinets[i].id, cabinets[j].id)
  const north = bounds('auto-kitchen-Верхний шкаф'),
    west = bounds('auto-kitchen-Корпус скрытой вытяжки')
  assert.ok(north.min.x - west.max.x >= 0.24999, 'north hinged fronts must clear the west return')
  assert.ok(west.min.z - north.max.z >= 0.24999, 'west hinged fronts must clear the north return')
  assert.equal(cabinet('auto-kitchen-Глухой верхний угол').params?.fixture, 'blindCorner')
  assert.equal(cabinet('auto-kitchen-Возврат верхнего угла').params?.fixture, 'blindCorner')
  const fridgeHousing = cabinet('auto-kitchen-Колонна холодильника'),
    fridgeVoid = fridgeHousing.params!.cabinetVoids![0]
  assert.ok(
    bounds('auto-kitchen-Холодильник').max.y <=
      (fridgeHousing.position[1] + fridgeVoid.bottom + fridgeVoid.height) / 1000 - 0.003,
    'integrated fridge must leave the proposed gap below its cavity top',
  )
  assert.ok(north.min.y - bounds('auto-kitchen-Столешница A').max.y >= 0.64999)
})

test('ceiling extension preserves the washer cavity, bathroom choices and regeneration', () => {
  for (const p of parts(groups.get('washer')!))
    for (const q of parts(groups.get('laundry-tower')!))
      assert.ok(
        !overlap(new T.Box3().setFromObject(p, true), new T.Box3().setFromObject(q, true)),
        'washer intersects a cabinet panel',
      )
  assert.ok(Math.abs(bounds('washer').min.y) < 1e-6)
  assert.deepEqual(cabinet('laundry-tower').size, [650, 2850, 560])
  for (const id of ['laundry-tower', 'washer'])
    assert.deepEqual(cabinet(id).position, seed.objects.find((e) => e.id === id)!.position)
  assert.equal(cabinet('laundry-tower').material, 'oak')
  assert.equal(cabinet('wc-storage').material, 'paint')
  assert.deepEqual(a.rooms, source.rooms)
  assert.deepEqual(applyBathroomPlan(generateElectrical(generateSourceInteriors(a))), a)
})

test('bathroom finish mapping changes only specified stone faces of shared walls', () => {
  const input = structuredClone(a)
  const wall = input.objects.find((e) => e.kind === 'Wall' && e.roomId === 'bathroom')!
  wall.roomId = 'kitchen' // Shared-wall ownership must not erase its bathroom finish.
  wall.material = 'paint'
  wall.wall!.materials = { left: 'stone', right: 'paint', edge: 'paint' }
  const mapped = applyBathroomPlan(input).objects.find((e) => e.id === wall.id)!
  assert.equal(mapped.material, 'paint')
  assert.deepEqual(mapped.wall!.materials, {
    left: 'bathroom-stone',
    right: 'paint',
    edge: 'paint',
  })
  assert.deepEqual(wall.wall!.materials, { left: 'stone', right: 'paint', edge: 'paint' })
})
