import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { parseRenderProgress } from '../scripts/blender-runtime.mjs'
import { lightingSpecs } from '../src/scene/lighting.ts'
import type { Apartment } from '../src/domain/schema.ts'

test('render progress follows real stages, Cycles sample counts and device fallback', () => {
  assert.deepEqual(parseRenderProgress('RENDER_PROGRESS {"phase":"importing","progress":0.02}'), { phase: 'importing', progress: .02 })
  const sample = parseRenderProgress('Fra:1 Mem:42M | Time:00:03 | Sample 12/32')!
  assert.equal(sample.samplesCompleted, 12)
  assert.equal(sample.samplesTotal, 32)
  assert.ok(sample.progress > .12 && sample.progress < .95)
  assert.equal(parseRenderProgress('CYCLES_DEVICE CPU (GPU render failed; automatic fallback)')?.device, 'CPU (GPU render failed; automatic fallback)')
  assert.equal(parseRenderProgress('Denoising')?.phase, 'denoising')
  assert.equal(parseRenderProgress('RENDER_COMPLETE /tmp/render.png')?.progress, 1)
  assert.equal(parseRenderProgress('Blender startup'), null)
  assert.equal(parseRenderProgress('Sample 1/0'), null)
})

test('photo daylight follows external window dimensions, points indoors, and preserves source', () => {
  const result = execFileSync('python3', ['-c', `
import copy,math,runpy,sys,types
sys.modules['bpy']=types.ModuleType('bpy')
utils=types.ModuleType('mathutils');utils.Vector=object;utils.Matrix=object
sys.modules['mathutils']=utils
m=runpy.run_path(sys.argv[1])
source={'rooms':[{'id':'room','polygon':[[0,0],[4000,0],[4000,4000],[0,4000]]}], 'objects':[
 {'id':'external','kind':'Wall','roomId':'room','wall':{'start':[0,0],'end':[4000,0],'thickness':200,'openings':[{'id':'window','kind':'window','offset':1000,'width':2000,'bottom':600,'height':1800}]}},
 {'id':'internal','kind':'Wall','roomId':'room','sharedWith':['other'],'wall':{'start':[0,0],'end':[4000,0],'openings':[{'id':'inside-window','kind':'window','offset':1000,'width':2000,'bottom':600,'height':1800}]}}
]}
before=copy.deepcopy(source);windows=m['photo_window_lights'](source)
assert source==before
assert len(windows)==1
w=windows[0]
assert w['width']==2 and w['height']==1.8
assert w['position']==[2,1.5,.125]
assert w['target'][2]>w['position'][2]
assert math.isclose(w['power'],2*1.8*m['PHOTO_WINDOW_WATTS_PER_SQUARE_METER'])
source['objects'][0]['wall']['start']=[4000,0];source['objects'][0]['wall']['end']=[0,0]
assert m['photo_window_lights'](source)[0]['target'][2]>0
source['objects'][0]['visible']=False
assert m['photo_window_lights'](source)==[]
fixtures={'lightingPreset':'day','sourceApartment':{'objects':[
 {'id':'window','kind':'Window','roomId':'living'},
 {'id':'living-light','kind':'Spotlight','roomId':'living'},
 {'id':'bath-light','kind':'Spotlight','roomId':'bathroom'}]},
 'photorealLights':[{'id':'living-light'},{'id':'bath-light'}], 'lights':[]}
assert m['photo_fixture_specs'](fixtures)==[{'id':'bath-light'}]
fixtures['lightingSchedule']={'fixtures':[], 'windows':[]}
assert m['photo_fixture_specs'](fixtures)==[]
assert m['active_window_lights'](fixtures,True)==[]
fixtures['lightingSchedule']={'fixtures':[{'id':'living-light'}], 'windows':[{'id':'window','power':4800}]}
assert m['photo_fixture_specs'](fixtures)==[{'id':'living-light'}]
assert m['active_window_lights'](fixtures,True)==[{'id':'window','power':80}]
del fixtures['lightingSchedule']
fixtures['conceptLighting']={'roomId':'living','style':'loft'}
fixtures['photorealLights']=[{'id':'living-light:lamp-1','entityId':'living-light'},{'id':'bath-light'}]
assert m['photo_fixture_specs'](fixtures)==fixtures['photorealLights']
del fixtures['conceptLighting']
assert m['photo_fixture_specs'](fixtures)==[{'id':'bath-light'}]
fixtures['lightingPreset']='clean';fixtures['lights']=[{'id':'living-light'}]
assert m['photo_fixture_specs'](fixtures)==fixtures['lights']
fixtures['sourceApartment']['rooms']=[{'id':'living','polygon':[[0,0],[2000,0],[2000,2000],[0,2000]]},{'id':'bathroom','polygon':[[2000,0],[4000,0],[4000,2000],[2000,2000]]}]
fixtures['roomId']='living' # Walking camera may have crossed into another room.
fixtures['camera']={'position':[3,1.6,1]}
assert m['photographic_day_exposure'](fixtures)=={'cameraRoom':'bathroom','exposureStops':.3}
fixtures['camera']['position']=[1,1.6,1]
assert m['photographic_day_exposure'](fixtures)=={'cameraRoom':'living','exposureStops':-.7}
print('PASS')
`, fileURLToPath(new URL('../scripts/blender/render.py', import.meta.url))], { encoding: 'utf8', timeout: 10000 })
  assert.match(result, /PASS/)
})

test('concept lighting distributes declared track flux and differentiates pendant types', () => {
  const a = { objects: [{ id: 'track', kind: 'TrackLight', roomId: 'living', position: [1000, 2700, 1000],
    rotation: [0, 90, 0], size: [1000, 120, 80], params: { lumens: 1500, designStyle: 'loft' } }] } as Apartment
  const specs = lightingSpecs(a, 'all', 'clean')
  assert.equal(specs.length, 3)
  assert.equal(specs.reduce((sum, light) => sum + light.power, 0), 1500)
  assert.equal(new Set(specs.map(light => light.id)).size, 3)
  assert.ok(specs.every(light => light.entityId === 'track' && light.type === 'spot'))
  assert.ok(specs.every(light => Math.abs(light.position[0] - 1) < 1e-9))
  assert.equal(new Set(specs.map(light => light.position[2])).size, 3)
  a.objects[0].params!.designStyle = 'hitech'
  const linear = lightingSpecs(a, 'all', 'clean')
  assert.equal(linear.length, 1)
  assert.equal(linear[0].type, 'area')
  assert.equal(linear[0].power, 1500)
  assert.ok(Math.abs(linear[0].position[1] - (2.7 + .12 * .57 - .002)) < 1e-9)
  a.objects[0].kind = 'Pendant'
  a.objects[0].params!.designStyle = 'classic'
  assert.equal(lightingSpecs(a, 'all', 'clean')[0].type, 'point')
  a.objects[0].params!.designStyle = 'hitech'
  assert.equal(lightingSpecs(a, 'all', 'clean')[0].type, 'area')
  assert.deepEqual(lightingSpecs(a, 'all', 'day'), [])
})
