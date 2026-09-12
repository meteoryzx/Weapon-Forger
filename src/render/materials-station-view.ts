import {
  Box3, BoxGeometry, BufferGeometry, Group, Matrix4, Mesh, MeshBasicMaterial,
  MeshStandardMaterial, PointLight, Quaternion, Vector3,
} from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { FORGE_MATERIALS, FORGE_RULES, type ForgeSnapshotWorkpiece } from "../forge/index.ts";
import { thermalSteelAppearance } from "./thermal-color.ts";
import { WORKSHOP_UNITS_PER_MM } from "../app/workshop-scale.ts";

// Keep the selection area's accepted local arrangement; move the whole station
// to the workshop's back-left so its full-sized table does not envelop the forge.
export const MATERIALS_ORIGIN = new Vector3(-390, 0, -170);
export const MATERIALS_FRAMES = {
  table: { position: [0, 262, 430], target: [0, 145, -28] },
  rack: { position: [0, 262, 430], target: [0, 145, -28] },
} as const;

const TABLE_SURFACE_Y = 72;
const TABLE_ITEM_BASE_Y = TABLE_SURFACE_Y + 1.25;
const STOCK_SHELF_SURFACE_Y = 200;
const RETURN_SHELF_SURFACE_Y = 288;
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

export class MaterialsStationView {
  readonly group = new Group();
  readonly candidates: Mesh[] = [];
  readonly rack = new Group();
  readonly rackItems: Mesh[] = [];
  readonly tableItems: Mesh[] = [];
  private selected: string | null = null;
  private lastTick: number | null = null;

  constructor(private readonly geometryOf: (piece: ForgeSnapshotWorkpiece) => BufferGeometry) {
    this.group.position.copy(MATERIALS_ORIGIN);
    this.group.scale.setScalar(0.84);
    const wood = new MeshStandardMaterial({ color: "#75533a", roughness: 0.86 });
    const edge = new MeshStandardMaterial({ color: "#47372d", roughness: 0.9 });
    const iron = new MeshStandardMaterial({ color: "#424a50", metalness: 0.65, roughness: 0.5 });
    const stone = new MeshStandardMaterial({ color: "#626968", roughness: 1 });
    this.box(this.group, [700, 360, 16], [0, 145, -270], stone);

    // The shelf is deep enough for a full stock billet and shares its front edge with the table.
    this.group.add(this.rack);
    for (const x of [-230, 230]) this.box(this.rack, [20, 356, 48], [x, 142, -115], edge);
    for (const y of [106, 194, 282]) this.box(this.rack, [480, 12, 220], [0, y, -115], wood);
    this.box(this.rack, [480, 22, 54], [0, 324, -115], wood);
    this.box(this.rack, [446, 16, 14], [0, -20, -28], edge);

    // Its back edge meets the shelf front edge at z=-5, forming one continuous work area.
    for (let plank = 0; plank < 6; plank += 1) {
      const material = wood.clone();
      material.color.multiplyScalar(0.9 + plank * 0.025);
      this.box(this.group, [510, 14, 50], [0, 65, 20 + plank * 50], material);
    }
    for (const x of [-218, 218]) {
      for (const z of [18, 272]) this.box(this.group, [22, 100, 22], [x, 14, z], edge);
    }
    this.box(this.group, [474, 18, 18], [0, 45, -2], edge);
    this.box(this.group, [474, 16, 18], [0, 8, 268], iron);

    const windowGlass = new MeshBasicMaterial({ color: "#adc9db" });
    this.box(this.group, [108, 138, 6], [-286, 184, -260], windowGlass);
    for (const x of [-342, -286, -230]) this.box(this.group, [7, 150, 10], [x, 184, -250], edge);
    for (const y of [108, 184, 260]) this.box(this.group, [122, 7, 10], [-286, y, -250], edge);
    const windowLight = new PointLight("#bbd9ed", 24_000, 580, 2);
    windowLight.position.set(-275, 240, -130);
    this.group.add(windowLight);

    const storedQuaternion = orientationFor(STORED_DIRECTION);
    const inspectionQuaternion = orientationFor(INSPECTION_DIRECTION);
    const halfThickness = FORGE_RULES.initialSectionThickness * STOCK_SCALE / 2;
    const shelfFrontZ = -5;
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
          0.65,
        ),
        new MeshStandardMaterial({
          color: (["#899297", "#747d84", "#80898d"][index] ?? "#80898d"),
          metalness: 0.62,
          roughness: 0.46,
        }),
      );
      const storedPosition = new Vector3(
        -142 + index * 142,
        STOCK_SHELF_SURFACE_Y + FORGE_RULES.initialSectionThickness * STOCK_SCALE / 2,
        -112,
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
        mesh.position.set(-174 + tableIndex * 116, TABLE_ITEM_BASE_Y, 112);
        mesh.quaternion.copy(orientationFor(STORED_DIRECTION));
        mesh.userData.tableSlot = tableIndex;
        this.tableItems.push(mesh);
        this.group.add(mesh);
        tableIndex += 1;
      } else {
        mesh.position.set(-174 + rackIndex * 116, RETURN_SHELF_SURFACE_Y, -112);
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
