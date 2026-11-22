import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import * as T from 'three'
import { kitchenInteriors } from '../src/domain/kitchen-interior.ts'
import { restoreSourcePlan } from '../src/domain/source-plan.ts'
import { applyGeneratedInteriors } from '../src/domain/auto-design.ts'
import { parseApartment } from '../src/domain/schema.ts'
import type { Entity } from '../src/domain/schema.ts'
import { frontPartsAtDepth } from '../src/review/motion.ts'
import { createEntity } from '../src/scene/components.ts'

const read = (file: string) => JSON.parse(readFileSync(new URL(file, import.meta.url), 'utf8'))
const source = restoreSourcePlan(parseApartment(read('../src/data/apartment.json')), read('../src/data/bathroom-interior.json'))
const proposal = kitchenInteriors(source)
const a = applyGeneratedInteriors(source, proposal, { kitchen: ['kitchen'] })
const materials = new Map(a.materials.map(m => {
  const material = new T.MeshPhysicalMaterial({ color: m.color }); material.name = m.id
  return [m.id, material]
}))
const byId = (name: string) => proposal.find(e => e.id === `auto-kitchen-${name}`)!
const groups = new Map(proposal.map(e => [e.id, createEntity(e, a, materials)]))
const bounds = (name: string) => new T.Box3().setFromObject(groups.get(byId(name).id)!, true)
const near = (x: number, y: number) => assert.ok(Math.abs(x - y) < 1e-6, `${x} != ${y}`)
function meshBounds(e: Entity) {
  const result: { name: string; box: T.Box3 }[] = []
  groups.get(e.id)!.traverse(o => {
    if (o instanceof T.Mesh) result.push({ name: o.name, box: new T.Box3().setFromObject(o, true) })
  })
  return result
}
function positiveOverlap(a: T.Box3, b: T.Box3) {
  return (['x', 'y', 'z'] as const).every(axis =>
    Math.min(a.max[axis], b.max[axis]) - Math.max(a.min[axis], b.min[axis]) > 1e-5)
}
function separate(first: string, second: string) {
  for (const p of meshBounds(byId(first))) for (const q of meshBounds(byId(second)))
    assert.ok(!positiveOverlap(p.box, q.box), `${p.name} intersects ${q.name}`)
}

test('the fitted kitchen fits the traced room and contains all four requested built-in appliances', () => {
  assert.deepEqual(a.rooms, source.rooms)
  assert.deepEqual(a.objects.filter(e => !e.generated), source.objects)
  for (const type of ['fridge', 'dishwasher', 'oven', 'microwave']) {
    const found = proposal.filter(e => e.params?.appliance === type)
    assert.equal(found.length, 1, type)
    assert.ok(found[0].params?.builtIn || found[0].params?.integrated, type)
  }
  assert.equal(byId('Холодильник').material, byId('Посудомойка').material)
  assert.equal(byId('Холодильник').material, byId('Колонна холодильника').material)
  assert.ok(bounds('Торец колонн').max.z < 6, 'finished end panel remains inside kitchen')
})

test('real appliance meshes fit their open housings and clear the common plinth', () => {
  for (const [appliance, housing] of [
    ['Духовка', 'Колонна духовки и СВЧ'], ['Микроволновка', 'Колонна духовки и СВЧ'],
    ['Холодильник', 'Колонна холодильника'], ['Посудомойка', 'Корпус посудомойки'],
    ['Вытяжка', 'Корпус скрытой вытяжки'],
  ]) {
    separate(appliance, housing)
    separate(appliance, 'Общий цоколь северный')
    separate(appliance, 'Общий цоколь западный')
  }
  separate('Духовка', 'Микроволновка')
  near(bounds('Холодильник').min.y, 0)
  near(bounds('Посудомойка').min.y, 0)
  near(bounds('Холодильник').max.x, .65)
  near(bounds('Духовка').max.x, .65)
  near(bounds('Микроволновка').max.x, .65)
  near(bounds('Посудомойка').max.z, 3.45)
})

test('the graphite upper doors run in one piece from the backsplash to the ceiling filler', () => {
  const ceiling = source.objects.find(e => e.kind === 'Ceiling' && e.roomId === 'kitchen')!.position[1] / 1000
  for (const [name, leaves] of [['Верхний шкаф', 2], ['Корпус скрытой вытяжки', 2], ['Верхний шкаф после вытяжки', 1]] as const) {
    const entity = byId(name)
    const local = createEntity({ ...entity, position: [0, 0, 0], rotation: [0, 0, 0] }, a, materials)
    local.updateMatrixWorld(true)
    const fronts = frontPartsAtDepth(local, entity.size[2])
    assert.equal(fronts.length, leaves)
    for (const { box } of fronts) {
      near(box.min.y, .0015)
      near(box.max.y, ceiling - 1.55 - .05 - .0015)
    }
    near(bounds(name).max.y, ceiling)
  }
  for (const name of ['Колонна духовки и СВЧ', 'Колонна холодильника']) {
    near(bounds(name).max.x, .65)
    near(bounds(name).max.y, ceiling)
  }
  near(bounds('Верхний шкаф').max.z, 3.2)
  near(bounds('Корпус скрытой вытяжки').max.x, .4)
  near(bounds('Корпус скрытой вытяжки').max.z, bounds('Верхний шкаф после вытяжки').min.z)
  near(bounds('Верхний шкаф после вытяжки').max.z, bounds('Колонна холодильника').min.z)
  near(bounds('Колонна холодильника').max.z, bounds('Колонна духовки и СВЧ').min.z)
  near(bounds('Торец колонн').min.x, 0)
  near(bounds('Торец колонн').max.x, bounds('Колонна духовки и СВЧ').max.x)
  separate('Общий цоколь северный', 'Общий цоколь западный')
  for (const entity of proposal.filter(e => e.kind === 'Wardrobe' || e.kind === 'KitchenCabinet' ||
      e.params?.integrated || e.params?.fixture === 'joineryPanel' && !e.name.startsWith('Фартук'))) {
    assert.equal(entity.material, 'kitchen-graphite')
    assert.equal(entity.params?.cabinetTopTier, undefined)
  }
})

test('worktops stop before the appliance columns and provide a usable hob landing', () => {
  separate('Столешница B', 'Колонна духовки и СВЧ')
  separate('Столешница B', 'Колонна холодильника')
  const hob = bounds('Варочная панель'), tower = bounds('Колонна холодильника')
  assert.ok(tower.min.z - hob.max.z >= .52499, 'at least525mm modeled landing before tall side')
  near(bounds('Столешница B').max.z, tower.min.z)
  assert.equal(byId('Столешница A').material, 'stone')
  assert.equal(byId('Столешница B').material, 'stone')
  assert.ok(bounds('Вытяжка').max.x < bounds('Корпус скрытой вытяжки').max.x - .03)
  assert.equal(byId('Корпус скрытой вытяжки').params?.cabinetVoids?.[0].front, false)
})

test('the perpendicular backsplash panels meet without overlapping stone volume', () => {
  assert.equal(byId('Фартук северный').material, 'kitchen-slate')
  assert.equal(byId('Фартук западный').material, 'kitchen-slate')
  separate('Фартук северный', 'Фартук западный')
  near(bounds('Фартук западный').min.z, bounds('Фартук северный').max.z)
  near(bounds('Фартук западный').max.z, bounds('Колонна холодильника').min.z)
})

test('the prep section keeps its facade and an unobstructed rear service aperture', () => {
  const cabinet = groups.get(byId('Боковой ряд 3').id)!
  cabinet.updateMatrixWorld(true)
  for (const y of [.3,.5]) {
    const fromInside = new T.Raycaster(new T.Vector3(.6,y,4.45),new T.Vector3(-1,0,0),0,.7)
    assert.equal(fromInside.intersectObject(cabinet,true).length,0, 'no back or shelf blocks the connection height')
    const throughClosedFront = new T.Raycaster(new T.Vector3(.7,y,4.45),new T.Vector3(-1,0,0),0,.7)
    const face = throughClosedFront.intersectObject(cabinet,true)[0]
    assert.ok(face)
    near(face.point.x,.65)
  }
})

test('the hood remains accessible from below and has a clear duct path behind the doors', () => {
  const housing = byId('Корпус скрытой вытяжки')
  const group = groups.get(housing.id)!
  const hood = groups.get(byId('Вытяжка').id)!
  group.updateMatrixWorld(true)
  hood.updateMatrixWorld(true)
  const fromBelow = new T.Raycaster(new T.Vector3(.22, 1.5, 3.85), new T.Vector3(0, 1, 0), 0, .2)
  assert.equal(fromBelow.intersectObject(group, true).length, 0)
  assert.ok(fromBelow.intersectObject(hood, true).length > 0)

  const rearPath = new T.Box3(new T.Vector3(.1, 1.7, 3.7), new T.Vector3(.3, 2.8, 4))
  for (const part of meshBounds(housing))
    assert.ok(!positiveOverlap(rearPath, part.box), `${part.name} blocks the reserved duct path`)
})

test('kitchen composition reads the ceiling datum without changing the source model', () => {
  const before = structuredClone(source)
  assert.deepEqual(kitchenInteriors(source), proposal)
  assert.deepEqual(source, before)
  const raised = structuredClone(source)
  raised.objects.find(e => e.kind === 'Ceiling' && e.roomId === 'kitchen')!.position[1] = 2900
  const next = kitchenInteriors(raised)
  for (const e of next.filter(e => e.params?.cabinetTopScribe || ['Торец колонн', 'Торец навесного ряда'].includes(e.name)))
    assert.equal(e.position[1] + e.size[1], 2900, e.id)
})
