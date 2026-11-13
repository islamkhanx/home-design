/** Browser-free export of the same canonical geometry and procedural texture pixels. */
import * as T from 'three'
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { deflateSync, crc32 } from 'node:zlib'
import { pathToFileURL } from 'node:url'
import path from 'node:path'
import {
  buildCanonical,
  applyVisibility,
  geometryManifest,
  visibleEntities,
  disposeTree,
} from '../src/scene/canonical.ts'
import { presets, fitOrthographic } from '../src/scene/cameras.ts'
import { lightingSpecs, updateEmitters } from '../src/scene/lighting.ts'
import { proceduralPixels } from '../src/scene/materials.ts'
import { parseApartment } from '../src/domain/schema.ts'
import { projectRoot } from './blender-runtime.mjs'
import { validateBundle } from './local-render-plugin.mjs'

function png(pixels, size, flip = true) {
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type), data]),
      result = Buffer.alloc(data.length + 12)
    result.writeUInt32BE(data.length, 0)
    body.copy(result, 4)
    result.writeUInt32BE(crc32(body), result.length - 4)
    return result
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(size, 0)
  header.writeUInt32BE(size, 4)
  header[8] = 8
  header[9] = 6
  const scan = Buffer.alloc(size * (size * 4 + 1)),
    data = Buffer.from(pixels)
  for (let y = 0; y < size; y++)
    data.copy(
      scan,
      y * (size * 4 + 1) + 1,
      (flip ? size - y - 1 : y) * size * 4,
      (flip ? size - y : y + 1) * size * 4,
    )
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(scan)),
    chunk('IEND', Buffer.alloc(0)),
  ])
}
function embedSurfaces(buffer, materials) {
  const source = Buffer.from(buffer),
    jsonSize = source.readUInt32LE(12)
  const gltf = JSON.parse(source.subarray(20, 20 + jsonSize).toString())
  let binary = source.subarray(28 + jsonSize)
  gltf.images ??= []
  gltf.textures ??= []
  gltf.samplers ??= []
  const sampler =
    gltf.samplers.push({ magFilter: 9729, minFilter: 9987, wrapS: 10497, wrapT: 10497 }) - 1
  const texture = (pixels, size, name) => {
    binary = Buffer.concat([binary, Buffer.alloc((4 - (binary.length % 4)) % 4)])
    const bytes = png(pixels, size),
      offset = binary.length
    binary = Buffer.concat([binary, bytes])
    const view =
      gltf.bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: bytes.length }) - 1
    const image = gltf.images.push({ bufferView: view, mimeType: 'image/png', name }) - 1
    return gltf.textures.push({ source: image, sampler }) - 1
  }
  for (const definition of materials) {
    const pixels = proceduralPixels(definition)
    if (!pixels) continue
    const color = texture(pixels.colors, pixels.size, definition.id + '-color')
    const normal = texture(pixels.normals, pixels.size, definition.id + '-normal')
    const packed = new Uint8ClampedArray(pixels.rough)
    // glTF roughness lives in G; metalness in B (the scalar factor is applied separately).
    for (let i = 0; i < packed.length; i += 4) {
      packed[i] = 255
      packed[i + 2] = 255
    }
    const roughness = texture(packed, pixels.size, definition.id + '-roughness')
    for (const material of gltf.materials)
      if (material.name === definition.id) {
        material.pbrMetallicRoughness.baseColorTexture = { index: color }
        material.pbrMetallicRoughness.metallicRoughnessTexture = { index: roughness }
        material.normalTexture = { index: normal, scale: 0.4 }
      }
  }
  gltf.buffers[0].byteLength = binary.length
  binary = Buffer.concat([binary, Buffer.alloc((4 - (binary.length % 4)) % 4)])
  let json = Buffer.from(JSON.stringify(gltf))
  json = Buffer.concat([json, Buffer.alloc((4 - (json.length % 4)) % 4, 32)])
  const header = Buffer.alloc(20)
  header.writeUInt32LE(0x46546c67, 0)
  header.writeUInt32LE(2, 4)
  header.writeUInt32LE(28 + json.length + binary.length, 8)
  header.writeUInt32LE(json.length, 12)
  header.writeUInt32LE(0x4e4f534a, 16)
  const binaryHeader = Buffer.alloc(8)
  binaryHeader.writeUInt32LE(binary.length, 0)
  binaryHeader.writeUInt32LE(0x004e4942, 4)
  return Buffer.concat([header, json, binaryHeader, binary])
}
export async function exportHeadlessScene({
  input,
  output = path.join(projectRoot, 'exports/latest'),
  view = 'dollhouse',
  lighting = 'day',
} = {}) {
  if (!['dollhouse', 'interior', 'plan', 'free'].includes(view)) throw new Error('Unknown view')
  if (!['day', 'clean', 'evening'].includes(lighting)) throw new Error('Unknown lighting')
  const a = parseApartment(
    JSON.parse(await readFile(input ?? path.join(projectRoot, 'src/data/apartment.json'), 'utf8')),
  )
  if (a.materials.some((m) => m.texture || m.normalTexture))
    throw new Error(
      'File textures require the browser exporter; headless mode supports the shared procedural materials.',
    )
  const root = await buildCanonical(a),
    room = a.rooms.find((r) => r.polygon)?.id ?? 'all'
  applyVisibility(root, a, room, view, true)
  updateEmitters(root, a, lightingSpecs(a, room, lighting))
  // GLTFExporter only requires FileReader to convert its completed Blob to binary in Node.
  const original = globalThis.FileReader
  globalThis.FileReader = class {
    readAsArrayBuffer(blob) {
      blob.arrayBuffer().then((b) => {
        this.result = b
        this.onloadend?.()
      })
    }
  }
  try {
    const raw = await new GLTFExporter().parseAsync(root, { binary: true, onlyVisible: false })
    const glb = embedSurfaces(raw, a.materials)
    const metadata = {
      schemaVersion: 1,
      units: 'm',
      sourceUnits: 'mm',
      sourceRevision: a.revision,
      sourceHash: createHash('sha256').update(JSON.stringify(a)).digest('hex'),
      sourceApartment: a,
      camera: fitOrthographic(presets(root)[view], root, 16 / 9),
      cameraPresets: presets(root),
      visibleEntityIds: visibleEntities(root),
      lightingPreset: lighting,
      lights: lightingSpecs(a, room, lighting),
      materials: a.materials,
      geometry: geometryManifest(root),
      exportedAt: new Date().toISOString(),
      exporter: 'canonical-headless',
      roundTrip: { passed: false, status: 'Blender import validation required before rendering' },
    }
    validateBundle(glb, metadata)
    await mkdir(output, { recursive: true })
    const sceneFile = path.join(output, 'scene.glb'),
      metadataFile = path.join(output, 'scene.metadata.json')
    await writeFile(sceneFile, glb)
    await writeFile(metadataFile, JSON.stringify(metadata, null, 2))
    await writeFile(path.join(output, 'apartment.json'), JSON.stringify(a, null, 2))
    return { sceneFile, metadataFile, output, parts: metadata.geometry.length }
  } finally {
    globalThis.FileReader = original
    disposeTree(root)
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2),
    get = (k) => (args.includes(k) ? args[args.indexOf(k) + 1] : undefined)
  exportHeadlessScene({
    input: get('--input'),
    output: get('--output'),
    view: get('--view'),
    lighting: get('--lighting'),
  })
    .then((r) => console.log(`Exported ${r.parts} canonical mesh parts to ${r.output}`))
    .catch((e) => {
      console.error(e)
      process.exitCode = 1
    })
}
