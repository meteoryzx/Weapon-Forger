import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { createForgePress } from '../../../src/render/forge-press-model.ts';
import { WorkshopModelKit } from '../../../src/render/workshop-model-kit.ts';
const renderer=new THREE.WebGLRenderer({canvas:document.querySelector('canvas'),antialias:true,preserveDrawingBuffer:true});
renderer.setPixelRatio(1);renderer.shadowMap.enabled=true;renderer.toneMapping=THREE.ACESFilmicToneMapping;
const scene=new THREE.Scene();scene.background=new THREE.Color('#d5d6d8');
const environment=new THREE.PMREMGenerator(renderer);scene.environment=environment.fromScene(new RoomEnvironment(),.04).texture;scene.environmentIntensity=.5;
const asset=createForgePress(new WorkshopModelKit());scene.add(asset.root);
const key=new THREE.DirectionalLight(0xffffff,3);key.position.set(-150,300,250);key.castShadow=true;
Object.assign(key.shadow.camera,{left:-130,right:130,top:150,bottom:-120,near:1,far:700});key.shadow.mapSize.set(2048,2048);key.shadow.normalBias=.15;
const fill=new THREE.DirectionalLight(0xffffff,.8);fill.position.set(200,120,130);scene.add(key,fill,new THREE.HemisphereLight(0xe2ebf1,0x73777a,1.5));
const ground=new THREE.Mesh(new THREE.PlaneGeometry(1000,1000),new THREE.ShadowMaterial({opacity:.18}));ground.rotation.x=-Math.PI/2;ground.position.y=-30;ground.receiveShadow=true;scene.add(ground);
const camera=new THREE.OrthographicCamera(-100,100,100,-100,1,1500),orbit=new OrbitControls(camera,renderer.domElement);
const directions={reference:[.42,.14,1],front:[0,0,1],right:[1,0,0],rear:[0,0,-1],left:[-1,0,0]};
function resize(){const aspect=innerWidth/innerHeight,span=Math.max(179,108/aspect);renderer.setSize(innerWidth,innerHeight,false);camera.left=-span*aspect/2;camera.right=span*aspect/2;camera.top=span/2;camera.bottom=-span/2;camera.updateProjectionMatrix();}
function view(name){orbit.target.set(0,46,0);camera.position.copy(orbit.target).add(new THREE.Vector3(...directions[name]).normalize().multiplyScalar(550));camera.lookAt(orbit.target);orbit.update();render();}
function render(){renderer.render(scene,camera);}
function inspect(){asset.root.updateMatrixWorld(true);const b=new THREE.Box3().setFromObject(asset.root),low=new THREE.Box3().setFromObject(asset.contact),up=new THREE.Box3().setFromObject(asset.upper);return{bounds:b.getSize(new THREE.Vector3()).toArray(),floor:b.min.y,gap:up.min.y-low.max.y,lowerTop:low.max.y,ramY:asset.ram.position.y,triangles:renderer.info.render.triangles,drawCalls:renderer.info.render.calls};}
const slider=document.querySelector('input[type=range]'),motion=document.querySelector('#motion');
slider.addEventListener('input',()=>{motion.checked=false;asset.ram.position.y=-Number(slider.value)*.08;render();});
document.querySelector('select').addEventListener('change',e=>view(e.target.value));addEventListener('resize',()=>{resize();render();});
window.pressReview={asset,scene,camera,renderer,view,inspect,render};resize();view('reference');
renderer.setAnimationLoop(t=>{if(motion.checked)asset.ram.position.y=-4.8*(1-Math.cos(t*.003));render();});
