import {
  Box3, BoxGeometry, BufferGeometry, Group, Mesh, MeshBasicMaterial,
  MeshStandardMaterial, PointLight, Vector3,
} from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { FORGE_MATERIALS, FORGE_RULES, type ForgeSnapshotWorkpiece } from "../forge/index.ts";
import { thermalSteelAppearance } from "./thermal-color.ts";

export const MATERIALS_ORIGIN = new Vector3(-420, 0, -132);
export const MATERIALS_FRAMES = {
  // Main view: the player stands at the staging table, with the rack behind it.
  table: { position: [0, 250, 300], target: [0, 66, -62] },
  // Secondary view: used only to select an already acquired workpiece.
  rack: { position: [0, 210, 95], target: [0, 100, -170] },
} as const;

export function materialsCameraFrame(focus: "table" | "rack", aspect: number) {
  const frame = MATERIALS_FRAMES[focus];
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
  private selected: string | null = null;
  private focus: "table" | "rack" = "table";
  private lastTick: number | null = null;

  constructor(private readonly geometryOf: (piece: ForgeSnapshotWorkpiece) => BufferGeometry) {
    this.group.position.copy(MATERIALS_ORIGIN);
    const wood = new MeshStandardMaterial({ color: "#75533a", roughness: 0.86 });
    const edge = new MeshStandardMaterial({ color: "#47372d", roughness: 0.9 });
    const iron = new MeshStandardMaterial({ color: "#424a50", metalness: 0.65, roughness: 0.5 });
    const stone = new MeshStandardMaterial({ color: "#626968", roughness: 1 });
    const floor = new MeshStandardMaterial({ color: "#777776", roughness: 1 });
    this.box(this.group, [680, 8, 520], [0, -34, -40], floor);
    this.box(this.group, [680, 330, 16], [0, 127, -280], stone);
    for (let row = 0; row < 5; row++) {
      for (let column = 0; column < 8; column++) {
        const tile = this.box(this.group, [78, 55, 8],
          [-315 + column * 87 + (row % 2) * 22, row * 61, -267], stone);
        tile.rotation.z = ((column + row) % 3 - 1) * 0.006;
      }
    }
    for (const x of [-300, -90, 305]) this.box(this.group, [14, 330, 22], [x, 127, -251], edge);

    // A continuous plank tabletop, without inventory sockets or fixed material recesses.
    for (let plank = 0; plank < 5; plank++) {
      const material = wood.clone();
      material.color.multiplyScalar(0.91 + plank * 0.035);
      this.box(this.group, [394, 12, 34], [0, 64, -205 + plank * 28], material);
    }
    for (const x of [-173, 173]) {
      for (const z of [-50, 88]) {
        this.box(this.group, [18, 94, 18], [x, 17, z - 73], edge);
        this.box(this.group, [30, 2, 25], [x, 71, z - 73], iron);
      }
    }
    this.box(this.group, [370, 21, 12], [0, 48, -61], wood);
    this.box(this.group, [370, 15, 12], [0, 8, -205], edge);

    // The window and furnace give spatial context; each remains simple and secondary.
    const windowGlass = new MeshBasicMaterial({ color: "#adc9db" });
    this.box(this.group, [93, 133, 6], [-225, 171, -256], windowGlass);
    for (const x of [-277, -225, -173]) this.box(this.group, [7, 145, 10], [x, 171, -247], edge);
    for (const y of [100, 170, 241]) this.box(this.group, [110, 7, 10], [-225, y, -247], edge);
    const windowLight = new PointLight("#bbd9ed", 28_000, 550, 2);
    windowLight.position.set(-235, 230, -160);
    this.group.add(windowLight);
    this.box(this.group, [88, 66, 73], [249, 2, -195], stone);
    this.box(this.group, [16, 87, 73], [213, 76, -195], stone);
    this.box(this.group, [16, 87, 73], [285, 76, -195], stone);
    this.box(this.group, [88, 17, 73], [249, 123, -195], stone);
    const fire = new MeshBasicMaterial({ color: "#ffb04d" });
    this.box(this.group, [53, 60, 3], [249, 75, -202], fire);
    const furnaceLight = new PointLight("#ffb16a", 14_000, 460, 2);
    furnaceLight.position.set(248, 109, -145);
    this.group.add(furnaceLight);

    this.group.add(this.rack);
    this.rack.position.x = -85;
    for (const x of [-24, 194]) this.box(this.rack, [12, 204, 38], [x, 72, -181], edge);
    for (const y of [58, 118, 177]) this.box(this.rack, [232, 8, 55], [85, y, -176], wood);
    this.box(this.rack, [214, 10, 9], [85, 8, -196], edge);
    const placements = [[-117, -12, -0.12], [3, -37, 0.13], [112, 27, -0.24]] as const;
    FORGE_MATERIALS.forEach((material, index) => {
      const placement = placements[index]!;
      const displayScale = 0.34;
      const mesh = new Mesh(new RoundedBoxGeometry(FORGE_RULES.workpieceLength * displayScale,
        FORGE_RULES.initialSectionThickness * displayScale, FORGE_RULES.initialSectionWidth * displayScale, 1, 0.65),
        new MeshStandardMaterial({ color: (["#899297", "#747d84", "#80898d"][index] ?? "#80898d"), metalness: 0.62, roughness: 0.46 }));
      mesh.position.set(placement[0], 86 + FORGE_RULES.initialSectionThickness * displayScale / 2, -145);
      mesh.rotation.y = placement[2];
      mesh.rotation.x = -0.22;
      mesh.userData.materialId = material.id;
      mesh.userData.home = mesh.position.clone();
      this.candidates.push(mesh);
      this.group.add(mesh);
    });
    this.group.visible = false;
  }

  update(candidateId: string | null, pieces: readonly ForgeSnapshotWorkpiece[]): void {
    this.selected = candidateId;
    this.rackItems.forEach((mesh) => {
      mesh.geometry.dispose();
      (mesh.material as MeshStandardMaterial).dispose();
      this.rack.remove(mesh);
    });
    this.rackItems.length = 0;
    pieces.forEach((piece, index) => {
      const geometry = this.geometryOf(piece);
      const bounds = new Box3().setFromBufferAttribute(geometry.getAttribute("position") as import("three").BufferAttribute);
      const center = bounds.getCenter(new Vector3());
      const size = bounds.getSize(new Vector3());
      geometry.translate(-center.x, -bounds.min.y, -center.z);
      const appearance = thermalSteelAppearance(piece.averageTemperatureC);
      const material = new MeshStandardMaterial({ vertexColors: true, metalness: 0.62, roughness: 0.46,
        emissive: appearance.emissive, emissiveIntensity: appearance.emissiveIntensity });
      const mesh = new Mesh(geometry, material);
      const scale = Math.min(0.28, 91 / Math.max(size.x, 1), 38 / Math.max(size.z, 1), 35 / Math.max(size.y, 1));
      mesh.scale.setScalar(scale);
      mesh.position.set(30 + (index % 2) * 110, 72 + Math.floor(index / 2) * 60,
        this.focus === "rack" ? -169 : -72);
      mesh.userData.workpieceId = piece.workpieceId;
      this.rackItems.push(mesh);
      this.rack.add(mesh);
    });
  }

  setFocus(focus: "table" | "rack"): void {
    this.focus = focus;
    this.rackItems.forEach((mesh, index) => {
      mesh.position.z = focus === "rack" ? -169 : -72;
      mesh.position.x = 30 + (index % 2) * 110;
      mesh.position.y = 72 + Math.floor(index / 2) * 60;
    });
  }

  tick(nowMs: number): boolean {
    const delta = this.lastTick === null ? 16 : Math.min(50, Math.max(0, nowMs - this.lastTick));
    this.lastTick = nowMs;
    if (!this.group.visible) return false;
    let moved = false;
    for (const mesh of this.candidates) {
      const home = mesh.userData.home as Vector3;
      const target = new Vector3(home.x, home.y, home.z + (mesh.userData.materialId === this.selected ? 64 : 0));
      if (mesh.position.distanceToSquared(target) > 0.0001) {
        mesh.position.lerp(target, 1 - Math.exp(-delta / 75));
        moved = true;
      } else mesh.position.copy(target);
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

  private box(parent: Group, size: [number, number, number], position: [number, number, number],
    material: MeshStandardMaterial | MeshBasicMaterial): Mesh {
    const mesh = new Mesh(new BoxGeometry(...size), material);
    mesh.position.set(...position);
    parent.add(mesh);
    return mesh;
  }
}
