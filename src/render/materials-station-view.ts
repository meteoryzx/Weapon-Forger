import {
  Box3, BoxGeometry, BufferGeometry, Group, Matrix4, Mesh, MeshBasicMaterial,
  MeshStandardMaterial, PointLight, Quaternion, Vector3,
} from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { FORGE_MATERIALS, FORGE_RULES, type ForgeSnapshotWorkpiece } from "../forge/index.ts";
import { thermalSteelAppearance } from "./thermal-color.ts";
import { WORKSHOP_SURFACE_Y, WORKSHOP_UNITS_PER_MM, WORKSHOP_LAYOUT } from "../app/workshop-scale.ts";
import { WorkshopModelKit } from "./workshop-model-kit.ts";

// Keep the selection area's accepted local arrangement; move the whole station
// to the workshop's back-left so its full-sized table does not envelop the forge.
export const MATERIALS_ORIGIN = new Vector3(...WORKSHOP_LAYOUT.materials!.origin);
export const MATERIALS_FRAMES = {
  table: { position: [0, 78, 276], target: [0, 48, 150] },
  rack: { position: [0, 98, 162], target: [0, 48, -8] },
} as const;

const TABLE_SURFACE_Y = WORKSHOP_SURFACE_Y;
const TABLE_ITEM_BASE_Y = TABLE_SURFACE_Y + 0.02;
export const MATERIAL_SHELF = { stockSurface: 82, returnSurface: 50, front: -20.8, center: -37.6 } as const;
const STOCK_SHELF_SURFACE_Y = MATERIAL_SHELF.stockSurface;
const RETURN_SHELF_SURFACE_Y = MATERIAL_SHELF.returnSurface;
const STOCK_SCALE = WORKSHOP_UNITS_PER_MM;
const STOCK_LENGTH = FORGE_RULES.workpieceLength * STOCK_SCALE;
const SIDE_AXIS = new Vector3(1, 0, 0);
const STORED_DIRECTION = new Vector3(0, 0, -1);
const INSPECTION_DIRECTION = new Vector3(0, 0.5, -0.8660254).normalize();

function orientationFor(direction: Vector3): Quaternion {
  const up = SIDE_AXIS.clone().cross(direction).normalize();
  return new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(direction, up, SIDE_AXIS));
}

export function materialsCameraFrame(_focus: "table" | "rack", aspect: number) {
  const frame = MATERIALS_FRAMES.table;
  const target = new Vector3(...frame.target).add(MATERIALS_ORIGIN);
  const position = new Vector3(...frame.position).add(MATERIALS_ORIGIN);
  position.sub(target).multiplyScalar(Math.max(1, 1.25 / aspect)).add(target);
  return { position: position.toArray(), target: target.toArray() };
}

export function weldCameraFrame(aspect: number) {
  const target = new Vector3(-20, TABLE_SURFACE_Y + 12, 166).add(MATERIALS_ORIGIN);
  const position = new Vector3(-20, 78, 330).add(MATERIALS_ORIGIN);
  position.sub(target).multiplyScalar(Math.max(1, 1.15 / aspect)).add(target);
  return { position: position.toArray(), target: target.toArray() };
}

export class MaterialsStationView {
  readonly group = new Group();
  readonly candidates: Mesh[] = [];
  readonly rack = new Group();
  readonly rackItems: Mesh[] = [];
  readonly tableItems: Mesh[] = [];
  private selected: string | null = null;
  private lastTick: number | null = null;
  private readonly kit = new WorkshopModelKit();

  constructor(private readonly geometryOf: (piece: ForgeSnapshotWorkpiece) => BufferGeometry) {
    this.group.position.copy(MATERIALS_ORIGIN);
    const kit=this.kit;
    kit.bench(this.group,1600,800,150);
    kit.ruler(this.group,500,[0,875,510]);
    for(const x of [-18,18])kit.beam(this.group,"tongs-handle",[600+x,881,320],[600-x,885,20],12,12,"iron");
    for(const x of [-18,18])kit.beam(this.group,"tongs-jaw",[600-x,885,20],[600+x,887,-65],15,18,"steel");
    kit.cylinder(this.group,"tongs-pivot",10,10,[600,885,55],"brass");
    this.group.add(this.rack);
    for(const x of [-750,750])kit.box(this.rack,"rack-upright",[80,1800,80],[x,900,-480],"endgrain");
    for(const height of [450,1000,1400,1750]){
      kit.box(this.rack,"stock-shelf",[1520,45,420],[0,height-22.5,-470],"wood");
      kit.box(this.rack,"shelf-backstop",[1520,65,25],[0,height+10,-682],"iron");
    }
    for(const x of [-700,700])kit.beam(this.rack,"rack-brace",[x,420,-650],[-x,1650,-650],35,24,"iron");
    // Background stock is deliberately distinct from the three selectable sources.
    for(let i=0;i<12;i++)kit.box(this.rack,"stored-bar",[32,24,336],[-580+i*105,462,-470],"iron",2);
    kit.batch(this.rack);kit.batch(this.group);

    const storedQuaternion = orientationFor(STORED_DIRECTION);
    const inspectionQuaternion = orientationFor(INSPECTION_DIRECTION);
    const halfThickness = FORGE_RULES.initialSectionThickness * STOCK_SCALE / 2;
    const shelfFrontZ = MATERIAL_SHELF.front;
    const extractedPosition = new Vector3(0, STOCK_SHELF_SURFACE_Y + halfThickness, shelfFrontZ + STOCK_LENGTH / 2);
    const inspectionRear = new Vector3(
      0,
      STOCK_SHELF_SURFACE_Y + halfThickness,
      shelfFrontZ,
    );
    const inspectionFront = inspectionRear.clone().addScaledVector(INSPECTION_DIRECTION, -STOCK_LENGTH);
    const inspectionCenter = inspectionRear.clone().add(inspectionFront).multiplyScalar(0.5);

    FORGE_MATERIALS.forEach((material, index) => {
      const mesh = new Mesh(
        new RoundedBoxGeometry(
          STOCK_LENGTH,
          FORGE_RULES.initialSectionThickness * STOCK_SCALE,
          FORGE_RULES.initialSectionWidth * STOCK_SCALE,
          1,
          0.04,
        ),
        new MeshStandardMaterial({
          color: (["#899297", "#747d84", "#80898d"][index] ?? "#80898d"),
          metalness: 0.62,
          roughness: 0.46,
        }),
      );
      const storedPosition = new Vector3(
        -36 + index * 36,
        STOCK_SHELF_SURFACE_Y + FORGE_RULES.initialSectionThickness * STOCK_SCALE / 2,
        MATERIAL_SHELF.center,
      );
      mesh.position.copy(storedPosition);
      mesh.quaternion.copy(storedQuaternion);
      mesh.userData.materialId = material.id;
      mesh.userData.storageShelfSurfaceY = STOCK_SHELF_SURFACE_Y;
      mesh.userData.homePosition = storedPosition;
      mesh.userData.homeQuaternion = storedQuaternion.clone();
      mesh.userData.extractedPosition = extractedPosition.clone().setX(storedPosition.x);
      mesh.userData.inspectionPosition = inspectionCenter.clone().setX(storedPosition.x);
      mesh.userData.inspectionQuaternion = inspectionQuaternion.clone();
      mesh.userData.inspectionProgress = 0;
      this.candidates.push(mesh);
      this.group.add(mesh);
    });
    this.group.visible = false;
  }

  update(
    candidateId: string | null,
    pieces: readonly ForgeSnapshotWorkpiece[],
    activeWorkpieceId: string | null = null,
    tableWorkpieceIds: readonly string[] = [],
  ): void {
    this.selected = candidateId;
    this.clearDynamicItems();
    const tableIds = new Set(tableWorkpieceIds);
    let tableIndex = 0;
    let rackIndex = 0;
    pieces.forEach((piece) => {
      const onTable = tableIds.has(piece.workpieceId);
      const mesh = this.createWorkpieceMesh(piece, piece.workpieceId === activeWorkpieceId);
      if (onTable) {
        mesh.position.set(-42 + tableIndex * 28, TABLE_ITEM_BASE_Y + 0.04, 150);
        mesh.quaternion.copy(orientationFor(STORED_DIRECTION));
        mesh.userData.tableSlot = tableIndex;
        this.tableItems.push(mesh);
        this.group.add(mesh);
        tableIndex += 1;
      } else {
        mesh.position.set(-42 + rackIndex * 28, RETURN_SHELF_SURFACE_Y, MATERIAL_SHELF.center);
        mesh.quaternion.copy(orientationFor(STORED_DIRECTION));
        mesh.userData.rackSlot = rackIndex;
        this.rackItems.push(mesh);
        this.rack.add(mesh);
        rackIndex += 1;
      }
    });
  }

  setFocus(_focus: "table" | "rack"): void {}

  tick(nowMs: number): boolean {
    const delta = this.lastTick === null ? 16 : Math.min(50, Math.max(0, nowMs - this.lastTick));
    this.lastTick = nowMs;
    if (!this.group.visible) return false;
    let moved = false;
    for (const mesh of this.candidates) {
      const inspecting = mesh.userData.materialId === this.selected;
      const before = mesh.userData.inspectionProgress as number;
      const progress = Math.min(1, Math.max(0, before + (inspecting ? 1 : -1) * delta / 420));
      mesh.userData.inspectionProgress = progress;
      if (progress !== before) moved = true;
      const homePosition = mesh.userData.homePosition as Vector3;
      const extractedPosition = mesh.userData.extractedPosition as Vector3;
      const inspectionPosition = mesh.userData.inspectionPosition as Vector3;
      const homeQuaternion = mesh.userData.homeQuaternion as Quaternion;
      const inspectionQuaternion = mesh.userData.inspectionQuaternion as Quaternion;
      if (progress <= 0.58) {
        const amount = smoothstep(progress / 0.58);
        mesh.position.lerpVectors(homePosition, extractedPosition, amount);
        mesh.quaternion.copy(homeQuaternion);
      } else {
        const amount = smoothstep((progress - 0.58) / 0.42);
        mesh.position.lerpVectors(extractedPosition, inspectionPosition, amount);
        mesh.quaternion.copy(homeQuaternion).slerp(inspectionQuaternion, amount);
      }
    }
    return moved;
  }

  dispose(): void {
    const geometries = new Set<BufferGeometry>();
    const materials = new Set<MeshStandardMaterial | MeshBasicMaterial>();
    this.group.traverse((object) => {
      if (!(object instanceof Mesh)) return;
      geometries.add(object.geometry);
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) materials.add(material);
    });
    geometries.forEach((geometry) => geometry.dispose());
    materials.forEach((material) => material.dispose());
    this.kit.woodTexture.dispose();this.kit.mineralTexture.dispose();
  }

  private clearDynamicItems(): void {
    for (const mesh of [...this.rackItems, ...this.tableItems]) {
      mesh.geometry.dispose();
      (mesh.material as MeshStandardMaterial).dispose();
      mesh.parent?.remove(mesh);
    }
    this.rackItems.length = 0;
    this.tableItems.length = 0;
  }

  private createWorkpieceMesh(piece: ForgeSnapshotWorkpiece, active: boolean): Mesh {
    const geometry = this.geometryOf(piece);
    const bounds = new Box3().setFromBufferAttribute(geometry.getAttribute("position") as import("three").BufferAttribute);
    const center = bounds.getCenter(new Vector3());
    geometry.translate(-center.x, -bounds.min.y, -center.z);
    const appearance = thermalSteelAppearance(piece.averageTemperatureC);
    const material = new MeshStandardMaterial({
      vertexColors: true,
      metalness: 0.62,
      roughness: 0.46,
      emissive: active ? "#3c2a16" : appearance.emissive,
      emissiveIntensity: active ? Math.max(0.18, appearance.emissiveIntensity) : appearance.emissiveIntensity,
    });
    const mesh = new Mesh(geometry, material);
    mesh.scale.setScalar(WORKSHOP_UNITS_PER_MM);
    mesh.userData.workpieceId = piece.workpieceId;
    return mesh;
  }

  private box(
    parent: Group,
    size: [number, number, number],
    position: [number, number, number],
    material: MeshStandardMaterial | MeshBasicMaterial,
  ): Mesh {
    const mesh = new Mesh(new BoxGeometry(...size), material);
    mesh.position.set(...position);
    parent.add(mesh);
    return mesh;
  }
}

function smoothstep(value: number): number {
  const bounded = Math.min(1, Math.max(0, value));
  return bounded * bounded * (3 - 2 * bounded);
}
