"""Use canonical GLB geometry and metadata emitters; fixed camera and exposure across scenes."""
import bpy,json,importlib.util
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]/'design'/'bathroom-v01'
sp=importlib.util.spec_from_file_location('shared',Path(__file__).with_name('render.py'));shared=importlib.util.module_from_spec(sp);sp.loader.exec_module(shared)
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=str(ROOT/'a3-tiles.glb'))
meta=json.loads((ROOT/'a3-tiles-metadata.json').read_text());validation=shared.verify_geometry(meta)
(ROOT/'a3-tiles-validation.json').write_text(json.dumps(validation,indent=2))
scene=bpy.context.scene;scene.render.engine='CYCLES';scene.cycles.samples=64;scene.cycles.use_denoising=True
scene.cycles.use_adaptive_sampling=True;scene.cycles.adaptive_threshold=.025;scene.cycles.max_bounces=10
scene.render.resolution_x=900;scene.render.resolution_y=900;scene.render.resolution_percentage=100
scene.render.image_settings.file_format='PNG';scene.render.image_settings.color_mode='RGB'
scene.view_settings.view_transform='AgX';scene.view_settings.exposure=1.3
world=bpy.data.worlds.new('Constant dim surroundings');world.use_nodes=True;scene.world=world
world.node_tree.nodes['Background'].inputs['Color'].default_value=(.35,.4,.5,1);world.node_tree.nodes['Background'].inputs['Strength'].default_value=.004
for o in scene.objects:
 if o.type=='MESH' and o.get('wall') in ['north','east','ceiling']:
  o.visible_camera=False # Enclosure remains present for indirect lighting and shadows.
camera=bpy.data.objects.new('Fixed camera',bpy.data.cameras.new('Fixed camera'));scene.collection.objects.link(camera);scene.camera=camera
camera.data.type='ORTHO';camera.data.ortho_scale=4.65
camera.location=shared.vec((5.3,5.8,-5.4));camera.rotation_euler=(shared.vec((.85,1.18,1.22))-camera.location).to_track_quat('-Z','Y').to_euler()
lamps=[]
for l in meta['lighting']['lights']:
 data=bpy.data.lights.new(l['id'],'AREA');data.shape='RECTANGLE';data.size=l['width_m'];data.size_y=l['height_m'];data.color=l['color']
 o=bpy.data.objects.new(l['id'],data);scene.collection.objects.link(o);o.location=shared.vec([n/1000 for n in l['position_mm']]);target=shared.vec([n/1000 for n in l['target_mm']]);o.rotation_euler=(target-o.location).to_track_quat('-Z','Y').to_euler()
 lamps.append((data,l))
emission=[]
for o in scene.objects:
 if o.type!='MESH':continue
 group='G3' if 'night-light' in o.name else 'G2' if 'mirror-light' in o.name else 'G1' if 'main-light-' in o.name and 'housing' not in o.name else None
 if not group:continue
 for slot in o.material_slots:
  slot.material=slot.material.copy();bs=next(n for n in slot.material.node_tree.nodes if n.type=='BSDF_PRINCIPLED')
  bs.inputs['Emission Color'].default_value=(1,.78,.53,1) if group!='G3' else (1,.65,.32,1)
  emission.append((bs,group))
device=shared.configure_device('auto');print('DEVICE',device,flush=True)
for variant in meta['variants']:
 for obj in scene.objects:
  if obj.type=='MESH':obj.hide_render=obj.get('entityId')!=variant
 for scenario in meta['lighting']['scenarios']:
  levels=scenario['levels']
  for data,l in lamps:data.energy=l['render_watts']*levels[l['group']]
  for bs,group in emission:bs.inputs['Emission Strength'].default_value=4*levels[group]
  scene.render.filepath=str(ROOT/f"a3-tile-{variant}-{scenario['id']}.png")
  print('START',scenario['id'],flush=True)
  bpy.ops.render.render(write_still=True)
  print('DONE',scenario['id'],flush=True)
(ROOT/'a3-tiles-render-report.json').write_text(json.dumps({'geometry_validation':validation,'engine':'Cycles','device':device,'samples':64,'exposure':1.3,'camera':'identical across scenarios','source':'a3-tiles.glb','lighting_source':'a3-tiles-metadata.json','note':'Illustrative lighting only: no IES profiles, lux verification, CRI or calibrated lumen model. Render watts are not electrical load.'},indent=2))
