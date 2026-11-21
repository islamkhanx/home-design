import * as T from 'three'
import type { MaterialDef } from '../domain/schema.ts'
const fract = (x: number) => x - Math.floor(x)
const wrap = (x: number, period: number) => ((x % period) + period) % period
const hash = (x: number, y: number) => fract(Math.sin(x * 127.1 + y * 311.7) * 43758.5453)
const parquetRepeat = .08 * 8 * Math.SQRT2
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
/** Repeat dimensions in metres; shared by FAST UVs and embedded GLB maps. */
export function surfaceScale(def: MaterialDef): [number, number] {
  if (def.tileSize) return [...def.tileSize]
  if (def.surface === 'oak') return [0.6, 2.4]
  if (def.surface === 'brick') return [0.52, 0.3]
  if (def.surface === 'concrete' || def.surface === 'plaster') return [1, 1]
  if (def.surface === 'cork') return [.24, .24]
  if (def.surface === 'terrazzo') return [.48, .48]
  if (def.surface === 'herringbone') return [parquetRepeat, parquetRepeat]
  if (def.surface === 'glazed-tile') return [.4, .4]
  if (def.surface === 'brushed-metal') return [.16, .8]
  return [1.2, 0.6]
}
function periodicNoise(u: number, v: number, cells: number) {
  const x = u * cells, y = v * cells,
    ix = Math.floor(x), iy = Math.floor(y),
    fx = fract(x), fy = fract(y),
    sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy),
    h = (a: number, b: number) => fract(Math.sin(((a % cells + cells) % cells) * 127.1 + ((b % cells + cells) % cells) * 311.7) * 43758.5453)
  return T.MathUtils.lerp(T.MathUtils.lerp(h(ix, iy), h(ix + 1, iy), sx), T.MathUtils.lerp(h(ix, iy + 1), h(ix + 1, iy + 1), sx), sy)
}
function absoluteColor(surface: MaterialDef['surface']) {
  return surface === 'brick' || surface === 'terrazzo' || surface === 'glazed-tile'
}

/** Metric patterns keep grain and aggregate scale consistent across objects. */
function patternedPixels(def: MaterialDef, scale: [number, number], size: number) {
  const surface = def.surface
  if (surface !== 'herringbone' && surface !== 'glazed-tile' && surface !== 'brushed-metal' && surface !== 'terrazzo' && surface !== 'cork') return null
  const color = [1, 3, 5].map(start => parseInt(def.color.slice(start, start + 2), 16))
  const aggregate = [[239, 229, 205], [124, 116, 110], [177, 127, 91], [202, 188, 172], [78, 87, 78]]
  const cells = surface === 'cork' ? 30 : 22
  const sites = Array.from({ length: cells * cells }, (_, i) => {
    const x = i % cells, y = Math.floor(i / cells), random = hash(x + 1, y + 1)
    const angle = hash(x + 71, y + 11) * Math.PI
    return { x: .34 + hash(x + 17, y + 3) * .32, y: .34 + hash(x + 23, y + 5) * .32,
      radius: .09 + Math.pow(random, 1.7) * .23, cos: Math.cos(angle), sin: Math.sin(angle), shade: random }
  })
  const metalGrain = surface === 'brushed-metal'
    ? Array.from({ length: size }, (_, x) => hash(x + 1, 23)) : []
  return (u: number, v: number, x: number): { rgb: number[]; roughness: number; height: number } => {
    let shade = 1, roughness = .92, height = 0
    let rgb: number[] | undefined
    if (surface === 'herringbone') {
      // A four-to-one staggered plank lattice rotated 45 degrees. Eight cells
      // on each axis return the same phase at opposite repeat edges.
      const X = (u + v) * 8, Y = (v - u) * 8, col = Math.floor(X), row = Math.floor(Y)
      const phase = wrap(col - row, 8), horizontal = phase < 4
      const along = horizontal ? phase + fract(X) : 7 - phase + fract(Y)
      const across = horizontal ? fract(Y) : fract(X)
      const originX = wrap(horizontal ? col - phase : col, 8), originY = wrap(horizontal ? row : row - (7 - phase), 8)
      const joint = Math.min(across, 1 - across, along, 4 - along) * scale[0] / (8 * Math.SQRT2) < .0014
      const grain = noise(across * 39 + originX * 43, along * 2 + originY * 13)
      shade = joint ? .63 : .72 + .17 * hash(originX + 7, originY + 4) + .11 * grain
      roughness = .87 + .1 * grain
      height = joint ? -.0007 : .00012 * grain
    } else if (surface === 'glazed-tile') {
      const column = Math.floor(u * 4), row = Math.floor(v * 4)
      const dx = Math.min(fract(u * 4), 1 - fract(u * 4)) * scale[0] / 4
      const dy = Math.min(fract(v * 4), 1 - fract(v * 4)) * scale[1] / 4
      const distance = Math.min(dx, dy), grout = distance < .0015
      const glaze = periodicNoise(u, v, 21)
      shade = .72 + .2 * hash(column + 7, row + 3) + .13 * glaze
      rgb = grout ? [161, 155, 144] : color.map(channel => channel * shade)
      roughness = grout ? 1 : .68 + .2 * glaze
      height = grout ? -.0012 : Math.min(distance - .0015, .004) * .25 + .0003 * glaze
    } else if (surface === 'brushed-metal') {
      const grain = metalGrain[x], fine = periodicNoise(u, v, 5)
      shade = .79 + .17 * grain + .04 * fine
      roughness = .71 + .21 * grain
      height = .000022 * grain
    } else {
      const ix = Math.floor(u * cells), iy = Math.floor(v * cells), site = sites[ix + iy * cells]
      const dx = fract(u * cells) - site.x, dy = fract(v * cells) - site.y
      const a = Math.abs(dx * site.cos + dy * site.sin), b = Math.abs(-dx * site.sin + dy * site.cos)
      const chip = a + .8 * b < site.radius && b < site.radius * .58
      const grain = hash(x + 1, Math.floor(v * size) + 1)
      if (surface === 'cork') {
        shade = (chip ? .54 + .26 * site.shade : .77 + .14 * site.shade) + .1 * grain
        height = chip ? -.00055 : .00012 * grain
      } else {
        const piece = aggregate[Math.min(aggregate.length - 1, Math.floor(site.shade * aggregate.length))]
        rgb = (chip ? piece : color).map(channel => channel * (.94 + .06 * grain))
        roughness = .92 + .06 * grain
        height = .00014 * grain
      }
    }
    return { rgb: rgb ?? [shade * 255, shade * 255, shade * 255], roughness, height }
  }
}

/** Subtle, deterministic texture study. UVs are measured in meters, not stretched per mesh. */
function generateProceduralPixels(def: MaterialDef) {
  if (!def.surface || def.surface === 'plain') return null
  const n = 512,
    heights = new Float32Array(n * n),
    colors = new Uint8ClampedArray(n * n * 4),
    rough = new Uint8ClampedArray(n * n * 4),
    normals = new Uint8ClampedArray(n * n * 4)
  const scale = surfaceScale(def)
  const oak = def.surface === 'oak'
  const brickColor = [1, 3, 5].map(start => parseInt(def.color.slice(start, start + 2), 16))
  const samplePattern = patternedPixels(def, scale, n)
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const i = (y * n + x) * 4
      if (samplePattern) {
        const { rgb, roughness, height } = samplePattern(x / n, y / n, x)
        for (let k = 0; k < 3; k++) {
          colors[i + k] = rgb[k]
          rough[i + k] = roughness * 255
        }
        colors[i + 3] = rough[i + 3] = 255
        heights[y * n + x] = height
        continue
      }
      if (def.surface === 'brick') {
        // Running bond: 250 × 65 mm brick faces and 10 mm mortar. The default
        // repeat contains two bricks across and four courses, never one brick
        // stretched over an entire wall. tileSize deliberately changes the module.
        const row = Math.floor(y / n * 4),
          shifted = x / n * 2 + (row % 2) * .5,
          column = Math.floor(shifted),
          bx = fract(shifted), by = fract(y / n * 4),
          mortar = bx < .01 / (scale[0] / 2) || by < .01 / (scale[1] / 4),
          faceNoise = periodicNoise(x / n, y / n, 61),
          grain = periodicNoise(x / n, y / n, 187),
          brickVariation = fract(Math.sin((column % 2) * 51.2 + row * 31.7 + 7) * 19341.7),
          shade = .78 + .17 * brickVariation + .09 * faceNoise - .055 * grain
        for (let k = 0; k < 3; k++) {
          // Absolute sRGB lets neutral mortar coexist with terracotta faces.
          // buildMaterials sets a white color factor for these baked maps.
          colors[i + k] = mortar ? [184, 180, 170][k] * (.92 + .08 * grain) : brickColor[k] * shade
          rough[i + k] = Math.round((mortar ? .97 : .82 + .15 * grain) * 255)
        }
        colors[i + 3] = rough[i + 3] = 255
        heights[y * n + x] = mortar ? -.0025 : .00055 * faceNoise + .0003 * grain
        continue
      }
      if (def.surface === 'concrete' || def.surface === 'plaster') {
        const u = x / n, v = y / n,
          cloud = periodicNoise(u, v, 4),
          fine = periodicNoise(u, v, 91),
          pores = Math.pow(periodicNoise(u, v, 173), 11),
          trowel = Math.pow(Math.max(0, Math.sin(Math.PI * 2 * (u * 3 + v * 2) + cloud * 1.3)), 12),
          concrete = def.surface === 'concrete',
          value = concrete ? .73 + .20 * cloud + .055 * fine - .17 * pores : .9 + .075 * cloud + .02 * fine - .025 * trowel,
          roughness = concrete ? .82 + .13 * fine + .04 * pores : .89 + .1 * fine
        for (let k = 0; k < 3; k++) {
          colors[i + k] = Math.round(value * 255)
          rough[i + k] = Math.round(roughness * 255)
        }
        colors[i + 3] = rough[i + 3] = 255
        heights[y * n + x] = concrete ? .00017 * cloud + .00016 * fine - .0008 * pores : .0003 * trowel + .00009 * fine
        continue
      }
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
      for (let k = 0; k < 3; k++) {
        colors[i + k] = Math.round(value * 255)
        rough[i + k] = Math.round((oak ? 0.84 + 0.1 * grain : 0.9 + 0.06 * fine) * 255)
      }
      colors[i + 3] = rough[i + 3] = 255
      heights[y * n + x] = joint ? -0.0006 : oak ? grain * 0.00012 : fine * 0.00007
    }
  const normalScratch = new T.Vector3()
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const i = (y * n + x) * 4,
        dx =
          (heights[y * n + ((x + 1) % n)] - heights[y * n + ((x + n - 1) % n)]) /
          ((2 * scale[0]) / n),
        dy =
          (heights[((y + 1) % n) * n + x] - heights[((y + n - 1) % n) * n + x]) /
          ((2 * scale[1]) / n),
        normal = normalScratch.set(-dx, -dy, 1).normalize()
      normals[i] = Math.round((normal.x * 0.5 + 0.5) * 255)
      normals[i + 1] = Math.round((normal.y * 0.5 + 0.5) * 255)
      normals[i + 2] = Math.round((normal.z * 0.5 + 0.5) * 255)
      normals[i + 3] = 255
    }
  return { colors, rough, normals, scale, size: n }
}
function patternKey(def: MaterialDef) {
  return [def.surface, ...surfaceScale(def), absoluteColor(def.surface) ? def.color : ''].join(':')
}
const pixelCache = new Map<string, NonNullable<ReturnType<typeof generateProceduralPixels>>>()
export function proceduralPixels(def: MaterialDef) {
  if (!def.surface || def.surface === 'plain') return null
  const key = patternKey(def), cached = pixelCache.get(key)
  if (cached) {
    pixelCache.delete(key)
    pixelCache.set(key, cached)
    return cached
  }
  const pixels = generateProceduralPixels(def)!
  // Retain common swatches across live swaps while bounding the resident pixel data.
  if (pixelCache.size >= 12) pixelCache.delete(pixelCache.keys().next().value!)
  pixelCache.set(key, pixels)
  return pixels
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
    result = new Map<string, T.MeshPhysicalMaterial>(),
    swatches = new Map<string, NonNullable<ReturnType<typeof procedural>>>()
  for (const d of defs) {
    const material = new T.MeshPhysicalMaterial({
      color: absoluteColor(d.surface) ? '#ffffff' : d.color,
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
      material.userData.metersPerTile = surfaceScale(d)
    // References with product textures need independent fallback maps. Other
    // room-scoped copies can share maps within this one canonical scene.
    const reuse = !d.texture && !d.normalTexture
    const key = patternKey(d)
    const generated = (reuse ? swatches.get(key) : undefined) ?? procedural(d)
    if (generated) {
      if (reuse) swatches.set(key, generated)
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
    if (!(o instanceof T.Mesh)) return
    const materials = Array.isArray(o.material) ? o.material : [o.material]
    if (!materials.some(material => material.userData.metersPerTile)) return
    const geometry = o.geometry,
      positions = geometry.getAttribute('position'),
      normals = geometry.getAttribute('normal')
    if (!normals) return
    const uv = new Float32Array(positions.count * 2),
      point = new T.Vector3(),
      normal = new T.Vector3(),
      matrix = new T.Matrix3().getNormalMatrix(o.matrixWorld)
    const oldUV = geometry.getAttribute('uv')
    if (oldUV) for (let i = 0; i < positions.count; i++) {
      uv[i * 2] = oldUV.getX(i); uv[i * 2 + 1] = oldUV.getY(i)
    }
    const wall = o.userData.wallUV as { origin: number[]; length: number; thickness: number } | undefined
    function project(i: number, scale: number[]) {
      point.fromBufferAttribute(positions, i)
      normal.fromBufferAttribute(normals, i)
      let u: number, v: number
      if (wall) {
        point.add(new T.Vector3(...wall.origin as [number, number, number]))
        // Tangents match outward face normals, including both room-facing sides.
        if (Math.abs(normal.z) > .5) {
          u = normal.z > 0 ? point.x : wall.length - point.x; v = point.y
        } else if (Math.abs(normal.x) > .5) {
          u = wall.thickness / 2 + (normal.x > 0 ? -point.z : point.z); v = point.y
        } else {
          u = point.x; v = wall.thickness / 2 + (normal.y > 0 ? -point.z : point.z)
        }
      } else {
        point.applyMatrix4(o.matrixWorld)
        normal.applyMatrix3(matrix).normalize()
        const ax = Math.abs(normal.x), ay = Math.abs(normal.y), az = Math.abs(normal.z)
        u = ay >= ax && ay >= az ? point.x : ax > az ? point.z : point.x
        v = ay >= ax && ay >= az ? point.z : point.y
      }
      uv[i * 2] = u / scale[0]; uv[i * 2 + 1] = v / scale[1]
    }
    if (Array.isArray(o.material)) {
      for (const group of geometry.groups) {
        const scale = materials[group.materialIndex ?? 0]?.userData.metersPerTile as number[] | undefined
        if (!scale) continue
        for (let i = group.start; i < group.start + group.count; i++)
          project(geometry.index ? geometry.index.getX(i) : i, scale)
      }
    } else {
      const scale = materials[0].userData.metersPerTile as number[]
      for (let i = 0; i < positions.count; i++) project(i, scale)
    }
    geometry.setAttribute('uv', new T.BufferAttribute(uv, 2))
  })
}
