import * as T from 'three'
import type { MaterialDef } from '../domain/schema.ts'
const fract = (x: number) => x - Math.floor(x)
function noise(x: number, y: number) {
  const ix = Math.floor(x),
    iy = Math.floor(y),
    fx = fract(x),
    fy = fract(y),
    u = fx * fx * (3 - 2 * fx),
    v = fy * fy * (3 - 2 * fy)
  const h = (a: number, b: number) => fract(Math.sin(a * 127.1 + b * 311.7) * 43758.5453)
  return T.MathUtils.lerp(
    T.MathUtils.lerp(h(ix, iy), h(ix + 1, iy), u),
    T.MathUtils.lerp(h(ix, iy + 1), h(ix + 1, iy + 1), u),
    v,
  )
}
/** Subtle, deterministic texture study. UVs are measured in meters, not stretched per mesh. */
export function proceduralPixels(def: MaterialDef) {
  if (!def.surface || def.surface === 'plain') return null
  const n = 512,
    heights = new Float32Array(n * n),
    colors = new Uint8ClampedArray(n * n * 4),
    rough = new Uint8ClampedArray(n * n * 4),
    normals = new Uint8ClampedArray(n * n * 4)
  const scale = def.tileSize ?? (def.surface === 'oak' ? [0.6, 2.4] : [1.2, 0.6])
  const oak = def.surface === 'oak'
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const u = x / n,
        v = y / n,
        cloud = noise(u * 7, v * 7),
        fine = noise(u * 86, v * 86)
      const drift = (noise(u * 3, v * 2) - 0.5) * 0.045,
        grain = noise((u + drift) * 145, v * 3),
        pores = Math.pow(noise((u + drift) * 320, v * 22), 7)
      // A 2 mm joint on a 600 × 1200 mm stone module. No fake seams on wood.
      const joint = !oak && (u < 0.002 / scale[0] || v < 0.002 / scale[1]),
        value = oak
          ? 0.86 + 0.1 * grain + 0.035 * cloud - 0.06 * pores
          : joint
            ? 0.76
            : 0.91 + 0.038 * cloud + 0.022 * fine
      const i = (y * n + x) * 4
      for (let k = 0; k < 3; k++) {
        colors[i + k] = Math.round(value * 255)
        rough[i + k] = Math.round((oak ? 0.84 + 0.1 * grain : 0.9 + 0.06 * fine) * 255)
      }
      colors[i + 3] = rough[i + 3] = 255
      heights[y * n + x] = joint ? -0.0006 : oak ? grain * 0.00012 : fine * 0.00007
    }
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const i = (y * n + x) * 4,
        dx =
          (heights[y * n + ((x + 1) % n)] - heights[y * n + ((x + n - 1) % n)]) /
          ((2 * scale[0]) / n),
        dy =
          (heights[((y + 1) % n) * n + x] - heights[((y + n - 1) % n) * n + x]) /
          ((2 * scale[1]) / n),
        normal = new T.Vector3(-dx, -dy, 1).normalize()
      normals[i] = Math.round((normal.x * 0.5 + 0.5) * 255)
      normals[i + 1] = Math.round((normal.y * 0.5 + 0.5) * 255)
      normals[i + 2] = Math.round((normal.z * 0.5 + 0.5) * 255)
      normals[i + 3] = 255
    }
  return { colors, rough, normals, scale, size: n }
}
function procedural(def: MaterialDef) {
  if (typeof document === 'undefined') return null
  const pixels = proceduralPixels(def)
  if (!pixels) return null
  const { colors, rough, normals, scale, size: n } = pixels
  const texture = (data: Uint8ClampedArray, srgb = false) => {
    const c = document.createElement('canvas')
    c.width = c.height = n
    c.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(data), n, n), 0, 0)
    const t = new T.CanvasTexture(c)
    t.wrapS = t.wrapT = T.RepeatWrapping
    t.anisotropy = 8
    if (srgb) t.colorSpace = T.SRGBColorSpace
    return t
  }
  return {
    map: texture(colors, true),
    roughnessMap: texture(rough),
    normalMap: texture(normals),
    scale,
  }
}
export async function buildMaterials(
  defs: MaterialDef[],
): Promise<Map<string, T.MeshPhysicalMaterial>> {
  const loader = typeof document !== 'undefined' ? new T.TextureLoader() : null,
    result = new Map<string, T.MeshPhysicalMaterial>()
  for (const d of defs) {
    const material = new T.MeshPhysicalMaterial({
      color: d.color,
      roughness: d.roughness,
      metalness: d.metalness,
      transmission: d.transmission ?? 0,
      ior: d.ior ?? 1.5,
      thickness: 0.008,
      side: T.DoubleSide,
      emissive: d.emissive ?? '#000000',
      emissiveIntensity: d.emissiveIntensity ?? 0,
    })
    material.name = d.id
    material.userData = { materialId: d.id }
    if (d.id === 'white') {
      material.clearcoat = 0.3
      material.clearcoatRoughness = 0.18
    }
    if (d.surface && d.surface !== 'plain')
      material.userData.metersPerTile =
        d.tileSize ?? (d.surface === 'oak' ? [0.6, 2.4] : [1.2, 0.6])
    const generated = procedural(d)
    if (generated) {
      material.map = generated.map
      material.normalMap = generated.normalMap
      material.roughnessMap = generated.roughnessMap
      material.userData.metersPerTile = generated.scale
      material.normalScale.set(0.4, 0.4)
    }
    if (d.texture && loader) {
      try {
        const photo = await loader.loadAsync(d.texture)
        photo.colorSpace = T.SRGBColorSpace
        // Match raw-image embedding in the browser-free GLB exporter.
        photo.flipY = false
        photo.anisotropy = 8
        photo.wrapS = photo.wrapT = T.RepeatWrapping
        photo.repeat.set(...(d.repeat ?? [1, 1]))
        material.map?.dispose()
        material.map = photo
        // A product photograph represents one tile, not one mesh face.
        if (d.tileSize) material.userData.metersPerTile = d.tileSize
        else delete material.userData.metersPerTile
      } catch {
        material.userData.textureFallback = { color: d.texture }
        console.warn(`Color texture unavailable for ${d.id}; using the generated or base material.`, d.texture)
      }
    }
    if (d.normalTexture && loader) {
      try {
        const normal = await loader.loadAsync(d.normalTexture)
        normal.wrapS = normal.wrapT = T.RepeatWrapping
        normal.repeat.set(...(d.repeat ?? [1, 1]))
        material.normalMap?.dispose()
        material.normalMap = normal
      } catch {
        material.userData.textureFallback = { ...material.userData.textureFallback, normal: d.normalTexture }
        console.warn(`Normal texture unavailable for ${d.id}; keeping the generated or base normal.`, d.normalTexture)
      }
    }
    result.set(d.id, material)
  }
  return result
}
export function applyMetricUVs(root: T.Group) {
  root.updateMatrixWorld(true)
  root.traverse((o) => {
    if (!(o instanceof T.Mesh) || Array.isArray(o.material)) return
    const scale = o.material.userData.metersPerTile as number[] | undefined
    if (!scale) return
    const geometry = o.geometry,
      positions = geometry.getAttribute('position'),
      normals = geometry.getAttribute('normal')
    if (!normals) return
    const uv = new Float32Array(positions.count * 2),
      point = new T.Vector3(),
      normal = new T.Vector3(),
      matrix = new T.Matrix3().getNormalMatrix(o.matrixWorld)
    for (let i = 0; i < positions.count; i++) {
      point.fromBufferAttribute(positions, i).applyMatrix4(o.matrixWorld)
      normal.fromBufferAttribute(normals, i).applyMatrix3(matrix).normalize()
      const ax = Math.abs(normal.x),
        ay = Math.abs(normal.y),
        az = Math.abs(normal.z)
      uv[i * 2] = (ay >= ax && ay >= az ? point.x : ax > az ? point.z : point.x) / scale[0]
      uv[i * 2 + 1] = (ay >= ax && ay >= az ? point.z : point.y) / scale[1]
    }
    geometry.setAttribute('uv', new T.BufferAttribute(uv, 2))
  })
}
