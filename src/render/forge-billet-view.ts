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
  Plane,
  Matrix4,
  Quaternion,
  ACESFilmicToneMapping, PCFShadowMap, PMREMGenerator, Box3,
} from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { WorkshopModelKit } from "./workshop-model-kit.ts";
import { PowerHammerWorkpiece } from "./power-hammer-workpiece.ts";
import { POWER_HAMMER } from "./power-hammer-model.ts";
import { ForgePressWorkpiece } from "./forge-press-workpiece.ts";
import { FORGE_PRESS } from "./forge-press-model.ts";
import { QuenchEffects } from "./quench-effects.ts";
import { basinAsset, forgingPressAsset, powerHammerAsset, roomAsset, ROOM_INTERIOR, type PoweredForgingAsset, type StationAsset } from "./workshop-assets.ts";
import { GRINDER, GrinderModel } from "./grinder-model.ts";

import {
  FORGE_RULES,
  type ForgeSnapshot,
  type ForgeSnapshotSection,
  type ForgeSnapshotWorkpiece,
  type GrindOperation,
  type HammerInfluencePreview,
  type WorkpieceGrid,
  type WorkpieceNode,
} from "../forge/index.ts";
import { thermalSteelAppearance } from "./thermal-color.ts";
import { MaterialsStationView, materialsCameraFrame, weldCameraFrame } from "./materials-station-view.ts";
import { SawStationView, SAW_ORIGIN, sawCameraFrame } from "./saw-station-view.ts";
import { CUT_HOME, CUT_TABLE, type CutPose } from "../app/cut-placement.ts";
import { FurnaceStationView, furnaceCameraFrame, temperCameraFrame, FURNACE_ORIGIN, TEMPER_FURNACE_ORIGIN, FURNACE } from "./furnace-station-view.ts";
import { HammerStationView, hammerCameraFrame, ANVIL, HAMMER_PRESENTATION_YAW } from "./hammer-station-view.ts";
import { HAMMER_HOME, hammerSurface, hammerFrame, placedHammerSurface, type HammerPose } from "../forge/index.ts";
import { GRINDER_STATION_YAW, QUENCH_SURFACE_Y, WORKSHOP_FLOOR_Y, WORKSHOP_SURFACE_Y, WORKSHOP_UNITS_PER_MM, WORKSHOP_STANDARD, WORKSHOP_LAYOUT, POWER_STATION_YAW, PRESS_STATION_YAW, stationPoseToWorldDelta, worldDeltaToStationPose, workshopUnits } from "../app/workshop-scale.ts";

const BILLET_SCALE = WORKSHOP_UNITS_PER_MM;
const ROTATE_CONTROL_SIZE = 32;
const WORKSTATION_YAW = Math.PI / 24;
const BILLET_YAW = Math.PI / 4;
// The operator's horizontal view direction in the two close-up machine
// cameras. It is converted into each machine's local frame below so W/S keeps
// meaning feed in/out even though the stations face opposite room walls.
const POWERED_SCREEN_INWARD_WORLD = { x: 52, z: -7 } as const;
const BILLET_CENTER_OFFSET = FORGE_RULES.workpieceLength * BILLET_SCALE / 2;
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
  | "grind"
  | "power"
  | "press";
export type InspectionView = "default" | "front" | "side" | "top" | "machine";

export type ForgeMaterialPick = "mild-steel" | "high-carbon-steel" | "spring-steel";

export type QuenchStation = "quench-water" | "quench-oil";

const STATION_ANCHORS: Record<Exclude<ForgeStation, "overview">, readonly [number, number, number]> = {
  materials: WORKSHOP_LAYOUT.materials!.origin,
  furnace: WORKSHOP_LAYOUT.furnace!.origin,
  anvil: WORKSHOP_LAYOUT.anvil!.origin,
  cut: WORKSHOP_LAYOUT.cut!.origin,
  weld: WORKSHOP_LAYOUT.materials!.origin,
  "quench-water": WORKSHOP_LAYOUT.quench!.origin,
  "quench-oil": WORKSHOP_LAYOUT["quench-oil"]!.origin,
  temper: WORKSHOP_LAYOUT.temper!.origin,
  grind: WORKSHOP_LAYOUT.grind!.origin,
  power: WORKSHOP_LAYOUT.power!.origin,
  press: WORKSHOP_LAYOUT.press!.origin,
};

const BILLET_ANCHORS: Record<Exclude<ForgeStation, "overview">, readonly [number, number, number]> = {
  materials: [WORKSHOP_LAYOUT.materials!.origin[0], WORKSHOP_SURFACE_Y, WORKSHOP_LAYOUT.materials!.origin[2]],
  furnace: [WORKSHOP_LAYOUT.furnace!.origin[0], FURNACE.hearth, WORKSHOP_LAYOUT.furnace!.origin[2]],
  anvil: [...WORKSHOP_LAYOUT.anvil!.origin],
  cut: [WORKSHOP_LAYOUT.cut!.origin[0], WORKSHOP_SURFACE_Y, WORKSHOP_LAYOUT.cut!.origin[2]],
  weld: [WORKSHOP_LAYOUT.materials!.origin[0]-20, WORKSHOP_SURFACE_Y, WORKSHOP_LAYOUT.materials!.origin[2]+16],
  "quench-water": [WORKSHOP_LAYOUT.quench!.origin[0], QUENCH_SURFACE_Y + 22, WORKSHOP_LAYOUT.quench!.origin[2]],
  "quench-oil": [WORKSHOP_LAYOUT["quench-oil"]!.origin[0], QUENCH_SURFACE_Y + 22, WORKSHOP_LAYOUT["quench-oil"]!.origin[2]],
  temper: [WORKSHOP_LAYOUT.temper!.origin[0], FURNACE.hearth, WORKSHOP_LAYOUT.temper!.origin[2]],
  grind: (() => { const d=stationPoseToWorldDelta(workshopUnits(GRINDER.frontX),0,GRINDER_STATION_YAW); return [WORKSHOP_LAYOUT.grind!.origin[0]+d.x,WORKSHOP_FLOOR_Y+workshopUnits(GRINDER.restY),WORKSHOP_LAYOUT.grind!.origin[2]+d.z]; })(),
  power: (() => { const d=stationPoseToWorldDelta(0,workshopUnits(POWER_HAMMER.dieZ),POWER_STATION_YAW); return [WORKSHOP_LAYOUT.power!.origin[0]+d.x,WORKSHOP_SURFACE_Y,WORKSHOP_LAYOUT.power!.origin[2]+d.z]; })(),
  press: (() => { const d=stationPoseToWorldDelta(0,workshopUnits(FORGE_PRESS.dieZ),PRESS_STATION_YAW); return [WORKSHOP_LAYOUT.press!.origin[0]+d.x,WORKSHOP_FLOOR_Y+workshopUnits(FORGE_PRESS.surfaceY),WORKSHOP_LAYOUT.press!.origin[2]+d.z]; })(),
};

export const CAMERA_FRAMES = {
  // A near-vertical plan view keeps the whole U-shaped workshop in one
  // frame, so station placement can be checked without a foreground machine
  // hiding the rear furnaces or the lower grinder.
  overview: { position: [0, 640, 30], target: [0, 0, -30] },
} as const;

function inspectionCameraFrame(target: Vector3, view: InspectionView, distance: number): { readonly position: readonly number[]; readonly target: readonly number[] } {
  const span = workshopUnits(360) * distance;
  const position = view === "front"
    ? target.clone().add(new Vector3(-span, 0, 0))
    : view === "side"
      ? target.clone().add(new Vector3(0, 0, span))
      : target.clone().add(new Vector3(0, span, 0));
  return { position: position.toArray(), target: target.toArray() };
}

export class ForgeBilletView {
  private readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly camera = new PerspectiveCamera(WORKSHOP_STANDARD.camera.fov, 1, 0.1, 8000);
  private readonly raycaster = new Raycaster();
  private readonly pointer = new Vector2();
  // The camera is the worker's eye line; the billet spins inside the fixed anvil station.
  private readonly billetRig = new Group();
  private readonly billet = new Mesh(new BufferGeometry(), BILLET_MATERIAL);
  private readonly weldBenchRigs: Group[] = [];
  private readonly weldBenchBillets: Mesh[] = [];
  private readonly weldBenchItemTargets: Mesh[] = [];
  private readonly billetHitTarget = new Mesh(
    new BoxGeometry(FORGE_RULES.workpieceLength * BILLET_SCALE, 24 * BILLET_SCALE, FORGE_RULES.initialSectionWidth * BILLET_SCALE),
    new MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }),
  );
  private readonly anvilModel: Group;
  private readonly stationMeshes = new Map<ForgeStation, Mesh>();
  private readonly materialMeshes = new Map<ForgeMaterialPick, Mesh>();
  private readonly stationProps = new Map<ForgeStation, Object3D[]>();
  private readonly stationBounds = new Map<string, Box3>();
  private readonly scaleReference = new Group();
  private readonly weldBenchTarget = new Mesh(
    new BoxGeometry(118, 10, 38),
    new MeshStandardMaterial({ color: "#876d53", metalness: 0.65, roughness: 0.38 }),
  );
  private readonly quenchTargets = new Map<QuenchStation, Mesh>();
  private readonly rotateControls: { readonly direction: -1 | 1; readonly group: Group }[] = [];
  private readonly temperControl:Mesh<BufferGeometry,MeshStandardMaterial>;
  private readonly cameraFromPosition = new Vector3();
  private readonly cameraFromTarget = new Vector3();
  private readonly cameraToPosition = new Vector3();
  private readonly cameraToTarget = new Vector3();
  private readonly cameraTarget = new Vector3();
  private station: ForgeStation = "overview";
  private materialsView: MaterialsStationView | null = null;
  private readonly sawView: SawStationView;
  private readonly furnaceView: FurnaceStationView;
  private readonly temperFurnaceView: FurnaceStationView;
  readonly hammerView: HammerStationView;
  private hammerPose:HammerPose=HAMMER_HOME;
  private poweredPose:HammerPose=HAMMER_HOME;
  private poweredPoseDirty = false;
  private poweredGapMm: number | null = null;
  readonly powerWorkpiece=new PowerHammerWorkpiece();
  readonly pressWorkpiece=new ForgePressWorkpiece();
  get activePoweredWorkpiece():PowerHammerWorkpiece { return this.station==="press"?this.pressWorkpiece:this.powerWorkpiece; }
  private cutPose: CutPose = CUT_HOME;
  private cutValid: boolean | null = null;
  private materialsFocus: "table" | "rack" = "table";
  private transitionStartedAtMs = 0;
  private isTransitioning = false;
  private temperPreviewC: number | null = null;
  private quenchOffset = new Vector3();
  private quenchVertical = 0;
  private quenchTilt = 0;
  private quenchYaw = 0;
  private grindOffset = new Vector3();
  private grindAngle = 0;
  private grindYaw = 0;
  private grindRoll = 0;
  // Start clear of the belt. Positive feed moves the workpiece toward the
  // calibrated belt plane; W advances it and S retracts it.
  // After the 180 degree station turn the operator stands on +X; positive
  // clearance keeps the billet on that side of the belt until W feeds it in.
  private grindFeed = workshopUnits(40);
  private grindWorkpieceId: string | null = null;
  private readonly grindCenter = new Vector3();
  private preparedGrindMesh: BufferGeometry | null = null;

  prepareGrindMesh(positions:Float32Array,colors:Float32Array):void {
    this.preparedGrindMesh?.dispose();
    const mesh=new BufferGeometry();
    mesh.setAttribute("position",new BufferAttribute(positions,3));mesh.setAttribute("color",new BufferAttribute(colors,3));
    mesh.computeVertexNormals();this.preparedGrindMesh=mesh;
  }
  private quenchPoseDirty = false;
  private lastQuenchRenderMs = 0;
  private lastQuenchEffectRenderMs = 0;
  private quenchImmersionCache = 0;
  private quenchImmersionCacheMs = -Infinity;
  private grindPoseDirty = false;
  private lastGrindRenderMs = 0;
  private inspectionView: InspectionView = "default";
  private readonly quenchBaseQuaternion = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), -Math.PI / 2);
  private readonly quenchXQuaternion = new Quaternion();
  private readonly quenchYQuaternion = new Quaternion();
  private snapshot: ForgeSnapshot | null = null;
  private readonly assetKit=new WorkshopModelKit();
  private readonly quenchEffects=new QuenchEffects();
  private readonly stationRoots=new Map<string,Group>();
  private readonly grinderModel = new GrinderModel("material");
  private powerAsset: PoweredForgingAsset | null = null;
  private pressAsset: PoweredForgingAsset | null = null;
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
    this.scene.background = new Color("#303936");
    this.renderer.toneMapping=ACESFilmicToneMapping;this.renderer.toneMappingExposure=1.05;
    this.renderer.shadowMap.enabled=true;this.renderer.shadowMap.type=PCFShadowMap;
    const environment=new RoomEnvironment(),pmrem=new PMREMGenerator(this.renderer);
    this.scene.environment=pmrem.fromScene(environment,0.04).texture;
    environment.dispose();pmrem.dispose();this.scene.environmentIntensity=0.55;
    this.scene.add(new AmbientLight("#d8e1dd", 0.65));

    const keyLight = new DirectionalLight("#e7eee7", 2.6);
    keyLight.position.set(-260, 360, 140);keyLight.castShadow=true;
    keyLight.shadow.mapSize.set(2048,2048);keyLight.shadow.camera.left=-380;keyLight.shadow.camera.right=380;
    keyLight.shadow.camera.top=380;keyLight.shadow.camera.bottom=-380;keyLight.shadow.camera.far=1100;
    keyLight.shadow.bias=-0.0006;keyLight.shadow.normalBias=0.35;
    this.scene.add(keyLight);
    const rimLight = new DirectionalLight("#c3d8dc", 0.6);
    rimLight.position.set(280, 180, 220);
    this.scene.add(rimLight);
    const workLight=new DirectionalLight("#ead9bd",0.5);
    workLight.position.set(-550,280,560);this.scene.add(workLight);
    this.scene.add(this.camera);
    this.createStationModels();
    this.createScaleReference();
    this.furnaceView = new FurnaceStationView(piece => createBilletGeometry(piece, null), FURNACE_ORIGIN, "heating-station");
    this.temperFurnaceView = new FurnaceStationView(piece => createBilletGeometry(piece, null), TEMPER_FURNACE_ORIGIN, "tempering-station", "temper");
    this.temperControl=this.temperFurnaceView.temperControl;
    this.scene.add(this.furnaceView.group);
    this.scene.add(this.temperFurnaceView.group);
    this.stationMeshes.set("furnace", this.furnaceView.target);
    this.stationMeshes.set("temper", this.temperFurnaceView.target);
    this.sawView=new SawStationView(piece=>createBilletGeometry(piece,null));
    this.scene.add(this.sawView.group);
    this.materialsView=new MaterialsStationView(piece=>createBilletGeometry(piece,null));
    this.scene.add(this.materialsView.group);
    this.scene.add(roomAsset(this.assetKit));
    this.stationRoots.set("materials",this.materialsView.group);
    this.stationRoots.set("cut",this.sawView.group);
    this.stationRoots.set("furnace",this.furnaceView.body);
    this.stationRoots.set("temper",this.temperFurnaceView.body);

    this.hammerView=new HammerStationView();
    const anvil = this.hammerView.group;
    this.anvilModel = anvil;
    anvil.position.set(...WORKSHOP_LAYOUT.anvil!.origin);
    // User-space x+ is right, y+ is inward, z+ is up. In Three.js this is a
    // positive yaw around world Y, so the top view reads counter-clockwise.
    this.stationMeshes.set("anvil",this.hammerView.target);
    this.scene.add(anvil);
    this.stationRoots.set("anvil",anvil);
    this.scene.add(this.scaleReference);
    this.billet.scale.setScalar(BILLET_SCALE);
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
    this.scene.add(this.quenchEffects.group);
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
    // Calibration geometry is an authoring aid, not part of the playable overview.
    this.scaleReference.visible = false;
    this.temperPreviewC = temperPreviewC;
    // Overview is a real room view: show each authored station body once.
    // The active station gets its moving workpiece; overview keeps the room
    // readable without duplicating the operation item.
    this.furnaceView.itemRig.visible = activeStation === "furnace";
    this.temperFurnaceView.itemRig.visible = activeStation === "temper";
    this.furnaceView.body.visible = true;
    this.temperFurnaceView.body.visible = true;
    this.hammerView.setActive(activeStation==="anvil"||activeStation==="overview");
    this.powerWorkpiece.group.visible=activeStation==="power";
    this.pressWorkpiece.group.visible=activeStation==="press";
    this.renderer.shadowMap.enabled = activeStation!=="power" && activeStation!=="press";
    if(activeStation==="power"||activeStation==="press"){
      this.activePoweredWorkpiece.update(snapshot,this.poweredPose);
      this.poweredPoseDirty = false;
      this.updateStationEmphasis(activeStation);this.render();return;
    }
    if(activeStation==="anvil"||activeStation==="overview"){
      if (activeStation === "anvil") this.hammerView.update(snapshot,this.hammerPose);
      this.hammerView.tool.visible=activeStation==="anvil";
      this.updateStationEmphasis(activeStation);this.render();return;
    }
    if (activeStation === "furnace" || activeStation === "temper") {
      const activeFurnace=activeStation==="temper"?this.temperFurnaceView:this.furnaceView;
      activeFurnace.update(snapshot);
      this.temperControl.rotation.z=((temperPreviewC??snapshot.temperTemperatureC??220)-220)/160;
      this.updateStationEmphasis(activeStation);
      this.render();
      return;
    }
    const appearance = thermalSteelAppearance(snapshot.averageTemperatureC);
    BILLET_MATERIAL.emissive.copy(appearance.emissive);
    BILLET_MATERIAL.emissiveIntensity = appearance.emissiveIntensity;
    this.billet.rotation.set(snapshot.orientationQuarterTurns * Math.PI / 2,0,0);
    const anchor = BILLET_ANCHORS[activeStation];
    this.billetRig.position.set(...anchor);
    this.temperControl.rotation.z = ((this.temperPreviewC ?? 220) - 220) / 160;
    const nextGeometry = this.preparedGrindMesh ?? createBilletGeometry(snapshot, hammerPreview);
    this.preparedGrindMesh=null;
    this.billet.geometry.dispose();
    this.billet.geometry = nextGeometry;
    nextGeometry.computeBoundingBox();
    const bounds=nextGeometry.boundingBox!.clone().applyMatrix4(new Matrix4().makeRotationX(this.billet.rotation.x));
    const center=bounds.getCenter(new Vector3()),size=bounds.getSize(new Vector3());
    this.billet.position.set(-center.x*BILLET_SCALE,-bounds.min.y*BILLET_SCALE,-center.z*BILLET_SCALE);
    this.billetHitTarget.rotation.set(0,0,0);
    this.billetHitTarget.geometry.dispose();
    this.billetHitTarget.geometry=new BoxGeometry(size.x*BILLET_SCALE,Math.max(size.y * BILLET_SCALE,12 * BILLET_SCALE),size.z * BILLET_SCALE);
    this.billetHitTarget.position.set(0,size.y*BILLET_SCALE/2,0);
    if (activeStation === "quench-water" || activeStation === "quench-oil") {
      this.applyQuenchPose();
    } else {
      this.quenchOffset.set(0, 0, 0);
      if (activeStation === "grind") {
        if (this.grindWorkpieceId !== snapshot.workpieceId) {
          this.grindWorkpieceId = snapshot.workpieceId;
          this.grindCenter.copy(center);
        }
        this.billet.position.copy(this.grindCenter).multiplyScalar(-BILLET_SCALE);
        this.billetHitTarget.position.y = 0;
        this.applyGrindTransform();
      } else this.billetRig.rotation.set(0, BILLET_YAW, 0);
    }
    this.updateWeldBenchItems(snapshot.bench, activeStation === "weld");
    this.updateStationEmphasis(activeStation);
    if(activeStation==="cut") this.sawView.update(snapshot,this.cutPose,this.cutValid);
    this.render();
  }

  /** Refresh quench heat feedback without rebuilding the workpiece mesh. */
  refreshQuenchThermal(snapshot: ForgeSnapshot): void {
    this.snapshot = snapshot;
    const appearance = thermalSteelAppearance(snapshot.averageTemperatureC);
    BILLET_MATERIAL.emissive.copy(appearance.emissive);
    BILLET_MATERIAL.emissiveIntensity = appearance.emissiveIntensity;
    this.render();
  }

  private createScaleReference(): void {
    const steel = new MeshStandardMaterial({ color: "#d6a04c", metalness: 0.55, roughness: 0.42 });
    const marker = new MeshStandardMaterial({ color: "#c6d0d4", metalness: 0.15, roughness: 0.8 });
    const wood = new MeshStandardMaterial({ color: "#8b6548", roughness: 0.9 });
    const at = new Group();
    at.position.set(-120, -30, 250);
    const box = (size: [number, number, number], position: [number, number, number], material: MeshStandardMaterial) => {
      const mesh = new Mesh(new BoxGeometry(...size), material);
      mesh.position.set(...position); at.add(mesh); return mesh;
    };
    const surfaceY = workshopUnits(WORKSHOP_STANDARD.workSurfaceHeightMm) - 30;
    box([workshopUnits(800), 12, workshopUnits(800)], [0, surfaceY - 6, 0], wood);
    box([workshopUnits(336), workshopUnits(8), workshopUnits(48)], [0, surfaceY + workshopUnits(4), 0], steel);
    // A simple human silhouette gives the author a stable eye-height and reach reference.
    box([workshopUnits(360), workshopUnits(1500), workshopUnits(260)], [workshopUnits(420), workshopUnits(750) - 30, workshopUnits(180)], marker);
    const head = new Mesh(new CylinderGeometry(workshopUnits(105), workshopUnits(105), workshopUnits(210), 16), marker);
    head.position.set(workshopUnits(420), workshopUnits(1650) - 30, workshopUnits(180)); at.add(head);
    const rulerX = workshopUnits(80);
    box([workshopUnits(18), workshopUnits(1750), workshopUnits(18)], [rulerX, workshopUnits(875) - 30, workshopUnits(-180)], marker);
    for (let mm = 0; mm <= 1750; mm += 250) box([workshopUnits(70), 4, workshopUnits(24)], [rulerX, workshopUnits(mm) - 30, workshopUnits(-180)], steel);
    this.scaleReference.add(at);
    this.scaleReference.visible = false;
  }

  setStation(station: ForgeStation, nowMs = performance.now()): void {
    if (station === this.station && !this.isTransitioning) return;
    const leavingQuench = station === "overview"
      && (this.station === "quench-water" || this.station === "quench-oil");
    if (station === "quench-water" || station === "quench-oil") {
      this.quenchOffset.set(0, 0, 0);
      this.quenchVertical = 0;
      this.quenchTilt = 0;
      this.quenchYaw = 0;
    }
    this.station = station;
    this.cameraFromPosition.copy(this.camera.position);
    this.cameraFromTarget.copy(this.cameraTarget);
    const frame = this.cameraFrame(station);
    this.cameraToPosition.fromArray(frame.position);
    this.cameraToTarget.fromArray(frame.target);
    if (leavingQuench) {
      this.isTransitioning = false;
      this.applyCameraFrame(station);
      return;
    }
    this.transitionStartedAtMs = nowMs;
    this.isTransitioning = true;
  }

  isCameraTransitioning(): boolean {
    return this.isTransitioning;
  }

  tick(nowMs: number): void {
    const materialMoved = this.materialsView?.tick(nowMs) ?? false;
    const sawMoved=this.sawView.tick(nowMs);
    const furnaceMoved = this.furnaceView.tick(nowMs);
    const temperFurnaceMoved = this.temperFurnaceView.tick(nowMs);
    const hammerMoved=this.hammerView.tick(nowMs);
    this.grinderModel.tick(nowMs / 1000);
    const inQuench=this.station==="quench-water"||this.station==="quench-oil";
    // Decorative steam/ripples are deferred from the current acceptance gate.
    // Keep the effect object dormant so it cannot consume the interaction frame.
    const quenchMoved = this.quenchEffects.hide();
    let poweredMoved = false;
    if (
      this.poweredPoseDirty &&
      this.snapshot &&
      (this.station === "power" || this.station === "press")
    ) {
      // Keyboard and pointer placement can generate several pose changes in
      // one input turn. Apply only the latest pose on the next animation
      // frame so the event handler stays responsive while the mesh catches up.
      this.activePoweredWorkpiece.update(this.snapshot, this.poweredPose);
      this.poweredPoseDirty = false;
      poweredMoved = true;
    }
    if (!this.isTransitioning) {
      const grindRenderReady = this.station === "grind"
        && this.grindPoseDirty
        && nowMs - this.lastGrindRenderMs >= 16;
      const quenchRenderReady = this.station !== "quench-water" && this.station !== "quench-oil"
        ? false
        : this.quenchPoseDirty && nowMs - this.lastQuenchRenderMs >= 500;
      if (materialMoved || sawMoved || furnaceMoved || temperFurnaceMoved || hammerMoved || poweredMoved || quenchMoved || quenchRenderReady || grindRenderReady || this.station === "grind") {
        this.quenchPoseDirty = false;
        if (this.station === "quench-water" || this.station === "quench-oil") this.lastQuenchRenderMs = nowMs;
        if (this.station === "quench-water" || this.station === "quench-oil") this.lastQuenchEffectRenderMs = nowMs;
        this.grindPoseDirty = false;
        if (this.station === "grind") this.lastGrindRenderMs = nowMs;
        this.render();
      }
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

  setPoweredPose(pose:HammerPose,refresh=true):void {
    if(pose.x===this.poweredPose.x&&pose.z===this.poweredPose.z&&pose.yaw===this.poweredPose.yaw&&pose.roll===this.poweredPose.roll)return;
    this.poweredPose={...pose};
    this.poweredPoseDirty = true;
    if(refresh&&this.snapshot&&(this.station==="power"||this.station==="press"))this.update(this.snapshot,null,this.station,this.temperPreviewC);
  }

  placePowerWorkpiece(pose:HammerPose):boolean {
    if(this.station!=="power"&&this.station!=="press")return false;
    if(!this.snapshot||!this.activePoweredWorkpiece.canPlace(this.snapshot,pose))return false;
    // Bound against the real wall and neighbouring station envelopes, not a UI slider.
    const localBounds=this.activePoweredWorkpiece.placementBounds(this.snapshot,pose);
    const bounds=new Box3();
    const stationYaw=this.station==="power"?POWER_STATION_YAW:PRESS_STATION_YAW;
    const anchor=new Vector3(...BILLET_ANCHORS[this.station]);
    for(const x of [localBounds.min.x,localBounds.max.x])
      for(const y of [localBounds.min.y,localBounds.max.y])
        for(const z of [localBounds.min.z,localBounds.max.z]) {
          const local=new Vector3(x*BILLET_SCALE,y*BILLET_SCALE+WORKSHOP_SURFACE_Y-BILLET_ANCHORS[this.station][1],z*BILLET_SCALE)
            .applyAxisAngle(new Vector3(0,1,0),stationYaw).add(anchor);
          bounds.expandByPoint(local);
        }
    if(bounds.max.x>=ROOM_INTERIOR.halfWidthX||bounds.min.x<=-ROOM_INTERIOR.halfWidthX||bounds.min.z<=ROOM_INTERIOR.backZ||bounds.min.y<WORKSHOP_FLOOR_Y)return false;
    for(const [station,root] of this.stationRoots) {
      if(station===this.station)continue;
      let stationBounds=this.stationBounds.get(station);
      if(!stationBounds){
        stationBounds=new Box3().setFromObject(root);
        this.stationBounds.set(station,stationBounds);
      }
      if(bounds.intersectsBox(stationBounds))return false;
    }
    this.setPoweredPose(pose,false);return true;
  }

  setPowerGap(mm:number):void {
    if(!this.powerAsset)return;
    const next=Math.round(Math.max(0,Math.min(120,mm))/6)*6;
    if(this.poweredGapMm===next)return;
    this.poweredGapMm=next;
    this.powerAsset.ram.position.y=this.powerAsset.closedRamY+workshopUnits(next);this.render();
  }

  powerTablePoint(x:number,y:number):{x:number;z:number}|null {
    if(this.station!=="power"&&this.station!=="press")return null;
    const p=this.hammerTablePoint(x,y);
    if(!p)return null;
    const anchor=BILLET_ANCHORS[this.station];
    const yaw=this.station==="power"?POWER_STATION_YAW:PRESS_STATION_YAW;
    const delta=worldDeltaToStationPose(
      (p.x-anchor[0])/BILLET_SCALE,
      (p.z-anchor[2])/BILLET_SCALE,
      yaw,
    );
    return delta;
  }

  pickPowerWorkpiece(x:number,y:number):boolean {
    return this.pickObject(x,y,[this.activePoweredWorkpiece.item],false)!==null;
  }

  setPressGap(mm:number):void {
    if(!this.pressAsset)return;
    const clamped=Math.max(0,Math.min(120,Number.isFinite(mm)?mm:0));
    const next=Math.round(clamped/6)*6;
    if(this.poweredGapMm===next)return;
    this.poweredGapMm=next;
    this.pressAsset.ram.position.y=this.pressAsset.closedRamY+workshopUnits(next);this.render();
  }

  resize(viewport: RenderViewport): void {
    this.viewport = viewport;
    this.renderer.setPixelRatio(Math.min(viewport.pixelRatio, 2));
    this.renderer.setSize(viewport.width, viewport.height, false);
    this.camera.aspect = viewport.width / viewport.height;
    if (!this.isTransitioning) this.applyCameraFrame(this.station);
    else {
      const frame=this.cameraFrame(this.station);
      this.cameraToPosition.fromArray(frame.position);this.cameraToTarget.fromArray(frame.target);
    }
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

  updateHammerPose(pose:HammerPose):void {
    this.hammerPose=pose;if(this.snapshot)this.hammerView.update(this.snapshot,pose);this.render();
  }
  hammerTablePoint(x:number,y:number):{x:number;z:number}|null {
    this.pointer.set(x/this.viewport.width*2-1,1-y/this.viewport.height*2);this.raycaster.setFromCamera(this.pointer,this.camera);
    const p=this.raycaster.ray.intersectPlane(new Plane(new Vector3(0,1,0),-ANVIL.surface),new Vector3());
    return p?{x:p.x/ANVIL.scale,z:p.z/ANVIL.scale}:null;
  }
  private anvilDisplayPointToLogical(point:{x:number;z:number}):{x:number;z:number} {
    const dx=point.x-this.hammerPose.x,dz=point.z-this.hammerPose.z;
    const c=Math.cos(HAMMER_PRESENTATION_YAW),s=Math.sin(HAMMER_PRESENTATION_YAW);
    return {x:this.hammerPose.x+c*dx-s*dz,z:this.hammerPose.z+s*dx+c*dz};
  }
  private anvilLogicalPointToDisplay(point:{x:number;z:number}):{x:number;z:number} {
    const dx=point.x-this.hammerPose.x,dz=point.z-this.hammerPose.z;
    const c=Math.cos(HAMMER_PRESENTATION_YAW),s=Math.sin(HAMMER_PRESENTATION_YAW);
    return {x:this.hammerPose.x+c*dx+s*dz,z:this.hammerPose.z-s*dx+c*dz};
  }
  pickHammerSurface(x:number,y:number):{x:number;z:number}|null {
    // A ray exactly on a duplicated lattice edge can miss both triangles due
    // to floating point cancellation. Retry within one twentieth of a pixel.
    const hit=this.pickObject(x,y,[this.hammerView.item],false)
      ??this.pickObject(x+0.05,y,[this.hammerView.item],false)
      ??this.pickObject(x-0.05,y,[this.hammerView.item],false);
    if (hit) {
      const local=this.hammerView.group.worldToLocal(hit.point.clone());
      return this.anvilDisplayPointToLogical({x:local.x/ANVIL.scale,z:local.z/ANVIL.scale});
    }
    // The close-up camera can place the projected center on a shared lattice
    // edge. Fall back to the actual billet footprint on the anvil plane.
    const tablePoint = this.hammerTablePoint(x, y);
    if (tablePoint) {
      // hammerTablePoint returns world-space millimetres because powered
      // stations share it for their table picking. Convert the fallback ray
      // into the rotated anvil's local frame before testing the billet.
      const world = new Vector3(tablePoint.x * ANVIL.scale, ANVIL.surface, tablePoint.z * ANVIL.scale);
      const local = this.hammerView.group.worldToLocal(world);
      const logical=this.anvilDisplayPointToLogical({x:local.x/ANVIL.scale,z:local.z/ANVIL.scale});
      tablePoint.x=logical.x;tablePoint.z=logical.z;
    }
    if (tablePoint
      && Math.abs(tablePoint.x - this.hammerPose.x) <= FORGE_RULES.workpieceLength / 2
      && Math.abs(tablePoint.z - this.hammerPose.z) <= FORGE_RULES.initialSectionWidth * 0.75) {
      return tablePoint;
    }
    // Keep the center of the close-up canvas forgiving when the billet's
    // projected center is a few pixels above the viewport midpoint.
    const center = new Box3().setFromObject(this.hammerView.item).getCenter(new Vector3()).project(this.camera);
    const centerX = (center.x + 1) * this.viewport.width / 2;
    const centerY = (1 - center.y) * this.viewport.height / 2;
    if (Math.hypot(x - centerX, y - centerY) <= 28) {
      return { x: this.hammerPose.x, z: this.hammerPose.z };
    }
    return null;
  }
  aimHammer(point:{x:number;z:number}|null,energy:number) {const hit=this.hammerView.setAim(point,energy);this.render();return hit;}

  pickStation(viewportX: number, viewportY: number): ForgeStation | null {
    const hit = this.pickObject(viewportX, viewportY, [...this.stationMeshes.entries()].filter(([station])=>station!=="weld").map(([,mesh])=>mesh), false);
    return (hit?.object.userData.station as ForgeStation | undefined) ?? null;
  }

  pickFurnace(x: number, y: number): boolean {
    const active=this.station==="temper"?this.temperFurnaceView:this.furnaceView;
    return this.pickObject(x, y, [active.target, active.item], false) !== null;
  }

  setTemperInsertionOffset(offsetZ: number): void {
    this.temperFurnaceView.setManualOffset(offsetZ);
    if (this.snapshot && this.station === "temper") {
      this.temperFurnaceView.update(this.snapshot);
      this.render();
    }
  }

  setFurnaceInsertionOffset(offsetZ: number): void {
    this.furnaceView.setManualOffset(offsetZ);
    if (this.snapshot && this.station === "furnace") {
      this.furnaceView.update(this.snapshot);
      this.render();
    }
  }

  // The tempering furnace is serviced from the aisle on its left, so a
  // screen-right drag pulls the workpiece toward the viewer instead of pushing
  // it into the chamber. Heating keeps the opposite sign because its camera
  // looks in from the right.
  dragTemperInsertion(startOffset: number, deltaX: number): void {
    this.setTemperInsertionOffset(startOffset + deltaX * 0.35);
  }

  furnaceInsertionOffset(): number { return this.furnaceView.manualOffset(); }
  furnaceInsertionComplete(): boolean { return this.furnaceView.isFullyInside(); }
  furnaceInsertionOutside(): boolean { return this.furnaceView.isFullyOutside(); }

  temperInsertionOffset(): number { return this.temperFurnaceView.manualOffset(); }
  temperInsertionComplete(): boolean { return this.temperFurnaceView.isFullyInside(); }
  temperInsertionOutside(): boolean { return this.temperFurnaceView.isFullyOutside(); }

  clearTemperInsertionOffset(): void { this.temperFurnaceView.clearManualOffset(); }

  updateCut(pose: CutPose, valid: boolean | null, trayPage = 0): void {
    this.cutPose=pose; this.cutValid=valid;
    if(!this.snapshot || this.station!=="cut")return;
    this.sawView.update(this.snapshot,pose,valid);
    this.sawView.updateTray(this.snapshot.bench,trayPage);
    this.render();
  }

  cutTablePoint(x: number,y: number): {x:number;z:number}|null {
    this.pointer.set(x/this.viewport.width*2-1,1-y/this.viewport.height*2);
    this.raycaster.setFromCamera(this.pointer,this.camera);
    const point=this.raycaster.ray.intersectPlane(new Plane(new Vector3(0,1,0),-CUT_TABLE.surface),new Vector3());
    if (!point) return null;
    const local = this.sawView.group.worldToLocal(point);
    return { x: local.x, z: local.z };
  }
  pickCutPiece(x:number,y:number): string|null {
    const hit=this.pickObject(x,y,[this.sawView.item,...this.sawView.tray.children],false);
    return hit ? hit.object===this.sawView.item ? this.snapshot?.workpieceId ?? null : hit.object.userData.workpieceId as string : null;
  }
  animateCut(): void {this.sawView.beginCut(performance.now());}
  isSawBusy(): boolean {return this.sawView.busy;}

  pickMaterial(viewportX: number, viewportY: number): ForgeMaterialPick | null {
    const meshes = this.station === "materials" ? this.materialsView?.candidates ?? [] : [...this.materialMeshes.values()];
    const hit = this.pickObject(viewportX, viewportY, meshes, false);
    return (hit?.object.userData.materialId as ForgeMaterialPick | undefined) ?? null;
  }

  updateMaterials(
    candidateId: string | null,
    pieces: readonly ForgeSnapshotWorkpiece[],
    activeWorkpieceId: string | null = null,
    tableWorkpieceIds: readonly string[] = [],
  ): void {
    if (!this.materialsView) {
      this.materialsView = new MaterialsStationView((piece) => createBilletGeometry(piece, null));
      this.scene.add(this.materialsView.group);
    }
    this.materialsView.update(candidateId, pieces, activeWorkpieceId, tableWorkpieceIds);
    this.materialsView.group.visible = true;
    this.render();
  }

  setMaterialsFocus(focus: "table" | "rack"): void {
    this.materialsFocus = focus;
    this.materialsView?.setFocus(focus);
  }

  pickMaterialsRack(x: number, y: number): boolean {
    return this.materialsView !== null && this.pickObject(x, y, [this.materialsView.rack], true) !== null;
  }

  pickRackWorkpiece(x: number, y: number): string | null {
    const hit = this.pickObject(x, y, this.materialsView?.rackItems ?? [], false);
    return (hit?.object.userData.workpieceId as string | undefined) ?? null;
  }

  pickMaterialsTableWorkpiece(x: number, y: number): string | null {
    const hit = this.pickObject(x, y, this.materialsView?.tableItems ?? [], false);
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

  quenchTablePoint(x: number, y: number): { x: number; z: number } | null {
    this.pointer.set(x / this.viewport.width * 2 - 1, 1 - y / this.viewport.height * 2);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const point = this.raycaster.ray.intersectPlane(new Plane(new Vector3(0, 1, 0), -QUENCH_SURFACE_Y), new Vector3());
    return point ? { x: point.x, z: point.z } : null;
  }

  updateQuenchPosition(point: { x: number; z: number }, station: QuenchStation): void {
    const anchor = BILLET_ANCHORS[station];
    this.quenchOffset.set(
      Math.max(-70, Math.min(70, point.x - anchor[0])),
      0,
      Math.max(-95, Math.min(85, point.z - anchor[2])),
    );
    if (this.snapshot) this.update(this.snapshot, null, station, this.temperPreviewC);
  }

  quenchOffsetFor(_station: QuenchStation): { x: number; z: number } {
    return { x: this.quenchOffset.x, z: this.quenchOffset.z };
  }

  setQuenchPose(pose: { vertical?: number; tilt?: number; yaw?: number }): void {
    if (pose.vertical !== undefined) this.quenchVertical = Math.max(-60, Math.min(60, pose.vertical));
    if (pose.tilt !== undefined) this.quenchTilt = pose.tilt;
    if (pose.yaw !== undefined) this.quenchYaw = pose.yaw;
    if (this.snapshot && (this.station === "quench-water" || this.station === "quench-oil")) {
      this.applyQuenchPose();
      this.quenchPoseDirty = true;
    }
  }

  private applyQuenchPose(): void {
    if (!this.snapshot || (this.station !== "quench-water" && this.station !== "quench-oil")) return;
    const anchor = BILLET_ANCHORS[this.station];
    this.billetRig.position.set(...anchor);
    this.billetRig.position.x += this.quenchOffset.x;
    this.billetRig.position.z += this.quenchOffset.z;
    this.billetRig.position.y += this.quenchVertical;
    // Player axes: x=right, y=inward (Three z), z=up (Three y).
    this.quenchXQuaternion.setFromAxisAngle(new Vector3(1, 0, 0), this.quenchTilt);
    this.quenchYQuaternion.setFromAxisAngle(new Vector3(0, 0, 1), this.quenchYaw);
    this.billetRig.quaternion.copy(this.quenchBaseQuaternion)
      .premultiply(this.quenchXQuaternion)
      .premultiply(this.quenchYQuaternion);
  }

  quenchPose(): { vertical: number; tilt: number; yaw: number } {
    return { vertical: this.quenchVertical, tilt: this.quenchTilt, yaw: this.quenchYaw };
  }

  grindTablePoint(x: number, y: number): { x: number; z: number } | null {
    this.pointer.set(x / this.viewport.width * 2 - 1, 1 - y / this.viewport.height * 2);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const faceX = BILLET_ANCHORS.grind[0];
    const point = this.raycaster.ray.intersectPlane(new Plane(new Vector3(1, 0, 0), -faceX), new Vector3());
    return point ? { x: point.y, z: -point.z } : null;
  }

  setInspectionView(view: InspectionView): void {
    this.inspectionView = view;
    this.cameraFromPosition.copy(this.camera.position);
    this.cameraFromTarget.copy(this.cameraTarget);
    const frame = this.cameraFrame(this.station);
    this.cameraToPosition.fromArray(frame.position);
    this.cameraToTarget.fromArray(frame.target);
    this.transitionStartedAtMs = performance.now();
    this.isTransitioning = true;
  }

  inspectionViewMode(): InspectionView { return this.inspectionView; }

  /** Horizontal feed direction seen by the operator at the active machine. */
  hammerFeedVector(): { x: number; z: number } {
    const yaw=this.hammerPose.yaw+HAMMER_PRESENTATION_YAW;
    return {x:Math.cos(yaw),z:-Math.sin(yaw)};
  }

  operationFeedVector(): { x: number; z: number } {
    // W/S follows the operator's screen-depth direction. Convert that world
    // direction back into station-local coordinates because the two machines
    // face opposite walls; this keeps the keyboard path and rendered billet on
    // the same physical feed axis.
    if (this.station === "power" || this.station === "press") {
      const stationYaw = this.station === "power" ? POWER_STATION_YAW : PRESS_STATION_YAW;
      const length = Math.hypot(POWERED_SCREEN_INWARD_WORLD.x, POWERED_SCREEN_INWARD_WORLD.z) || 1;
      const direction = worldDeltaToStationPose(
        POWERED_SCREEN_INWARD_WORLD.x / length,
        POWERED_SCREEN_INWARD_WORLD.z / length,
        stationYaw,
      );
      const localLength = Math.hypot(direction.x, direction.z) || 1;
      return { x: direction.x / localLength, z: direction.z / localLength };
    }
    const x=this.cameraTarget.x-this.camera.position.x, z=this.cameraTarget.z-this.camera.position.z;
    const length=Math.hypot(x,z)||1;
    return {x:x/length,z:z/length};
  }

  isInspectionActive(): boolean { return this.inspectionView !== "default"; }

  setGrindPose(offset: { x?: number; z?: number; angle?: number; yaw?: number; roll?: number; feed?: number }): void {
    if (offset.x !== undefined) this.grindOffset.x = clamp(offset.x, 0, workshopUnits(200));
    if (offset.z !== undefined) this.grindOffset.z = clamp(offset.z, -workshopUnits(350), workshopUnits(350));
    if (offset.angle !== undefined) this.grindAngle = Math.atan2(Math.sin(offset.angle), Math.cos(offset.angle));
    if (offset.yaw !== undefined) this.grindYaw = Math.atan2(Math.sin(offset.yaw), Math.cos(offset.yaw));
    if (offset.roll !== undefined) this.grindRoll = Math.atan2(Math.sin(offset.roll), Math.cos(offset.roll));
    if (offset.feed !== undefined) this.grindFeed = clamp(offset.feed, 0, workshopUnits(120));
    if (this.snapshot && this.station === "grind") {
      this.applyGrindTransform();
      this.grindPoseDirty = true;
    }
  }

  private applyGrindTransform(): void {
    const anchor = BILLET_ANCHORS.grind;
    this.billetRig.position.set(...anchor);
    this.billetRig.position.z -= this.grindOffset.z;
    this.billetRig.rotation.set(0, Math.PI / 2 + GRINDER_STATION_YAW, 0);
    // Rotate the workpiece and its operator axes with the station.
    this.billetRig.rotateOnWorldAxis(new Vector3(0,0,-1),this.grindAngle);
    this.billetRig.rotateOnWorldAxis(new Vector3(-1,0,0),this.grindYaw);
    this.billetRig.rotateOnWorldAxis(new Vector3(0,1,0),this.grindRoll);
    this.billetRig.updateMatrixWorld(true);
    const localBounds=this.billet.geometry.boundingBox;
    if(!localBounds)return;
    // The actual mesh support is essential after an oblique bevel: a rotated
    // bounding box contains empty corners which must not hold it off the belt.
    const vertices=this.billet.geometry.getAttribute("position"),p=new Vector3();
    let minY=Infinity,minX=Infinity,minContactX=Infinity;
    for(let i=0;i<vertices.count;i++){
      p.fromBufferAttribute(vertices,i).applyMatrix4(this.billet.matrixWorld);
      minY=Math.min(minY,p.y);minX=Math.min(minX,p.x);
      if(Math.abs(p.z-STATION_ANCHORS.grind[2])<workshopUnits(GRINDER.beltWidth/2)-1e-5)minContactX=Math.min(minContactX,p.x);
    }
    this.billetRig.position.y += anchor[1] - minY + this.grindOffset.x;
    this.billetRig.position.x += anchor[0] - (Number.isFinite(minContactX)?minContactX:minX) + this.grindFeed;
  }

  grindPose(): { x: number; z: number; angle: number; yaw: number; roll: number; feed: number } {
    return { x: this.grindOffset.x, z: this.grindOffset.z, angle: this.grindAngle, yaw: this.grindYaw, roll: this.grindRoll, feed: this.grindFeed };
  }

  grindContactTarget(): HammerPickTarget | null {
    if (this.station !== "grind" || !this.snapshot || this.grindFeed > workshopUnits(0.25)) return null;
    const bounds = this.worldBilletBounds();
    const beltX = BILLET_ANCHORS.grind[0];
    if (bounds.max.x < beltX - workshopUnits(0.3) || bounds.min.x > beltX + workshopUnits(0.3)
      || bounds.max.y < WORKSHOP_FLOOR_Y + workshopUnits(GRINDER.lowerY)
      || bounds.min.y > WORKSHOP_FLOOR_Y + workshopUnits(GRINDER.upperY)
      || bounds.max.z < STATION_ANCHORS.grind[2]-workshopUnits(GRINDER.beltWidth/2)
      || bounds.min.z > STATION_ANCHORS.grind[2]+workshopUnits(GRINDER.beltWidth/2)) return null;
    return { sectionIndex: Math.floor(this.snapshot.sections.length / 2), faceBias: 1 };
  }

  grindContactPatch(): NonNullable<GrindOperation["contact"]> | null {
    if (this.station !== "grind" || !this.snapshot || this.grindFeed > workshopUnits(0.25)) return null;
    if (!this.grindContactTarget()) return null;
    const inverse=this.billet.matrixWorld.clone().invert();
    const origin=new Vector3(BILLET_ANCHORS.grind[0],WORKSHOP_FLOOR_Y+workshopUnits((GRINDER.lowerY+GRINDER.upperY)/2),STATION_ANCHORS.grind[2]).applyMatrix4(inverse);
    const normal=new Vector3(-1,0,0).transformDirection(inverse);
    const across=new Vector3(0,0,-1).transformDirection(inverse);
    const down=new Vector3(0,-1,0).transformDirection(inverse);
    const point=(p:Vector3)=>({x:p.x,y:p.y,z:p.z});
    return { axialPosition: origin.x, verticalOffset: origin.y, axialWidth: GRINDER.beltWidth, verticalHeight: GRINDER.upperY-GRINDER.lowerY,
      depth: 4, frame:{origin:point(origin),normal:point(normal),across:point(across),down:point(down),width:GRINDER.beltWidth,height:GRINDER.upperY-GRINDER.lowerY} };
  }

  private worldBilletBounds(): Box3 {
    this.billet.updateWorldMatrix(true, false);
    const localBounds = this.billet.geometry.boundingBox;
    return localBounds ? localBounds.clone().applyMatrix4(this.billet.matrixWorld) : new Box3();
  }

  quenchImmersion(nowMs = Number.POSITIVE_INFINITY): number {
    if(this.station!=="quench-water" && this.station!=="quench-oil")return 0;
    if (Number.isFinite(nowMs) && nowMs - this.quenchImmersionCacheMs < 100) return this.quenchImmersionCache;
    this.billetRig.updateMatrixWorld(true);
    const localBounds=this.billet.geometry.boundingBox;
    if(!localBounds)return 0;
    const b=localBounds.clone().applyMatrix4(this.billet.matrixWorld),a=BILLET_ANCHORS[this.station];
    if(b.max.x<a[0]-28 || b.min.x>a[0]+28 || b.max.z<a[2]-30 || b.min.z>a[2]+30)return 0;
    const immersion = clamp((QUENCH_SURFACE_Y-b.min.y)/Math.max(0.001,b.max.y-b.min.y),0,1);
    this.quenchImmersionCache = immersion;
    this.quenchImmersionCacheMs = nowMs;
    return immersion;
  }

  // Read-only browser diagnostics: tests still operate real pointer/keyboard inputs.
  inspectScene(motionOnly=false) {
    if(motionOnly)return {toolY:this.hammerView.tool.position.y};
    this.scene.updateMatrixWorld(true);this.camera.updateMatrixWorld(true);
    const projectWorld=(world:Vector3)=>{
      const p=world.clone().project(this.camera);
      return {x:(p.x+1)*this.viewport.width/2,y:(1-p.y)*this.viewport.height/2,world:world.toArray()};
    };
    const project=(o:Object3D,useBounds=false)=>{
      const world=useBounds
        ? new Box3().setFromObject(o).getCenter(new Vector3())
        : new Vector3().setFromMatrixPosition(o.matrixWorld);
      return projectWorld(world);
    };
    const inspectedBillet = this.station === "power" || this.station === "press" ? this.activePoweredWorkpiece.item : this.station === "anvil"
      ? this.hammerView.item
      : this.station === "furnace"
        ? this.furnaceView.item
        : this.station === "temper"
          ? this.temperFurnaceView.item
        : this.billet;
    const points:Record<string,ReturnType<typeof project>>={billet:project(inspectedBillet,true),hammer:project(this.hammerView.item,true),temper:project(this.temperControl)};
    const axisHalfLength = FORGE_RULES.workpieceLength * BILLET_SCALE / 2;
    const axisPose = this.station === "anvil" ? this.hammerPose : this.poweredPose;
    const axisYaw = this.station === "anvil" ? HAMMER_PRESENTATION_YAW : this.station === "power" ? POWER_STATION_YAW : this.station === "press" ? PRESS_STATION_YAW : 0;
    const axisAnchor = this.station === "anvil" ? BILLET_ANCHORS.anvil : BILLET_ANCHORS[this.station as "power" | "press"];
    const axisDirection = { x: Math.cos(axisPose.yaw) * axisHalfLength, z: -Math.sin(axisPose.yaw) * axisHalfLength };
    const axisWorld = (sign: number) => {
      const local = stationPoseToWorldDelta(sign * axisDirection.x, sign * axisDirection.z, axisYaw);
      return projectWorld(new Vector3(axisAnchor[0] + local.x, axisAnchor[1] + 0.32, axisAnchor[2] + local.z));
    };
    const workpieceAxis = this.station === "anvil" || this.station === "power" || this.station === "press"
      ? { start: axisWorld(-1), end: axisWorld(1) }
      : null;
    if(this.station==="anvil")for(const [x,z] of [[0,0],[100,0],[105,0],[105,18],[105,-18],[0,58],[105,58]] as const){
      const contact=this.hammerView.contact(x,z);
      const displayPoint=this.anvilLogicalPointToDisplay({x,z});
      const point=new Vector3(displayPoint.x*ANVIL.scale,ANVIL.surface+(contact?.point.y??8)*ANVIL.scale,displayPoint.z*ANVIL.scale);
      const projected=projectWorld(this.hammerView.group.localToWorld(point));
      points[`hammer:${x}:${z}`]=projected;
      if(z===0)points[`hammer:${x}`]=projected;
    }
    for(const [name,object] of this.stationMeshes)points["station:"+name]=project(object);
    this.materialsView?.candidates.forEach(m=>points["material:"+m.userData.materialId]=project(m));
    this.materialsView?.tableItems.forEach((m,i)=>points["table:"+i]=project(m));
    this.materialsView?.rackItems.forEach((m,i)=>{points["returned:"+i]=project(m);points["returned:"+m.userData.workpieceId]=project(m);});
    this.weldBenchBillets.forEach((m,i)=>points["weld:"+i]=project(m));
    return {station:this.station,transitioning:this.isTransitioning,points,workpieceAxis,camera:{position:this.camera.position.toArray(),target:this.cameraTarget.toArray(),fov:this.camera.fov},
      renderer:{calls:this.renderer.info.render.calls,triangles:this.renderer.info.render.triangles,geometries:this.renderer.info.memory.geometries,textures:this.renderer.info.memory.textures},
      immersion:this.quenchImmersion(),
      power:this.station==="power"?{pose:this.poweredPose,contact:this.powerWorkpiece.contact,contactHeight:this.powerWorkpiece.contactHeight,
        gapMm:((this.powerAsset?.ram.position.y??0)-(this.powerAsset?.closedRamY??0))/BILLET_SCALE,previewVertices:this.powerWorkpiece.preview.geometry.getAttribute("position")?.count??0,
        previewVisible:this.powerWorkpiece.preview.visible,bounds:new Box3().setFromObject(this.powerWorkpiece.item)}:null,
      press:this.station==="press"?{pose:this.poweredPose,contact:this.pressWorkpiece.contact,contactHeight:this.pressWorkpiece.contactHeight,
        gapMm:((this.pressAsset?.ram.position.y??0)-(this.pressAsset?.closedRamY??0))/BILLET_SCALE,previewVertices:this.pressWorkpiece.preview.geometry.getAttribute("position")?.count??0,
        previewVisible:this.pressWorkpiece.preview.visible,bounds:new Box3().setFromObject(this.pressWorkpiece.item)}:null,
      hammer:this.station==="anvil"&&this.snapshot?{
        busy:this.hammerView.busy,
        tailSections:[0.7,0.85,1].map(fraction=>{
          const g=this.snapshot!.geometry,ring=(g.grid.widthBlocks+1)*(g.grid.heightBlocks+1);
          const index=Math.round((g.nodes.length/ring-1)*fraction);
          const widthProfile=Array.from({length:g.grid.widthBlocks+1},(_,width)=>{
            const node=g.nodes[index*ring+Math.floor(g.grid.heightBlocks/2)*(g.grid.widthBlocks+1)+width]!;
            return {x:node.axialPosition,y:node.verticalOffset,z:node.lateralOffset};
          });
          const points=[widthProfile[0]!,widthProfile[Math.floor(g.grid.widthBlocks/2)]!,widthProfile.at(-1)!];
          return {points,widthProfile,cup:(points[0]!.y+points[2]!.y)/2-points[1]!.y};
        }),
        toolY:this.hammerView.tool.position.y,
        bounds:new Box3().setFromObject(this.hammerView.item),
        contactProbes:([[0,0],[100,0],[105,0],[0,58],[105,58]] as const).map(([x,z])=>({x,z,contact:this.hammerView.contact(x,z)})),
        aim:this.hammerView.aimContact,
        supportedMinY:this.snapshot.geometry.nodes.reduce((min,n)=>{
          const p=this.hammerView.item.localToWorld(new Vector3(n.axialPosition,n.verticalOffset,n.lateralOffset));
          return Math.abs(p.x)<=FORGE_RULES.anvilFaceLength*ANVIL.scale/2&&Math.abs(p.z)<=FORGE_RULES.anvilFaceWidth*ANVIL.scale/2?Math.min(min,p.y):min;
        },Infinity),
        midPlanes:[0.1,0.5,0.9].map(fraction=>{
          const g=this.snapshot!.geometry,ring=(g.grid.widthBlocks+1)*(g.grid.heightBlocks+1);
          const index=Math.round((g.nodes.length/ring-1)*fraction);
          const ys=g.nodes.slice(index*ring,(index+1)*ring).map(n=>n.verticalOffset);
          return (Math.min(...ys)+Math.max(...ys))/2;
        }),
        overhangMidPlanes:[0.1,0.5,0.9].map(fraction=>{
          const g=this.snapshot!.geometry,ring=(g.grid.widthBlocks+1)*(g.grid.heightBlocks+1);
          const index=Math.round((g.nodes.length/ring-1)*fraction);
          const ys=g.nodes.slice(index*ring,(index+1)*ring).filter(n=>n.lateralOffset>12).map(n=>n.verticalOffset);
          return ys.length?(Math.min(...ys)+Math.max(...ys))/2:null;
        }),
      }:null,
      grind:this.station==="grind"?{pose:this.grindPose(),contact:this.grindContactTarget(),frame:this.grindContactPatch()?.frame,metrics:this.snapshot?.grindMetrics,
        billetBounds:new Box3().setFromObject(this.billet),restY:BILLET_ANCHORS.grind[1],frontX:BILLET_ANCHORS.grind[0],model:this.grinderModel.root.name,solids:this.snapshot?.geometry.solids?.length ?? 0,grid:this.snapshot?.geometry.grid,vertices:this.billet.geometry.getAttribute("position").count}:null};
  }

  pickTemperControl(viewportX: number, viewportY: number): boolean {
    return this.pickObject(viewportX, viewportY, [this.temperControl], false) !== null;
  }

  pickHammerTarget(viewportX: number, viewportY: number): HammerPickTarget | null {
    if (!this.snapshot) {
      return null;
    }
    const pickMesh = this.station === "anvil" ? this.hammerView.item : this.billet;
    const hit = this.pickObject(viewportX, viewportY, [pickMesh, this.billetHitTarget], false);
    if (!hit) {
      return null;
    }

    const localPoint = pickMesh.worldToLocal(hit.point.clone());
    const sectionIndex = sectionIndexAt(localPoint.x, this.snapshot.sections)
      ?? (this.station === "grind" ? Math.floor(this.snapshot.sections.length / 2) : null);
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
    this.temperControl.rotation.z = (this.temperPreviewC - 220) / 160;
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
    this.powerWorkpiece.dispose();
    this.pressWorkpiece.dispose();
    this.quenchEffects.dispose();
    this.stationMeshes.delete("anvil");this.hammerView.dispose();
    this.stationMeshes.delete("furnace");
    this.furnaceView.dispose();
    this.stationMeshes.delete("temper");
    this.temperFurnaceView.dispose();
    this.sawView.dispose();
    this.materialsView?.dispose();
    this.grinderModel.dispose();
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
    const displayScale = BILLET_SCALE;
    const displayLength = rawLengths.map((length) => length * displayScale);
    const slotPositions = [-24, 24] as const;
    bench.forEach((workpiece, index) => {
      const rig = this.weldBenchRigs[index];
      const billet = this.weldBenchBillets[index];
      const target = this.weldBenchItemTargets[index];
      if (!rig || !billet || !target) return;
      const rawLength = rawLengths[index] ?? 24;
      const length = displayLength[index] ?? 24;
      billet.geometry.dispose();
      billet.geometry = createBilletGeometry(workpiece, null);
      billet.scale.setScalar(displayScale);
      billet.position.set(-rawLength * displayScale / 2, FORGE_RULES.initialSectionThickness * displayScale / 2, 0);
      if(workpiece.geometry.solids){
        billet.geometry.computeBoundingBox();const bounds=billet.geometry.boundingBox!;
        billet.position.set(-(bounds.min.x+bounds.max.x)/2*displayScale,-bounds.min.y*displayScale,-(bounds.min.z+bounds.max.z)/2*displayScale);
      }
      target.geometry.dispose();
      target.geometry = new BoxGeometry(length, 24 * displayScale, FORGE_RULES.initialSectionWidth * displayScale * 0.72);
      target.position.set(0, FORGE_RULES.initialSectionThickness * displayScale / 2, 0);
      target.userData.weldBenchIndex = index;
      rig.position.set(
        STATION_ANCHORS.weld[0] + 22 + index*18,
        WORKSHOP_SURFACE_Y,
        STATION_ANCHORS.weld[2]+16,
      );
      rig.visible = visible;
    });
    for (let index = bench.length; index < this.weldBenchRigs.length; index += 1) {
      const rig = this.weldBenchRigs[index];
      if (rig) rig.visible = false;
    }
  }

  private createStationModels(): void {
    const k=this.assetKit;
    const assets: [Exclude<ForgeStation,"overview">,StationAsset][]=[
      ["quench-water",basinAsset(k,false)],["quench-oil",basinAsset(k,true)],
      ["grind",{root:this.grinderModel.root}],
    ];
    for(const [station,asset] of assets){
      asset.root.position.set(STATION_ANCHORS[station][0],station==="grind"?0:STATION_ANCHORS[station][1],STATION_ANCHORS[station][2]);
      if(station==="quench-water"||station==="quench-oil")asset.root.position.y=-30*(1-0.55);
      if(station==="grind")asset.root.rotation.y=GRINDER_STATION_YAW;
      // The grinder face is authored on local -X and, after the 180 degree
      // turn, is presented to the operator on world +X.
      this.scene.add(asset.root);
      this.stationRoots.set(station,asset.root);
      if(asset.contact)this.quenchTargets.set(station as QuenchStation,asset.contact);
    }
    const power=powerHammerAsset(k);
    power.root.position.set(...WORKSHOP_LAYOUT.power!.origin);this.scene.add(power.root);
    power.root.rotation.y=POWER_STATION_YAW;
    this.stationRoots.set("power",power.root);
    power.contact!.userData.station="power";
    this.stationMeshes.set("power",power.contact!);
    this.powerAsset=power;
    power.root.add(this.powerWorkpiece.group);
    const press=forgingPressAsset(k);
    press.root.position.set(...WORKSHOP_LAYOUT.press!.origin);this.scene.add(press.root);
    press.root.rotation.y=PRESS_STATION_YAW;
    this.stationRoots.set("press",press.root);
    press.contact!.userData.station="press";
    this.stationMeshes.set("press",press.contact!);
    this.pressAsset=press;
    press.root.add(this.pressWorkpiece.group);
    for(const station of ["materials","cut","weld","quench-water","quench-oil","grind"] as const){
      const definition=WORKSHOP_LAYOUT[station==="weld"?"materials":station==="quench-water"?"quench":station]!;
      const target=new Mesh(new BoxGeometry(definition.footprint[0],50,definition.footprint[1]),new MeshBasicMaterial({transparent:true,opacity:0,depthWrite:false}));
      target.position.set(definition.origin[0],15,definition.origin[2]);target.userData.station=station;
      this.stationMeshes.set(station,target);this.scene.add(target);
    }
    this.weldBenchTarget.position.set(...BILLET_ANCHORS.weld);
    this.weldBenchTarget.material.transparent=true;this.weldBenchTarget.material.opacity=0;
    this.weldBenchTarget.material.depthWrite=false;
  }

  private updateStationEmphasis(activeStation: ForgeStation): void {
    const poweredFocus = activeStation === "power" || activeStation === "press";
    const stationName: string = activeStation;
    this.billetRig.visible=!["materials","cut","furnace","temper","anvil","overview","power","press"].includes(activeStation);
    // Every station has one persistent body. Only active workpieces and tools change visibility.
    // The selection table is part of the continuous room and must remain
    // visible in the quench view; only obstructing tools are suppressed.
    // Close-up machine views do not need every other station's meshes. Keeping
    // both powered machines and all decorative station bodies alive doubled
    // the draw work on every keyboard update and made the input feel laggy.
    if(this.materialsView)this.materialsView.group.visible=!poweredFocus || stationName==="materials";
    this.sawView.group.visible=!poweredFocus || stationName==="cut";this.sawView.setActive(activeStation==="cut");
    this.furnaceView.group.visible=!poweredFocus || stationName==="furnace";this.furnaceView.body.visible=this.furnaceView.group.visible;
    this.furnaceView.itemRig.visible=activeStation==="furnace";
    this.temperFurnaceView.group.visible=!poweredFocus || stationName==="temper";this.temperFurnaceView.body.visible=this.temperFurnaceView.group.visible;
    this.temperFurnaceView.itemRig.visible=activeStation==="temper";
    this.anvilModel.visible=!poweredFocus;
    const power = this.stationRoots.get("power");
    if (power) power.visible = activeStation === "power";
    const press = this.stationRoots.get("press");
    if (press) press.visible = activeStation === "press";
    this.hammerView.setActive(activeStation==="anvil");
    for(const mesh of this.materialMeshes.values())mesh.visible=false;
  }

  private applyCameraFrame(station: ForgeStation): void {
    const frame = this.cameraFrame(station);
    this.camera.position.fromArray(frame.position);
    this.cameraTarget.fromArray(frame.target);
    this.camera.lookAt(this.cameraTarget);
  }

  private cameraFrame(station: ForgeStation) {
    if(station==="press"&&this.inspectionView==="machine"){
      const target=new Vector3(WORKSHOP_LAYOUT.press!.origin[0],WORKSHOP_FLOOR_Y+workshopUnits(950),WORKSHOP_LAYOUT.press!.origin[2]);
      const distance=Math.max(1,0.85/this.camera.aspect);
      return {position:target.clone().add(new Vector3(-85,55,225).multiplyScalar(distance)).toArray(),target:target.toArray()};
    }
    if(station==="power"&&this.inspectionView==="machine"){
      const target=new Vector3(WORKSHOP_LAYOUT.power!.origin[0],WORKSHOP_FLOOR_Y+workshopUnits(1090),WORKSHOP_LAYOUT.power!.origin[2]);
      const distance=Math.max(1,0.9/this.camera.aspect);
      // The hammer is turned 180 degrees. Approach from its +X side and look
      // toward the -X mouth so the machine front faces the player.
      return {position:target.clone().add(new Vector3(-220,140,-55).multiplyScalar(distance)).toArray(),target:target.toArray()};
    }
    // Inspection views are a shared camera mode. Every station gets the same
    // orthogonal framing around its active workpiece; the station-specific
    // camera remains the default operation view.
    if (station !== "overview" && this.inspectionView !== "default") {
      const anchor = BILLET_ANCHORS[station];
      const target = new Vector3(anchor[0], anchor[1], anchor[2]);
      if (station === "quench-water" || station === "quench-oil") target.y = QUENCH_SURFACE_Y + 4;
      else if (station === "furnace") target.y = FURNACE.hearth;
      else if (station === "grind") target.y += workshopUnits(38);
      else target.y = WORKSHOP_SURFACE_Y + 5;
      const distance = station === "quench-water" || station === "quench-oil"
        ? Math.max(1, 2.25 / this.camera.aspect)
        : station === "grind" ? Math.max(1, 0.46 / this.camera.aspect) : Math.max(1, 1.2 / this.camera.aspect);
      return inspectionCameraFrame(target, this.inspectionView, distance);
    }
    if(station==="anvil")return hammerCameraFrame(this.camera.aspect,WORKSHOP_LAYOUT.anvil!.origin);
    if (station === "furnace") return furnaceCameraFrame(this.camera.aspect, FURNACE_ORIGIN);
    if (station === "temper") return temperCameraFrame(this.camera.aspect);
    if(station==="cut")return sawCameraFrame(this.camera.aspect);
    if (station === "materials") return materialsCameraFrame(this.materialsFocus, this.camera.aspect);
    if (station === "weld") return weldCameraFrame(this.camera.aspect);
    if (station === "power") {
      const target=new Vector3(...BILLET_ANCHORS.power);
      target.y+=workshopUnits(24);
      const distance=Math.max(1,0.62/this.camera.aspect);
      // The hammer is turned 180 degrees. Approach from its +X side and look
      // toward the -X mouth so the machine front faces the player.
      return {position:target.clone().add(new Vector3(-52,20,7).multiplyScalar(distance)).toArray(),target:target.toArray()};
    }
    if (station === "press") {
      const target=new Vector3(...BILLET_ANCHORS.press);target.y+=workshopUnits(28);
      const distance=Math.max(1,0.62/this.camera.aspect);
      // Hydraulic press shares the +X operator/feed axis with the power
      // hammer while retaining its own lower-right station position.
      return {position:target.clone().add(new Vector3(-52,19,7).multiplyScalar(distance)).toArray(),target:target.toArray()};
    }
    if (station === "grind") {
      const target = new Vector3(BILLET_ANCHORS.grind[0], BILLET_ANCHORS.grind[1] + workshopUnits(38), BILLET_ANCHORS.grind[2]);
      const distance = Math.max(1, 0.46 / this.camera.aspect);
      return {position:target.clone().add(new Vector3(workshopUnits(350), workshopUnits(92), 0).multiplyScalar(distance)).toArray(),target:target.toArray()};
    }
    if (station === "quench-water" || station === "quench-oil") {
      const anchor = STATION_ANCHORS[station];
      const target = new Vector3(anchor[0], QUENCH_SURFACE_Y + 4, anchor[2]);
      const distance = Math.max(1, 2.25 / this.camera.aspect);
      // Approach from the opposite aisle so the reserved power hammer stays
      // behind the camera instead of occluding the basin.
      const offset = new Vector3(0, 82, 132).multiplyScalar(distance);
      return { position: target.clone().add(offset).toArray(), target: target.toArray() };
    }
    if (station === "overview") {
      const frame=CAMERA_FRAMES.overview;
      const target=new Vector3(...frame.target);
      const position=new Vector3(...frame.position).sub(target).multiplyScalar(Math.max(1,1.5/this.camera.aspect)).add(target);
      return {position:position.toArray(),target:frame.target};
    }
    const anchor=STATION_ANCHORS[station];
    const target=new Vector3(anchor[0],WORKSHOP_SURFACE_Y+5,anchor[2]);
    const distance=Math.max(1,1.2/this.camera.aspect);
    const offset=new Vector3(22,38,72);
    return {position:offset.multiplyScalar(distance).add(target).toArray(),target:target.toArray()};
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

export function createBilletGeometry(
  snapshot: ForgeSnapshotWorkpiece,
  hammerPreview: HammerInfluencePreview | null,
): BufferGeometry {
  // Render all lattice surface samples so an interior hammer depression stays
  // visible at the furnace, saw and material table as well as at the anvil.
  if (snapshot.geometry.solids || snapshot.sections.some(s=>s.plasticStrain>0)) {
    const positions: number[] = [], colors: number[] = [];
    const blocks = new Map(snapshot.sections.flatMap(section => section.blocks.map(block => [block.id, block] as const)));
    for (const face of hammerSurface(snapshot.geometry)) {
      const block = blocks.get(face.blockId);
      const color = temperatureColor(block?.temperatureC ?? 20, 0).lerp(materialColor(snapshot.carbon), 0.12);
      for (let index = 1; index + 1 < face.points.length; index++) {
        for (const point of [face.points[0]!, face.points[index]!, face.points[index + 1]!]) {
          positions.push(point.x, point.y, point.z);
          colors.push(color.r, color.g, color.b);
        }
      }
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new BufferAttribute(new Float32Array(positions), 3));
    geometry.setAttribute("color", new BufferAttribute(new Float32Array(colors), 3));
    geometry.computeVertexNormals();
    return geometry;
  }
  const perimeterVertexCount = (snapshot.geometry.grid.widthBlocks + snapshot.geometry.grid.heightBlocks) * 2;
  const ringCount = snapshot.sections.length + 1;
  const positions: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];

  for (let ringIndex = 0; ringIndex < ringCount; ringIndex += 1) {
    const profile = workpiecePerimeter(snapshot, ringIndex);
    profile.points.forEach((point, pointIndex) => {
      positions.push(point.axialPosition, point.verticalOffset, point.lateralOffset);
      const preview = previewIntensityAtRingPoint(ringIndex, pointIndex, hammerPreview, snapshot.geometry.grid);
      const sectionIndex = Math.min(ringIndex, snapshot.sections.length - 1);
      const section = snapshot.sections[sectionIndex];
      const color = temperatureColor(temperatureAtPlane(snapshot.sections, ringIndex), preview)
        .lerp(materialColor(snapshot.carbon), 0.12)
        .lerp(new Color("#c9b58d"), Math.min(0.16, Math.max(0, snapshot.layerCount - 1) * 0.03));
      const tint = perimeterTint(pointIndex, snapshot.geometry.grid) * (1 - (section?.groundAmount ?? 0) * 0.12);
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
  const grid = snapshot.geometry.grid;

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
  return node;
}

function workpieceNodeAt(
  snapshot: ForgeSnapshotWorkpiece,
  axialIndex: number,
  widthIndex: number,
  heightIndex: number,
): WorkpieceNode {
  const grid = snapshot.geometry.grid;
  const planeSize = (grid.widthBlocks + 1) * (grid.heightBlocks + 1);
  const index = axialIndex * planeSize + heightIndex * (grid.widthBlocks + 1) + widthIndex;
  const node = snapshot.geometry.nodes[index];
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
