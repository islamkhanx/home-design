import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { parseApartment } from '../src/domain/schema.ts'
import { applyDesignStudy } from '../src/domain/design-variants.ts'
import { listLightingSources, makeInteriorLighting, resolveLighting } from '../src/scene/lighting.ts'

const load = async () => parseApartment(JSON.parse(await readFile(new URL('../src/data/apartment.json', import.meta.url), 'utf8')))

test('lighting controls distinguish exterior daylight from glazing between rooms', async () => {
  const apartment = await load()
  const on = { windows: true, sources: {} }
  const apertures = resolveLighting(apartment, 'all', 'day', on).windows
  assert.deepEqual(apertures.map(spec => spec.id).sort(), ['window-courtyard', 'window-living'])
  const living = apertures.find(spec => spec.id === 'window-living')!
  assert.equal(living.type, 'area')
  assert.equal(living.width, 2.4)
  assert.equal(living.height, 2.2)
  assert.ok(living.target[2] < living.position[2], 'area normal must face into the apartment')
  assert.deepEqual(resolveLighting(apartment, 'bedroom', 'day', on).windows, [])

  const filtered = resolveLighting(apartment, 'all', 'evening', { ...on, sources: { 'window-living': false } })
  assert.deepEqual(filtered.windows.map(spec => spec.id), ['window-courtyard'])
  const disabled = { windows: false, sources: { 'window-living': true } }
  assert.deepEqual(resolveLighting(apartment, 'all', 'day', disabled).windows, [])
  const row = listLightingSources(apartment, 'living', 'day', disabled).find(source => source.id === 'window-living')!
  assert.equal(row.on, false)
  assert.equal(row.override, true)
})

test('window aperture follows an angled host wall and its elevation', async () => {
  const apartment = await load()
  const window = apartment.objects.find(entity => entity.id === 'window-living')!
  const wall = apartment.objects.find(entity => entity.id === window.attach!.wallId)!
  wall.position = [1000, 200, 5000]
  wall.rotation = [0, 90, 0]
  wall.wall = {
    start: [0, 0], end: [4000, 0], thickness: 200, height: 3000,
    openings: [{ id: window.attach!.openingId, kind: 'window', offset: 700, width: 1000, height: 1000, bottom: 400 }],
  }
  const room = apartment.rooms.find(candidate => candidate.id === window.roomId)!
  room.polygon = [[1100, 1000], [4100, 1000], [4100, 5000], [1100, 5000]]
  const [aperture] = resolveLighting(apartment, room.id, 'day', { windows: true, sources: {} }).windows
  assert.ok(aperture)
  const rounded = (coords: number[]) => coords.map(n => Number(n.toFixed(3)))
  assert.deepEqual(rounded(aperture.position), [1.135, 1.1, 3.8])
  assert.deepEqual(rounded(aperture.target), [2.135, 1.1, 3.8])
})

test('fixture overrides control every lamp in a track and leave no hidden lights when everything is off', async () => {
  const apartment = applyDesignStudy(await load(), 'atelier-walnut')
  const track = apartment.objects.find(entity => entity.roomId === 'living' && entity.kind === 'TrackLight')!
  const on = { windows: false, sources: { [track.id]: true } }
  const lamps = resolveLighting(apartment, 'living', 'evening', on).fixtures.filter(spec => spec.entityId === track.id)
  assert.equal(lamps.length, 3)
  assert.equal(lamps.reduce((sum, light) => sum + light.power, 0), track.params!.lumens)
  const rows = listLightingSources(apartment, 'all', 'clean', on)
  assert.equal(rows.filter(source => source.id === track.id).length, 1)
  const sources = Object.fromEntries(rows.map(source => [source.id, false]))
  const off = resolveLighting(apartment, 'all', 'clean', { windows: false, sources })
  assert.deepEqual(off, { fixtures: [], windows: [] })
  assert.equal(makeInteriorLighting(off, apartment, 'living').children.length, 0)
  sources[track.id] = true
  const onlyTrack = resolveLighting(apartment, 'all', 'clean', { windows: false, sources })
  const preview = makeInteriorLighting(onlyTrack, apartment, 'living')
  assert.deepEqual(preview.children.filter(child => child.name.startsWith('reflected-light:')).map(child => child.name),
    ['reflected-light:living'])
  const day = resolveLighting(apartment, 'bathroom', 'day', { windows: true, sources: {} })
  assert.equal(day.fixtures.length, 4, 'windowless bathroom uses its declared fixtures')
})
