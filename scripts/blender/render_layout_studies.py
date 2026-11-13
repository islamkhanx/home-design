"""Render the exported study geometry unchanged; only cameras, lighting and visibility vary."""
import bpy, json, math, importlib.util, os
from pathlib import Path
from mathutils import Vector
ROOT=Path(__file__).resolve().parents[2]/'design'/'bathroom-v01'
prefix=os.environ.get('STUDY_PREFIX','layout-studies')
output_prefix=os.environ.get('STUDY_OUTPUT','volume')
views=os.environ.get('STUDY_VIEWS','bath,entry').split(',')
spec=importlib.util.spec_from_file_location('shared_renderer',Path(__file__).with_name('render.py'))
shared=importlib.util.module_from_spec(spec);spec.loader.exec_module(shared)
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=str(ROOT/f'{prefix}.glb'))
meta=json.loads((ROOT/f'{prefix}-metadata.json').read_text())
validation=shared.verify_geometry(meta)
(ROOT/f'{prefix}-validation.json').write_text(json.dumps(validation,indent=2))
print('GEOMETRY VERIFIED',validation,flush=True)
scene=bpy.context.scene;scene.render.engine='CYCLES';scene.cycles.samples=24
scene.cycles.use_denoising=True;scene.cycles.use_adaptive_sampling=True;scene.cycles.adaptive_threshold=.08
scene.cycles.max_bounces=6;scene.cycles.transmission_bounces=4
scene.render.resolution_x=900;scene.render.resolution_y=900;scene.render.resolution_percentage=100
scene.render.image_settings.file_format='PNG';scene.render.image_settings.color_mode='RGB'
scene.view_settings.view_transform='AgX';scene.view_settings.exposure=-.15
world=bpy.data.worlds.new('Neutral studio');world.use_nodes=True;world.node_tree.nodes['Background'].inputs['Color'].default_value=(.82,.85,.87,1);world.node_tree.nodes['Background'].inputs['Strength'].default_value=.55;scene.world=world
def light(name,position,energy,size,target):
 data=bpy.data.lights.new(name,'AREA');data.energy=energy;data.shape='DISK';data.size=size
 o=bpy.data.objects.new(name,data);scene.collection.objects.link(o);o.location=shared.vec(position)
 o.rotation_euler=(shared.vec(target)-o.location).to_track_quat('-Z','Y').to_euler()
light('Ceiling softbox',(1,5,1.2),650,4,(.9,0,1.2))
light('Front fill',(4,3,-2),380,3,(.8,1,1.2))
light('Rear fill',(2,3,5),300,3,(.8,1,1.2))
# Refine surface response without moving or replacing any architectural geometry.
for m in bpy.data.materials:
 if not m.use_nodes:continue
 nodes=m.node_tree.nodes;bs=next((n for n in nodes if n.type=='BSDF_PRINCIPLED'),None)
 if not bs:continue
 if m.name.startswith(('warm limestone','accent stone','oak furniture')):
  tex=nodes.new('ShaderNodeTexNoise');tex.inputs['Scale'].default_value=85 if 'oak' not in m.name else 6
  tex.inputs['Detail'].default_value=2
  coord=nodes.new('ShaderNodeTexCoord');mapping=nodes.new('ShaderNodeVectorMath');mapping.operation='MULTIPLY';mapping.inputs[1].default_value=(1,1,20) if 'oak' in m.name else (1,1,1)
  m.node_tree.links.new(coord.outputs['Generated'],mapping.inputs[0]);m.node_tree.links.new(mapping.outputs[0],tex.inputs['Vector'])
  bump=nodes.new('ShaderNodeBump');bump.inputs['Strength'].default_value=.12;bump.inputs['Distance'].default_value=.0005
  m.node_tree.links.new(tex.outputs['Fac'],bump.inputs['Height']);m.node_tree.links.new(bump.outputs['Normal'],bs.inputs['Normal'])
camera=bpy.data.objects.new('Study camera',bpy.data.cameras.new('Study camera'));scene.collection.objects.link(camera);scene.camera=camera
camera.data.type='ORTHO';camera.data.ortho_scale=4.65;camera.data.lens=45
device=shared.configure_device('auto');print('DEVICE',device,flush=True)
for variant in meta.get('variants',['A','B','C']):
 for view,pos,hidden in [('bath',(5.3,5.8,-5.4),'north'),('entry',(5.8,5.8,6.1),'south')]:
  if view not in views:continue
  for obj in scene.objects:
   if obj.type=='MESH':
    upper=any(tag in obj.name for tag in ['upper-cabinet','wide-mirror','mirror-joint','cabinet-joint']) or (variant=='B' and 'mirror-light' in obj.name)
    obj.hide_render=obj.get('entityId')!=variant or obj.get('wall')==hidden or (view=='entry' and upper)
  camera.location=shared.vec(pos);camera.rotation_euler=(shared.vec((.85,1.18,1.22))-camera.location).to_track_quat('-Z','Y').to_euler()
  scene.render.filepath=str(ROOT/f'{output_prefix}-{variant}-{view}.png')
  print('RENDER START',variant,view,flush=True)
  try:bpy.ops.render.render(write_still=True)
  except RuntimeError:
   scene.cycles.device='CPU';bpy.ops.render.render(write_still=True)
  print('RENDER DONE',variant,view,flush=True)
(ROOT/f'{output_prefix}-render-report.json').write_text(json.dumps({'engine':'Cycles','samples':24,'resolution':[900,900],'device':scene.cycles.device,'geometry_validation':validation,'geometry_source':f'{prefix}.glb','notes':'Studio illumination; not a calculated installed lighting design. Cutaway walls vary by view; upper cabinets hidden in entry view to expose circulation. Geometry unchanged.'},indent=2))
