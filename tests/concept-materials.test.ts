import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { buildMaterials, proceduralPixels, surfaceScale } from '../src/scene/materials.ts'
import type { MaterialDef } from '../src/domain/schema.ts'

const material = (surface: MaterialDef['surface'], color = '#a86543'): MaterialDef => ({
  id: surface!, name: surface!, color, roughness: .9, metalness: 0, surface,
})
const digest = (pixels: NonNullable<ReturnType<typeof proceduralPixels>>) => createHash('sha256')
  .update(pixels.colors).update(pixels.rough).update(pixels.normals).digest('hex')

test('brick running bond has neutral 10 mm mortar and staggered 250 × 65 mm faces', async () => {
  const definition = material('brick'), pixels = proceduralPixels(definition)!
  assert.deepEqual(pixels.scale, [.52, .3])
  const sample = (x: number, y: number) => {
    const i = (Math.floor(y / pixels.scale[1] * pixels.size) * pixels.size + Math.floor(x / pixels.scale[0] * pixels.size)) * 4
    return Array.from(pixels.colors.slice(i, i + 3))
  }
  const firstJoint = sample(.005, .04), firstFace = sample(.14, .04),
    shiftedFace = sample(.005, .115), shiftedJoint = sample(.135, .115)
  assert.ok(firstJoint[0] - firstJoint[2] < 20, 'mortar stays neutral instead of inheriting terracotta tint')
  assert.ok(shiftedJoint[0] - shiftedJoint[2] < 20)
  assert.ok(firstFace[0] > firstFace[2] * 1.7)
  assert.ok(shiftedFace[0] > shiftedFace[2] * 1.7, 'next course shifts the vertical joint by half a brick')
  assert.ok(firstJoint[1] > firstFace[1] + 40)
  const mats = await buildMaterials([definition])
  const actual = mats.get('brick')!
  assert.equal(actual.color.getHexString(), 'ffffff', 'baked sRGB colors are not multiplied by the brick tint twice')
  assert.deepEqual(actual.userData.metersPerTile, pixels.scale)
  actual.dispose()
})

test('concrete and plaster have distinct deterministic relief without tile joints', async () => {
  const definitions = [material('brick'), material('concrete', '#99958e'), material('plaster', '#e9e1d4')]
  const maps = definitions.map(definition => proceduralPixels(definition)!)
  assert.equal(new Set(maps.map(digest)).size, 3)
  assert.equal(digest(maps[1]), digest(proceduralPixels(definitions[1])!))
  for (const pixels of maps.slice(1)) {
    assert.deepEqual(pixels.scale, [1, 1])
    const firstColumn = new Set(Array.from({ length: pixels.size }, (_, row) => pixels.colors[row * pixels.size * 4]))
    assert.ok(firstColumn.size > 5, 'a continuous finish must not receive a solid tile grout border')
    assert.ok(pixels.normals.some((value, i) => i % 4 < 2 && Math.abs(value - 128) > 2), 'relief is represented by a normal map')
    assert.ok(pixels.rough.every((value, i) => i % 4 === 3 ? value === 255 : value >= 200))
  }
  const materials = await buildMaterials(definitions)
  for (const [i, definition] of definitions.entries()) {
    const actual = materials.get(definition.id)!
    assert.deepEqual(actual.userData.metersPerTile, maps[i].scale, 'FAST and headless map scale must agree')
    actual.dispose()
  }
  const explicit = { ...definitions[1], tileSize: [2, 3] as [number, number] }
  assert.deepEqual(surfaceScale(explicit), [2, 3])
  assert.notEqual(surfaceScale(explicit), explicit.tileSize)
})

test('existing oak and stone procedural appearance stays unchanged', () => {
  assert.equal(digest(proceduralPixels(material('oak', '#ffffff'))!), '74cfdee31367d9207bc79fa46219ed5b67bd35b8f846af99081cb986fe63a966')
  assert.equal(digest(proceduralPixels(material('stone', '#ffffff'))!), 'ba2a9d2ec5c06bfe8ca4bb9c86c6d8bab22eb710f035efeae082306c178fff9c')
})
