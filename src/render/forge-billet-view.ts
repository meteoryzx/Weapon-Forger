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
import { QuenchEffects } from "./quench-effects.ts";
import { basinAsset, grindingAsset, powerHammerAsset, roomAsset, type StationAsset } from "./workshop-assets.ts";

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
import { MaterialsStationView, materialsCameraFrame, weldCameraFrame } from "./materials-station-view.ts";
import { SawStationView, SAW_ORIGIN, sawCameraFrame } from "./saw-station-view.ts";
import { CUT_HOME, CUT_TABLE, type CutPose } from "../app/cut-placement.ts";
import { FurnaceStationView, furnaceCameraFrame, FURNACE_ORIGIN, FURNACE } from "./furnace-station-view.ts";
import { HammerStationView, hammerCameraFrame, ANVIL } from "./hammer-station-view.ts";
import { HAMMER_HOME, hammerSurface, type HammerPose } from "../forge/index.ts";
import { QUENCH_SURFACE_Y, WORKSHOP_FLOOR_Y, WORKSHOP_SURFACE_Y, WORKSHOP_UNITS_PER_MM, WORKSHOP_STANDARD, WORKSHOP_LAYOUT, workshopUnits } from "../app/workshop-scale.ts";

const BILLET_SCALE = WORKSHOP_UNITS_PER_MM;
const ROTATE_CONTROL_SIZE = 32;
const WORKSTATION_YAW = Math.PI / 24;
const BILLET_YAW = Math.PI / 4;
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
  | "grind";

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
  temper: WORKSHOP_LAYOUT.furnace!.origin,
  grind: WORKSHOP_LAYOUT.grind!.origin,
};

const BILLET_ANCHORS: Record<Exclude<ForgeStation, "overview">, readonly [number, number, number]> = {
  materials: [WORKSHOP_LAYOUT.materials!.origin[0], WORKSHOP_SURFACE_Y, WORKSHOP_LAYOUT.materials!.origin[2]],
  furnace: [WORKSHOP_LAYOUT.furnace!.origin[0], FURNACE.hearth, WORKSHOP_LAYOUT.furnace!.origin[2]],
  anvil: [0, 0, 0],
  cut: [WORKSHOP_LAYOUT.cut!.origin[0], WORKSHOP_SURFACE_Y, WORKSHOP_LAYOUT.cut!.origin[2]],
  weld: [WORKSHOP_LAYOUT.materials!.origin[0]-20, WORKSHOP_SURFACE_Y, WORKSHOP_LAYOUT.materials!.origin[2]+16],
  "quench-water": [WORKSHOP_LAYOUT.quench!.origin[0], QUENCH_SURFACE_Y + 22, WORKSHOP_LAYOUT.quench!.origin[2]],
  "quench-oil": [WORKSHOP_LAYOUT["quench-oil"]!.origin[0], QUENCH_SURFACE_Y + 22, WORKSHOP_LAYOUT["quench-oil"]!.origin[2]],
  temper: [WORKSHOP_LAYOUT.furnace!.origin[0], WORKSHOP_SURFACE_Y, WORKSHOP_LAYOUT.furnace!.origin[2]+FURNACE.front],
  grind: [WORKSHOP_LAYOUT.grind!.origin[0], WORKSHOP_SURFACE_Y, WORKSHOP_LAYOUT.grind!.origin[2]+25],
};

export const CAMERA_FRAMES = {
  overview: { position: [0, 470, 550], target: [0, 25, -15] },
} as const;

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
  readonly hammerView: HammerStationView;
  private hammerPose:HammerPose=HAMMER_HOME;
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
  private readonly quenchBaseQuaternion = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), -Math.PI / 2);
  private readonly quenchXQuaternion = new Quaternion();
  private readonly quenchYQuaternion = new Quaternion();
  private snapshot: ForgeSnapshot | null = null;
  private readonly assetKit=new WorkshopModelKit();
  private readonly quenchEffects=new QuenchEffects();
  private readonly stationRoots=new Map<string,Group>();
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
    this.furnaceView = new FurnaceStationView(piece => createBilletGeometry(piece, null));
    this.temperControl=this.furnaceView.temperControl;
    this.scene.add(this.furnaceView.group);
    this.stationMeshes.set("furnace", this.furnaceView.target);
    this.sawView=new SawStationView(piece=>createBilletGeometry(piece,null));
    this.scene.add(this.sawView.group);
    this.materialsView=new MaterialsStationView(piece=>createBilletGeometry(piece,null));
    this.scene.add(this.materialsView.group);
    this.scene.add(roomAsset(this.assetKit));
    this.stationRoots.set("materials",this.materialsView.group);
    this.stationRoots.set("cut",this.sawView.group);
    this.stationRoots.set("furnace",this.furnaceView.body);

    this.hammerView=new HammerStationView();
    const anvil = this.hammerView.group;
    this.anvilModel = anvil;
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
    this.furnaceView.body.visible = activeStation === "furnace" || activeStation === "overview";
    this.hammerView.setActive(activeStation==="anvil"||activeStation==="overview");
    if(activeStation==="anvil"||activeStation==="overview"){
      this.hammerView.update(snapshot,this.hammerPose);
      this.hammerView.tool.visible=activeStation==="anvil";
      this.updateStationEmphasis(activeStation);this.render();return;
    }
    if (activeStation === "furnace" || activeStation === "temper") {
      this.furnaceView.update(snapshot);
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
    const nextGeometry = createBilletGeometry(snapshot, hammerPreview);
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
      this.billetRig.position.x += this.quenchOffset.x;
      this.billetRig.position.z += this.quenchOffset.z;
      this.billetRig.position.y += this.quenchVertical;
      // Player axes: x=right, y=inward (Three z), z=up (Three y).
      // The billet length is aligned with player y. Both rotations happen on
      // the centred rig: A/D around player x, wheel around player y (world z).
      this.quenchXQuaternion.setFromAxisAngle(new Vector3(1, 0, 0), this.quenchTilt);
      this.quenchYQuaternion.setFromAxisAngle(new Vector3(0, 0, 1), this.quenchYaw);
      this.billetRig.quaternion.copy(this.quenchBaseQuaternion)
        .premultiply(this.quenchXQuaternion)
        .premultiply(this.quenchYQuaternion);
    } else {
      this.quenchOffset.set(0, 0, 0);
      if (activeStation === "grind") {
        this.billetRig.position.x += this.grindOffset.x;
        this.billetRig.position.z += this.grindOffset.z;
        this.billetRig.rotation.set(0, BILLET_YAW + this.grindAngle, 0);
      } else this.billetRig.rotation.set(0, BILLET_YAW, 0);
    }
    this.updateWeldBenchItems(snapshot.bench, activeStation === "weld");
    this.updateStationEmphasis(activeStation);
    if(activeStation==="cut") this.sawView.update(snapshot,this.cutPose,this.cutValid);
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
    const hammerMoved=this.hammerView.tick(nowMs);
    const inQuench=this.station==="quench-water"||this.station==="quench-oil";
    const quenchMoved=inQuench?this.quenchEffects.update(nowMs,this.billetRig.position,this.quenchImmersion(),this.snapshot?.averageTemperatureC??20):this.quenchEffects.hide();
    if (!this.isTransitioning) {
      if (materialMoved || sawMoved || furnaceMoved || hammerMoved || quenchMoved) this.render();
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
  pickHammerSurface(x:number,y:number):{x:number;z:number}|null {
    // A ray exactly on a duplicated lattice edge can miss both triangles due
    // to floating point cancellation. Retry within one twentieth of a pixel.
    const hit=this.pickObject(x,y,[this.hammerView.item],false)
      ??this.pickObject(x+0.05,y,[this.hammerView.item],false)
      ??this.pickObject(x-0.05,y,[this.hammerView.item],false);
    return hit?{x:hit.point.x/ANVIL.scale,z:hit.point.z/ANVIL.scale}:null;
  }
  aimHammer(point:{x:number;z:number}|null,energy:number) {const hit=this.hammerView.setAim(point,energy);this.render();return hit;}

  pickStation(viewportX: number, viewportY: number): ForgeStation | null {
    const hit = this.pickObject(viewportX, viewportY, [...this.stationMeshes.entries()].filter(([station])=>station!=="weld").map(([,mesh])=>mesh), false);
    return (hit?.object.userData.station as ForgeStation | undefined) ?? null;
  }

  pickFurnace(x: number, y: number): boolean {
    return this.pickObject(x, y, [this.furnaceView.target, this.furnaceView.item], false) !== null;
  }

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
    if (this.snapshot && (this.station === "quench-water" || this.station === "quench-oil")) this.update(this.snapshot, null, this.station, this.temperPreviewC);
  }

  quenchPose(): { vertical: number; tilt: number; yaw: number } {
    return { vertical: this.quenchVertical, tilt: this.quenchTilt, yaw: this.quenchYaw };
  }

  grindTablePoint(x: number, y: number): { x: number; z: number } | null {
    this.pointer.set(x / this.viewport.width * 2 - 1, 1 - y / this.viewport.height * 2);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const point = this.raycaster.ray.intersectPlane(new Plane(new Vector3(0, 1, 0), -WORKSHOP_SURFACE_Y), new Vector3());
    return point ? { x: point.x, z: point.z } : null;
  }

  setGrindPose(offset: { x?: number; z?: number; angle?: number }): void {
    if (offset.x !== undefined) this.grindOffset.x = clamp(offset.x, -72, 72);
    if (offset.z !== undefined) this.grindOffset.z = clamp(offset.z, -96, 96);
    if (offset.angle !== undefined) this.grindAngle = offset.angle;
    if (this.snapshot && this.station === "grind") this.update(this.snapshot, null, "grind", this.temperPreviewC);
  }

  grindPose(): { x: number; z: number; angle: number } {
    return { x: this.grindOffset.x, z: this.grindOffset.z, angle: this.grindAngle };
  }

  quenchImmersion(): number {
    if(this.station!=="quench-water" && this.station!=="quench-oil")return 0;
    this.billetRig.updateMatrixWorld(true);
    const b=new Box3().setFromObject(this.billet),a=BILLET_ANCHORS[this.station];
    if(b.max.x<a[0]-28 || b.min.x>a[0]+28 || b.max.z<a[2]-30 || b.min.z>a[2]+30)return 0;
    return clamp((QUENCH_SURFACE_Y-b.min.y)/Math.max(0.001,b.max.y-b.min.y),0,1);
  }

  // Read-only browser diagnostics: tests still operate real pointer/keyboard inputs.
  inspectScene() {
    this.scene.updateMatrixWorld(true);this.camera.updateMatrixWorld(true);
    const project=(o:Object3D)=>{
      const world=new Box3().setFromObject(o).getCenter(new Vector3());
      const p=world.clone().project(this.camera);
      return {x:(p.x+1)*this.viewport.width/2,y:(1-p.y)*this.viewport.height/2,world:world.toArray()};
    };
    const points:Record<string,ReturnType<typeof project>>={billet:project(this.billet),hammer:project(this.hammerView.item),temper:project(this.temperControl)};
    for(const [name,object] of this.stationMeshes)points["station:"+name]=project(object);
    this.materialsView?.candidates.forEach(m=>points["material:"+m.userData.materialId]=project(m));
    this.materialsView?.tableItems.forEach((m,i)=>points["table:"+i]=project(m));
    this.materialsView?.rackItems.forEach((m,i)=>{points["returned:"+i]=project(m);points["returned:"+m.userData.workpieceId]=project(m);});
    this.weldBenchBillets.forEach((m,i)=>points["weld:"+i]=project(m));
    return {station:this.station,transitioning:this.isTransitioning,points,camera:{position:this.camera.position.toArray(),target:this.cameraTarget.toArray(),fov:this.camera.fov},
      renderer:{calls:this.renderer.info.render.calls,triangles:this.renderer.info.render.triangles,geometries:this.renderer.info.memory.geometries,textures:this.renderer.info.memory.textures},
      immersion:this.quenchImmersion()};
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
    this.quenchEffects.dispose();
    this.stationMeshes.delete("anvil");this.hammerView.dispose();
    this.stationMeshes.delete("furnace");
    this.furnaceView.dispose();
    this.sawView.dispose();
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
      ["grind",grindingAsset(k)],
    ];
    for(const [station,asset] of assets){
      asset.root.position.set(STATION_ANCHORS[station][0],station==="grind"?0:STATION_ANCHORS[station][1],STATION_ANCHORS[station][2]);
      if(station==="quench-water"||station==="quench-oil")asset.root.position.y=-30*(1-0.55);
      if(station==="grind")asset.root.rotation.y=-Math.PI/2;
      this.scene.add(asset.root);
      this.stationRoots.set(station,asset.root);
      if(asset.contact)this.quenchTargets.set(station as QuenchStation,asset.contact);
    }
    const power=powerHammerAsset(k);
    power.root.position.set(...WORKSHOP_LAYOUT.power!.origin);this.scene.add(power.root);
    this.stationRoots.set("power",power.root);
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
    this.billetRig.visible=!["materials","cut","furnace","temper","anvil","overview"].includes(activeStation);
    // Every station has one persistent body. Only active workpieces and tools change visibility.
    if(this.materialsView)this.materialsView.group.visible=true;
    this.sawView.group.visible=true;this.sawView.setActive(activeStation==="cut");
    this.furnaceView.group.visible=true;this.furnaceView.body.visible=true;
    this.furnaceView.itemRig.visible=activeStation==="furnace"||activeStation==="temper";
    this.anvilModel.visible=true;
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
    if(station==="anvil")return hammerCameraFrame(this.camera.aspect);
    if (station === "furnace" || station === "temper") return furnaceCameraFrame(this.camera.aspect);
    if(station==="cut")return sawCameraFrame(this.camera.aspect);
    if (station === "materials") return materialsCameraFrame(this.materialsFocus, this.camera.aspect);
    if (station === "weld") return weldCameraFrame(this.camera.aspect);
    if (station === "overview") {
      const frame=CAMERA_FRAMES.overview;
      const target=new Vector3(...frame.target);
      const position=new Vector3(...frame.position).sub(target).multiplyScalar(Math.max(1,1.5/this.camera.aspect)).add(target);
      return {position:position.toArray(),target:frame.target};
    }
    const anchor=STATION_ANCHORS[station];
    const target=new Vector3(anchor[0],WORKSHOP_SURFACE_Y+5,anchor[2]);
    const distance=Math.max(1,1.2/this.camera.aspect);
    const offset=station==="grind"?new Vector3(-92,38,0):new Vector3(22,38,72);
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
  if (heightIndex !== snapshot.geometry.grid.heightBlocks) return node;
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
