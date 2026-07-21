import { Color, PerspectiveCamera, Scene, WebGLRenderer } from "three";

const canvas = document.querySelector<HTMLCanvasElement>("#game");
if (!canvas) {
  throw new Error("Missing #game canvas.");
}

const renderer = new WebGLRenderer({ antialias: true, canvas });
const scene = new Scene();
const camera = new PerspectiveCamera();
scene.background = new Color("#151817");

function render(): void {
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  renderer.render(scene, camera);
}

window.addEventListener("resize", render);
render();
