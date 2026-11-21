import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import os from 'node:os'
import path from 'node:path'
import { inflateSync, crc32 } from 'node:zlib'
import { exportHeadlessScene } from '../scripts/export-headless.mjs'
import type { MaterialDef } from '../src/domain/schema.ts'
import { proceduralPixels } from '../src/scene/materials.ts'
import { buildCanonical, disposeTree, geometryManifest } from '../src/scene/canonical.ts'
import { prepareWalkthroughApartment, walkingSpace } from '../src/scene/walking-space.ts'
import { lightingSpecs } from '../src/scene/lighting.ts'

test('headless GLB embeds the same procedural pixels, valid PNG checksums and canonical IDs', async () => {
  const output = await mkdtemp(path.join(os.tmpdir(), 'home-export-'))
  try {
    const result = await exportHeadlessScene({ output }),
      glb = await readFile(result.sceneFile)
    const length = glb.readUInt32LE(12),
      gltf = JSON.parse(glb.subarray(20, 20 + length).toString()),
      binary = glb.subarray(28 + length)
    const meta = JSON.parse(await readFile(result.metadataFile, 'utf8'))
    assert.ok(meta.geometry.length > 50)
    assert.equal(meta.roomId, 'all')
    assert.match(meta.renderNotice[0], /Интерьер сгенерирован автоматически/)
    assert.match(meta.renderNotice[1], /масштаб по окну/)
    for (const room of meta.sourceApartment.rooms.filter((r: { polygon?: unknown }) => r.polygon))
      assert.ok(
        meta.visibleEntityIds.some(
          (id: string) =>
            meta.sourceApartment.objects.find((o: { id: string; roomId: string }) => o.id === id)
              ?.roomId === room.id,
        ),
      )
    assert.equal(gltf.images.length, meta.materials.filter((m: MaterialDef) => m.surface && m.surface !== 'plain').length * 3)
    assert.ok(
      gltf.nodes
        .filter((n: { mesh?: number }) => n.mesh !== undefined)
        .every((n: { extras?: { partId?: string } }) => n.extras?.partId),
    )
    for (const image of gltf.images) {
      const view = gltf.bufferViews[image.bufferView],
        png = binary.subarray(view.byteOffset, view.byteOffset + view.byteLength)
      if (image.mimeType === 'image/jpeg') {
        const definition = meta.materials.find((m: MaterialDef) => image.name === m.id + '-photo')
        assert.ok(definition?.texture, 'Photographic texture must have source metadata')
        assert.deepEqual(png, await readFile(new URL('../public' + definition.texture, import.meta.url)))
        continue
      }
      assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10])
      const idat = []
      for (let offset = 8; offset < png.length; ) {
        const size = png.readUInt32BE(offset),
          type = png.subarray(offset + 4, offset + 8).toString(),
          data = png.subarray(offset + 8, offset + 8 + size)
        assert.equal(
          crc32(png.subarray(offset + 4, offset + 8 + size)),
          png.readUInt32BE(offset + 8 + size),
        )
        if (type === 'IDAT') idat.push(data)
        offset += size + 12
      }
      if (image.name === 'oak-color') {
        const pixels = proceduralPixels(meta.materials.find((m: MaterialDef) => m.id === 'oak'))!,
          scan = inflateSync(Buffer.concat(idat)),
          stride = pixels.size * 4
        for (const y of [0, 123, 511])
          assert.deepEqual(
            scan.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride),
            Buffer.from(pixels.colors).subarray((511 - y) * stride, (512 - y) * stride),
          )
      }
    }
  } finally {
    await rm(output, { recursive: true, force: true })
  }
})

test('indoor export retains the full apartment, corrects an obstructed eye and exports matching door poses', async () => {
  const output = await mkdtemp(path.join(os.tmpdir(), 'home-indoor-export-'))
  try {
    const source = JSON.parse(await readFile(new URL('../src/data/apartment.json', import.meta.url), 'utf8'))
    const living = source.rooms.find((r: { id: string }) => r.id === 'living')
    const chair = source.objects.find((o: { id: string }) => o.id === 'auto-living-Рабочее кресло')
    assert.ok(chair)
    // Force the old failure even after a future layout edit moves the default camera.
    living.interiorCamera.position = [chair.position[0], 1600, chair.position[2]]
    const input = path.join(output, 'input.json'), before = JSON.stringify(source)
    await writeFile(input, before)
    const result = await exportHeadlessScene({ input, output, room: 'living', view: 'interior', lighting: 'clean' })
    const meta = JSON.parse(await readFile(result.metadataFile, 'utf8'))
    const staged = prepareWalkthroughApartment(source), root = await buildCanonical(staged)
    try {
      const space = walkingSpace(staged, root)
      assert.equal(space.free([chair.position[0] / 1000, chair.position[2] / 1000]), false)
      assert.ok(space.free([meta.camera.position[0], meta.camera.position[2]]))
      assert.equal(meta.camera.position[1], 1.6)
      assert.deepEqual(meta.camera, meta.cameraPresets.interior)
      assert.deepEqual(meta.sourceApartment, staged)
      assert.deepEqual(JSON.parse(await readFile(path.join(output, 'apartment.json'), 'utf8')), staged)
      assert.equal(meta.sourceHash, createHash('sha256').update(JSON.stringify(staged)).digest('hex'))
      assert.deepEqual(meta.geometry, geometryManifest(root))
      assert.deepEqual(meta.lights, lightingSpecs(staged, 'all', 'clean'))
      for (const object of staged.objects.filter((o) => o.visible !== false && !['DimensionLine', 'RoomLabel'].includes(o.kind)))
        assert.ok(meta.visibleEntityIds.includes(object.id), object.id + ' must remain in the interior render')
      assert.equal(staged.objects.find((o) => o.id === 'door-entry')?.params?.doorAngle, 0)
      assert.equal(await readFile(input, 'utf8'), before, 'source file must remain unchanged')
    } finally {
      disposeTree(root)
    }
  } finally {
    await rm(output, { recursive: true, force: true })
  }
})
