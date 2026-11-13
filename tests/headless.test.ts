import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { inflateSync, crc32 } from 'node:zlib'
import { exportHeadlessScene } from '../scripts/export-headless.mjs'
import type { MaterialDef } from '../src/domain/schema.ts'
import { proceduralPixels } from '../src/scene/materials.ts'

test('headless GLB embeds the same procedural pixels, valid PNG checksums and canonical IDs', async () => {
  const output = await mkdtemp(path.join(os.tmpdir(), 'home-export-'))
  try {
    const result = await exportHeadlessScene({ output }),
      glb = await readFile(result.sceneFile)
    const length = glb.readUInt32LE(12),
      gltf = JSON.parse(glb.subarray(20, 20 + length).toString()),
      binary = glb.subarray(28 + length)
    const meta = JSON.parse(await readFile(result.metadataFile, 'utf8'))
    assert.equal(meta.geometry.length, 61)
    assert.equal(gltf.images.length, 9)
    assert.ok(
      gltf.nodes
        .filter((n: { mesh?: number }) => n.mesh !== undefined)
        .every((n: { extras?: { partId?: string } }) => n.extras?.partId),
    )
    for (const image of gltf.images) {
      const view = gltf.bufferViews[image.bufferView],
        png = binary.subarray(view.byteOffset, view.byteOffset + view.byteLength)
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
