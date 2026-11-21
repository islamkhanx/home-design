import test from 'node:test'
import assert from 'node:assert/strict'
import * as T from 'three'
import { buildMaterials } from '../src/scene/materials.ts'
import type { MaterialDef } from '../src/domain/schema.ts'
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { exportHeadlessScene } from '../scripts/export-headless.mjs'

const stone: MaterialDef = {
  id: 'photo-stone', name: 'Photo stone', color: '#ffffff', roughness: 0.7, metalness: 0,
  surface: 'stone', tileSize: [1.2, 0.6], texture: '/textures/missing.jpg', normalTexture: '/textures/missing-normal.jpg',
}

test('missing published photos keep usable procedural materials and do not abort the scene', async t => {
  const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document')
  const originalImageData = Object.getOwnPropertyDescriptor(globalThis, 'ImageData')
  Object.defineProperty(globalThis, 'document', { configurable: true, value: {
    createElement: () => ({ width: 0, height: 0, getContext: () => ({ putImageData() {} }) }),
  } })
  Object.defineProperty(globalThis, 'ImageData', { configurable: true, value: class {
    data: Uint8ClampedArray; width: number; height: number
    constructor(data: Uint8ClampedArray, width: number, height: number) { this.data = data; this.width = width; this.height = height }
  } })
  t.after(() => {
    for (const [key, descriptor] of [['document', originalDocument], ['ImageData', originalImageData]] as const) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else Reflect.deleteProperty(globalThis, key)
    }
  })
  const disposed: T.Texture[] = [], warnings: unknown[][] = []
  const dispose = T.Texture.prototype.dispose
  t.mock.method(T.Texture.prototype, 'dispose', function (this: T.Texture) { disposed.push(this); dispose.call(this) })
  t.mock.method(console, 'warn', (...args: unknown[]) => warnings.push(args))
  t.mock.method(T.TextureLoader.prototype, 'loadAsync', async () => { throw new Error('404') })
  const materials = await buildMaterials([stone, { ...stone, id: 'plain', surface: 'plain' }])
  const procedural = materials.get(stone.id)!, plain = materials.get('plain')!
  assert.ok(procedural.map instanceof T.CanvasTexture)
  assert.ok(procedural.normalMap instanceof T.CanvasTexture)
  assert.ok(procedural.roughnessMap instanceof T.CanvasTexture)
  assert.deepEqual(procedural.userData.metersPerTile, [1.2, 0.6])
  assert.deepEqual(procedural.userData.textureFallback, { color: stone.texture, normal: stone.normalTexture })
  assert.equal(plain.map, null)
  assert.equal(plain.normalMap, null)
  assert.equal(plain.color.getHexString(), 'ffffff')
  assert.equal(disposed.length, 0, 'failed replacements must not dispose the fallback')
  assert.equal(warnings.length, 4)

  const photo = new T.Texture()
  t.mock.method(T.TextureLoader.prototype, 'loadAsync', async (url: string) => {
    assert.equal(disposed.length, 0, 'fallback must survive until the photograph finishes loading')
    if (url === stone.texture) return photo
    throw new Error('404')
  })
  const partial = (await buildMaterials([{ ...stone, normalTexture: undefined }])).get(stone.id)!
  assert.equal(partial.map, photo)
  assert.ok(partial.normalMap instanceof T.CanvasTexture)
  assert.equal(photo.colorSpace, T.SRGBColorSpace)
  assert.equal(photo.flipY, false)
  assert.equal(disposed.length, 1)
  assert.ok(disposed[0] instanceof T.CanvasTexture)
  assert.notEqual(disposed[0], partial.normalMap)
  assert.equal(partial.userData.textureFallback, undefined)
})

test('headless export embeds procedural maps when source-only checkout lacks photo and normal files', async t => {
  const output = await mkdtemp(path.join(os.tmpdir(), 'home-missing-textures-'))
  t.after(() => rm(output, { recursive: true, force: true }))
  t.mock.method(console, 'warn', () => {})
  const model = JSON.parse(await readFile(new URL('../src/data/apartment.json', import.meta.url), 'utf8'))
  const material = model.materials.find((m: MaterialDef) => m.texture)
  assert.ok(material)
  material.texture = '/textures/source-only-missing-color.jpg'
  material.normalTexture = '/textures/source-only-missing-normal.jpg'
  const input = path.join(output, 'model.json')
  await writeFile(input, JSON.stringify(model))
  const result = await exportHeadlessScene({ input, output })
  const bytes = await readFile(result.sceneFile)
  const gltf = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString())
  const actual = gltf.materials.find((m: {name: string}) => m.name === material.id)
  const color = gltf.images[gltf.textures[actual.pbrMetallicRoughness.baseColorTexture.index].source]
  const normal = gltf.images[gltf.textures[actual.normalTexture.index].source]
  assert.equal(color.mimeType, 'image/png')
  assert.equal(color.name, material.id + '-color')
  assert.equal(normal.mimeType, 'image/png')
  assert.equal(normal.name, material.id + '-normal')
  assert.deepEqual(actual.extras.textureFallback, { color: material.texture, normal: material.normalTexture })
  assert.ok(gltf.nodes.some((node: {mesh?: number}) => node.mesh !== undefined))
  material.texture = '/textures/../disallowed.jpg'
  await writeFile(input, JSON.stringify(model))
  await assert.rejects(exportHeadlessScene({ input, output }), /textures must be local \/textures\/ paths/)
})
