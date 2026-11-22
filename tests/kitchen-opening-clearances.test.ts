import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import * as T from 'three'
import { OBB } from 'three/addons/math/OBB.js'
import { collectReviewParts, overlapBoxParts, transformedBoxObb } from '../src/review/geometry.ts'
import {
  applianceFrontBox as applianceFront,
  auditMotion,
  frontPartsAtDepth,
  motionMatrixAt,
  openingMotion,
} from '../src/review/motion.ts'
import { homeReviewProfile } from '../src/review/home-profile.ts'
import type { Hinge } from '../src/review/motion.ts'
import { createEntity } from '../src/scene/components.ts'
import { parseApartment } from '../src/domain/schema.ts'
import { generateSourceInteriors } from '../src/domain/interior-preset.ts'
import type { Entity } from '../src/domain/schema.ts'

const a = generateSourceInteriors(
  parseApartment(
    JSON.parse(readFileSync(new URL('../src/data/apartment.json', import.meta.url), 'utf8')),
  ),
)
const material = new T.MeshPhysicalMaterial({ side: T.DoubleSide })
const materials = new Map(a.materials.map((m) => [m.id, material]))
const groups = new Map(a.objects.map((e) => [e.id, createEntity(e, a, materials)]))
for (const g of groups.values()) g.updateMatrixWorld(true)
const get = (name: string) => a.objects.find((e) => e.id === `auto-kitchen-${name}`)!

function parts(g: T.Group) {
  return collectReviewParts(g).map((part) => ({ ...part, name: part.mesh.name }))
}
const fixed = a.objects
  .filter((e) => !['Floor', 'Ceiling'].includes(e.kind))
  .flatMap((e) => parts(groups.get(e.id)!).map((p) => ({ id: e.id, ...p })))
function fronts(e: Entity) {
  const g = createEntity({ ...e, position: [0, 0, 0], rotation: [0, 0, 0] }, a, materials)
  g.updateMatrixWorld(true)
  const result = frontPartsAtDepth(g, e.size[2]).map((part) => ({ ...part, name: part.mesh.name }))
  g.traverse((mesh) => {
    if (mesh instanceof T.Mesh) mesh.geometry.dispose()
  })
  return result
}
function openedFront(e: Entity, box: T.Box3, hinge: Hinge, axis: 'x' | 'y', angle: number) {
  const motion = openingMotion(box, hinge, axis)
  return transformedBoxObb(
    box,
    motionMatrixAt(groups.get(e.id)!.matrixWorld, motion, angle * Math.sign(motion.to)),
  )
}
function sweep(
  e: Entity,
  box: T.Box3,
  hinge: Hinge,
  axis: 'x' | 'y' = 'y',
  excludedParts: string[] = [],
) {
  const result = auditMotion({
    entityId: e.id,
    partId: `${e.id}/proposed-front`,
    localBox: box,
    parentMatrix: groups.get(e.id)!.matrixWorld,
    motion: openingMotion(box, hinge, axis),
    obstacles: fixed,
    excludedParts: fixed
      .filter((p) => excludedParts.includes(p.name))
      .map(({ entityId, partId }) => ({ entityId, partId })),
    toleranceMm: 0.05,
  })
  return result.findings.map((finding) => ({
    angle: Math.abs(finding.details!.sample as number),
    id: finding.details!.obstacleEntityId,
    name: finding.details!.obstaclePartId,
  }))
}
test('explicit proposed cabinet hinges clear room meshes through90degrees', () => {
  // Fixed proposals, not an automatic search for whichever hinge happens to pass.
  // Double fronts use their outer edges; the sink single door hinges atX1251.5.
  const choices = (homeReviewProfile.motions ?? []).filter(
    (proposal) => proposal.kind === 'cabinet',
  )
  assert.equal(choices.length, 11, 'all reviewed cabinet proposals must be covered')
  for (const { entityId, hinges } of choices) {
    const e = a.objects.find((entity) => entity.id === entityId)!
    assert.ok(e, `missing cabinet ${entityId}`)
    const name = e.name,
      leaves = fronts(e)
    assert.equal(
      leaves.length,
      hinges.length,
      `${name}: every modeled front needs an opening proposal`,
    )
    leaves.forEach((leaf, index) =>
      assert.deepEqual(sweep(e, leaf.box, hinges[index], 'y', [leaf.name]), [], `${name}/${index}`),
    )
  }
})

test('the two constrained hinge choices are protected by real obstruction checks', () => {
  const sink = get('Нижний ряд 3'),
    sinkDoor = fronts(sink)[0]
  assert.ok(
    sweep(sink, sinkDoor.box, 'max', 'y', [sinkDoor.name]).some(
      (hit) => hit.id === 'auto-living-Стул 1',
    ),
  )
  const upper = get('Антресоль северная'),
    left = fronts(upper)[0]
  assert.ok(
    sweep(upper, left.box, 'max', 'y', [left.name]).some(
      (hit) => hit.id === 'auto-kitchen-Основной свет',
    ),
  )
})

test('conservative appliance opening envelopes clear the current furniture arrangement', () => {
  const choices = (homeReviewProfile.motions ?? []).filter(
    (proposal) => proposal.kind === 'appliance',
  )
  assert.equal(choices.length, 4, 'all reviewed appliance proposals must be covered')
  for (const { entityId, axis, hinge } of choices) {
    const e = a.objects.find((entity) => entity.id === entityId)!
    assert.ok(e, `missing appliance ${entityId}`)
    const name = e.name,
      box = applianceFront(e)
    const ownParts = parts(groups.get(e.id)!).map((p) => p.name)
    // The full fascia conservatively includes fixed oven controls. It models
    // space reservation only, without claiming a selected product's hinge path.
    assert.deepEqual(sweep(e, box, hinge, axis, ownParts), [], name)
  }
})

test('oven and fridge have clear trial standing zones with their doors fully open', () => {
  for (const [name, axis, min, max] of [
    ['Духовка', 'x', [1.241, 0, 5.3], [1.741, 1.7, 5.8]],
    ['Холодильник', 'y', [0.75, 0, 4.7], [1.25, 1.7, 5.2]],
  ] as const) {
    const e = get(name),
      zone = new OBB().fromBox3(new T.Box3(new T.Vector3(...min), new T.Vector3(...max)))
    for (const part of fixed)
      assert.ok(!zone.intersectsOBB(part.obb, 1e-8), `${name}: standing zone meets ${part.name}`)
    assert.ok(
      !overlapBoxParts(
        { obb: zone },
        { obb: openedFront(e, applianceFront(e), 'min', axis, 90) },
        0.05,
      ),
      `${name}: open door reaches the standing zone`,
    )
  }
  assert.equal(get('Духовка').position[2], 5550)
  assert.equal(get('Холодильник').position[2], 4950)
})

test('the adjusted south chair faces the unchanged table and leaves its eastern pullout route', () => {
  const table = a.objects.find((e) => e.id === 'auto-living-Обеденный стол')!,
    pendant = a.objects.find((e) => e.id === 'auto-living-Подвес над столом')!,
    chair = a.objects.find((e) => e.id === 'auto-living-Стул 2')!
  assert.deepEqual(table.position, [1900, 0, 4550])
  assert.deepEqual(pendant.position, [1900, 1600, 4550])
  const direction = new T.Vector3(0, 0, 1).applyAxisAngle(
    new T.Vector3(0, 1, 0),
    T.MathUtils.degToRad(chair.rotation[1]),
  )
  const towardTable = new T.Vector3(
    table.position[0] - chair.position[0],
    0,
    table.position[2] - chair.position[2],
  ).normalize()
  assert.ok(direction.dot(towardTable) > 0.999)
  const moved = structuredClone(chair)
  moved.position[0] -= direction.x * 300
  moved.position[2] -= direction.z * 300
  const g = createEntity(moved, a, materials)
  g.updateMatrixWorld(true)
  assert.ok(3.212 - new T.Box3().setFromObject(g, true).max.x > 0.8)
  for (const p of parts(g))
    for (const other of fixed)
      if (other.id !== chair.id)
        assert.ok(!p.obb.intersectsOBB(other.obb, 1e-8), `pulled chair meets ${other.name}`)
  g.traverse((mesh) => {
    if (mesh instanceof T.Mesh) mesh.geometry.dispose()
  })
})

test.after(() => {
  for (const g of groups.values())
    g.traverse((mesh) => {
      if (mesh instanceof T.Mesh) mesh.geometry.dispose()
    })
  material.dispose()
})
