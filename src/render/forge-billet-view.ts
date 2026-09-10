import {
  AmbientLight,
  BufferAttribute,
  BufferGeometry,
  Color,
  DirectionalLight,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  PerspectiveCamera,
  Raycaster,
  Scene,
  ShapeGeometry,
  Vector2,
  WebGLRenderer,
  BoxGeometry,
  CylinderGeometry,
  DoubleSide,
  ExtrudeGeometry,
  Shape,
  Vector3,
  TorusGeometry,
} from "three";

import {
  FORGE_RULES,
  type ForgeSnapshot,
  type ForgeSnapshotSection,
  type ForgeSnapshotWorkpiece,
  type HammerInfluencePreview,
  type WorkpieceGrid,
  type WorkpieceNode,
} from "../forge/index.ts";
import { thermalSteelAppearance } from "./thermal-color.ts";
import { MaterialsStationView, materialsCameraFrame } from "./materials-station-view.ts";

const BILLET_AXIAL_SCALE = 0.58;
const ROTATE_CONTROL_SIZE = 32;
const WORKSTATION_YAW = Math.PI / 24;
const BILLET_YAW = Math.PI / 4;
const BILLET_CENTER_OFFSET = FORGE_RULES.workpieceLength * BILLET_AXIAL_SCALE / 2;
const BILLET_MATERIAL = new MeshStandardMaterial({
  metalness: 0.82,
  roughness: 0.34,
  emissive: "#000000",
  emissiveIntensity: 0,
  vertexColors: true,
  side: DoubleSide,
});

export interface RenderCanvas {
  readonly width: number;
  readonly height: number;
  getContext(kind: "webgl2"): WebGL2RenderingContext | null;
}

export interface RenderViewport {
  readonly width: number;
  readonly height: number;
  readonly pixelRatio: number;
}

export interface HammerPickTarget {
  readonly sectionIndex: number;
  readonly faceBias: number;
}

export type ForgeStation =
  | "overview"
  | "materials"
  | "furnace"
  | "anvil"
  | "cut"
  | "weld"
  | "quench-water"
  | "quench-oil"
  | "temper"
  | "grind";

export type ForgeMaterialPick = "mild-steel" | "high-carbon-steel" | "spring-steel";

export type QuenchStation = "quench-water" | "quench-oil";

const STATION_ANCHORS: Record<Exclude<ForgeStation, "overview">, readonly [number, number, number]> = {
  materials: [-420, 44, -132],
  furnace: [-260, 56, -20],
  anvil: [0, 0, 0],
  cut: [-340, 42, 150],
  weld: [330, 42, 150],
  "quench-water": [250, 48, -4],
  "quench-oil": [250, 48, -96],
  temper: [180, 56, -190],
  grind: [-150, 56, 260],
};

const BILLET_ANCHORS: Record<Exclude<ForgeStation, "overview">, readonly [number, number, number]> = {
  materials: [-420, 44, -132],
  furnace: [-260, 92, -20],
  anvil: [0, 0, 0],
  cut: [-340, 42, 150],
  weld: [280, 66, 122],
  "quench-water": [190, 76, -4],
  "quench-oil": [190, 76, -96],
  temper: [180, 82, -190],
  grind: [-150, 96, 245],
};

const CAMERA_FRAMES: Record<ForgeStation, { readonly position: readonly [number, number, number]; readonly target: readonly [number, number, number] }> = {
  overview: { position: [0, 430, 700], target: [0, 0, 30] },
  anvil: { position: [0, 250, 330], target: [0, 0, 0] },
  materials: { position: [-420, 190, 180], target: [-420, 25, -70] },
  furnace: { position: [-260, 190, 170], target: [-260, 42, -20] },
  cut: { position: [-340, 190, 195], target: [-340, 35, 150] },
  weld: { position: [330, 180, 225], target: [330, 35, 120] },
  "quench-water": { position: [250, 190, 160], target: [250, 35, -4] },
  "quench-oil": { position: [250, 190, 160], target: [250, 35, -96] },
  temper: { position: [180, 180, 170], target: [180, 38, -190] },
  grind: { position: [-150, 260, 480], target: [-150, 72, 250] },
};

export class ForgeBilletView {
  private readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly camera = new PerspectiveCamera(52, 1, 0.1, 2000);
  private readonly raycaster = new Raycaster();
  private readonly pointer = new Vector2();
  // The camera is the worker's eye line; the billet spins inside the fixed anvil station.
  private readonly billetRig = new Group();
  private readonly billet = new Mesh(new BufferGeometry(), BILLET_MATERIAL);
  private readonly weldBenchRigs: Group[] = [];
  private readonly weldBenchBillets: Mesh[] = [];
  private readonly weldBenchItemTargets: Mesh[] = [];
  private readonly billetHitTarget = new Mesh(
    new BoxGeometry(FORGE_RULES.workpieceLength, 24, FORGE_RULES.initialSectionWidth),
    new MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }),
  );
  private readonly anvilModel: Group;
  private readonly stationMeshes = new Map<ForgeStation, Mesh>();
  private readonly materialMeshes = new Map<ForgeMaterialPick, Mesh>();
  private readonly stationProps = new Map<ForgeStation, Object3D[]>();
  private readonly weldBenchTarget = new Mesh(
    new BoxGeometry(118, 10, 38),
    new MeshStandardMaterial({ color: "#876d53", metalness: 0.65, roughness: 0.38 }),
  );
  private readonly quenchTargets = new Map<QuenchStation, Mesh>();
  private readonly rotateControls: { readonly direction: -1 | 1; readonly group: Group }[] = [];
  private readonly temperControl = new Mesh(
    new BoxGeometry(32, 12, 32),
    new MeshStandardMaterial({ color: "#d69b52", metalness: 0.35, roughness: 0.5 }),
  );
  private readonly cameraFromPosition = new Vector3();
  private readonly cameraFromTarget = new Vector3();
  private readonly cameraToPosition = new Vector3();
  private readonly cameraToTarget = new Vector3();
  private readonly cameraTarget = new Vector3();
  private station: ForgeStation = "overview";
  private materialsView: MaterialsStationView | null = null;
  private materialsFocus: "table" | "rack" = "table";
  private transitionStartedAtMs = 0;
  private isTransitioning = false;
  private temperPreviewC: number | null = null;
  private snapshot: ForgeSnapshot | null = null;
  private viewport: RenderViewport;

  constructor(private readonly canvas: RenderCanvas, viewport: RenderViewport) {
    const context = canvas.getContext("webgl2");
    if (!context) {
      throw new Error("The current runtime does not provide a WebGL2 context.");
    }
    this.viewport = viewport;
    this.renderer = new WebGLRenderer({
      antialias: true,
      canvas: canvas as unknown as HTMLCanvasElement,
      context,
    });
    this.scene.background = new Color("#1b1d20");
    this.scene.add(new AmbientLight("#d8dbe0", 1.15));

    const keyLight = new DirectionalLight("#ffd8b2", 3.2);
    keyLight.position.set(-220, 320, -260);
    this.scene.add(keyLight);
    const rimLight = new DirectionalLight("#9fb9d0", 1.7);
    rimLight.position.set(280, 180, 220);
    this.scene.add(rimLight);
    this.scene.add(this.camera);
    this.createStationModels();

    const anvil = this.createAnvilModel();
    this.anvilModel = anvil;
    anvil.scale.set(BILLET_AXIAL_SCALE, 0.92, 1);
    // User-space x+ is right, y+ is inward, z+ is up. In Three.js this is a
    // positive yaw around world Y, so the top view reads counter-clockwise.
    anvil.rotation.y = WORKSTATION_YAW;
    this.scene.add(anvil);
    this.billet.scale.x = BILLET_AXIAL_SCALE;
    // The local billet geometry starts at x=0, so rotate around its midpoint
    // while keeping that midpoint at the anvil center in the top view.
    this.billetRig.position.set(
      -BILLET_CENTER_OFFSET * Math.cos(BILLET_YAW),
      0,
      BILLET_CENTER_OFFSET * Math.sin(BILLET_YAW),
    );
    this.billetRig.rotation.y = BILLET_YAW;
    this.billetRig.add(this.billet);
    this.billetRig.add(this.billetHitTarget);
    this.scene.add(this.billetRig);
    this.resize(viewport);
    this.applyCameraFrame("overview");
  }

  update(
    snapshot: ForgeSnapshot,
    hammerPreview: HammerInfluencePreview | null = null,
    activeStation: ForgeStation = "overview",
    temperPreviewC: number | null = null,
  ): void {
    if (activeStation !== this.station) this.setStation(activeStation);
    this.snapshot = snapshot;
    this.temperPreviewC = temperPreviewC;
    const appearance = thermalSteelAppearance(snapshot.averageTemperatureC);
    BILLET_MATERIAL.emissive.copy(appearance.emissive);
    BILLET_MATERIAL.emissiveIntensity = appearance.emissiveIntensity;
    this.billet.rotation.x = snapshot.orientationQuarterTurns * (Math.PI / 2);
    this.billet.position.x = snapshot.feedOffset * BILLET_AXIAL_SCALE;
    const halfHeight = snapshot.orientationQuarterTurns % 2 === 0
      ? FORGE_RULES.initialSectionThickness / 2
      : FORGE_RULES.initialSectionWidth / 2;
    // The anvil face is at world Y=0. Place the lowest billet surface exactly
    // on that plane; do not hide an intersection by changing camera angle.
    this.billet.position.y = halfHeight;
    this.billetHitTarget.position.x = this.billet.position.x + FORGE_RULES.workpieceLength / 2;
    this.billetHitTarget.position.y = this.billet.position.y;
    this.billetHitTarget.rotation.x = this.billet.rotation.x;
    const anchor = activeStation === "overview"
      ? BILLET_ANCHORS.anvil
      : BILLET_ANCHORS[activeStation];
    this.billetRig.position.set(
      anchor[0] - BILLET_CENTER_OFFSET * Math.cos(BILLET_YAW),
      anchor[1],
      anchor[2] + BILLET_CENTER_OFFSET * Math.sin(BILLET_YAW),
    );
    this.temperControl.rotation.y = ((this.temperPreviewC ?? 220) - 220) / 160;
    const nextGeometry = createBilletGeometry(snapshot, hammerPreview);
    this.billet.geometry.dispose();
    this.billet.geometry = nextGeometry;
    this.updateWeldBenchItems(snapshot.bench, activeStation === "weld");
    this.updateStationEmphasis(activeStation);
    this.render();
  }

  setStation(station: ForgeStation, nowMs = performance.now()): void {
    if (station === this.station && !this.isTransitioning) return;
    this.station = station;
    this.cameraFromPosition.copy(this.camera.position);
    this.cameraFromTarget.copy(this.cameraTarget);
    const frame = this.cameraFrame(station);
    this.cameraToPosition.fromArray(frame.position);
    this.cameraToTarget.fromArray(frame.target);
    this.transitionStartedAtMs = nowMs;
    this.isTransitioning = true;
  }

  isCameraTransitioning(): boolean {
    return this.isTransitioning;
  }

  tick(nowMs: number): void {
    const materialMoved = this.materialsView?.tick(nowMs) ?? false;
    if (!this.isTransitioning) {
      if (materialMoved) this.render();
      return;
    }
    const amount = clamp((nowMs - this.transitionStartedAtMs) / 420, 0, 1);
    const eased = amount * amount * (3 - 2 * amount);
    this.camera.position.lerpVectors(this.cameraFromPosition, this.cameraToPosition, eased);
    this.cameraTarget.lerpVectors(this.cameraFromTarget, this.cameraToTarget, eased);
    this.camera.lookAt(this.cameraTarget);
    this.camera.updateProjectionMatrix();
    if (amount >= 1) this.isTransitioning = false;
    this.render();
  }

  resize(viewport: RenderViewport): void {
    this.viewport = viewport;
    this.renderer.setPixelRatio(Math.min(viewport.pixelRatio, 2));
    this.renderer.setSize(viewport.width, viewport.height, false);
    this.camera.aspect = viewport.width / viewport.height;
    if (!this.isTransitioning) this.applyCameraFrame(this.station);
    this.camera.updateProjectionMatrix();
    this.positionRotateControls();
    this.render();
  }

  enableRotateControls(): void {
    if (this.rotateControls.length > 0) return;
    const left = { direction: -1 as const, group: this.createRotateControl(-1) };
    const right = { direction: 1 as const, group: this.createRotateControl(1) };
    this.rotateControls.push(left, right);
    this.camera.add(left.group, right.group);
    this.positionRotateControls();
    this.render();
  }

  pickSection(viewportX: number, viewportY: number): number | null {
    return this.pickHammerTarget(viewportX, viewportY)?.sectionIndex ?? null;
  }

  pickStation(viewportX: number, viewportY: number): ForgeStation | null {
    const hit = this.pickObject(viewportX, viewportY, [...this.stationMeshes.values()], false);
    return (hit?.object.userData.station as ForgeStation | undefined) ?? null;
  }

  pickMaterial(viewportX: number, viewportY: number): ForgeMaterialPick | null {
    if (this.station === "materials" && this.materialsFocus === "rack") return null;
    const meshes = this.station === "materials" ? this.materialsView?.candidates ?? [] : [...this.materialMeshes.values()];
    const hit = this.pickObject(viewportX, viewportY, meshes, false);
    return (hit?.object.userData.materialId as ForgeMaterialPick | undefined) ?? null;
  }

  updateMaterials(candidateId: string | null, pieces: readonly ForgeSnapshotWorkpiece[]): void {
    if (!this.materialsView) {
      this.materialsView = new MaterialsStationView((piece) => createBilletGeometry(piece, null));
      this.scene.add(this.materialsView.group);
    }
    this.materialsView.update(candidateId, pieces);
    this.materialsView.group.visible = this.station === "materials";
    this.render();
  }

  setMaterialsFocus(focus: "table" | "rack"): void {
    if (focus === this.materialsFocus) return;
    this.materialsFocus = focus;
    this.materialsView?.setFocus(focus);
    this.isTransitioning = true;
    this.setStation("materials");
  }

  pickMaterialsRack(x: number, y: number): boolean {
    return this.materialsView !== null && this.pickObject(x, y, [this.materialsView.rack], true) !== null;
  }

  pickRackWorkpiece(x: number, y: number): string | null {
    if (this.materialsFocus !== "rack") return null;
    const hit = this.pickObject(x, y, this.materialsView?.rackItems ?? [], false);
    return (hit?.object.userData.workpieceId as string | undefined) ?? null;
  }

  pickRotateControl(viewportX: number, viewportY: number): -1 | 1 | null {
    for (const control of this.rotateControls) {
      if (this.pickObject(viewportX, viewportY, [control.group], true)) return control.direction;
    }
    return null;
  }

  pickWeldBench(viewportX: number, viewportY: number): number | null {
    const hit = this.pickObject(viewportX, viewportY, this.weldBenchItemTargets, false);
    return (hit?.object.userData.weldBenchIndex as number | undefined) ?? null;
  }

  pickQuenchBasin(viewportX: number, viewportY: number, station: QuenchStation): boolean {
    const basin = this.quenchTargets.get(station);
    return basin ? this.pickObject(viewportX, viewportY, [basin], false) !== null : false;
  }

  pickTemperControl(viewportX: number, viewportY: number): boolean {
    return this.pickObject(viewportX, viewportY, [this.temperControl], false) !== null;
  }

  pickHammerTarget(viewportX: number, viewportY: number): HammerPickTarget | null {
    if (!this.snapshot) {
      return null;
    }
    const hit = this.pickObject(viewportX, viewportY, [this.billet, this.billetHitTarget], false);
    if (!hit) {
      return null;
    }

    const localPoint = this.billet.worldToLocal(hit.point.clone());
    const sectionIndex = sectionIndexAt(localPoint.x, this.snapshot.sections);
    if (sectionIndex === null) {
      return null;
    }
    const section = this.snapshot.sections[sectionIndex];
    if (!section) {
      return null;
    }
    const turns = this.snapshot.orientationQuarterTurns;
    const faceBias = turns % 2 === 0
      ? inverseLerp(
        section.lateralOffset - section.width / 2,
        section.lateralOffset + section.width / 2,
        localPoint.z,
      )
      : inverseLerp(
        section.verticalOffset - section.thickness / 2,
        section.verticalOffset + section.thickness / 2,
        localPoint.y,
      );
    return { sectionIndex, faceBias: clamp(faceBias, 0, 1) };
  }

  setTemperPreview(temperatureC: number): void {
    this.temperPreviewC = clamp(temperatureC, 80, 450);
    this.temperControl.rotation.y = (this.temperPreviewC - 220) / 160;
    this.render();
  }

  private pickObject(viewportX: number, viewportY: number, objects: Object3D[], recursive: boolean) {
    this.pointer.set(
      (viewportX / this.viewport.width) * 2 - 1,
      -(viewportY / this.viewport.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(this.pointer, this.camera);
    return this.raycaster.intersectObjects(objects, recursive)[0] ?? null;
  }

  dispose(): void {
    this.materialsView?.dispose();
    this.billet.geometry.dispose();
    this.weldBenchBillets.forEach((billet) => billet.geometry.dispose());
    this.weldBenchItemTargets.forEach((target) => {
      target.geometry.dispose();
      (target.material as MeshBasicMaterial).dispose();
    });
    this.billetHitTarget.geometry.dispose();
    (this.billetHitTarget.material as MeshBasicMaterial).dispose();
    for (const mesh of [...this.stationMeshes.values(), ...this.materialMeshes.values()]) {
      mesh.geometry.dispose();
      (mesh.material as MeshStandardMaterial).dispose();
    }
    // BILLET_MATERIAL is shared across view instances; do not dispose it here.
    this.renderer.dispose();
  }

  private render(): void {
    this.renderer.render(this.scene, this.camera);
  }

  private createRotateControl(direction: -1 | 1): Group {
    const group = new Group();
    const panel = new Mesh(
      new BoxGeometry(ROTATE_CONTROL_SIZE, ROTATE_CONTROL_SIZE, 1),
      new MeshBasicMaterial({ color: "#29323a" }),
    );
    const arrow = new Mesh(
      createArrowGeometry(direction),
      new MeshBasicMaterial({ color: "#f3c36d" }),
    );
    arrow.position.z = 0.6;
    group.add(panel, arrow);
    return group;
  }

  private positionRotateControls(): void {
    if (this.rotateControls.length === 0) return;
    const distance = 120;
    const halfHeight = Math.tan((this.camera.fov * Math.PI) / 360) * distance;
    const halfWidth = halfHeight * this.camera.aspect;
    for (const control of this.rotateControls) {
      control.group.position.set(
        control.direction < 0 ? -halfWidth + ROTATE_CONTROL_SIZE * 0.75 : halfWidth - ROTATE_CONTROL_SIZE * 0.75,
        -halfHeight + ROTATE_CONTROL_SIZE * 0.75,
        -distance,
      );
    }
  }

  private updateWeldBenchItems(
    bench: readonly ForgeSnapshotWorkpiece[],
    visible: boolean,
  ): void {
    while (this.weldBenchRigs.length < bench.length) {
      const rig = new Group();
      rig.rotation.y = BILLET_YAW;
      const billet = new Mesh(new BufferGeometry(), BILLET_MATERIAL);
      const target = new Mesh(
        new BoxGeometry(1, 1, 1),
        new MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }),
      );
      rig.add(billet, target);
      this.weldBenchRigs.push(rig);
      this.weldBenchBillets.push(billet);
      this.weldBenchItemTargets.push(target);
      this.scene.add(rig);
    }
    const rawLengths = bench.map((workpiece) => Math.max(
      workpiece.sections.reduce((sum, section) => sum + section.length, 0),
      24,
    ));
    const displayScale = BILLET_AXIAL_SCALE * 0.24;
    const displayLength = rawLengths.map((length) => length * displayScale);
    const slotPositions = [-70, 70] as const;
    bench.forEach((workpiece, index) => {
      const rig = this.weldBenchRigs[index];
      const billet = this.weldBenchBillets[index];
      const target = this.weldBenchItemTargets[index];
      if (!rig || !billet || !target) return;
      const rawLength = rawLengths[index] ?? 24;
      const length = displayLength[index] ?? 24;
      billet.geometry.dispose();
      billet.geometry = createBilletGeometry(workpiece, null);
      billet.scale.set(displayScale, 1, 1);
      billet.position.set(-rawLength / 2, FORGE_RULES.initialSectionThickness / 2, 0);
      target.geometry.dispose();
      target.geometry = new BoxGeometry(length, 24, FORGE_RULES.initialSectionWidth * 0.72);
      target.position.set(0, FORGE_RULES.initialSectionThickness / 2, 0);
      target.userData.weldBenchIndex = index;
      rig.position.set(
        STATION_ANCHORS.weld[0] + (slotPositions[index] ?? 0),
        STATION_ANCHORS.weld[1],
        STATION_ANCHORS.weld[2],
      );
      rig.visible = visible;
    });
    for (let index = bench.length; index < this.weldBenchRigs.length; index += 1) {
      const rig = this.weldBenchRigs[index];
      if (rig) rig.visible = false;
    }
  }

  private createAnvilModel(): Group {
    const anvil = new Group();
    const steel = new MeshStandardMaterial({ color: "#414852", metalness: 0.52, roughness: 0.4, side: DoubleSide });
    const edge = new MeshStandardMaterial({ color: "#697482", metalness: 0.48, roughness: 0.3 });
    const face = new Mesh(new BoxGeometry(FORGE_RULES.anvilFaceLength, 16, FORGE_RULES.anvilFaceWidth), edge);
    face.position.set(0, -8, 0);
    const body = this.createProfile(
      [[-78, -16], [78, -16], [60, -38], [45, -88], [64, -112], [58, -152], [-58, -152], [-64, -112], [-45, -88], [-60, -38]],
      78,
      steel,
    );
    const foot = new Mesh(new BoxGeometry(160, 20, 98), edge);
    foot.position.set(0, -151, 0);
    anvil.add(face, body, foot);
    return anvil;
  }

  private createStationModels(): void {
    const definitions: readonly [Exclude<ForgeStation, "overview">, [number, number, number], [number, number, number], string][] = [
      ["materials", [-420, 14, -132], [112, 28, 60], "#4f5961"],
      ["furnace", [-260, 28, -20], [100, 56, 92], "#8b3f28"],
      ["cut", [-340, 14, 150], [104, 28, 66], "#7a7f86"],
      ["weld", [330, 14, 150], [104, 28, 66], "#536c74"],
      ["quench-water", [250, 16, -4], [84, 32, 62], "#315d72"],
      ["quench-oil", [250, 16, -96], [84, 32, 62], "#5a4a2f"],
      ["temper", [180, 22, -190], [112, 44, 70], "#774a38"],
      ["grind", [-150, 24, 260], [104, 48, 74], "#646d77"],
    ];
    for (const [station, position, size, color] of definitions) {
      const mesh = new Mesh(
        new BoxGeometry(...size),
        new MeshStandardMaterial({ color, metalness: 0.25, roughness: 0.7, emissive: "#000000" }),
      );
      mesh.position.set(...position);
      mesh.userData.station = station;
      this.stationMeshes.set(station, mesh);
      this.addStationObject(station, mesh);
    }

    this.weldBenchTarget.position.set(400, 62, 122);
    this.weldBenchTarget.userData.station = "weld";
    this.addStationObject("weld", this.weldBenchTarget);

    const furnaceOpening = new Mesh(
      new BoxGeometry(62, 8, 58),
      new MeshStandardMaterial({ color: "#17191b", metalness: 0.1, roughness: 0.92 }),
    );
    furnaceOpening.position.set(-260, 76, -20);
    this.addStationObject("furnace", furnaceOpening);
    const furnaceEmber = new Mesh(
      new BoxGeometry(42, 3, 38),
      new MeshStandardMaterial({ color: "#d34d25", emissive: "#e23d16", emissiveIntensity: 1.2 }),
    );
    furnaceEmber.position.set(-260, 82, -20);
    this.addStationObject("furnace", furnaceEmber);

    const cutBlade = new Mesh(
      new BoxGeometry(6, 54, 44),
      new MeshStandardMaterial({ color: "#c6d0d4", metalness: 0.82, roughness: 0.28 }),
    );
    cutBlade.position.set(-340, 80, 150);
    this.addStationObject("cut", cutBlade);
    const cutHandle = new Mesh(
      new BoxGeometry(18, 64, 18),
      new MeshStandardMaterial({ color: "#6b432e", metalness: 0.05, roughness: 0.85 }),
    );
    cutHandle.position.set(-340, 112, 150);
    this.addStationObject("cut", cutHandle);

    const weldClamp = new Mesh(
      new TorusGeometry(26, 5, 8, 20),
      new MeshStandardMaterial({ color: "#9babb1", metalness: 0.7, roughness: 0.32 }),
    );
    weldClamp.rotation.x = Math.PI / 2;
    weldClamp.position.set(330, 72, 122);
    this.addStationObject("weld", weldClamp);

    const grindWheel = new Mesh(
      new CylinderGeometry(44, 44, 14, 24),
      new MeshStandardMaterial({ color: "#68727a", metalness: 0.38, roughness: 0.74 }),
    );
    grindWheel.rotation.x = Math.PI / 2;
    grindWheel.position.set(-150, 84, 260);
    this.addStationObject("grind", grindWheel);
    const grindHub = new Mesh(
      new CylinderGeometry(10, 10, 18, 16),
      new MeshStandardMaterial({ color: "#bd8b4d", metalness: 0.7, roughness: 0.3 }),
    );
    grindHub.rotation.x = Math.PI / 2;
    grindHub.position.set(-150, 84, 260);
    this.addStationObject("grind", grindHub);

    for (const [station, color] of [["quench-water", "#6da9c3"], ["quench-oil", "#b28a4d"]] as const) {
      const basin = new Mesh(
        new BoxGeometry(70, 8, 34),
        new MeshStandardMaterial({ color, metalness: 0.2, roughness: 0.5, transparent: true, opacity: 0.9 }),
      );
      const anchor = STATION_ANCHORS[station];
      basin.position.set(anchor[0], anchor[1], anchor[2]);
      this.quenchTargets.set(station, basin);
      this.addStationObject(station, basin);
    }

    this.temperControl.position.set(180, 70, -190);
    this.addStationObject("temper", this.temperControl);

    const materials: readonly [ForgeMaterialPick, string][] = [
      ["mild-steel", "#78838c"],
      ["spring-steel", "#9e8d72"],
      ["high-carbon-steel", "#b86f45"],
    ];
    materials.forEach(([materialId, color], index) => {
      const mesh = new Mesh(
        new CylinderGeometry(18, 21, 8, 12),
        new MeshStandardMaterial({ color, metalness: 0.75, roughness: 0.32 }),
      );
      mesh.rotation.z = Math.PI / 2;
      mesh.position.set(-445 + index * 35, 42, -42);
      mesh.userData.materialId = materialId;
      this.materialMeshes.set(materialId, mesh);
      this.addStationObject("materials", mesh);
    });
  }

  private updateStationEmphasis(activeStation: ForgeStation): void {
    this.billetRig.visible = activeStation !== "materials";
    if (this.materialsView) this.materialsView.group.visible = activeStation === "materials";
    this.anvilModel.visible = activeStation === "overview" || activeStation === "anvil";
    for (const [station, objects] of this.stationProps) {
      const visible = activeStation === "overview" || (activeStation === station && station !== "materials");
      objects.forEach((object) => { object.visible = visible; });
    }
    for (const mesh of this.materialMeshes.values()) {
      mesh.visible = activeStation === "overview";
    }
    for (const [station, mesh] of this.stationMeshes) {
      const material = mesh.material as MeshStandardMaterial;
      material.emissive.set(station === activeStation ? "#d8a36b" : "#000000");
      material.emissiveIntensity = station === activeStation ? 0.45 : 0;
    }
    const activeTool = activeStation === "weld"
      ? this.weldBenchTarget
      : activeStation === "temper"
        ? this.temperControl
        : this.quenchTargets.get(activeStation as QuenchStation);
    if (activeTool) {
      const material = activeTool.material as MeshStandardMaterial;
      material.emissive.set("#f2b866");
      material.emissiveIntensity = 0.35;
    }
  }

  private applyCameraFrame(station: ForgeStation): void {
    const frame = this.cameraFrame(station);
    this.camera.position.fromArray(frame.position);
    this.cameraTarget.fromArray(frame.target);
    this.camera.lookAt(this.cameraTarget);
  }

  private cameraFrame(station: ForgeStation) {
    if (station !== "materials") return CAMERA_FRAMES[station];
    return materialsCameraFrame(this.materialsFocus, this.camera.aspect);
  }

  private addStationObject(station: Exclude<ForgeStation, "overview">, object: Object3D): void {
    const objects = this.stationProps.get(station) ?? [];
    objects.push(object);
    this.stationProps.set(station, objects);
    this.scene.add(object);
  }

  private createProfile(points: readonly [number, number][], depth: number, material: MeshStandardMaterial): Mesh {
    const shape = new Shape();
    const [first, ...rest] = points;
    if (!first) {
      throw new Error("A profile needs at least one point.");
    }
    shape.moveTo(...first);
    rest.forEach((point) => shape.lineTo(...point));
    shape.closePath();
    const geometry = new ExtrudeGeometry(shape, {
      depth,
      bevelEnabled: true,
      bevelSegments: 1,
      bevelSize: 2,
      bevelThickness: 2,
    });
    geometry.translate(0, 0, -depth / 2);
    return new Mesh(geometry, material);
  }
}

function createBilletGeometry(
  snapshot: ForgeSnapshotWorkpiece,
  hammerPreview: HammerInfluencePreview | null,
): BufferGeometry {
  const perimeterVertexCount = (snapshot.grid.widthBlocks + snapshot.grid.heightBlocks) * 2;
  const ringCount = snapshot.sections.length + 1;
  const positions: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];

  for (let ringIndex = 0; ringIndex < ringCount; ringIndex += 1) {
    const profile = workpiecePerimeter(snapshot, ringIndex);
    profile.points.forEach((point, pointIndex) => {
      positions.push(point.axialPosition, point.verticalOffset, point.lateralOffset);
      const preview = previewIntensityAtRingPoint(ringIndex, pointIndex, hammerPreview, snapshot.grid);
      const sectionIndex = Math.min(ringIndex, snapshot.sections.length - 1);
      const section = snapshot.sections[sectionIndex];
      const color = temperatureColor(temperatureAtPlane(snapshot.sections, ringIndex), preview)
        .lerp(materialColor(snapshot.carbon), 0.12)
        .lerp(new Color("#c9b58d"), Math.min(0.16, Math.max(0, snapshot.layerCount - 1) * 0.03));
      const tint = perimeterTint(pointIndex, snapshot.grid) * (1 - (section?.groundAmount ?? 0) * 0.12);
      colors.push(color.r * tint, color.g * tint, color.b * tint);
    });
  }

  for (let ringIndex = 0; ringIndex < ringCount - 1; ringIndex += 1) {
    const start = ringIndex * perimeterVertexCount;
    const end = (ringIndex + 1) * perimeterVertexCount;
    for (let pointIndex = 0; pointIndex < perimeterVertexCount; pointIndex += 1) {
      const nextPoint = (pointIndex + 1) % perimeterVertexCount;
      indices.push(start + pointIndex, end + pointIndex, end + nextPoint);
      indices.push(start + pointIndex, end + nextPoint, start + nextPoint);
    }
  }

  appendEndCap(positions, colors, indices, 0, perimeterVertexCount, false);
  appendEndCap(positions, colors, indices, (ringCount - 1) * perimeterVertexCount, perimeterVertexCount, true);

  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(new Float32Array(positions), 3));
  geometry.setAttribute("color", new BufferAttribute(new Float32Array(colors), 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function workpiecePerimeter(snapshot: ForgeSnapshotWorkpiece, axialIndex: number): { readonly points: readonly WorkpieceNode[] } {
  const points: WorkpieceNode[] = [];
  const grid = snapshot.grid;

  for (let boundary = 0; boundary < grid.widthBlocks; boundary += 1) {
    points.push(groundedNode(snapshot, axialIndex, boundary, grid.heightBlocks));
  }
  for (let boundary = grid.heightBlocks; boundary > 0; boundary -= 1) {
    points.push(groundedNode(snapshot, axialIndex, grid.widthBlocks, boundary));
  }
  for (let boundary = grid.widthBlocks; boundary > 0; boundary -= 1) {
    points.push(groundedNode(snapshot, axialIndex, boundary, 0));
  }
  for (let boundary = 0; boundary < grid.heightBlocks; boundary += 1) {
    points.push(groundedNode(snapshot, axialIndex, 0, boundary));
  }

  return { points };
}

function groundedNode(
  snapshot: ForgeSnapshotWorkpiece,
  axialIndex: number,
  widthIndex: number,
  heightIndex: number,
): WorkpieceNode {
  const node = workpieceNodeAt(snapshot, axialIndex, widthIndex, heightIndex);
  if (heightIndex !== snapshot.grid.heightBlocks) return node;
  const sectionIndex = Math.min(axialIndex, snapshot.sections.length - 1);
  const groundAmount = snapshot.sections[sectionIndex]?.groundAmount ?? 0;
  return { ...node, verticalOffset: node.verticalOffset - groundAmount * 1.6 };
}

function workpieceNodeAt(
  snapshot: ForgeSnapshotWorkpiece,
  axialIndex: number,
  widthIndex: number,
  heightIndex: number,
): WorkpieceNode {
  const planeSize = (snapshot.grid.widthBlocks + 1) * (snapshot.grid.heightBlocks + 1);
  const index = axialIndex * planeSize + heightIndex * (snapshot.grid.widthBlocks + 1) + widthIndex;
  const node = snapshot.nodes[index];
  if (!node || node.axialIndex !== axialIndex || node.widthIndex !== widthIndex || node.heightIndex !== heightIndex) {
    throw new Error(`Missing billet node ${axialIndex}:${widthIndex}:${heightIndex}.`);
  }
  return node;
}

function temperatureAtPlane(sections: readonly ForgeSnapshotSection[], axialIndex: number): number {
  const temperatures = [sections[axialIndex - 1]?.temperatureC, sections[axialIndex]?.temperatureC]
    .filter((value): value is number => value !== undefined);
  return average(temperatures);
}

function appendEndCap(
  positions: number[],
  colors: number[],
  indices: number[],
  ringStart: number,
  perimeterVertexCount: number,
  reverse: boolean,
): void {
  let y = 0;
  let z = 0;
  for (let index = 0; index < perimeterVertexCount; index += 1) {
    const offset = (ringStart + index) * 3;
    y += positions[offset + 1] ?? 0;
    z += positions[offset + 2] ?? 0;
  }
  const centerIndex = positions.length / 3;
  const x = positions[ringStart * 3] ?? 0;
  positions.push(x, y / perimeterVertexCount, z / perimeterVertexCount);
  colors.push(0.72, 0.42, 0.22);
  for (let index = 0; index < perimeterVertexCount; index += 1) {
    const next = (index + 1) % perimeterVertexCount;
    if (reverse) {
      indices.push(centerIndex, ringStart + index, ringStart + next);
    } else {
      indices.push(centerIndex, ringStart + next, ringStart + index);
    }
  }
}

function perimeterTint(pointIndex: number, grid: WorkpieceGrid): number {
  if (pointIndex < grid.widthBlocks) return 1.08;
  if (pointIndex < grid.widthBlocks + grid.heightBlocks) return 0.86;
  if (pointIndex < grid.widthBlocks * 2 + grid.heightBlocks) return 0.62;
  return 0.74;
}

function previewIntensityAtRingPoint(
  ringIndex: number,
  pointIndex: number,
  hammerPreview: HammerInfluencePreview | null,
  grid: WorkpieceGrid,
): number {
  if (hammerPreview === null) return 0;
  let intensity = 0;
  for (const influence of hammerPreview.samples) {
    if (!blockTouchesPerimeterPoint(influence.widthIndex, influence.heightIndex, pointIndex, grid)) {
      continue;
    }
    if (influence.sectionIndex === ringIndex || influence.sectionIndex === ringIndex - 1) {
      intensity = Math.max(intensity, influence.weight);
    }
  }
  return clamp(intensity, 0, 1);
}

function blockTouchesPerimeterPoint(
  widthIndex: number,
  heightIndex: number,
  pointIndex: number,
  grid: WorkpieceGrid,
): boolean {
  const topStart = 0;
  const rightStart = grid.widthBlocks;
  const bottomStart = grid.widthBlocks + grid.heightBlocks;
  const leftStart = grid.widthBlocks * 2 + grid.heightBlocks;
  if (pointIndex >= topStart && pointIndex < rightStart) {
    const boundary = pointIndex;
    return heightIndex === grid.heightBlocks - 1 && touchesBoundary(widthIndex, boundary);
  }
  if (pointIndex >= rightStart && pointIndex < bottomStart) {
    const boundary = grid.heightBlocks - (pointIndex - rightStart);
    return widthIndex === grid.widthBlocks - 1 && touchesBoundary(heightIndex, boundary);
  }
  if (pointIndex >= bottomStart && pointIndex < leftStart) {
    const boundary = grid.widthBlocks - (pointIndex - bottomStart);
    return heightIndex === 0 && touchesBoundary(widthIndex, boundary);
  }
  const boundary = pointIndex - leftStart;
  return widthIndex === 0 && touchesBoundary(heightIndex, boundary);
}

function touchesBoundary(index: number, boundary: number): boolean {
  return index === boundary || index === boundary - 1;
}

function average(values: readonly number[]): number {
  if (values.length === 0) {
    throw new Error("A billet surface boundary needs at least one block.");
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function temperatureColor(temperatureC: number, impact: number): Color {
  return thermalSteelAppearance(temperatureC).surface.lerp(new Color("#fff2ae"), impact * 0.75);
}

function materialColor(carbon: number): Color {
  return new Color().setHSL(0.08, 0.2, lerp(0.58, 0.34, clamp(carbon, 0, 1)));
}

function createArrowGeometry(direction: -1 | 1): ShapeGeometry {
  const shape = new Shape();
  const points: readonly [number, number][] = direction < 0
    ? [[-12, 0], [-1, -9], [-1, -4], [7, -4], [7, 4], [-1, 4], [-1, 9]]
    : [[12, 0], [1, -9], [1, -4], [-7, -4], [-7, 4], [1, 4], [1, 9]];
  const [first, ...rest] = points;
  if (!first) throw new Error("A rotate arrow needs at least one point.");
  shape.moveTo(first[0], first[1]);
  rest.forEach((point) => shape.lineTo(point[0], point[1]));
  shape.closePath();
  return new ShapeGeometry(shape);
}

function sectionIndexAt(position: number, sections: readonly ForgeSnapshotSection[]): number | null {
  const index = sections.findIndex(
    (section) => position >= section.position - section.length / 2 && position <= section.position + section.length / 2,
  );
  return index >= 0 ? index : null;
}

function inverseLerp(start: number, end: number, value: number): number {
  return end === start ? 0.5 : (value - start) / (end - start);
}

function lerp(start: number, end: number, amount: number): number {
  return start + (end - start) * amount;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
