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
  OrthographicCamera,
  Raycaster,
  Scene,
  ShapeGeometry,
  Vector2,
  WebGLRenderer,
  BoxGeometry,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  ExtrudeGeometry,
  Shape,
  Vector3,
} from "three";

import type { ForgeSnapshot, ForgeSnapshotSection, WorkpieceGrid } from "../forge/index.ts";

const VISUAL_SUBDIVISIONS_PER_SECTION = 4;
const VISUAL_THICKNESS_SCALE = 2.4;
const DESIGN_HALF_HEIGHT = 117;
const ROTATE_CONTROL_SIZE = 72;
const BILLET_MATERIAL = new MeshStandardMaterial({
  metalness: 0.82,
  roughness: 0.34,
  emissive: "#351008",
  emissiveIntensity: 0.55,
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
  private readonly camera = new OrthographicCamera(-320, 320, 180, -180, 0.1, 2000);
  private readonly raycaster = new Raycaster();
  private readonly pointer = new Vector2();
  // The rig establishes the fixed presentation angle; the billet spins inside it on its own long axis.
  private readonly billetRig = new Group();
  private readonly billet = new Mesh(new BufferGeometry(), BILLET_MATERIAL);
  private readonly rotateControls: { readonly direction: -1 | 1; readonly group: Group }[] = [];
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
    anvil.scale.setScalar(0.92);
    anvil.rotation.y = -0.24;
    this.scene.add(anvil);
    this.scene.add(this.createHammerModel());
    const rotateLeftControl = { direction: -1 as const, group: this.createRotateControl(-1) };
    const rotateRightControl = { direction: 1 as const, group: this.createRotateControl(1) };
    this.rotateControls.push(rotateLeftControl, rotateRightControl);
    this.camera.add(rotateLeftControl.group, rotateRightControl.group);
    this.billet.scale.x = 0.58;
    this.billetRig.position.set(-96, 18, 0);
    this.billetRig.rotation.y = 0.3;
    this.billetRig.add(this.billet);
    this.scene.add(this.billetRig);
    this.resize(viewport);
  }

  update(snapshot: ForgeSnapshot, impactSectionIndex: number | null = null): void {
    this.snapshot = snapshot;
    this.billet.rotation.x = snapshot.orientationQuarterTurns * (Math.PI / 2);
    this.billet.position.x = snapshot.feedOffset;
    this.billet.position.y = snapshot.orientationQuarterTurns % 2 === 0 ? -6 : 0;
    const nextGeometry = createBilletGeometry(snapshot, impactSectionIndex);
    this.billet.geometry.dispose();
    this.billet.geometry = nextGeometry;
    this.render();
  }

  resize(viewport: RenderViewport): void {
    this.viewport = viewport;
    this.renderer.setPixelRatio(Math.min(viewport.pixelRatio, 2));
    this.renderer.setSize(viewport.width, viewport.height, false);
    const aspect = viewport.width / viewport.height;
    const halfHeight = DESIGN_HALF_HEIGHT * Math.max(1, (16 / 9) / aspect);
    const halfWidth = halfHeight * aspect;
    this.camera.left = -halfWidth;
    this.camera.right = halfWidth;
    this.camera.top = halfHeight;
    this.camera.bottom = -halfHeight;
    this.camera.position.set(-260, 300, 600);
    this.camera.lookAt(0, -28, 0);
    this.camera.updateProjectionMatrix();
    this.positionRotateControls();
    this.render();
  }

  pickSection(viewportX: number, viewportY: number): number | null {
    return this.pickHammerTarget(viewportX, viewportY)?.sectionIndex ?? null;
  }

  pickHammerTarget(viewportX: number, viewportY: number): HammerPickTarget | null {
    if (!this.snapshot) {
      return null;
    }
    const hit = this.pickObject(viewportX, viewportY, [this.billet], false);
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
        (section.verticalOffset - section.thickness / 2) * VISUAL_THICKNESS_SCALE,
        (section.verticalOffset + section.thickness / 2) * VISUAL_THICKNESS_SCALE,
        localPoint.y,
      );
    return { sectionIndex, faceBias: clamp(faceBias, 0, 1) };
  }

  pickRotateControl(viewportX: number, viewportY: number): -1 | 1 | null {
    for (const control of this.rotateControls) {
      if (this.pickObject(viewportX, viewportY, [control.group], true)) {
        return control.direction;
      }
    }
    return null;
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
    BILLET_MATERIAL.dispose();
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
    const arrow = new Mesh(createArrowGeometry(direction), new MeshBasicMaterial({ color: "#f3c36d" }));
    panel.position.z = -72;
    arrow.position.z = -71;
    group.add(panel, arrow);
    return group;
  }

  private positionRotateControls(): void {
    const y = this.camera.bottom + ROTATE_CONTROL_SIZE * 0.72;
    const xInset = ROTATE_CONTROL_SIZE * 0.72;
    for (const control of this.rotateControls) {
      control.group.position.set(
        control.direction < 0 ? this.camera.left + xInset : this.camera.right - xInset,
        y,
        -120,
      );
      control.group.rotation.set(0, 0, 0);
    }
  }

  private createAnvilModel(): Group {
    const anvil = new Group();
    const steel = new MeshStandardMaterial({ color: "#414852", metalness: 0.52, roughness: 0.4, side: DoubleSide });
    const edge = new MeshStandardMaterial({ color: "#697482", metalness: 0.48, roughness: 0.3 });
    const face = new Mesh(new BoxGeometry(320, 16, 150), edge);
    face.position.set(0, -8, 0);
    const body = this.createProfile(
      [[-112, -16], [112, -16], [82, -38], [58, -88], [88, -112], [80, -152], [-80, -152], [-88, -112], [-58, -88], [-82, -38]],
      94,
      steel,
    );
    const foot = new Mesh(new BoxGeometry(210, 20, 126), edge);
    foot.position.set(0, -151, 0);
    const horn = new Mesh(new ConeGeometry(55, 132, 4), steel);
    horn.position.set(205, -8, 0);
    horn.rotation.z = -Math.PI / 2;
    anvil.add(face, body, foot, horn);
    return anvil;
  }

  private createHammerModel(): Group {
    const hammer = new Group();
    const steel = new MeshStandardMaterial({ color: "#4d5662", metalness: 0.54, roughness: 0.3 });
    const wood = new MeshStandardMaterial({ color: "#844a29", metalness: 0.06, roughness: 0.48 });
    const headPosition = new Vector3(105, 112, 34);
    const head = new Mesh(new BoxGeometry(58, 82, 58), steel);
    head.position.copy(headPosition);
    head.rotation.z = -0.16;
    const handle = this.createRoundToolBar(
      headPosition.clone().add(new Vector3(18, -30, -8)),
      new Vector3(330, -12, 180),
      18,
      wood,
    );

    hammer.add(head, handle);
    return hammer;
  }

  private createToolBar(start: Vector3, end: Vector3, width: number, material: MeshStandardMaterial): Mesh {
    const direction = end.clone().sub(start);
    const bar = new Mesh(new BoxGeometry(direction.length(), width, width), material);
    bar.position.copy(start).add(end).multiplyScalar(0.5);
    bar.quaternion.setFromUnitVectors(new Vector3(1, 0, 0), direction.normalize());
    return bar;
  }

  private createRoundToolBar(start: Vector3, end: Vector3, diameter: number, material: MeshStandardMaterial): Mesh {
    const direction = end.clone().sub(start);
    const bar = new Mesh(new CylinderGeometry(diameter / 2, diameter / 2, direction.length(), 12), material);
    bar.position.copy(start).add(end).multiplyScalar(0.5);
    bar.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), direction.normalize());
    return bar;
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
  impactSectionIndex: number | null,
): BufferGeometry {
  const sections = snapshot.sections;
  const sectionProfiles = sections.map((section) => sectionPerimeter(section, snapshot.grid));
  const perimeterVertexCount = (snapshot.grid.widthBlocks + snapshot.grid.heightBlocks) * 2;
  const ringCount = sections.length * VISUAL_SUBDIVISIONS_PER_SECTION + 1;
  const positions: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];

  for (let ringIndex = 0; ringIndex < ringCount; ringIndex += 1) {
    const profile = profileAtRing(ringIndex, sections, sectionProfiles);
    const impact = impactIntensityAtRing(ringIndex, impactSectionIndex);
    const color = temperatureColor(profile.temperatureC, impact);
    profile.points.forEach((point, pointIndex) => {
      positions.push(profile.position, point.y * VISUAL_THICKNESS_SCALE, point.z);
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

interface PerimeterPoint {
  readonly y: number;
  readonly z: number;
}

interface PerimeterProfile {
  readonly position: number;
  readonly temperatureC: number;
  readonly points: readonly PerimeterPoint[];
}

function sectionPerimeter(section: ForgeSnapshotSection, grid: WorkpieceGrid): PerimeterProfile {
  const points: PerimeterPoint[] = [];
  const topHeight = grid.heightBlocks - 1;
  const rightWidth = grid.widthBlocks - 1;

  for (let boundary = 0; boundary < grid.widthBlocks; boundary += 1) {
    points.push({
      y: horizontalSurface(section, topHeight, boundary, "top"),
      z: horizontalBoundary(section, topHeight, boundary),
    });
  }
  for (let boundary = grid.heightBlocks; boundary > 0; boundary -= 1) {
    points.push({
      y: verticalBoundary(section, rightWidth, boundary),
      z: verticalSurface(section, rightWidth, boundary, "right"),
    });
  }
  for (let boundary = grid.widthBlocks; boundary > 0; boundary -= 1) {
    points.push({
      y: horizontalSurface(section, 0, boundary, "bottom"),
      z: horizontalBoundary(section, 0, boundary),
    });
  }
  for (let boundary = 0; boundary < grid.heightBlocks; boundary += 1) {
    points.push({
      y: verticalBoundary(section, 0, boundary),
      z: verticalSurface(section, 0, boundary, "left"),
    });
  }

  return { position: section.position, temperatureC: section.temperatureC, points };
}

function profileAtRing(
  ringIndex: number,
  sections: readonly ForgeSnapshotSection[],
  profiles: readonly PerimeterProfile[],
): PerimeterProfile {
  const firstSection = sections[0];
  const lastSection = sections.at(-1);
  const firstProfile = profiles[0];
  const lastProfile = profiles.at(-1);
  if (!firstSection || !lastSection || !firstProfile || !lastProfile) {
    throw new Error("A billet needs at least one section to render.");
  }
  if (ringIndex === 0) {
    return { ...firstProfile, position: firstSection.position - firstSection.length / 2 };
  }
  const finalRingIndex = sections.length * VISUAL_SUBDIVISIONS_PER_SECTION;
  if (ringIndex === finalRingIndex) {
    return { ...lastProfile, position: lastSection.position + lastSection.length / 2 };
  }

  const sample = ringIndex / VISUAL_SUBDIVISIONS_PER_SECTION - 0.5;
  const leftIndex = Math.floor(sample);
  const t = smoothStep(sample - leftIndex);
  const start = profileAtClamped(profiles, leftIndex);
  const points = start.points.map((_, pointIndex) => ({
    y: smoothProfileCoordinate(profiles, leftIndex, pointIndex, "y", t),
    z: smoothProfileCoordinate(profiles, leftIndex, pointIndex, "z", t),
  }));
  return {
    position: lerp(ringPositionAt(sections, leftIndex + 1), ringPositionAt(sections, leftIndex + 2), t),
    temperatureC: smoothScalar(profiles, leftIndex, "temperatureC", t),
    points,
  };
}

function horizontalBoundary(section: ForgeSnapshotSection, heightIndex: number, boundary: number): number {
  const touching = section.blocks.filter(
    (block) => block.heightIndex === heightIndex
      && (block.widthIndex === boundary - 1 || block.widthIndex === boundary),
  );
  return average(touching.map((block) => block.lateralOffset + (block.widthIndex < boundary ? block.width / 2 : -block.width / 2)));
}

function horizontalSurface(
  section: ForgeSnapshotSection,
  heightIndex: number,
  boundary: number,
  face: "top" | "bottom",
): number {
  const touching = section.blocks.filter(
    (block) => block.heightIndex === heightIndex
      && (block.widthIndex === boundary - 1 || block.widthIndex === boundary),
  );
  return average(touching.map((block) => block.verticalOffset + (face === "top" ? block.thickness / 2 : -block.thickness / 2)));
}

function verticalBoundary(section: ForgeSnapshotSection, widthIndex: number, boundary: number): number {
  const touching = section.blocks.filter(
    (block) => block.widthIndex === widthIndex
      && (block.heightIndex === boundary - 1 || block.heightIndex === boundary),
  );
  return average(touching.map((block) => block.verticalOffset + (block.heightIndex < boundary ? block.thickness / 2 : -block.thickness / 2)));
}

function verticalSurface(
  section: ForgeSnapshotSection,
  widthIndex: number,
  boundary: number,
  face: "left" | "right",
): number {
  const touching = section.blocks.filter(
    (block) => block.widthIndex === widthIndex
      && (block.heightIndex === boundary - 1 || block.heightIndex === boundary),
  );
  return average(touching.map((block) => block.lateralOffset + (face === "right" ? block.width / 2 : -block.width / 2)));
}

function smoothProfileCoordinate(
  profiles: readonly PerimeterProfile[],
  leftIndex: number,
  pointIndex: number,
  coordinate: keyof PerimeterPoint,
  t: number,
): number {
  const valueAt = (index: number) => profileAtClamped(profiles, index).points[pointIndex]?.[coordinate] ?? 0;
  return catmullRom(valueAt(leftIndex - 1), valueAt(leftIndex), valueAt(leftIndex + 1), valueAt(leftIndex + 2), t);
}

function smoothScalar(
  profiles: readonly PerimeterProfile[],
  leftIndex: number,
  key: "temperatureC",
  t: number,
): number {
  return catmullRom(
    profileAtClamped(profiles, leftIndex - 1)[key],
    profileAtClamped(profiles, leftIndex)[key],
    profileAtClamped(profiles, leftIndex + 1)[key],
    profileAtClamped(profiles, leftIndex + 2)[key],
    t,
  );
}

function profileAtClamped(profiles: readonly PerimeterProfile[], index: number): PerimeterProfile {
  const profile = profiles[clamp(index, 0, profiles.length - 1)];
  if (!profile) {
    throw new Error("Missing billet profile.");
  }
  return profile;
}

function ringPositionAt(sections: readonly ForgeSnapshotSection[], ringIndex: number): number {
  if (ringIndex <= 0) {
    const first = sections[0];
    return first ? first.position - first.length / 2 : 0;
  }
  if (ringIndex >= sections.length) {
    const last = sections.at(-1);
    return last ? last.position + last.length / 2 : 0;
  }
  const previous = sections[ringIndex - 1];
  return previous ? previous.position + previous.length / 2 : 0;
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

function impactIntensityAtRing(ringIndex: number, impactSectionIndex: number | null): number {
  if (impactSectionIndex === null) return 0;
  const sample = ringIndex / VISUAL_SUBDIVISIONS_PER_SECTION - 0.5;
  return Math.max(0, 1 - Math.abs(sample - impactSectionIndex) / 1.5);
}

function catmullRom(previous: number, start: number, end: number, next: number, t: number): number {
  const t2 = t * t;
  const t3 = t2 * t;
  return 0.5 * (
    2 * start
    + (-previous + end) * t
    + (2 * previous - 5 * start + 4 * end - next) * t2
    + (-previous + 3 * start - 3 * end + next) * t3
  );
}

function smoothStep(value: number): number {
  return value * value * (3 - 2 * value);
}

function lerp(start: number, end: number, t: number): number {
  return start + (end - start) * t;
}

function average(values: readonly number[]): number {
  if (values.length === 0) {
    throw new Error("A billet surface boundary needs at least one block.");
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function temperatureColor(temperatureC: number, impact: number): Color {
  const heat = Math.min(1, Math.max(0, (temperatureC - 450) / 550));
  const color = new Color("#5a2419").lerp(new Color("#ffad45"), heat);
  return color.lerp(new Color("#fff2ae"), impact * 0.75);
}

function createArrowGeometry(direction: -1 | 1): ShapeGeometry {
  const shape = new Shape();
  const points: [number, number][] = direction < 0
    ? [[-28, 0], [-1, -22], [-1, -8], [12, -8], [12, 8], [-1, 8], [-1, 22]]
    : [[28, 0], [1, -22], [1, -8], [-12, -8], [-12, 8], [1, 8], [1, 22]];
  const [first, ...rest] = points;
  if (!first) {
    throw new Error("A rotate arrow needs at least one point.");
  }
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

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
