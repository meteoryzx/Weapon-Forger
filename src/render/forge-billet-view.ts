import {
  AmbientLight,
  BufferAttribute,
  BufferGeometry,
  Color,
  DirectionalLight,
  Group,
  Mesh,
  MeshStandardMaterial,
  OrthographicCamera,
  Raycaster,
  Scene,
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

import type { ForgeSnapshot, ForgeSnapshotSection } from "../forge/index.ts";

const RING_VERTEX_COUNT = 4;
const VISUAL_THICKNESS_SCALE = 2.4;
const DESIGN_HALF_HEIGHT = 117;
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

export class ForgeBilletView {
  private readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly camera = new OrthographicCamera(-320, 320, 180, -180, 0.1, 2000);
  private readonly raycaster = new Raycaster();
  private readonly pointer = new Vector2();
  // The rig establishes the fixed presentation angle; the billet spins inside it on its own long axis.
  private readonly billetRig = new Group();
  private readonly billet = new Mesh(new BufferGeometry(), BILLET_MATERIAL);
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

    this.scene.add(this.createAnvilModel());
    this.scene.add(this.createHammerModel());
    this.billet.scale.x = 0.58;
    this.billetRig.position.set(-118, 13, 0);
    this.billetRig.rotation.y = 0.3;
    this.billetRig.add(this.billet);
    this.scene.add(this.billetRig);
    this.resize(viewport);
  }

  update(snapshot: ForgeSnapshot, impactSectionIndex: number | null = null): void {
    this.snapshot = snapshot;
    this.billet.rotation.x = snapshot.orientationQuarterTurns * (Math.PI / 2);
    const nextGeometry = createBilletGeometry(snapshot.sections, impactSectionIndex);
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
    this.render();
  }

  pickSection(viewportX: number, viewportY: number): number | null {
    if (!this.snapshot) {
      return null;
    }
    this.pointer.set(
      (viewportX / this.viewport.width) * 2 - 1,
      -(viewportY / this.viewport.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hit = this.raycaster.intersectObject(this.billet, false)[0];
    if (!hit) {
      return null;
    }

    const localPoint = this.billet.worldToLocal(hit.point.clone());
    return sectionIndexAt(localPoint.x, this.snapshot.sections);
  }

  dispose(): void {
    this.billet.geometry.dispose();
    BILLET_MATERIAL.dispose();
    this.renderer.dispose();
  }

  private render(): void {
    this.renderer.render(this.scene, this.camera);
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
    horn.position.set(226, -8, 0);
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
  sections: readonly ForgeSnapshotSection[],
  impactSectionIndex: number | null,
): BufferGeometry {
  const ringCount = sections.length + 1;
  const positions = new Float32Array(ringCount * RING_VERTEX_COUNT * 3);
  const colors = new Float32Array(ringCount * RING_VERTEX_COUNT * 3);
  const indices: number[] = [];

  for (let ringIndex = 0; ringIndex < ringCount; ringIndex += 1) {
    const profile = profileAtRing(ringIndex, sections);
    const color = temperatureColor(profile.temperatureC, impactSectionIndex !== null && (ringIndex === impactSectionIndex || ringIndex === impactSectionIndex + 1));
    writeRing(positions, colors, ringIndex, profile, color);
  }

  for (let sectionIndex = 0; sectionIndex < sections.length; sectionIndex += 1) {
    const start = sectionIndex * RING_VERTEX_COUNT;
    const end = (sectionIndex + 1) * RING_VERTEX_COUNT;
    for (let side = 0; side < RING_VERTEX_COUNT; side += 1) {
      const nextSide = (side + 1) % RING_VERTEX_COUNT;
      indices.push(start + side, end + side, end + nextSide, start + side, end + nextSide, start + nextSide);
    }
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(positions, 3));
  geometry.setAttribute("color", new BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function profileAtRing(index: number, sections: readonly ForgeSnapshotSection[]): ForgeSnapshotSection {
  const first = sections[0];
  const last = sections.at(-1);
  if (!first || !last) {
    throw new Error("A billet needs at least one section to render.");
  }
  if (index === 0) {
    return { ...first, position: first.position - first.length / 2 };
  }
  if (index === sections.length) {
    return { ...last, position: last.position + last.length / 2 };
  }
  const previous = sections[index - 1];
  const next = sections[index];
  if (!previous || !next) {
    throw new Error("Missing a billet section at a shared ring.");
  }
  return {
    ...previous,
    position: previous.position + previous.length / 2,
    width: (previous.width + next.width) / 2,
    thickness: (previous.thickness + next.thickness) / 2,
    temperatureC: (previous.temperatureC + next.temperatureC) / 2,
    lateralOffset: (previous.lateralOffset + next.lateralOffset) / 2,
  };
}

function writeRing(
  positions: Float32Array,
  colors: Float32Array,
  ringIndex: number,
  section: ForgeSnapshotSection,
  color: Color,
): void {
  const halfWidth = section.width / 2;
  const halfThickness = (section.thickness * VISUAL_THICKNESS_SCALE) / 2;
  const vertices = [
    [section.position, -halfThickness, section.lateralOffset - halfWidth],
    [section.position, -halfThickness, section.lateralOffset + halfWidth],
    [section.position, halfThickness, section.lateralOffset + halfWidth],
    [section.position, halfThickness, section.lateralOffset - halfWidth],
  ];
  const start = ringIndex * RING_VERTEX_COUNT * 3;
  vertices.forEach((vertex, index) => {
    const offset = start + index * 3;
    positions.set(vertex, offset);
    colors.set([color.r, color.g, color.b], offset);
  });
}

function temperatureColor(temperatureC: number, isImpacted: boolean): Color {
  const heat = Math.min(1, Math.max(0, (temperatureC - 450) / 550));
  const color = new Color("#5a2419").lerp(new Color("#ffad45"), heat);
  return isImpacted ? color.lerp(new Color("#fff2ae"), 0.75) : color;
}

function sectionIndexAt(position: number, sections: readonly ForgeSnapshotSection[]): number | null {
  const index = sections.findIndex(
    (section) => position >= section.position - section.length / 2 && position <= section.position + section.length / 2,
  );
  return index >= 0 ? index : null;
}
