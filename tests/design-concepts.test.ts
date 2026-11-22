import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import * as T from 'three'
import type { Apartment, Entity } from '../src/domain/schema.ts'
import { parseApartment } from '../src/domain/schema.ts'
import { buildCanonical, disposeTree } from '../src/scene/canonical.ts'
import { lightingSpecs } from '../src/scene/lighting.ts'
import { createDesignVariant, generateDesignImages, DEFAULT_DESIGN_VARIANTS, DESIGN_VARIANTS } from '../scripts/design-images.mjs'
import { architectureFingerprint } from '../scripts/design-concepts.mjs'
import { applyDesignStudy, FEATURED_DESIGN_STUDIES } from '../src/domain/design-variants.ts'
import { DESIGN_STUDIES } from '../src/domain/design-studies.ts'
import { wallMaterialForRoom } from '../src/domain/wall-finishes.ts'
const styles = ['loft', 'hitech', 'classic', 'japandi']
const seed = async () => parseApartment(JSON.parse(await readFile(new URL('../src/data/apartment.json', import.meta.url), 'utf8')))
function shapeSignature(root: T.Group, id: string) {
  const hash = createHash('sha256'), entity = root.children.find(o => o.userData.entityId === id)!
  entity.traverse(o => {
    if (!(o instanceof T.Mesh)) return
    hash.update(JSON.stringify([o.position.toArray(), o.quaternion.toArray(), o.scale.toArray()]))
    const vertices = o.geometry.getAttribute('position').array
    hash.update(Buffer.from(vertices.buffer, vertices.byteOffset, vertices.byteLength))
  })
  return hash.digest('hex')
}

test('full concepts expose composition, furniture and lighting directions instead of palette-only defaults', () => {
  assert.deepEqual(DEFAULT_DESIGN_VARIANTS, ['current', 'loft', 'hitech', 'classic'])
  for (const id of styles) {
    const concept = DESIGN_VARIANTS.find(v => v.id === id)!
    assert.equal(concept.category, 'concept')
    for (const field of ['walls', 'furniture', 'lighting', 'materials'] as const) assert.ok(concept.features[field].length > 10)
  }
  assert.equal(DESIGN_VARIANTS.find(v => v.id === 'warm')!.category, 'palette')
})

test('integrated kitchen fronts follow concept finishes while appliance cavities remain fixed', async () => {
  const source = await seed(), before = JSON.stringify(source)
  const fronts = source.objects.filter(o => o.roomId === 'kitchen' && o.kind === 'Appliance' && o.params?.integrated)
  assert.ok(fronts.length >= 2)
  for (const style of styles) {
    const { apartment } = createDesignVariant(source, 'kitchen', style)
    for (const original of fronts) {
      const changed = apartment.objects.find((o: Entity) => o.id === original.id)!
      assert.match(changed.material, new RegExp(`^design-kitchen-${style}-`))
      assert.deepEqual(changed.params, original.params)
      assert.deepEqual(changed.position, original.position)
      assert.deepEqual(changed.size, original.size)
    }
  }
  assert.equal(JSON.stringify(source), before)
})

test('every reference study applies across the apartment while preserving the bathroom and source model', async () => {
  const source = await seed(), before = JSON.stringify(source)
  const bathroom = source.rooms.find(room => room.id === 'bathroom')!
  const bathroomObjects = source.objects.filter(o => o.roomId === bathroom.id && !o.wall)
  const sourceArchitecture = architectureFingerprint(source)
  assert.equal(applyDesignStudy(source, 'current'), source)
  for (const study of DESIGN_STUDIES) {
    const preview = applyDesignStudy(source, study.id)
    assert.notEqual(preview, source)
    assert.equal(architectureFingerprint(preview), sourceArchitecture, study.id)
    assert.deepEqual(preview.objects.filter(o => o.roomId === bathroom.id && !o.wall), bathroomObjects, study.id)
    const proposed = new Map(preview.objects.map(o => [o.id, o]))
    for (const wall of source.objects.filter(o => o.wall)) {
      assert.equal(wallMaterialForRoom(proposed.get(wall.id)!, bathroom), wallMaterialForRoom(wall, bathroom), study.id)
    }
    for (const roomId of ['living', 'kitchen', 'bedroom']) {
      assert.ok(preview.objects.some(o => o.roomId === roomId && o.params?.designStyle === study.designStyle && o.materialOverrides), `${study.id}/${roomId}`)
    }
    const living = applyDesignStudy(source, study.id, 'living')
    assert.deepEqual(living.objects.filter(o => o.roomId === 'kitchen' && !o.wall), source.objects.filter(o => o.roomId === 'kitchen' && !o.wall), study.id)
  }
  assert.equal(JSON.stringify(source), before)
})

test('walnut and graphite studies distinguish cabinetry from wall finishes and light the veneer at dusk', async () => {
  const source = await seed()
  for (const id of FEATURED_DESIGN_STUDIES) {
    const preview = applyDesignStudy(source, id)
    const materials = new Map(preview.materials.map(material => [material.id, material]))
    for (const roomId of ['living', 'kitchen', 'bedroom', 'hall']) {
      const room = preview.rooms.find(candidate => candidate.id === roomId)!
      const walls = preview.objects.filter(object => object.wall && object.roomId === roomId)
      const wallColors = new Set(walls.map(wall => materials.get(wallMaterialForRoom(wall, room))?.color))
      const cabinet = preview.objects.find(object => object.roomId === roomId && object.kind === 'Wardrobe')!
      assert.ok(cabinet, `${id}/${roomId} cabinet`)
      assert.ok(!wallColors.has(materials.get(cabinet.material)?.color), `${id}/${roomId} cabinet blends into the wall`)
    }
    assert.ok(preview.objects.some(object => object.roomId === 'living' && object.kind === 'WallPanel' &&
      materials.get(object.material)?.surface === 'oak'), `${id} veneer panel`)
    const leds = preview.objects.filter(object => object.roomId === 'living' && object.kind === 'LEDStrip' &&
      object.id.startsWith(`concept-living-${id}-wall-light-`))
    assert.ok(leds.length > 0, `${id} wall profiles`)
    const evening = lightingSpecs(preview, 'living', 'evening')
    assert.ok(leds.every(led => evening.some(light => light.id === led.id && light.power > 0 && light.type === 'area')), `${id} evening lighting`)
  }
})

test('four living concepts change real furniture meshes, wall composition, material families and installed light output', async () => {
  const source = await seed(), untouched = JSON.stringify(source), signatures = new Set<string>(), records: Record<string, any> = {}
  const originalFurniture = source.objects.filter(o => o.roomId === 'living' && ['Sofa', 'Bed', 'Table', 'Wardrobe', 'KitchenCabinet', 'Shelf'].includes(o.kind))
  for (const style of styles) {
    const result = createDesignVariant(source, 'living', style), apartment = result.apartment as Apartment
    assert.equal(result.architectureUnchanged, true)
    assert.equal(result.geometryUnchanged, false)
    assert.equal(result.sceneDifferences, true)
    assert.equal(architectureFingerprint(apartment), architectureFingerprint(source))
    assert.ok(result.changeSummary.furniture >= 8)
    assert.ok(result.changeSummary.wallPanels >= 1)
    assert.ok(result.changeSummary.lighting >= 2)
    assert.ok(result.conceptPlacements.every((p: any) => p.wallId === 'source-living-east'))
    assert.ok('removedArtworkIds' in result)
    assert.ok(result.removedArtworkIds.includes('auto-living-Панно'))
    for (const before of originalFurniture) {
      const after = apartment.objects.find(o => o.id === before.id)!
      assert.deepEqual(after.position, before.position)
      assert.deepEqual(after.rotation, before.rotation)
      assert.deepEqual(after.size, before.size)
      assert.equal(after.params?.designStyle, style)
    }
    assert.deepEqual(apartment.objects.filter(o => o.roomId === 'bathroom'), source.objects.filter(o => o.roomId === 'bathroom'))
    assert.deepEqual(apartment.objects.find(o => o.id === 'source-service-strip'), source.objects.find(o => o.id === 'source-service-strip'))
    const lights = lightingSpecs(apartment, 'living', 'clean')
    assert.ok(lights.some(light => light.color !== '#fff0da'))
    assert.ok(apartment.objects.filter(o => o.roomId === 'living' && o.params?.lumens).every(o => o.params?.group !== 'night'))
    const root = await buildCanonical(apartment)
    try { signatures.add(shapeSignature(root, 'auto-living-Диван')) } finally { disposeTree(root) }
    records[style] = { apartment, lights }
  }
  assert.equal(signatures.size, 4, 'every style must change the actual sofa silhouette, not only its shader')
  assert.equal(JSON.stringify(source), untouched)
  assert.ok(records.loft.apartment.materials.some((m: any) => m.surface === 'brick'))
  assert.ok(records.loft.apartment.materials.some((m: any) => m.surface === 'concrete'))
  assert.equal(records.hitech.apartment.objects.filter((o: Entity) => o.id.startsWith('concept-living-hitech-wall-light')).length, 2)
  assert.ok(records.classic.apartment.objects.some((o: Entity) => o.kind === 'WallPanel' && o.params?.treatment === 'moulding'))
  assert.ok(records.japandi.apartment.objects.some((o: Entity) => o.kind === 'WallPanel' && o.params?.treatment === 'slats'))
})

test('concept preparation records source architecture separately from changed scene geometry and exports schema-derived elevations', async () => {
  const output = await mkdtemp(path.join(tmpdir(), 'design-concepts-test-'))
  try {
    const state = await generateDesignImages({ room: 'living', variants: ['loft', 'hitech', 'classic', 'japandi', 'clay-arch'], preset: 'draft', device: 'cpu', output, prepareOnly: true })
    assert.equal(state.status, 'prepared')
    assert.equal(state.completed, 0)
    assert.match(state.sourceArchitectureHash, /^[0-9a-f]{64}$/)
    for (const item of state.items) {
      assert.equal(item.geometryUnchanged, false)
      assert.equal(item.architectureUnchanged, true)
      assert.equal(item.image, undefined)
      assert.equal(item.category, 'concept')
      assert.ok(item.changes.length >= 4)
      const plan = await readFile(path.join(output, item.plan), 'utf8')
      assert.match(plan, /concept-living-/)
      const prompt = await readFile(path.join(output, item.prompt), 'utf8')
      assert.match(prompt, /wall composition, furniture style and fixtures/)
      if (item.id === 'clay-arch') {
        assert.match(prompt, /Project reference:/)
        assert.match(item.reference.url, /^https:\/\//)
        assert.equal(item.scope, 'all')
        const snapshot = JSON.parse(await readFile(path.join(output, 'clay-arch/variant-apartment.json'), 'utf8')) as Apartment
        assert.ok(snapshot.objects.some(o => o.roomId === 'kitchen' && o.kind === 'KitchenCabinet' && o.params?.designStyle))
      }
    }
  } finally { await rm(output, { recursive: true, force: true }) }
})
