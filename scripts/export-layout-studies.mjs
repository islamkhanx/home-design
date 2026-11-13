import * as T from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const dir=fileURLToPath(new URL('../design/bathroom-v01/',import.meta.url));
const source=process.argv[2]??'bathroom-layout-options.json';
const prefix=process.argv[3]??'layout-studies';
const model=JSON.parse(await fs.readFile(path.join(dir,source),'utf8'));
globalThis.FileReader=class{readAsArrayBuffer(blob){blob.arrayBuffer().then(b=>{this.result=b;this.onloadend?.()})}};
const scene=new T.Scene();let count=0;let variant='';let finishZones={};let woodFinish=null;const records=[];
const mat=(name,color,roughness=.65,metalness=0)=>new T.MeshStandardMaterial({name,color,roughness,metalness});
const stone=mat('warm limestone',0xcac3b7,.82),wood=mat('oak furniture',0xb18d61,.55),white=mat('white ceramic',0xf5f5f0,.23),metal=mat('satin chrome',0x9ba4a5,.24,.8),mirror=mat('mirror',0xd5e5e2,.055,.98),inner=mat('basin interior',0xd5dedb,.3),accent=mat('accent stone',0x8e8b79,.8);
const glass=new T.MeshPhysicalMaterial({name:'glass',color:0xe3efec,roughness:.08,transmission:.98,ior:1.45,thickness:.008});
const led=mat('LED diffuser',0xffedc4,.4);led.emissive=new T.Color(0xffd99d);led.emissiveIntensity=1.5;
function add(g,m,p,name,wall=''){if(m===wood&&woodFinish)m=woodFinish;const zone=name==='floor'?'floor':name==='wall-west'?'west':name==='WC-frame'?'wc_frame':name.startsWith('tower-')?'tower':null; if(zone&&finishZones[zone])m=finishZones[zone]==='accent'?accent:facade;const o=new T.Mesh(g,m);o.position.set(...p);o.name=`${variant}-${name}-${count++}`;o.userData={partId:o.name,entityId:variant,wall};scene.add(o);return o;}
function box(x,z,w,d,y,h,m,name,r=0,wall=''){return add(r?new RoundedBoxGeometry(w,h,d,3,Math.min(r,w/3,h/3,d/3)):new T.BoxGeometry(w,h,d),m,[x+w/2,y+h/2,z+d/2],name,wall);}
function rect(a,y,h,m,name,r=0){return box(...a.map(n=>n/1000),y,h,m,name,r)}
function disk(x,y,z,r,m,name,face='south'){const o=add(new T.CylinderGeometry(r,r,.012,40),m,[x,y,z],name);if(face==='east')o.rotation.z=Math.PI/2;else o.rotation.x=Math.PI/2;return o;}
const facade=mat('warm matte facade',0xcac6ba,.75);
for(const v of model.variants){variant=v.id;finishZones=v.finish_zones??{};woodFinish=v.wood_tone_hex?mat('wood-finish-'+v.id,v.wood_tone_hex,.6):null;const layout=v.layout??v.id;
 box(0,0,1.8,2.47,-.13,.13,stone,'floor');
 box(-.08,0,.08,2.47,0,2.7,stone,'wall-west',0,'west');
 box(0,-.08,1.8,.08,0,2.7,layout==='C'?accent:stone,'wall-north',0,'north');
 if(layout==='C')box(0,0,.003,.7,0,2.7,accent,'accent-return');
 box(0,2.47,1.8,.08,0,2.7,stone,'wall-south',0,'south');
 if(model.enclosed_for_lighting){
  box(0,0,1.8,2.47,2.7,.08,facade,'ceiling',0,'ceiling');
  box(1.8,0,.08,.85,0,2.7,stone,'wall-east-1',0,'east');
  box(1.8,1.75,.08,.72,0,2.7,stone,'wall-east-2',0,'east');
  box(1.8,.85,.08,.9,2.1,.6,stone,'wall-east-lintel',0,'east');
  for(const l of model.lighting.lights.filter(l=>l.group==='G1')){
   const [x,y,z]=l.position_mm.map(n=>n/1000);
   box(x-.06,z-.06,.12,.12,y+.005,.04,white,'main-light-housing',.01);
   box(x-.05,z-.05,.1,.1,y,.005,led,'main-light',.008);
  }
 }
 // The entry and the near east wall remain cut away in both inspection views.
 box(0,0,1.7,.7,0,.57,white,'tub-body',.06);
 box(.085,.09,1.53,.52,.565,.012,inner,'tub-basin',.09);
 for(const [x,z,w,d] of [[0,0,1.7,.085],[0,.615,1.7,.085],[0,.08,.085,.54],[1.615,.08,.085,.54]])box(x,z,w,d,.57,.03,white,'tub-rim',.012);
 box(0,.7,.65,.008,.6,1.4,glass,'bath-screen');
 box(.02,.32,.1,.05,.85,.08,metal,'bath-mixer',.01);box(.02,.32,.025,.025,.95,1.25,metal,'shower-rail');box(.02,.27,.24,.14,2.16,.025,metal,'shower-head',.01);
 rect(model.shaft_assumption,0,2.7,stone,'service-shaft');
 rect(v.frame,0,1.2,stone,'WC-frame');
 const [tx,tz,tw,td]=v.wc.map(n=>n/1000);
 box(tx,tz,tw,td,.2,.24,white,'WC-bowl',.1);box(tx-.005,tz-.005,tw+.01,td+.01,.44,.025,white,'WC-seat',.08);
 const [fx,fz,fw,fd]=v.frame.map(n=>n/1000);
 if(layout==='C')box(fx+.22,fz-.012,.24,.012,.95,.15,metal,'flush');else box(fx+fw,fz+.22,.012,.24,.95,.15,metal,'flush');
 rect(v.vanity,.35,.5,wood,'vanity',.007);
 const [vx,vz,vw,vd]=v.vanity.map(n=>n/1000);
 if(layout==='A')rect(v.vanity,.85,.025,white,'counter',.008);
 else if(layout==='B')box(.3,1.82,1.5,.65,.88,.025,white,'common-counter',.008);
 else box(0,.8,.65,1.27,.88,.025,white,'common-counter',.008);
 const top=layout==='A'?.875:.905;
 box(vx+.065,vz+.08,vw-.13,vd-.16,top,.035,white,'basin-edge',.045);
 box(vx+.09,vz+.105,vw-.18,vd-.21,top+.035,.004,inner,'basin-recess',.04);
 const tap=layout==='B'?[vx+vw/2,top,vz+vd-.045]:[vx+.04,top,vz+vd/2];
 box(tap[0],tap[2],.025,.025,top,.17,metal,'tap-upright',.008);
 box(tap[0],layout==='B'?tap[2]-.13:tap[2],layout==='B'?.025:.13,layout==='B'?.13:.025,top+.15,.025,metal,'tap-spout',.008);
 const [wx,wz,ww,wd]=v.washer.map(n=>n/1000);
 box(wx+.025,wz+.025,ww-.05,wd-.05,0,.85,white,'washer',.018);
 if(layout==='C'){disk(wx+ww-.02,.43,wz+wd/2,.205,metal,'washer-ring','east');disk(wx+ww-.009,.43,wz+wd/2,.164,inner,'washer-window','east');box(wx+ww-.01,wz+.08,.012,.2,.72,.045,metal,'washer-controls');}
 else{disk(wx+ww/2,.43,wz+.02,.205,metal,'washer-ring');disk(wx+ww/2,.43,wz+.009,.164,inner,'washer-window');box(wx+.08,wz+.01,.2,.012,.72,.045,metal,'washer-controls');}
 if(v.composition===2){
  box(0,.8,.22,1.37,1.3,1.1,facade,'upper-cabinet-wide',.006);
  box(.22,.8,.008,1.37,1.3,1.1,mirror,'wide-mirror');
  for(const z of [1.26,1.72])box(.229,z,.003,.003,1.3,1.1,metal,'mirror-joint');
  box(.235,.8,.018,1.37,1.285,.015,led,'mirror-light');
  box(1.15,2.17,.65,.3,1.3,1.1,facade,'upper-cabinet-laundry',.006);
 }else if(v.composition===3){
  box(0,1.48,.3,.69,1.3,1.1,facade,'upper-cabinet-wc',.006);
  // Washer stays at its existing coordinate; only its enclosure is new.
  for(const x of [1.15,1.782])box(x,1.82,.018,.65,0,2.55,wood,'tower-side');
  for(const y of [.91,2.532])box(1.168,1.82,.614,.65,y,.018,wood,'tower-shelf');
  for(const x of [1.15,1.477]){
   box(x,1.8,.323,.018,.02,.88,wood,'tower-door-lower',.003);
   box(x,1.8,.323,.018,.93,1.62,wood,'tower-door-upper',.003);
  }
  box(.015,.8,.015,.6,1.1,1,mirror,'mirror');for(const z of [.8,1.39])box(.035,z,.02,.012,1.1,1,led,'mirror-light');
 }else{
 for(const u of v.upper){const [x,z,w,d]=u.map(n=>n/1000);box(x,z,w,d,layout==='B'?1.2:1.3,1.1,wood,'upper-cabinet',.006);
  if(layout==='B'){box(x,z-.008,w,.008,1.2,1.1,mirror,'wide-mirror');for(const k of [.5,1])box(x+k,z-.009,.004,.009,1.2,1.1,metal,'mirror-joint');box(x,z-.03,w,.02,2.31,.025,led,'mirror-light');}
  else if(x===0)box(x+w+.001,z+d/2,.003,.004,1.3,1.1,metal,'cabinet-joint');
 }
 if(layout!=='B'){box(.015,.8,.015,.6,1.1,1,mirror,'mirror');for(const z of [.8,1.39])box(.035,z,.02,.012,1.1,1,led,'mirror-light');}
 }
 if(!model.lighting || model.lighting.lights.some(l=>l.group==='G3')) {if(layout==='B')box(.35,1.83,.7,.012,.34,.012,led,'night-light');else box(vx+vw-.01,vz+.04,.012,vd-.08,.34,.012,led,'night-light'); }
 // Tile joint geometry comes from the same canonical layout used by elevations.
 const grout=mat('tile joints',0xaaa397,.8);
 if(v.tile_grid){
  const t=v.tile_grid,j=t.joint_visual_width_mm/1000;
  function westGrid(x,z0,z1,h,name){
   for(const zmm of t.west_vertical_axes_mm){const z=zmm/1000;if(z>z0&&z<z1)box(x,z-j/2,.001,j,0,h,grout,name+'-v');}
   for(const ymm of t.horizontal_axes_mm){const y=ymm/1000;if(y<h)box(x,z0,.001,z1-z0,y-j/2,j,grout,name+'-h');}
  }
  westGrid(.001,0,2.47,2.7,'tile-west');westGrid(.201,1.48,2.17,1.2,'tile-wc');westGrid(.301,2.17,2.47,2.7,'tile-shaft');
  const xaxes=t.nominal_width_mm===1200?[.3,1.5]:[.6,1.2];
  for(const [z,wall] of [[.001,'north'],[2.469,'south']]){
   for(const x of xaxes)box(x-j/2,z,j,.001,0,2.7,grout,'tile-'+wall+'-v',0,wall);
   for(const ymm of t.horizontal_axes_mm)box(0,z,1.8,.001,ymm/1000-j/2,j,grout,'tile-'+wall+'-h',0,wall);
  }
  for(const x of t.floor_x_axes_mm)box(x/1000-j/2,0,j,2.47,.001,.001,grout,'tile-floor');
  for(const z of t.floor_z_axes_mm)box(0,z/1000-j/2,1.8,j,.001,.001,grout,'tile-floor');
 }else{
  for(let x=.6;x<1.8;x+=.6)box(x,0,.0015,2.47,.001,.0015,grout,'grout');
  for(let z=.6;z<2.47;z+=.6)box(0,z,1.8,.0015,.001,.0015,grout,'grout');
 }
}
scene.updateMatrixWorld(true);
scene.traverse(o=>{if(o.isMesh){const b=new T.Box3().setFromObject(o);records.push({id:o.userData.partId,min:b.min.toArray(),max:b.max.toArray(),triangles:o.geometry.index?o.geometry.index.count/3:o.geometry.attributes.position.count/3});}});
const glb=await new GLTFExporter().parseAsync(scene,{binary:true});await fs.writeFile(path.join(dir,`${prefix}.glb`),Buffer.from(glb));
await fs.writeFile(path.join(dir,`${prefix}-metadata.json`),JSON.stringify({units:'m',geometry:records,source,variants:model.variants.map(v=>v.id),lighting:model.lighting??null},null,2));
console.log(`Exported ${records.length} mesh parts from the existing variant model.`);
