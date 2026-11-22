import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import * as T from 'three'
import { createEntity } from '../src/scene/components.ts'
import { lightingSpecs, updateEmitters } from '../src/scene/lighting.ts'
import { parseApartment, validateApartment, designStyles } from '../src/domain/schema.ts'
import type { Entity, Kind } from '../src/domain/schema.ts'

const apartment = parseApartment(JSON.parse(readFileSync(new URL('../src/data/apartment.json', import.meta.url), 'utf8')))
const materials = new Map(apartment.materials.map(m => [m.id, Object.assign(new T.MeshPhysicalMaterial({ color: m.color }), { name: m.id })]))
const styledKinds: Kind[] = ['KitchenCabinet','Wardrobe','Shelf','Sofa','Bed','Table','TrackLight','Pendant','Spotlight']

function checkGeometry(entity: Entity) {
  const group = createEntity(entity, apartment, materials), bounds = new T.Box3().setFromObject(group, true)
  const [w,h,d] = entity.size.map(v=>v/1000)
  for (const [axis, minimum, maximum] of [['x',-w/2,w/2],['y',0,h],['z',-d/2,d/2]] as const) {
    assert.ok(bounds.min[axis] >= minimum-1e-6, `${entity.id} ${axis}: ${bounds.min[axis]} < ${minimum}`)
    assert.ok(bounds.max[axis] <= maximum+1e-6, `${entity.id} ${axis}: ${bounds.max[axis]} > ${maximum}`)
  }
  const hash = createHash('sha256'), ids = new Set<string>()
  group.traverse(object => {
    if (!(object instanceof T.Mesh)) return
    assert.ok(!ids.has(object.userData.partId), 'stable parts must remain unique')
    ids.add(object.userData.partId)
    const positions=object.geometry.getAttribute('position')
    assert.ok(positions.count>0)
    for(let i=0;i<positions.count;i++) assert.ok(Number.isFinite(positions.getX(i)+positions.getY(i)+positions.getZ(i)))
    hash.update(Buffer.from(positions.array.buffer,positions.array.byteOffset,positions.array.byteLength))
    hash.update(JSON.stringify(object.matrixWorld.elements))
    object.geometry.dispose()
  })
  assert.ok(ids.size>0)
  return hash.digest('hex')
}

test('concept furnishings stay within original source envelopes, including ceiling cabinet scribes', () => {
  for (const source of apartment.objects.filter(e=>styledKinds.includes(e.kind))) {
    // Legacy media and sanitary fixtures are intentionally kept in their existing factories.
    if (source.params?.fixture && !['diningChair','officeChair','armchair','roundTable','bench','blindCorner','sinkBase'].includes(source.params.fixture)) continue
    for (const designStyle of designStyles) checkGeometry({ ...source, id:source.id+'-'+designStyle, position:[0,0,0],rotation:[0,0,0], params:{...source.params,designStyle} })
  }
})

test('concept furniture changes canonical shape, and wall treatments are actual bounded geometry', () => {
  for (const kind of ['Sofa','Table','Bed','Wardrobe','Pendant'] as const) {
    const size: [number,number,number] = kind==='Pendant' ? [380,650,300] : kind==='Wardrobe' ? [1000,2850,600] : kind==='Bed' ? [1600,950,2100] : kind==='Table' ? [1200,750,800] : [2200,850,900]
    const hashes = designStyles.map(designStyle=>checkGeometry({ id:'variant',name:kind,kind,roomId:'living',position:[0,0,0],rotation:[0,0,0],size,material:'oak',evidence:'assumed',params:{designStyle,...(kind==='Wardrobe'?{cabinetTopScribe:120,cabinetTopTier:450}:{})} }))
    assert.equal(new Set(hashes).size,4, `${kind}: changing styles must change meshes, not just color`)
  }
  const hashes = ['flat','slats','moulding'].map(treatment=>checkGeometry({ id:'panel',name:'Panel',kind:'WallPanel',roomId:'living',position:[0,0,0],rotation:[0,0,0],size:[1800,2100,24],material:'oak',evidence:'assumed',params:{treatment:treatment as 'flat'} }))
  assert.equal(new Set(hashes).size,3)
})

test('fixture lenses are exposed at their light origins, with one lens for each visible head', () => {
  const track = apartment.objects.find(e => e.kind === 'TrackLight' && e.roomId === 'living')!
  const pendant = apartment.objects.find(e => e.kind === 'Pendant' && e.roomId === 'living')!
  const spot = apartment.objects.find(e => e.kind === 'Spotlight')!
  const strip = apartment.objects.find(e => e.kind === 'LEDStrip')!
  const cases: Array<[Entity, number]> = [
    [track, 3],
    [{ ...track, rotation: [0, 45, 0], params: { ...track.params, designStyle: 'hitech' } }, 1],
    [pendant, 1],
    [{ ...pendant, params: { ...pendant.params, lightForm: 'cluster' } }, 3],
    [{ ...pendant, params: { ...pendant.params, designStyle: 'classic' } }, 5],
    [spot, 1],
    [strip, 1],
  ]
  for (const [entity, expected] of cases) {
    const fixture = createEntity(entity, apartment, materials)
    const sources = lightingSpecs({ ...apartment, objects: [entity] }, entity.roomId, 'clean')
    assert.equal(sources.length, expected, entity.id)
    assert.equal(fixture.children.filter(part => part.userData.fixtureDiffuser).length, expected, entity.id)
    for (const source of sources) {
      const origin = new T.Vector3().fromArray(source.position)
      // Skew slightly so the ray cannot hit a degenerate vertex at a globe's pole.
      const direction = origin.clone().sub(new T.Vector3().fromArray(source.target))
        .add({ x: .08, y: 0, z: .03 }).normalize()
      const first = new T.Raycaster(origin, direction).intersectObject(fixture, true)[0]
      assert.ok(first?.object.userData.fixtureDiffuser, `${entity.id} should emit from a visible lens`)
    }
  }
})

test('fixture body stays dark while light control activates each track lens', () => {
  const original = apartment.objects.find(e => e.kind === 'TrackLight' && e.roomId === 'living')!
  const entity = { ...original, params: { ...original.params, color: '#ffc38b' } }
  const model = { ...apartment, objects: [entity] }
  const fixture = createEntity(entity, model, materials)
  const root = new T.Group().add(fixture)
  const lenses = fixture.children.filter(part => part.userData.fixtureDiffuser) as T.Mesh<T.BufferGeometry, T.MeshPhysicalMaterial>[]
  assert.equal(lenses.length, 3)
  updateEmitters(root, model, [])
  assert.ok(lenses.every(lens => lens.material.emissiveIntensity === 0))
  updateEmitters(root, model, lightingSpecs(model, entity.roomId, 'clean'))
  assert.ok(lenses.every(lens => lens.material.emissiveIntensity > 0 && lens.material.emissive.getHexString() === 'ffc38b'))
  const body = fixture.children.find(part => !part.userData.fixtureDiffuser) as T.Mesh<T.BufferGeometry, T.MeshPhysicalMaterial>
  assert.equal(body.material.emissive.getHex(), 0)
})

test('schema rejects unknown style, wall treatment and surface tokens', () => {
  for (const designStyle of designStyles) {
    const a=structuredClone(apartment);a.objects[0].params={designStyle}
    assert.deepEqual(validateApartment(a),[])
  }
  const a=structuredClone(apartment)
  a.objects[0].params={designStyle:'fantasy' as any};assert.ok(validateApartment(a).some(e=>e.includes('design style')))
  a.objects[0].params={treatment:'slats'};assert.ok(validateApartment(a).some(e=>e.includes('panel treatment')))
  a.objects[0].params={};a.materials[0].surface='marble' as any;assert.ok(validateApartment(a).some(e=>e.includes('material surface')))
})
