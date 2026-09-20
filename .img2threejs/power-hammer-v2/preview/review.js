import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createEarlyIndustrialPneumaticPowerHammerModel } from './createPowerHammerModel.ts';

const renderer = new THREE.WebGLRenderer({ canvas: document.querySelector('canvas'), antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
const scene = new THREE.Scene();
scene.background = new THREE.Color('#d5d6d8');
const model = createEarlyIndustrialPneumaticPowerHammerModel({ textureSize: 32 });
const runtime = model.userData.sculptRuntime;
// Map-stripped blockout: assess silhouette without surface maps or lighting baked into references.
model.traverse(object => {
  if (!object.isMesh) return;
  if (object.name === 'root') { object.visible = false; return; }
  object.material = new THREE.MeshStandardMaterial({ color: '#666e72', roughness: 0.78, flatShading: true });
});
scene.add(model);
const key = new THREE.DirectionalLight(0xffffff, 3);
key.position.set(-2600, 3800, 3000);
key.castShadow = true;
Object.assign(key.shadow.camera, { left: -2500, right: 2500, top: 3000, bottom: -2500, near: 1, far: 10000 });
key.shadow.mapSize.set(2048, 2048);
key.shadow.bias = -0.0002;
key.shadow.normalBias = 4;
scene.add(key, new THREE.HemisphereLight(0xe2ebf1, 0x73777a, 1.5));
const fill = new THREE.DirectionalLight(0xffffff, 0.8);
fill.position.set(2400, 1800, 1600);
scene.add(fill);
const ground = new THREE.Mesh(new THREE.PlaneGeometry(16000, 16000), new THREE.ShadowMaterial({ opacity: 0.18 }));
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
ground.position.y = -1;
scene.add(ground);
const camera = new THREE.OrthographicCamera(-1800, 1800, 1800, -1800, 1, 16000);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 1175, 0);
controls.enableDamping = false;
const directions = { reference: [0.746, 0.228, 0.626], front: [0, 0, 1], right: [1, 0, 0], rear: [0, 0, -1], left: [-1, 0, 0], top: [0, 1, 0.001] };
let currentView = 'reference';
function view(name) {
  currentView = name;
  document.querySelector('select').value = name;
  controls.target.set(0, name === 'reference' ? 900 : 1090, 0);
  resize();
  camera.position.copy(controls.target).add(new THREE.Vector3(...directions[name]).normalize().multiplyScalar(6500));
  camera.lookAt(controls.target);
  controls.update();
}
function resize() {
  const width = innerWidth, height = innerHeight;
  renderer.setSize(width, height, false);
  const aspect = width / height;
  const span = Math.max(currentView === 'reference' ? 2400 : 2700, 1850 / aspect);
  camera.left = -span * aspect / 2;
  camera.right = span * aspect / 2;
  camera.top = span / 2;
  camera.bottom = -span / 2;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
document.querySelector('select').addEventListener('change', event => view(event.target.value));
const motion = document.querySelector('#motion'), travel = document.querySelector('#travel');
travel.addEventListener('input', () => { motion.checked = false; });
const initialRamY = runtime.nodes.ram.position.y;
function bounds(mesh) { return new THREE.Box3().setFromObject(mesh); }
function inspect() {
  model.updateMatrixWorld(true);
  const lower = bounds(runtime.meshes['lower-die']), upper = bounds(runtime.meshes['upper-die']);
  const base = bounds(runtime.meshes.base);
  return { lowerFaceMm: lower.max.y, gapMm: upper.min.y - lower.max.y, baseFloorMm: base.min.y, baseSizeMm: base.getSize(new THREE.Vector3()).toArray(), upperCenter: upper.getCenter(new THREE.Vector3()).toArray(), lowerCenter: lower.getCenter(new THREE.Vector3()).toArray(), triangles: renderer.info.render.triangles, drawCalls: renderer.info.render.calls, parts: Object.keys(runtime.meshes), ramY: runtime.nodes.ram.position.y };
}
window.powerHammerReview = { inspect, view, model, scene, camera, renderer, runtime, ground };
resize(); view('reference');
renderer.setAnimationLoop(time => {
  const offset = motion.checked ? 60 * (1 - Math.cos(time * 0.004)) : Number(travel.value);
  runtime.nodes.ram.position.y = initialRamY - offset;
  document.querySelector('output').value = `${Math.round(offset)} mm`;
  renderer.render(scene, camera);
});
