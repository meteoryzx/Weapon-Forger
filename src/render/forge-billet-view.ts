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
  Vector2,
  WebGLRenderer,
  BoxGeometry,
  CircleGeometry,
  DoubleSide,
  ExtrudeGeometry,
  Shape,
} from "three";

import {
  FORGE_RULES,
  type ForgeSnapshot,
  type ForgeSnapshotSection,
  type HammerInfluencePreview,
  type WorkpieceGrid,
  type WorkpieceNode,
} from "../forge/index.ts";
import { thermalSteelAppearance } from "./thermal-color.ts";

const BILLET_AXIAL_SCALE = 0.58;
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

export class ForgeBilletView {
  private readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly camera = new PerspectiveCamera(52, 1, 0.1, 2000);
  private readonly raycaster = new Raycaster();
  private readonly pointer = new Vector2();
  // The camera is the worker's eye line; the billet spins inside the fixed anvil station.
  private readonly billetRig = new Group();
  private readonly billet = new Mesh(new BufferGeometry(), BILLET_MATERIAL);
  private readonly billetHitTarget = new Mesh(
    new BoxGeometry(FORGE_RULES.workpieceLength, 24, FORGE_RULES.initialSectionWidth),
    new MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }),
  );
  private readonly impactMarker = new Mesh(
    new CircleGeometry(7, 24),
    new MeshBasicMaterial({
      color: "#ffffff",
      transparent: true,
      opacity: 0.92,
      depthWrite: false,
      side: DoubleSide,
    }),
  );
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

    const anvil = this.createAnvilModel();
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
    this.impactMarker.visible = false;
    this.billet.add(this.impactMarker);
    this.scene.add(this.billetRig);
    this.resize(viewport);
  }

  update(snapshot: ForgeSnapshot, hammerPreview: HammerInfluencePreview | null = null): void {
    this.snapshot = snapshot;
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
    this.updateImpactMarker(snapshot, hammerPreview);
    const nextGeometry = createBilletGeometry(snapshot, hammerPreview);
    this.billet.geometry.dispose();
    this.billet.geometry = nextGeometry;
    this.render();
  }

  resize(viewport: RenderViewport): void {
    this.viewport = viewport;
    this.renderer.setPixelRatio(Math.min(viewport.pixelRatio, 2));
    this.renderer.setSize(viewport.width, viewport.height, false);
    this.camera.aspect = viewport.width / viewport.height;
    this.camera.position.set(0, 280, 420);
    this.camera.lookAt(0, 0, 0);
    this.camera.updateProjectionMatrix();
    this.render();
  }

  pickSection(viewportX: number, viewportY: number): number | null {
    return this.pickHammerTarget(viewportX, viewportY)?.sectionIndex ?? null;
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

  private pickObject(viewportX: number, viewportY: number, objects: Object3D[], recursive: boolean) {
    this.pointer.set(
      (viewportX / this.viewport.width) * 2 - 1,
      -(viewportY / this.viewport.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(this.pointer, this.camera);
    return this.raycaster.intersectObjects(objects, recursive)[0] ?? null;
  }

  dispose(): void {
    this.billet.geometry.dispose();
    this.billetHitTarget.geometry.dispose();
    (this.billetHitTarget.material as MeshBasicMaterial).dispose();
    this.impactMarker.geometry.dispose();
    (this.impactMarker.material as MeshBasicMaterial).dispose();
    // BILLET_MATERIAL is shared across view instances; do not dispose it here.
    this.renderer.dispose();
  }

  private render(): void {
    this.renderer.render(this.scene, this.camera);
  }

  private updateImpactMarker(snapshot: ForgeSnapshot, hammerPreview: HammerInfluencePreview | null): void {
    const section = hammerPreview ? snapshot.sections[hammerPreview.sectionIndex] : undefined;
    if (!section || !hammerPreview) {
      this.impactMarker.visible = false;
      return;
    }

    const struckFace = struckFaceForOrientation(snapshot.orientationQuarterTurns);
    const faceBias = clamp(hammerPreview.faceBias, 0, 1);
    const verticalTangent = lerp(
      section.verticalOffset - section.thickness / 2,
      section.verticalOffset + section.thickness / 2,
      faceBias,
    );
    const lateralTangent = lerp(
      section.lateralOffset - section.width / 2,
      section.lateralOffset + section.width / 2,
      faceBias,
    );

    // Keep this mapping identical to forge-simulation's contactTargetFor.
    // The marker is a child of the billet, so its local surface position also
    // follows feed, quarter-turns, and the deformed mesh as one object.
    switch (struckFace) {
      case "top":
        this.impactMarker.position.set(
          section.position,
          section.verticalOffset + section.thickness / 2 + 0.8,
          lateralTangent,
        );
        this.impactMarker.rotation.set(-Math.PI / 2, 0, 0);
        break;
      case "bottom":
        this.impactMarker.position.set(
          section.position,
          section.verticalOffset - section.thickness / 2 - 0.8,
          lateralTangent,
        );
        this.impactMarker.rotation.set(Math.PI / 2, 0, 0);
        break;
      case "left":
        this.impactMarker.position.set(
          section.position,
          verticalTangent,
          section.lateralOffset - section.width / 2 - 0.8,
        );
        this.impactMarker.rotation.set(0, -Math.PI / 2, 0);
        break;
      case "right":
        this.impactMarker.position.set(
          section.position,
          verticalTangent,
          section.lateralOffset + section.width / 2 + 0.8,
        );
        this.impactMarker.rotation.set(0, Math.PI / 2, 0);
        break;
    }
    this.impactMarker.scale.setScalar(0.75 + hammerPreview.energy * 0.55);
    this.impactMarker.visible = true;
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
  snapshot: ForgeSnapshot,
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
      const color = temperatureColor(temperatureAtPlane(snapshot.sections, ringIndex), preview);
      const tint = perimeterTint(pointIndex, snapshot.grid);
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

function workpiecePerimeter(snapshot: ForgeSnapshot, axialIndex: number): { readonly points: readonly WorkpieceNode[] } {
  const points: WorkpieceNode[] = [];
  const grid = snapshot.grid;

  for (let boundary = 0; boundary < grid.widthBlocks; boundary += 1) {
    points.push(workpieceNodeAt(snapshot, axialIndex, boundary, grid.heightBlocks));
  }
  for (let boundary = grid.heightBlocks; boundary > 0; boundary -= 1) {
    points.push(workpieceNodeAt(snapshot, axialIndex, grid.widthBlocks, boundary));
  }
  for (let boundary = grid.widthBlocks; boundary > 0; boundary -= 1) {
    points.push(workpieceNodeAt(snapshot, axialIndex, boundary, 0));
  }
  for (let boundary = 0; boundary < grid.heightBlocks; boundary += 1) {
    points.push(workpieceNodeAt(snapshot, axialIndex, 0, boundary));
  }

  return { points };
}

function workpieceNodeAt(
  snapshot: ForgeSnapshot,
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

function sectionIndexAt(position: number, sections: readonly ForgeSnapshotSection[]): number | null {
  const index = sections.findIndex(
    (section) => position >= section.position - section.length / 2 && position <= section.position + section.length / 2,
  );
  return index >= 0 ? index : null;
}

type StruckFace = "top" | "bottom" | "left" | "right";

function struckFaceForOrientation(orientationQuarterTurns: 0 | 1 | 2 | 3): StruckFace {
  switch (orientationQuarterTurns) {
    case 0:
      return "top";
    case 1:
      return "left";
    case 2:
      return "bottom";
    case 3:
      return "right";
  }
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
