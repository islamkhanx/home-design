"""Render a resumable frame sequence from the exact canonical GLB."""
import argparse, json, struct, sys, time
from pathlib import Path
import bpy
sys.path.insert(0,str(Path(__file__).parent))
from render import verify_geometry, camera_from_metadata, configure_lighting, configure_device, vec

def atomic_json(path,value):
    temp=path.with_suffix('.tmp')
    temp.write_text(json.dumps(value,ensure_ascii=False,indent=2))
    temp.replace(path)

def valid_png(path,width,height):
    try:
        with path.open('rb') as f:
            header=f.read(24);f.seek(-12,2);tail=f.read()
        return header[:8]==b'\x89PNG\r\n\x1a\n' and struct.unpack('>II',header[16:24])==(width,height) and tail==b'\x00\x00\x00\x00IEND\xaeB`\x82'
    except (OSError,ValueError,struct.error):return False

def main():
    p=argparse.ArgumentParser();p.add_argument('--directory',required=True)
    args=p.parse_args(sys.argv[sys.argv.index('--')+1:]);out=Path(args.directory)
    plan=json.loads((out/'tour.json').read_text());meta=json.loads((out/'scene.metadata.json').read_text())
    settings=plan['settings'];frames=out/'frames';frames.mkdir(exist_ok=True)
    state=json.loads((out/'progress.json').read_text())
    def update(**values):
        state.update(values);state['updatedAt']=time.time();atomic_json(out/'progress.json',state)
        print('TOUR_PROGRESS '+json.dumps(state,ensure_ascii=False),flush=True)
    update(phase='importing',message='Importing canonical geometry')
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(out/'scene.glb'))
    validation=verify_geometry(meta);atomic_json(out/'geometry-validation.json',validation)
    scene=bpy.context.scene;scene.render.engine='CYCLES'
    scene.render.resolution_x=settings['width'];scene.render.resolution_y=settings['height'];scene.render.resolution_percentage=100
    scene.cycles.samples=settings['samples'];scene.cycles.adaptive_threshold=settings['threshold']
    scene.cycles.use_adaptive_sampling=True;scene.cycles.adaptive_min_samples=min(8,settings['samples'])
    scene.cycles.use_denoising=True;scene.cycles.seed=17
    scene.cycles.max_bounces=8;scene.cycles.diffuse_bounces=4;scene.cycles.glossy_bounces=4;scene.cycles.transmission_bounces=6
    scene.cycles.sample_clamp_indirect=5
    # Rebuild Cycles state per frame: cached scene data can retain stale visibility
    # when a tour switches between rooms in Blender 5.x.
    scene.render.use_persistent_data=False;scene.render.film_transparent=False
    scene.render.image_settings.file_format='PNG';scene.render.image_settings.color_mode='RGB';scene.render.image_settings.color_depth='8'
    try:scene.view_settings.view_transform='AgX'
    except TypeError:scene.view_settings.view_transform='Standard'
    scene.view_settings.exposure=.3
    device=configure_device(settings['device'])
    complete={i for i in range(1,settings['totalFrames']+1) if valid_png(frames/f'{i:06}.png',settings['width'],settings['height'])}
    update(phase='rendering',device=device,completed=len(complete),resumedFrames=len(complete),total=settings['totalFrames'])
    for shot in plan['shots']:
        visible=set(shot['visibleEntityIds'])
        for obj in scene.objects:
            if obj.type=='MESH':obj.hide_render=obj.get('entityId') not in visible
        if scene.camera:
            old=scene.camera;data=old.data;bpy.data.objects.remove(old,do_unlink=True);bpy.data.cameras.remove(data)
        camera_from_metadata(shot['camera'],settings['width'],settings['height'])
        configure_lighting({**meta,**shot})
        # Burn provenance into frames, so screenshots and the MP4 retain it.
        for key in ('time','date','render_time','frame','frame_range','memory','hostname','camera','lens','scene','marker','filename','sequencer_strip'):
            if hasattr(scene.render,'use_stamp_'+key):setattr(scene.render,'use_stamp_'+key,False)
        scene.render.use_stamp=True;scene.render.use_stamp_labels=False;scene.render.use_stamp_note=True
        scene.render.stamp_note_text=shot['title']+' | '+ ' | '.join(shot['renderNotice'])
        scene.render.stamp_font_size=max(8,round(settings['width']/105))
        scene.render.stamp_foreground=(.12,.17,.1,1);scene.render.stamp_background=(.96,.95,.91,.92)
        for frame in range(shot['startFrame'],shot['endFrame']+1):
            if (out/'pause.request').exists():
                update(phase='paused',message='Paused; completed frames are saved');return
            if frame in complete:continue
            pose=plan['walkthrough']['frames'][frame-1]
            camera=scene.camera;camera.location=vec(pose['position'])
            direction=(vec(pose['target'])-camera.location).normalized()
            camera.rotation_euler=direction.to_track_quat('-Z','Y').to_euler()
            title=plan['roomNames'].get(pose['room'],shot['title'])
            scene.render.stamp_note_text=title+' | '+' | '.join(shot['renderNotice'])
            update(frame=frame,shot=title,message='Rendering frame')
            temp=frames/f'{frame:06}.partial.png';scene.render.filepath=str(temp)
            before=time.monotonic()
            try:bpy.ops.render.render(write_still=True)
            except RuntimeError:
                if settings['device']!='auto' or device=='CPU':raise
                scene.cycles.device='CPU';device='CPU';update(device=device,message='GPU failed; using CPU')
                bpy.ops.render.render(write_still=True)
            if not valid_png(temp,settings['width'],settings['height']):raise RuntimeError('Incomplete rendered frame')
            temp.replace(frames/f'{frame:06}.png');complete.add(frame)
            update(completed=len(complete),lastCompletedFrame=frame,lastFrameSeconds=time.monotonic()-before,message='Frame saved')
    update(phase='encoding',message='All frames saved; creating MP4')

if __name__=='__main__':
    try:main()
    except Exception:
        import traceback;traceback.print_exc();sys.exit(1)
