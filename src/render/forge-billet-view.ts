import {
  AmbientLight,
  BufferAttribute,
  BufferGeometry,
  Color,
  DirectionalLight,
  Group,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  Raycaster,
  Scene,
  Vector2,
  WebGLRenderer,
  BoxGeometry,
  DoubleSide,
} from "three";

import type { ForgeSnapshot, ForgeSnapshotSection } from "../forge/index.ts";

const RING_VERTEX_COUNT = 4;
const VISUAL_THICKNESS_SCALE = 2.4;
const BILLET_MATERIAL = new MeshStandardMaterial({
  metalness: 0.82,
  roughness: 0.34,
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
  private readonly camera = new PerspectiveCamera(38, 1, 0.1, 1000);
  private readonly raycaster = new Raycaster();
  private readonly pointer = new Vector2();
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
    this.scene.background = new Color("#171817");
    this.scene.add(new AmbientLight("#ffbc86", 0.8));

    const keyLight = new DirectionalLight("#ffd2a8", 3.2);
    keyLight.position.set(120, 170, 120);
    this.scene.add(keyLight);

    this.scene.add(this.createAnvil());
    this.scene.add(this.billet);
    this.camera.position.set(258, 174, 265);
    this.camera.lookAt(165, 0, 0);
    this.resize(viewport);
  }

  update(snapshot: ForgeSnapshot, impactSectionIndex: number | null = null): void {
    this.snapshot = snapshot;
    const nextGeometry = createBilletGeometry(snapshot.sections, impactSectionIndex);
    this.billet.geometry.dispose();
    this.billet.geometry = nextGeometry;
    this.render();
  }

  resize(viewport: RenderViewport): void {
    this.viewport = viewport;
    this.renderer.setPixelRatio(Math.min(viewport.pixelRatio, 2));
    this.renderer.setSize(viewport.width, viewport.height, false);
    this.camera.aspect = viewport.width / viewport.height;
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

  private createAnvil(): Group {
    const anvil = new Group();
    const material = new MeshStandardMaterial({ color: "#303536", metalness: 0.8, roughness: 0.52 });

    const face = new Mesh(new BoxGeometry(240, 9, 82), material);
    face.position.set(165, -24, 0);
    const waist = new Mesh(new BoxGeometry(94, 52, 54), material);
    waist.position.set(165, -53, 0);
    const foot = new Mesh(new BoxGeometry(160, 12, 92), material);
    foot.position.set(165, -84, 0);
    anvil.add(face, waist, foot);
    return anvil;
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
