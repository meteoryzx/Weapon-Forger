import {
  AmbientLight,
  BoxGeometry,
  Color,
  ConeGeometry,
  DirectionalLight,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  OrthographicCamera,
  PlaneGeometry,
  PointLight,
  Raycaster,
  Scene,
  Vector2,
  Vector3,
  WebGLRenderer,
} from "three";

import type { BilletLocation, ForgeSnapshot } from "../forge/index.ts";
import { thermalSteelAppearance } from "./thermal-color.ts";

export interface FurnaceRenderCanvas {
  readonly width: number;
  readonly height: number;
  getContext(kind: "webgl2"): WebGL2RenderingContext | null;
}

export interface FurnaceViewport {
  readonly width: number;
  readonly height: number;
  readonly pixelRatio: number;
}

const ANIMATION_MS = 650;
const LANDSCAPE_INSPECTION_POSITION = new Vector3(-105, 31, 68);
const LANDSCAPE_FURNACE_POSITION = new Vector3(100, 31, 10);
const PORTRAIT_INSPECTION_POSITION = new Vector3(0, 31, 260);
const PORTRAIT_FURNACE_POSITION = new Vector3(0, 70, 10);

export class FurnaceView {
  private readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly camera = new OrthographicCamera(-320, 320, 180, -180, 0.1, 2_000);
  private readonly raycaster = new Raycaster();
  private readonly pointer = new Vector2();
  private readonly billetMaterial = new MeshStandardMaterial({ metalness: 0.72, roughness: 0.38 });
  private readonly billet = new Mesh(new BoxGeometry(195, 8, 48), this.billetMaterial);
  private readonly furnaceTarget = new Mesh(
    new BoxGeometry(116, 86, 28),
    new MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }),
  );
  private readonly furnaceGroup: Group;
  private readonly flames: readonly Mesh[];
  private location: BilletLocation | null = null;
  private animationStartedAtMs = -Infinity;
  private animationFrom = LANDSCAPE_INSPECTION_POSITION.clone();
  private animationTo = LANDSCAPE_INSPECTION_POSITION.clone();
  private viewport: FurnaceViewport;
  private portrait = false;

  constructor(private readonly canvas: FurnaceRenderCanvas, viewport: FurnaceViewport) {
    const context = canvas.getContext("webgl2");
    if (!context) throw new Error("The current runtime does not provide a WebGL2 context.");
    this.viewport = viewport;
    this.renderer = new WebGLRenderer({ antialias: true, canvas: canvas as unknown as HTMLCanvasElement, context });
    this.scene.background = new Color("#18191a");
    this.scene.add(new AmbientLight("#c7d0d6", 1.35));
    const key = new DirectionalLight("#dbe7ed", 2.4);
    key.position.set(-180, 260, 300);
    this.scene.add(key);
    const furnaceLight = new PointLight("#ff7a24", 42, 360, 1.5);
    furnaceLight.position.set(92, 36, 72);
    this.scene.add(furnaceLight);
    this.scene.add(this.camera);
    this.scene.add(this.createFloor());
    const furnace = this.createFurnace();
    this.furnaceGroup = furnace.group;
    this.flames = furnace.flames;
    this.scene.add(this.furnaceGroup);
    this.billet.position.copy(LANDSCAPE_INSPECTION_POSITION);
    this.billet.rotation.y = -0.08;
    this.scene.add(this.billet);
    this.furnaceTarget.position.set(100, 32, 76);
    this.scene.add(this.furnaceTarget);
    this.resize(viewport);
  }

  update(snapshot: ForgeSnapshot, nowMs: number): void {
    if (this.location === null) {
      this.location = snapshot.billetLocation;
      const initialPosition = this.positionFor(snapshot.billetLocation);
      this.billet.position.copy(initialPosition);
      this.animationFrom.copy(initialPosition);
      this.animationTo.copy(initialPosition);
    } else if (this.location !== snapshot.billetLocation) {
      this.location = snapshot.billetLocation;
      this.animationFrom.copy(this.billet.position);
      this.animationTo.copy(this.positionFor(snapshot.billetLocation));
      this.animationStartedAtMs = nowMs;
    }
    const progress = clamp((nowMs - this.animationStartedAtMs) / ANIMATION_MS, 0, 1);
    const eased = progress * progress * (3 - 2 * progress);
    this.billet.position.lerpVectors(this.animationFrom, this.animationTo, eased);
    const appearance = thermalSteelAppearance(snapshot.averageTemperatureC);
    this.billetMaterial.color.copy(appearance.surface);
    this.billetMaterial.emissive.copy(appearance.emissive);
    this.billetMaterial.emissiveIntensity = appearance.emissiveIntensity;
    this.flames.forEach((flame, index) => {
      const pulse = 0.92 + Math.sin(nowMs * 0.006 + index * 1.7) * 0.08;
      flame.scale.y = pulse;
    });
    this.renderer.render(this.scene, this.camera);
  }

  isAnimating(nowMs: number): boolean {
    return nowMs - this.animationStartedAtMs < ANIMATION_MS;
  }

  pickToggle(viewportX: number, viewportY: number): boolean {
    this.pointer.set(
      (viewportX / this.viewport.width) * 2 - 1,
      -(viewportY / this.viewport.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(this.pointer, this.camera);
    return this.raycaster.intersectObjects([this.billet, this.furnaceTarget], false).length > 0;
  }

  resize(viewport: FurnaceViewport): void {
    this.viewport = viewport;
    this.renderer.setPixelRatio(Math.min(viewport.pixelRatio, 2));
    this.renderer.setSize(viewport.width, viewport.height, false);
    const aspect = viewport.width / viewport.height;
    const wasPortrait = this.portrait;
    this.portrait = aspect < 0.75;
    this.furnaceGroup.position.set(this.portrait ? -100 : 0, this.portrait ? 40 : 0, 0);
    this.furnaceTarget.position.set(this.portrait ? 0 : 100, this.portrait ? 72 : 32, 76);
    if (this.location !== null && wasPortrait !== this.portrait) {
      this.billet.position.copy(this.positionFor(this.location));
    }
    const halfHeight = this.portrait ? 250 : 130 * Math.max(1, (16 / 9) / aspect);
    const halfWidth = halfHeight * aspect;
    this.camera.left = -halfWidth;
    this.camera.right = halfWidth;
    this.camera.top = halfHeight;
    this.camera.bottom = -halfHeight;
    this.camera.position.set(-30, 190, 470);
    this.camera.lookAt(15, 22, 0);
    this.camera.updateProjectionMatrix();
  }

  dispose(): void {
    this.billet.geometry.dispose();
    this.billetMaterial.dispose();
    this.renderer.dispose();
  }

  private createFloor(): Mesh {
    const floor = new Mesh(
      new PlaneGeometry(760, 440),
      new MeshStandardMaterial({ color: "#282a2b", metalness: 0.08, roughness: 0.88 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(0, -22, -20);
    return floor;
  }

  private createFurnace(): { readonly group: Group; readonly flames: readonly Mesh[] } {
    const group = new Group();
    const shell = new MeshStandardMaterial({ color: "#62686d", metalness: 0.22, roughness: 0.72 });
    const edge = new MeshStandardMaterial({ color: "#272a2e", metalness: 0.48, roughness: 0.46 });
    const hot = new MeshBasicMaterial({ color: "#ff6324" });
    const chamber = new Mesh(new BoxGeometry(132, 78, 8), new MeshBasicMaterial({ color: "#7f1d0d" }));
    chamber.position.set(100, 30, 18);
    group.add(chamber);
    const wallParts = [
      { size: [190, 34, 62], position: [100, 92, 42] },
      { size: [190, 30, 62], position: [100, -25, 42] },
      { size: [38, 88, 62], position: [24, 31, 42] },
      { size: [38, 88, 62], position: [176, 31, 42] },
    ] as const;
    for (const part of wallParts) {
      const mesh = new Mesh(new BoxGeometry(part.size[0], part.size[1], part.size[2]), shell);
      mesh.position.set(part.position[0], part.position[1], part.position[2]);
      group.add(mesh);
    }
    const lintel = new Mesh(new BoxGeometry(128, 10, 72), edge);
    lintel.position.set(100, 75, 47);
    group.add(lintel);
    const hearth = new Mesh(new BoxGeometry(134, 12, 80), edge);
    hearth.position.set(100, -2, 45);
    group.add(hearth);
    const flames = [-30, 0, 30].map((offset, index) => {
      const flame = new Mesh(new ConeGeometry(13 - index * 1.5, 44 + index * 7, 16), hot);
      flame.position.set(100 + offset, 23, 54 - index * 2);
      flame.rotation.z = index === 1 ? 0.08 : -0.04;
      group.add(flame);
      return flame;
    });
    return { group, flames };
  }

  private positionFor(location: BilletLocation): Vector3 {
    if (this.portrait) return location === "furnace" ? PORTRAIT_FURNACE_POSITION : PORTRAIT_INSPECTION_POSITION;
    return location === "furnace" ? LANDSCAPE_FURNACE_POSITION : LANDSCAPE_INSPECTION_POSITION;
  }
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
