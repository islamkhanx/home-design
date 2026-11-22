import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import * as T from 'three'
import { kitchenInteriors } from '../src/domain/kitchen-interior.ts'
import { restoreSourcePlan } from '../src/domain/source-plan.ts'
import { applyGeneratedInteriors } from '../src/domain/auto-design.ts'
import { parseApartment } from '../src/domain/schema.ts'
import type { Entity } from '../src/domain/schema.ts'
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

test('the deep upper band joins the tall columns while work-zone cupboards stay recessed', () => {
  const ceiling = source.objects.find(e => e.kind === 'Ceiling' && e.roomId === 'kitchen')!.position[1] / 1000
  for (const name of ['Антресоль над вытяжкой', 'Антресоль рабочей секции', 'Колонна духовки и СВЧ', 'Колонна холодильника']) {
    near(bounds(name).max.x, .65)
    near(bounds(name).max.y, ceiling)
  }
  near(bounds('Антресоль северная').max.z, 3.45)
  near(bounds('Верхний шкаф').max.z, 3.2)
  near(bounds('Корпус скрытой вытяжки').max.x, .4)
  near(bounds('Верхний шкаф').max.y, bounds('Антресоль северная').min.y)
  near(bounds('Антресоль над вытяжкой').max.z, bounds('Антресоль рабочей секции').min.z)
  near(bounds('Антресоль рабочей секции').max.z, bounds('Колонна холодильника').min.z)
  near(bounds('Колонна холодильника').max.z, bounds('Колонна духовки и СВЧ').min.z)
  near(bounds('Торец колонн').min.x, 0)
  near(bounds('Торец колонн').max.x, bounds('Колонна духовки и СВЧ').max.x)
  separate('Общий цоколь северный', 'Общий цоколь западный')
})

test('worktops stop before the appliance columns and provide a usable hob landing', () => {
  separate('Столешница B', 'Колонна духовки и СВЧ')
  separate('Столешница B', 'Колонна холодильника')
  const hob = bounds('Варочная панель'), tower = bounds('Колонна холодильника')
  assert.ok(tower.min.z - hob.max.z >= .52499, 'at least525mm modeled landing before tall side')
  near(bounds('Столешница B').max.z, tower.min.z)
  assert.ok(bounds('Вытяжка').max.x < bounds('Корпус скрытой вытяжки').max.x - .03)
  assert.equal(byId('Корпус скрытой вытяжки').params?.cabinetVoids?.[0].front, false)
})

test('the perpendicular backsplash panels meet without overlapping stone volume', () => {
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

test('the hood mezzanine has a closed visible underside and an open rear duct path', () => {
  const underside = bounds('Подшивка над вытяжкой')
  near(underside.min.x, bounds('Корпус скрытой вытяжки').max.x)
  near(underside.max.x, .631)
  near(underside.min.y, 2.3)
  near(underside.max.y, 2.318)
  near(underside.min.z, 3.468)
  near(underside.max.z, 4.232)
  for (const neighbor of ['Корпус скрытой вытяжки', 'Антресоль над вытяжкой', 'Вытяжка'])
    separate('Подшивка над вытяжкой', neighbor)

  const parts = ['Подшивка над вытяжкой', 'Антресоль над вытяжкой', 'Корпус скрытой вытяжки']
    .map(name => groups.get(byId(name).id)!)
  for (const part of parts) part.updateMatrixWorld(true)
  const fromBelow = new T.Raycaster(new T.Vector3(.5, 2.2, 3.85), new T.Vector3(0, 1, 0), 0, .6)
  const visibleUnderside = fromBelow.intersectObjects(parts, true)
  assert.ok(visibleUnderside.length > 0, 'the overhang cannot expose a dark open cavity from below')
  near(visibleUnderside[0].point.y, 2.3)

  const rearPath = new T.Box3(new T.Vector3(.1, 2.2, 3.7), new T.Vector3(.3, 2.75, 4))
  for (const name of ['Подшивка над вытяжкой', 'Антресоль над вытяжкой', 'Корпус скрытой вытяжки'])
    for (const part of meshBounds(byId(name)))
      assert.ok(!positiveOverlap(rearPath, part.box), `${part.name} blocks the reserved duct path`)
})

test('kitchen composition reads the ceiling datum without changing the source model', () => {
  const before = structuredClone(source)
  assert.deepEqual(kitchenInteriors(source), proposal)
  assert.deepEqual(source, before)
  const raised = structuredClone(source)
  raised.objects.find(e => e.kind === 'Ceiling' && e.roomId === 'kitchen')!.position[1] = 2900
  const next = kitchenInteriors(raised)
  for (const e of next.filter(e => e.id.includes('Антресоль') || e.id.includes('Колонна') || e.id.includes('Торец колонн')))
    assert.equal(e.position[1] + e.size[1], 2900, e.id)
})
