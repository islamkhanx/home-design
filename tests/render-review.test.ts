import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

test('photographic review lights scale with polygon area and stay inside concave rooms below their ceilings', () => {
  // Exercise the actual pure Python lighting calculations without needing Cycles
  // or a graphics device in the unit-test environment.
  const result = execFileSync('python3', ['-c', `
import math,runpy,sys,types
sys.modules['bpy']=types.ModuleType('bpy')
utils=types.ModuleType('mathutils');utils.Vector=object;utils.Matrix=object
sys.modules['mathutils']=utils
m=runpy.run_path(sys.argv[1])
small={'id':'small','height':2800,'polygon':[[0,0],[2000,0],[2000,2000],[0,2000]]}
large={'id':'large','height':2800,'polygon':[[0,0],[4000,0],[4000,4000],[0,4000]]}
source={'objects':[{'kind':'Ceiling','roomId':'small','position':[0,2300,0]}]}
rig=m['indoor_review_rig']([small,large],source)
assert math.isclose(rig[0][2],20)
assert math.isclose(rig[1][2],80)
assert math.isclose(rig[0][0][1],2.1)
u={'polygon':[[0,0],[4000,0],[4000,4000],[3000,4000],[3000,1000],[1000,1000],[1000,4000],[0,4000]]}
area,center,size=m['room_review_geometry'](u)
poly=[(x/1000,z/1000) for x,z in u['polygon']]
assert math.isclose(area,10)
assert not m['polygon_contains']((2,1.7),poly), 'fixture must exercise exterior centroid fallback'
assert m['polygon_contains'](center,poly)
for i in range(32):
 p=(center[0]+size/2*math.cos(i*math.pi/16),center[1]+size/2*math.sin(i*math.pi/16))
 assert m['polygon_contains'](p,poly), 'softbox must not cross walls'
reverse=m['room_review_geometry']({'polygon':list(reversed(small['polygon']))})
assert math.isclose(reverse[0],4) and reverse[1]==(1,1)
assert m['room_review_geometry']({'polygon':[]}) is None
print('PASS')
`, fileURLToPath(new URL('../scripts/blender/render.py', import.meta.url))], { encoding: 'utf8', timeout: 10000 })
  assert.match(result, /PASS/)
})
