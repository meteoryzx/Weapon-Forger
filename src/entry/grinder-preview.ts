import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { GrinderModel, type GrinderPass } from '../render/grinder-model.ts';

const params=new URLSearchParams(location.search);
const pass=params.get('pass')??'blockout';
const model=new GrinderModel(pass as GrinderPass);
const root=model.assembly;root.removeFromParent();root.scale.setScalar(.001);root.position.y=0;
const scene=new THREE.Scene();scene.background=new THREE.Color('#353638');
scene.add(root);
const renderer=new THREE.WebGLRenderer({antialias:true,preserveDrawingBuffer:true});
renderer.setSize(innerWidth,innerHeight);renderer.setPixelRatio(1);
renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.1;
renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;
document.body.append(renderer.domElement);
const pmrem=new THREE.PMREMGenerator(renderer),room=new RoomEnvironment();
scene.environment=pmrem.fromScene(room).texture;scene.environmentIntensity=0.7;room.dispose();pmrem.dispose();
for(const [position,intensity,color] of [[[-3,4,3],3,'#fff0df'],[[-2,1,-3],1,'#bac9df'],[[3,4,-1],2,'#fff0d8']] as const){
  const light=new THREE.DirectionalLight(color,intensity);light.position.fromArray(position);scene.add(light);
}
const camera=new THREE.PerspectiveCamera(36,innerWidth/innerHeight,0.01,30);
const controls=new OrbitControls(camera,renderer.domElement);
controls.target.set(0.02,0.67,0);controls.enableDamping=true;
const views:Record<string,number[]>={hero:[-2.2,1.7,-2.5],front:[-3,0.76,0],side:[0,0.76,3],rear:[3,0.76,0],left:[0,0.76,-3]};
function setView(view:string){camera.position.fromArray(views[view]??views.hero!);controls.target.set(0.02,0.67,0);controls.update();}
setView(params.get('view')??'hero');
document.querySelectorAll<HTMLButtonElement>('button[data-view]').forEach(b=>b.onclick=()=>setView(b.dataset.view!));
addEventListener('resize',()=>{camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight);});
Object.assign(window,{__grinderReview:{root,scene,camera,renderer}});
renderer.setAnimationLoop((time)=>{if(pass==='material')model.tick(time/1000);controls.update();renderer.render(scene,camera);});
