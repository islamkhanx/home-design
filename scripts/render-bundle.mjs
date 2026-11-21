/** Pure export-bundle validation shared by CLI and HTTP; no server imports. */
export function validateBundle(glb, metadata) {
  if (
    !Buffer.isBuffer(glb) ||
    glb.length < 20 ||
    glb.readUInt32LE(0) !== 0x46546c67 ||
    glb.readUInt32LE(4) !== 2 ||
    glb.readUInt32LE(8) !== glb.length
  )
    throw new Error('Invalid GLB header or length.')
  const jsonLength = glb.readUInt32LE(12)
  if (glb.readUInt32LE(16) !== 0x4e4f534a || jsonLength > glb.length - 20)
    throw new Error('Missing GLB JSON.')
  const data = JSON.parse(glb.subarray(20, 20 + jsonLength).toString())
  for (const asset of [...(data.images ?? []), ...(data.buffers ?? [])])
    if (asset.uri && !asset.uri.startsWith('data:'))
      throw new Error('GLB must embed textures and buffers.')
  if (
    metadata?.schemaVersion !== 1 ||
    metadata.units !== 'm' ||
    !Array.isArray(metadata.geometry) ||
    metadata.geometry.length > 100000 ||
    !Array.isArray(metadata.visibleEntityIds) ||
    !metadata.camera
  )
    throw new Error('Invalid scene metadata.')
  const finiteVector = (v) =>
    Array.isArray(v) &&
    v.length === 3 &&
    v.every((x) => typeof x === 'number' && Number.isFinite(x) && Math.abs(x) < 1e5)
  for (const p of metadata.geometry)
    if (typeof p.id !== 'string' || !finiteVector(p.min) || !finiteVector(p.max))
      throw new Error('Invalid geometry manifest.')
  for (const key of ['position', 'target', 'up'])
    if (!finiteVector(metadata.camera[key])) throw new Error('Invalid camera.')
  return true
}
