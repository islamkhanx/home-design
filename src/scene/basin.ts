import * as T from 'three'

/** Closed underside and a separate recessed floor; never cap the upper opening. */
function ceramicShell(profiles: Array<[number, number, number, number]>) {
  const positions: number[] = [],
    indices: number[] = []
  const ring = (w: number, d: number, y: number, radius: number) => {
    const r = Math.min(radius, w / 2, d / 2)
    for (let corner = 0; corner < 4; corner++) {
      const angle = (corner * Math.PI) / 2
      const cx = corner === 0 || corner === 3 ? w / 2 - r : -w / 2 + r
      const cz = corner < 2 ? d / 2 - r : -d / 2 + r
      for (let i = 0; i <= 12; i++) {
        const a = angle + ((i / 12) * Math.PI) / 2
        positions.push(cx + Math.cos(a) * r, y, cz + Math.sin(a) * r)
      }
    }
  }
  for (const profile of profiles) ring(...profile)
  const count = 52
  for (let j = 0; j < profiles.length - 1; j++)
    for (let i = 0; i < count; i++) {
      const a = j * count + i,
        b = j * count + ((i + 1) % count)
      indices.push(a, a + count, b, b, a + count, b + count)
    }
  // Close the underside and basin bottom separately; the upper opening stays genuinely hollow.
  for (const j of [0, profiles.length - 1]) {
    const center = positions.length / 3
    positions.push(0, positions[j * count * 3 + 1], 0)
    for (let i = 0; i < count; i++) {
      const a = j * count + i,
        b = j * count + ((i + 1) % count)
      indices.push(...(j === 0 ? [center, a, b] : [center, b, a]))
    }
  }
  const geometry = new T.BufferGeometry()
  geometry.setAttribute('position', new T.Float32BufferAttribute(positions, 3))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  return geometry
}

/** Continuous ceramic shell, including the real recess. All points stay inside the envelope. */
export function basinGeometry(width: number, height: number, depth: number, rim: number) {
  const radius = Math.min(width, depth) * 0.16
  return ceramicShell([
    [width * 0.97, depth * 0.97, 0, radius],
    [width, depth, height * 0.12, radius],
    [width, depth, height - 0.008, radius],
    [width - 0.008, depth - 0.008, height, radius],
    [width - rim * 2, depth - rim * 2, height, radius],
    [width - rim * 2 - 0.012, depth - rim * 2 - 0.012, height - 0.012, radius],
    [width - rim * 3, depth - rim * 3, Math.min(height * 0.2, 0.08), radius],
  ])
}

/** Drop-in flange sits above the worktop; the narrower bowl passes through its cutout. */
export function dropInSinkGeometry(width: number, height: number, depth: number) {
  const flangeHeight = Math.min(0.008, height * 0.1),
    flangeOverhang = Math.min(0.02, width * 0.06, depth * 0.06),
    bodyWidth = width - flangeOverhang * 2,
    bodyDepth = depth - flangeOverhang * 2,
    wall = Math.min(0.012, height * 0.1),
    shoulder = height - flangeHeight,
    radius = Math.min(bodyWidth, bodyDepth) * 0.12
  return ceramicShell([
    [bodyWidth * 0.94, bodyDepth * 0.94, 0, radius],
    [bodyWidth, bodyDepth, height * 0.2, radius],
    [bodyWidth, bodyDepth, shoulder, radius],
    [width, depth, shoulder, radius],
    [width, depth, height, radius],
    [bodyWidth - wall, bodyDepth - wall, height, radius],
    [bodyWidth - wall * 2, bodyDepth - wall * 2, shoulder - wall / 2, radius],
    [bodyWidth * 0.86, bodyDepth * 0.86, wall, radius],
  ])
}
