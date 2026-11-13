"""Import the exact exported GLB. Never build or reposition architectural geometry here."""
import argparse,json,math,sys
from pathlib import Path
import bpy
from mathutils import Vector,Matrix
PRESETS={'preview':(960,540,32,.08),'quality':(1920,1080,256,.02),'ultra':(3840,2160,1024,.008)}
def vec(v):
    # glTF/Three Y-up -> Blender Z-up: +90 degrees about X.
    return Vector((v[0],-v[2],v[1]))
def configure_device(mode):
    scene=bpy.context.scene
    if mode=='cpu':scene.cycles.device='CPU';return 'CPU'
    prefs=bpy.context.preferences.addons['cycles'].preferences
    backends=['METAL','OPTIX','CUDA','HIP','ONEAPI'] if sys.platform=='darwin' else ['OPTIX','CUDA','HIP','ONEAPI','METAL']
    for backend in backends:
        try:
            prefs.compute_device_type=backend;prefs.get_devices()
            devices=[d for d in prefs.devices if d.type==backend]
            if devices:
                for d in prefs.devices:d.use=d in devices
                scene.cycles.device='GPU';return backend
        except (TypeError,RuntimeError):pass
    if mode=='gpu':raise RuntimeError('GPU requested, but no supported Cycles GPU was found.')
    scene.cycles.device='CPU';return 'CPU'
def verify_geometry(meta):
    expected={p['id']:p for p in meta['geometry']}
    found={};max_error=0.0
    bpy.context.view_layer.update()
    for obj in bpy.context.scene.objects:
        if obj.type!='MESH':continue
        key=obj.get('partId')
        if not key:raise RuntimeError('Imported mesh has no canonical partId: '+obj.name)
        if key in found:raise RuntimeError('Duplicate imported partId: '+key)
        points=[obj.matrix_world@v.co for v in obj.data.vertices]
        if not points:raise RuntimeError('Empty imported mesh: '+key)
        lo=Vector(tuple(min(p[i] for p in points) for i in range(3)));hi=Vector(tuple(max(p[i] for p in points) for i in range(3)))
        src=expected.get(key)
        if not src:raise RuntimeError('Unexpected mesh: '+key)
        obj.data.calc_loop_triangles()
        if len(obj.data.loop_triangles)!=src['triangles']:raise RuntimeError('Triangle count mismatch: '+key)
        # Signed axis permutation requires swapping min/max for the negative Z -> Y axis.
        elo=Vector((src['min'][0],-src['max'][2],src['min'][1]))
        ehi=Vector((src['max'][0],-src['min'][2],src['max'][1]))
        err=max(max(abs(lo[i]-elo[i]) for i in range(3)),max(abs(hi[i]-ehi[i]) for i in range(3)))
        max_error=max(max_error,err)
        if err>.0001:raise RuntimeError(f'Geometry mismatch {key}: {err*1000:.4f} mm')
        found[key]=True
    if set(found)!=set(expected):raise RuntimeError('Missing imported mesh IDs: '+str(set(expected)-set(found)))
    return {'passed':True,'meshParts':len(found),'maxBoundsErrorMeters':max_error,'toleranceMeters':.0001}
def camera_from_metadata(spec,width,height):
    data=bpy.data.cameras.new('Canonical camera');obj=bpy.data.objects.new('Canonical camera',data);bpy.context.collection.objects.link(obj)
    obj.location=vec(spec['position']);direction=(vec(spec['target'])-obj.location).normalized();up=vec(spec['up']).normalized()
    right=direction.cross(up).normalized();up=right.cross(direction).normalized()
    obj.rotation_euler=Matrix((right,up,-direction)).transposed().to_euler()
    data.clip_start=spec.get('near',.02);data.clip_end=spec.get('far',200)
    data.sensor_fit='VERTICAL'
    if spec['type']=='orthographic':
        data.type='ORTHO';data.ortho_scale=spec['verticalSpan']
    else:
        data.type='PERSP';data.sensor_height=24
        data.lens=data.sensor_height/(2*math.tan(math.radians(spec['fov'])/2))
    bpy.context.scene.camera=obj
def linear(hexcolor):
    c=[int(hexcolor.lstrip('#')[i:i+2],16)/255 for i in (0,2,4)]
    return tuple(v/12.92 if v<=.04045 else ((v+.055)/1.055)**2.4 for v in c)
def configure_lighting(meta):
    scene=bpy.context.scene
    for obj in list(scene.objects):
        if obj.type=='LIGHT':bpy.data.objects.remove(obj,do_unlink=True)
    world=bpy.data.worlds.new('Architectural studio');scene.world=world;world.use_nodes=True
    nodes=world.node_tree.nodes;links=world.node_tree.links
    nodes.clear()
    output=nodes.new('ShaderNodeOutputWorld');mix=nodes.new('ShaderNodeMixShader')
    path=nodes.new('ShaderNodeLightPath')
    environment=nodes.new('ShaderNodeBackground');background=nodes.new('ShaderNodeBackground')
    environment.inputs['Color'].default_value=(.78,.83,.9,1)
    environment.inputs['Strength'].default_value={'evening':.035,'day':.3,'clean':.12}.get(meta['lightingPreset'],.3)
    background.inputs['Color'].default_value=(*linear('#e7e5de'),1)
    background.inputs['Strength'].default_value=.8
    links.new(path.outputs['Is Camera Ray'],mix.inputs[0]);links.new(environment.outputs[0],mix.inputs[1]);links.new(background.outputs[0],mix.inputs[2]);links.new(mix.outputs[0],output.inputs[0])
    # Review softboxes are photographic lights, never added as architectural geometry.
    if meta['lightingPreset']=='day':
        parts=[p for p in meta['geometry'] if p['entityId'] in meta['visibleEntityIds']]
        lo=[min(p['min'][i] for p in parts) for i in range(3)]
        hi=[max(p['max'][i] for p in parts) for i in range(3)]
        center=[(a+b)/2 for a,b in zip(lo,hi)];span=max(hi[0]-lo[0],hi[2]-lo[2],1)
        if meta['camera']['type']=='perspective':
            rig=[([hi[0]-.2,hi[1]-.2,center[2]], [lo[0],1,center[2]],100,1.2),
                 ([center[0],hi[1]-.25,lo[2]+.5],[center[0],0,center[2]],70,.8)]
        else:
            rig=[([center[0]+span,hi[1]+span,center[2]+span],center,450,span*1.2),
                 ([center[0]-span,hi[1],center[2]-span],center,180,span),
                 ([center[0],hi[1]+.5,center[2]],center,80,span*.8)]
        for i,(position,target,power,size) in enumerate(rig):
            data=bpy.data.lights.new('Review softbox '+str(i),'AREA');data.energy=power;data.shape='DISK';data.size=size
            obj=bpy.data.objects.new(data.name,data);bpy.context.collection.objects.link(obj);obj.location=vec(position)
            obj.rotation_euler=(vec(target)-obj.location).to_track_quat('-Z','Y').to_euler()
    for spec in meta['lights']:
        data=bpy.data.lights.new(spec['id'],type='AREA' if spec['type']=='area' else 'SPOT' if spec['type']=='spot' else 'POINT')
        # Approximate white LED luminous efficacy; this is NOT a certified lux calculation.
        data.energy=spec['power']/100;data.color=linear(spec['color'])
        if data.type=='AREA':data.shape='RECTANGLE';data.size=max(.02,spec.get('width',.04));data.size_y=max(.02,spec.get('height',.5))
        else:data.shadow_soft_size=spec.get('size',.06)
        if data.type=='SPOT':data.spot_size=math.pi/1.4;data.spot_blend=.7
        obj=bpy.data.objects.new(spec['id']+' light',data);bpy.context.collection.objects.link(obj);obj.location=vec(spec['position'])
        direction=vec(spec['target'])-obj.location;obj.rotation_euler=direction.to_track_quat('-Z','Y').to_euler()
def main():
    parser=argparse.ArgumentParser();parser.add_argument('--scene',required=True);parser.add_argument('--metadata',required=True);parser.add_argument('--output',required=True)
    parser.add_argument('--preset',choices=PRESETS,default='quality');parser.add_argument('--device',choices=['auto','cpu','gpu'],default='auto');parser.add_argument('--validate-only',action='store_true')
    args=parser.parse_args(sys.argv[sys.argv.index('--')+1:])
    meta=json.loads(Path(args.metadata).read_text());output=Path(args.output);output.parent.mkdir(parents=True,exist_ok=True)
    if meta.get('schemaVersion')!=1 or meta.get('units')!='m':raise RuntimeError('Invalid metadata units/schema')
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.scene.unit_settings.system='METRIC';bpy.context.scene.unit_settings.scale_length=1.0
    bpy.ops.import_scene.gltf(filepath=str(Path(args.scene).resolve()))
    result=verify_geometry(meta)
    (output.parent/'geometry-validation.json').write_text(json.dumps(result,indent=2))
    visible=set(meta['visibleEntityIds'])
    for obj in bpy.context.scene.objects:
        if obj.type=='MESH':obj.hide_render=obj.get('entityId') not in visible
    # GLB contains embedded base-color/normal textures and PBR material values.
    # Preserve importer-created nodes; do not discard texture links or substitute geometry.
    for image in bpy.data.images:
        if image.source=='FILE' and not image.packed_file:
            try:image.pack()
            except RuntimeError:pass
    if args.validate_only:
        print('GEOMETRY_VALIDATION '+json.dumps(result));return
    scene=bpy.context.scene;scene.render.engine='CYCLES'
    width,height,samples,threshold=PRESETS[args.preset]
    scene.render.resolution_x=width;scene.render.resolution_y=height;scene.render.resolution_percentage=100
    scene.cycles.samples=samples;scene.cycles.use_adaptive_sampling=True;scene.cycles.adaptive_threshold=threshold;scene.cycles.use_denoising=True
    scene.cycles.max_bounces=12;scene.cycles.diffuse_bounces=6;scene.cycles.glossy_bounces=6;scene.cycles.transmission_bounces=8;scene.cycles.transparent_max_bounces=8
    scene.cycles.adaptive_min_samples=16;scene.cycles.sample_clamp_indirect=5;scene.cycles.seed=17
    scene.render.film_transparent=False
    scene.view_settings.exposure={'day':.3,'clean':1.2,'evening':.7}.get(meta['lightingPreset'],.3)
    scene.render.image_settings.file_format='PNG';scene.render.image_settings.color_mode='RGBA';scene.render.image_settings.color_depth='8' if args.preset=='preview' else '16'
    scene.render.film_transparent=False;scene.render.filepath=str(output)
    try:scene.view_settings.view_transform='AgX'
    except TypeError:scene.view_settings.view_transform='Standard'
    camera_from_metadata(meta['camera'],width,height);configure_lighting(meta)
    device=configure_device(args.device);print('CYCLES_DEVICE '+device,flush=True)
    try:bpy.ops.render.render(write_still=True)
    except RuntimeError:
        if args.device!='auto' or device=='CPU':raise
        scene.cycles.device='CPU';device='CPU (GPU render failed; automatic fallback)';bpy.ops.render.render(write_still=True)
    (output.parent/'render-report.json').write_text(json.dumps({'preset':args.preset,'device':device,'resolution':[width,height],'samplesLimit':samples,'sourceHash':meta['sourceHash'],'sourceRevision':meta['sourceRevision'],'geometry':result,'textures':[i.name for i in bpy.data.images],'lightingPreset':meta['lightingPreset'],'colorManagement':scene.view_settings.view_transform,'bitDepth':scene.render.image_settings.color_depth,'lightCount':sum(o.type=='LIGHT' for o in scene.objects)},indent=2))
    print('RENDER_COMPLETE '+str(output),flush=True)
if __name__=='__main__':
    try:main()
    except Exception:
        import traceback;traceback.print_exc();sys.exit(1)
