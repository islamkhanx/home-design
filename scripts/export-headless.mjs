/** Browser-free export of the same canonical geometry and procedural texture pixels. */
import * as T from 'three'
import { renderNotice } from '../src/scene/provenance.ts'
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
import { presets, fitOrthographic, safeIndoorCamera } from '../src/scene/cameras.ts'
import { prepareWalkthroughApartment } from '../src/scene/walking-space.ts'
import { lightingSpecs, updateEmitters } from '../src/scene/lighting.ts'
import { proceduralPixels } from '../src/scene/materials.ts'
import { parseApartment } from '../src/domain/schema.ts'
import { projectRoot } from './blender-runtime.mjs'
import { validateBundle } from './render-bundle.mjs'

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
async function embedSurfaces(buffer, materials) {
  const source = Buffer.from(buffer),
    jsonSize = source.readUInt32LE(12)
  const gltf = JSON.parse(source.subarray(20, 20 + jsonSize).toString())
  let binary = source.subarray(28 + jsonSize)
  gltf.images ??= []
  gltf.textures ??= []
  gltf.samplers ??= []
  const sampler =
    gltf.samplers.push({ magFilter: 9729, minFilter: 9987, wrapS: 10497, wrapT: 10497 }) - 1
  const imageTexture = (bytes, name, mimeType) => {
    binary = Buffer.concat([binary, Buffer.alloc((4 - (binary.length % 4)) % 4)])
    const offset = binary.length
    binary = Buffer.concat([binary, bytes])
    const view =
      gltf.bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: bytes.length }) - 1
    const image = gltf.images.push({ bufferView: view, mimeType, name }) - 1
    return gltf.textures.push({ source: image, sampler }) - 1
  }
  const texture = (pixels, size, name) => imageTexture(png(pixels, size), name, 'image/png')
  const fileTexture = async (url, name) => {
    if (!/^\/textures\/[^?]+\.(png|jpe?g)$/i.test(url) || url.includes('..'))
      throw new Error(`Unsupported local texture: ${url}`)
    let bytes
    try { bytes = await readFile(path.join(projectRoot, 'public', url)) }
    catch (error) {
      if (error.code !== 'ENOENT') throw error
      console.warn(`Local texture unavailable; using the generated or base material: ${url}`)
      return null
    }
    return imageTexture(bytes, name, /\.png$/i.test(url) ? 'image/png' : 'image/jpeg')
  }
  for (const definition of materials) {
    const pixels = proceduralPixels(definition)
    if (!pixels && !definition.texture && !definition.normalTexture) continue
    const photo = definition.texture ? await fileTexture(definition.texture, definition.id + '-photo') : null
    const suppliedNormal = definition.normalTexture ? await fileTexture(definition.normalTexture, definition.id + '-normal') : null
    const color = photo ?? (pixels ? texture(pixels.colors, pixels.size, definition.id + '-color') : null)
    const normal = suppliedNormal ?? (pixels ? texture(pixels.normals, pixels.size, definition.id + '-normal') : null)
    const fallback = {
      ...(definition.texture && photo === null ? { color: definition.texture } : {}),
      ...(definition.normalTexture && suppliedNormal === null ? { normal: definition.normalTexture } : {}),
    }
    const packed = new Uint8ClampedArray(pixels?.rough ?? [])
    // glTF roughness lives in G; metalness in B (the scalar factor is applied separately).
    for (let i = 0; i < packed.length; i += 4) {
      packed[i] = 255
      packed[i + 2] = 255
    }
    const roughness = pixels ? texture(packed, pixels.size, definition.id + '-roughness') : null
    for (const material of gltf.materials)
      if (material.name === definition.id) {
        if (color !== null) material.pbrMetallicRoughness.baseColorTexture = { index: color }
        if (roughness !== null) material.pbrMetallicRoughness.metallicRoughnessTexture = { index: roughness }
        if (normal !== null) material.normalTexture = { index: normal, scale: 0.4 }
        if (Object.keys(fallback).length) material.extras = { ...material.extras, textureFallback: fallback }
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
/** Presentation camera coordinates are meters. They never alter the source apartment.
 * @param {{input?: string, output?: string, view?: string, lighting?: string, room?: string, conceptLighting?: {roomId: string, style: string, label?: string, roomIds?: string[]}, camera?: {position: number[], target: number[], fov?: number}}} [options]
 */
export async function exportHeadlessScene({
  input,
  output = path.join(projectRoot, 'exports/latest'),
  view = 'dollhouse',
  lighting = 'day',
  room = 'all',
  camera,
  conceptLighting,
} = {}) {
  if (!['dollhouse', 'interior', 'plan', 'free', 'ceiling', 'electrical'].includes(view)) throw new Error('Unknown view')
  if (!['day', 'clean', 'evening'].includes(lighting)) throw new Error('Unknown lighting')
  if (camera && (view !== 'interior' ||
      ![camera.position, camera.target].every((v) => Array.isArray(v) && v.length === 3 && v.every(Number.isFinite)) ||
      (camera.fov !== undefined && (!Number.isFinite(camera.fov) || camera.fov < 20 || camera.fov > 120))))
    throw new Error('An interior camera requires finite 3D position/target in meters and a valid field of view.')
  const source = parseApartment(
    JSON.parse(await readFile(input ?? path.join(projectRoot, 'src/data/apartment.json'), 'utf8')),
  )
  if (room !== 'all' && !source.rooms.some((r) => r.id === room && r.polygon))
    throw new Error('Unknown room')
  if (conceptLighting && (conceptLighting.roomId !== room || room === 'bathroom' ||
      !/^[a-z][a-z0-9-]{0,39}$/.test(conceptLighting.style)))
    throw new Error('Invalid concept lighting scope')
  // The browser uses these declared open-door poses for indoor viewing. Stage the
  // same copy here; its hash and sourceApartment must describe the exported GLB.
  const a = view === 'interior' ? prepareWalkthroughApartment(source) : source
  const root = await buildCanonical(a)
  applyVisibility(root, a, room, view, false)
  const specs = lightingSpecs(a, view === 'interior' ? 'all' : room, lighting)
  updateEmitters(root, a, specs)
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
    const cameraRoom = view === 'interior' && room === 'all'
      ? (a.rooms.find((r) => r.id === 'hall' && r.polygon) ?? a.rooms.find((r) => r.polygon))?.id
      : room
    const cameraPresets = presets(root, cameraRoom)
    if (camera) cameraPresets.interior = { ...cameraPresets.interior, ...camera }
    if (view === 'interior')
      cameraPresets.interior = safeIndoorCamera(cameraPresets.interior, a, root, cameraRoom)
    const raw = await new GLTFExporter().parseAsync(root, { binary: true, onlyVisible: false })
    const glb = await embedSurfaces(raw, a.materials)
    const metadata = {
      schemaVersion: 1,
      units: 'm',
      sourceUnits: 'mm',
      sourceRevision: a.revision,
      sourceHash: createHash('sha256').update(JSON.stringify(a)).digest('hex'),
      sourceApartment: a,
      renderNotice: conceptLighting ? [
        `${conceptLighting.label ?? source.generation?.label ?? conceptLighting.style} · концепция интерьера`,
        'Контур по исходному плану · нужен обмер · в проект не внесено',
      ] : renderNotice(a, room),
      roomId: room,
      camera: fitOrthographic(cameraPresets[view], root, 16 / 9),
      cameraPresets,
      visibleEntityIds: visibleEntities(root),
      lightingPreset: lighting,
      ...(conceptLighting ? { conceptLighting } : {}),
      lights: specs,
      photorealLights: lightingSpecs(a, 'all', 'clean'),
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
    room: get('--room'),
  })
    .then((r) => console.log(`Exported ${r.parts} canonical mesh parts to ${r.output}`))
    .catch((e) => {
      console.error(e)
      process.exitCode = 1
    })
}
