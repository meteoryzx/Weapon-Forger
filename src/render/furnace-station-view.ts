import { BoxGeometry, BufferGeometry, CylinderGeometry, DoubleSide, Group, Mesh, MeshBasicMaterial, MeshStandardMaterial, PointLight, Vector3 } from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import type { ForgeSnapshot } from "../forge/index.ts";
import { thermalSteelAppearance } from "./thermal-color.ts";
import { WORKSHOP_UNITS_PER_MM } from "../app/workshop-scale.ts";

// Same workshop, behind the quench area on the right. Local +Z faces the worker.
export const FURNACE_ORIGIN = new Vector3(380, 0, -300);
export const FURNACE = { floor: -30, hearth: 72, front: 75, rear: -75, halfOpening: 44, ceiling: 124, scale: WORKSHOP_UNITS_PER_MM } as const;

export function furnaceCameraFrame(aspect: number) {
  const target = new Vector3(0, 95, 105);
  const offset = new Vector3(185, 170, 430).multiplyScalar(Math.max(1, 1.6 / aspect));
  return { position: target.clone().add(offset).add(FURNACE_ORIGIN).toArray(), target: target.add(FURNACE_ORIGIN).toArray() };
}

export class FurnaceStationView {
  readonly group = new Group();
  readonly body = new Group();
  readonly item = new Mesh(new BufferGeometry(), new MeshStandardMaterial({ vertexColors: true, metalness: 0.5, roughness: 0.65, side: DoubleSide }));
  readonly itemRig = new Group();
  readonly target = new Mesh(new BoxGeometry(120, 82, 150), new MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }));
  private desiredZ = 0;
  private lastLocation: string | null = null;
  private lastId: string | null = null;
  private lastTick: number | null = null;

  constructor(private readonly geometryFor: (snapshot: ForgeSnapshot) => BufferGeometry) {
    this.group.position.copy(FURNACE_ORIGIN);
    this.group.name = "heating-station";
    this.body.name = "open-forge";
    const steel = new MeshStandardMaterial({ color: "#424950", metalness: 0.48, roughness: 0.72 });
    const edge = new MeshStandardMaterial({ color: "#626c72", metalness: 0.5, roughness: 0.6 });
    const lining = new MeshStandardMaterial({ color: "#b97f4c", emissive: "#df5713", emissiveIntensity: 0.25, roughness: 1 });
    const hot = new MeshStandardMaterial({ color: "#f1ad42", emissive: "#ff7415", emissiveIntensity: 1.6 });
    const box = (name: string, size: [number, number, number], at: [number, number, number], material = steel) => {
      const mesh = new Mesh(new RoundedBoxGeometry(...size, 1, 0.7), material);
      mesh.name = name; mesh.position.set(...at); this.body.add(mesh); return mesh;
    };
    // Only the top, floor and two side walls enclose the tunnel. Both ends stay open.
    box("roof", [120, 8, 150], [0, 138, 0]);
    box("hearth-base", [120, 6, 150], [0, 61, 0]);
    box("hearth-lining", [108, 8, 150], [0, 68, 0], lining);
    box("roof-lining", [108, 10, 150], [0, 129, 0], lining);
    for (const side of [-1, 1]) {
      box("side-shell", [6, 70, 150], [side * 57, 99, 0]);
      box("side-lining", [12, 52, 150], [side * 50, 98, 0], lining);
      for (const z of [-70, 70]) {
        box("mouth-upright", [10, 78, 7], [side * 55, 103, z], edge);
      }
      for (const z of [-63, 63, 240]) {
        // All feet end exactly on the existing workshop floor, Y=-30.
        box("support-leg", [7, 93, 7], [side * 52, 18.5, z]);
        box("foot", [16, 4, 16], [side * 52, -28, z], edge);
      }
      box("lower-brace", [5, 5, 310], [side * 52, -2, 88]);
    }
    for (const z of [-70, 70]) box("mouth-lintel", [120, 10, 7], [0, 137, z], edge);
    // Front support and hearth share a surface height, including short cut pieces.
    box("front-table", [120, 5, 180], [0, 69.5, 165]);
    box("front-brace", [104, 5, 5], [0, -2, 240]);
    for (const z of [-45, 0, 45]) {
      const burner = new Mesh(new CylinderGeometry(6, 6, 50, 10), steel);
      burner.name = "burner"; burner.position.set(0, 167, z); this.body.add(burner);
      const collar = new Mesh(new CylinderGeometry(10, 10, 7, 8), edge);
      collar.position.set(0, 145.5, z); this.body.add(collar);
      const nozzle = new Mesh(new CylinderGeometry(3, 6, 8, 10), hot);
      nozzle.position.set(0, 120, z); this.body.add(nozzle);
    }
    const manifold = new Mesh(new CylinderGeometry(3, 3, 120, 8), edge);
    manifold.rotation.x = Math.PI / 2; manifold.position.set(0, 192, 0); this.body.add(manifold);
    const glow = new PointLight("#ff8c36", 2800, 200, 2);
    glow.position.set(0, 103, 35); this.group.add(glow);
    this.target.position.set(0, 101, 0);
    this.target.userData.station = "furnace";
    this.itemRig.rotation.y = Math.PI / 2;
    this.item.scale.setScalar(FURNACE.scale);
    this.itemRig.add(this.item);
    this.group.add(this.body, this.target, this.itemRig);
  }

  update(snapshot: ForgeSnapshot) {
    this.item.geometry.dispose();
    this.item.geometry = this.geometryFor(snapshot);
    this.item.geometry.computeBoundingBox();
    const bounds = this.item.geometry.boundingBox!;
    const center = bounds.getCenter(new Vector3());
    const length = (bounds.max.x - bounds.min.x) * FURNACE.scale;
    this.item.position.set(-center.x * FURNACE.scale, -bounds.min.y * FURNACE.scale, -center.z * FURNACE.scale);
    this.itemRig.position.y = FURNACE.hearth;
    const z = snapshot.billetLocation === "furnace"
      ? FURNACE.front - length * 0.15
      : FURNACE.front + 12 + length / 2;
    this.desiredZ = z;
    if (this.lastId !== snapshot.workpieceId || this.lastLocation === null) this.itemRig.position.z = z;
    this.lastId = snapshot.workpieceId;
    this.lastLocation = snapshot.billetLocation;
    const appearance = thermalSteelAppearance(snapshot.averageTemperatureC);
    this.item.material.emissive.copy(appearance.emissive);
    this.item.material.emissiveIntensity = appearance.emissiveIntensity;
  }

  tick(now: number) {
    const dt = this.lastTick === null ? 0 : Math.min(0.05, (now - this.lastTick) / 1000);
    this.lastTick = now;
    const delta = this.desiredZ - this.itemRig.position.z;
    if (Math.abs(delta) < 0.05) { this.itemRig.position.z = this.desiredZ; return false; }
    this.itemRig.position.z += delta * (1 - Math.exp(-12 * dt));
    return true;
  }

  dispose() {
    this.group.traverse(object => {
      if (object instanceof Mesh) { object.geometry.dispose(); const materials = Array.isArray(object.material) ? object.material : [object.material]; materials.forEach(m => m.dispose()); }
    });
  }
}
