import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { BokehPass } from 'three/examples/jsm/postprocessing/BokehPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

export type ProceduralModelOptions = {
  wireframe?: boolean;
  castShadow?: boolean;
  receiveShadow?: boolean;
  textureSize?: number;
  textureAnisotropy?: number;
  qualityPriority?: 'reference-fidelity' | 'balanced';
};

export type ProceduralModelRuntime = {
  nodes: Record<string, THREE.Object3D>;
  meshes: Record<string, THREE.Mesh>;
  sockets: Record<string, THREE.Object3D>;
  colliders: Record<string, unknown>;
  destructionGroups: Record<string, THREE.Object3D[]>;
};

type SculptMaterialSpec = Record<string, any>;

// bevelEnabled defaults to true on THREE.ExtrudeGeometry and rounds every
// corner — sharp/pointed profiles (blades, fork tines, spikes) need
// bevelEnabled: false plus lineTo()-only path segments near the tip, since a
// curve command cannot produce a true converging point.
function buildExtrudeShape(points: [number, number][], holes?: [number, number][][]): THREE.Shape {
  const shape = new THREE.Shape();
  if (points.length > 0) {
    shape.moveTo(points[0][0], points[0][1]);
    for (let i = 1; i < points.length; i += 1) {
      shape.lineTo(points[i][0], points[i][1]);
    }
  }
  // Cutouts (e.g. an oval wire-cutter hole) as THREE.Path added to shape.holes —
  // dep-free boolean subtraction via the tessellator, no CSG library needed.
  for (const loop of holes ?? []) {
    if (loop.length < 3) continue;
    const path = new THREE.Path();
    path.moveTo(loop[0][0], loop[0][1]);
    for (let i = 1; i < loop.length; i += 1) path.lineTo(loop[i][0], loop[i][1]);
    path.closePath();
    shape.holes.push(path);
  }
  return shape;
}

// Build an N-gon oval loop (for hole authoring from a compact {cx,cy,rx,ry} descriptor).
function ovalLoop(cx: number, cy: number, rx: number, ry: number, seg = 24): [number, number][] {
  const loop: [number, number][] = [];
  for (let i = 0; i < seg; i += 1) {
    const a = (i / seg) * Math.PI * 2;
    loop.push([cx + Math.cos(a) * rx, cy + Math.sin(a) * ry]);
  }
  return loop;
}

function buildExtrudeGeometry(profile: { points: [number, number][]; depth: number; holes?: [number, number][][]; ovalHoles?: { cx: number; cy: number; rx: number; ry: number }[] }): THREE.ExtrudeGeometry {
  const holes = [...(profile.holes ?? []), ...((profile.ovalHoles ?? []).map((o) => ovalLoop(o.cx, o.cy, o.rx, o.ry)))];
  const shape = buildExtrudeShape(profile.points, holes);
  return new THREE.ExtrudeGeometry(shape, {
    depth: profile.depth,
    bevelEnabled: false,
    steps: 1,
  });
}

function buildLatheGeometry(profile: { points: [number, number][]; segments?: number }): THREE.LatheGeometry {
  const points = profile.points.map(([x, y]) => new THREE.Vector2(Math.max(0.0001, x), y));
  return new THREE.LatheGeometry(points, profile.segments ?? 24);
}

function hashString(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function readLayerNumber(value: unknown, keys: string[], fallback: number): number {
  if (typeof value === 'number') return value;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    for (const key of keys) {
      if (typeof record[key] === 'number') return record[key] as number;
    }
  }
  return fallback;
}

function hexToRgb(hex: string): [number, number, number] {
  const normalized = /^#[0-9a-f]{3}$/i.test(hex)
    ? '#' + hex.slice(1).split('').map((part) => part + part).join('')
    : hex;
  const value = /^#[0-9a-f]{6}$/i.test(normalized) ? Number.parseInt(normalized.slice(1), 16) : 0x8a7a5f;
  return [clampAlbedoChannel((value >> 16) & 255), clampAlbedoChannel((value >> 8) & 255), clampAlbedoChannel(value & 255)];
}

function materialPalette(spec: SculptMaterialSpec): string[] {
  const palette = spec.colorVariation?.palette;
  if (Array.isArray(palette) && palette.length > 0) return palette.filter((value) => typeof value === 'string');
  const secondary = spec.albedo?.secondary;
  const colors = [spec.baseColor ?? spec.color ?? spec.albedo?.dominant, ...(Array.isArray(secondary) ? secondary : [])];
  return colors.filter((value): value is string => typeof value === 'string' && value.startsWith('#'));
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function clampAlbedoChannel(value: number): number {
  return Math.max(30, Math.min(240, Math.round(value)));
}

function clampPbrF0(value: number): number {
  return Math.max(0.02, Math.min(1, value));
}

function clampPbrIor(value: number): number {
  return Math.max(1, Math.min(2.5, value));
}

function clampPbrMetalness(value: number): number {
  return value >= 0.5 ? 1 : 0;
}

function clampedAlbedoColor(spec: SculptMaterialSpec): THREE.Color {
  const source = typeof spec.baseColor === 'string' ? spec.baseColor : '#8A7A5F';
  // setStyle with an explicit SRGBColorSpace, NOT the numeric constructor.
  //
  // `new THREE.Color(r, g, b)` treats its arguments as LINEAR working-space components,
  // while an authored `baseColor` hex is sRGB. Feeding one to the other skipped the
  // transfer function and lifted every dark albedo: #2e2a28, authored as a near-black
  // vinyl, rendered at roughly sRGB 0.46 — a mid grey. The error is largest exactly where
  // it matters most, because the transfer curve is steepest near black.
  return new THREE.Color().setStyle(source, THREE.SRGBColorSpace);
}

function smoothCurve(value: number): number {
  return value * value * (3 - 2 * value);
}

function periodicHash(x: number, y: number, seed: number, periodX: number, periodY: number): number {
  const wrappedX = ((x % periodX) + periodX) % periodX;
  const wrappedY = ((y % periodY) + periodY) % periodY;
  let value = Math.imul(wrappedX + seed * 17, 374761393) ^ Math.imul(wrappedY + seed * 31, 668265263);
  value = Math.imul(value ^ (value >>> 13), 1274126177);
  return ((value ^ (value >>> 16)) >>> 0) / 4294967295;
}

function periodicValueNoise(u: number, v: number, seed: number, periodX: number, periodY: number): number {
  const x = u * periodX;
  const y = v * periodY;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const tx = smoothCurve(x - x0);
  const ty = smoothCurve(y - y0);
  const a = periodicHash(x0, y0, seed, periodX, periodY);
  const b = periodicHash(x0 + 1, y0, seed, periodX, periodY);
  const c = periodicHash(x0, y0 + 1, seed, periodX, periodY);
  const d = periodicHash(x0 + 1, y0 + 1, seed, periodX, periodY);
  return THREE.MathUtils.lerp(THREE.MathUtils.lerp(a, b, tx), THREE.MathUtils.lerp(c, d, tx), ty);
}

type SurfaceBand = {
  frequency: number;
  amplitude: number;
  stretchX: number;
  stretchY: number;
  ridge: boolean;
};

function surfaceBands(spec: SculptMaterialSpec): SurfaceBand[] {
  const source = Array.isArray(spec.surfaceFrequencyBands) ? spec.surfaceFrequencyBands : [];
  const parsed = source.flatMap((item: unknown) => {
    if (!item || typeof item !== 'object') return [];
    const band = item as Record<string, unknown>;
    const frequency = typeof band.frequency === 'number' ? band.frequency : 0;
    const amplitude = typeof band.amplitude === 'number' ? band.amplitude : 0;
    if (frequency <= 0 || amplitude <= 0) return [];
    const stretch = Array.isArray(band.stretch) ? band.stretch : [1, 1];
    const description = `${String(band.pattern ?? '')} ${String(band.role ?? '')}`.toLowerCase();
    return [{
      frequency,
      amplitude,
      stretchX: typeof stretch[0] === 'number' ? Math.max(0.1, stretch[0]) : 1,
      stretchY: typeof stretch[1] === 'number' ? Math.max(0.1, stretch[1]) : 1,
      ridge: /(ridge|groove|grain|fiber|striated|crack)/.test(description),
    }];
  });
  return parsed.length > 0 ? parsed : [
    { frequency: 2, amplitude: 0.42, stretchX: 1, stretchY: 1, ridge: false },
    { frequency: 12, amplitude: 0.22, stretchX: 1, stretchY: 1, ridge: false },
    { frequency: 56, amplitude: 0.08, stretchX: 1, stretchY: 1, ridge: false },
  ];
}

function sampleSurface(u: number, v: number, bands: SurfaceBand[], seed: number): number {
  let value = 0;
  let weight = 0;
  for (let index = 0; index < bands.length; index += 1) {
    const band = bands[index];
    const periodX = Math.max(1, Math.round(band.frequency * band.stretchX));
    const periodY = Math.max(1, Math.round(band.frequency * band.stretchY));
    let sample = periodicValueNoise(u, v, seed + index * 1013, periodX, periodY);
    if (band.ridge) sample = 1 - Math.abs(sample * 2 - 1);
    value += sample * band.amplitude;
    weight += band.amplitude;
  }
  return weight > 0 ? clamp01(value / weight) : 0.5;
}

function mixPalette(colors: [number, number, number][], value: number): [number, number, number] {
  if (colors.length === 1) return colors[0];
  const scaled = clamp01(value) * (colors.length - 1);
  const index = Math.min(colors.length - 2, Math.floor(scaled));
  const mix = scaled - index;
  const a = colors[index];
  const b = colors[index + 1];
  return [
    Math.round(THREE.MathUtils.lerp(a[0], b[0], mix)),
    Math.round(THREE.MathUtils.lerp(a[1], b[1], mix)),
    Math.round(THREE.MathUtils.lerp(a[2], b[2], mix)),
  ];
}

type ColorGradientStop = { offset: number; color: string };
type ColorGradientSpec = {
  type: 'linear' | 'radial';
  axis: [number, number];
  stops: ColorGradientStop[];
};

function parseRgba(value: string): [number, number, number] {
  const match = /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/.exec(value);
  if (!match) return [138, 122, 95];
  return [clampAlbedoChannel(Number(match[1])), clampAlbedoChannel(Number(match[2])), clampAlbedoChannel(Number(match[3]))];
}

// Analytical per-pixel gradient sample. The extraction schema's colorGradient carries
// exact rgba(...) stop colors (see extract_part_color_recipe.py), so this samples the
// same trend directly in JS math rather than round-tripping through a Canvas 2D
// createLinearGradient/createRadialGradient object — same visual result, and it composes
// directly with the existing noise/height-correlated colorVariation blend below.
function sampleColorGradient(gradient: ColorGradientSpec, u: number, v: number): [number, number, number] {
  const stops = gradient.stops.length >= 2 ? gradient.stops : [{ offset: 0, color: 'rgba(138,122,95,1)' }, { offset: 1, color: 'rgba(138,122,95,1)' }];
  let t: number;
  if (gradient.type === 'radial') {
    const [cx, cy] = gradient.axis;
    const dx = u - cx;
    const dy = v - cy;
    const maxRadius = Math.max(0.001, Math.hypot(Math.max(cx, 1 - cx), Math.max(cy, 1 - cy)));
    t = clamp01(Math.hypot(dx, dy) / maxRadius);
  } else {
    const [ax, ay] = gradient.axis;
    const projection = (u - 0.5) * ax + (v - 0.5) * ay;
    const maxProjection = 0.5 * (Math.abs(ax) + Math.abs(ay)) || 0.5;
    t = clamp01(projection / maxProjection + 0.5);
  }
  const scaled = t * (stops.length - 1);
  const index = Math.min(stops.length - 2, Math.max(0, Math.floor(scaled)));
  const mix = scaled - index;
  const a = parseRgba(stops[index].color);
  const b = parseRgba(stops[index + 1].color);
  return [
    THREE.MathUtils.lerp(a[0], b[0], mix),
    THREE.MathUtils.lerp(a[1], b[1], mix),
    THREE.MathUtils.lerp(a[2], b[2], mix),
  ];
}

function writePixel(data: Uint8ClampedArray, offset: number, red: number, green: number, blue: number): void {
  data[offset] = Math.max(0, Math.min(255, Math.round(red)));
  data[offset + 1] = Math.max(0, Math.min(255, Math.round(green)));
  data[offset + 2] = Math.max(0, Math.min(255, Math.round(blue)));
  data[offset + 3] = 255;
}

function makeCanvas(size: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  return canvas;
}

function createMapTexture(
  canvas: HTMLCanvasElement,
  colorSpace: THREE.ColorSpace,
  spec: SculptMaterialSpec,
  options: ProceduralModelOptions,
): THREE.CanvasTexture {
  const texture = new THREE.CanvasTexture(canvas);
  const projection = spec.textureProjection && typeof spec.textureProjection === 'object' ? spec.textureProjection : {};
  const repeat = Array.isArray(projection.repeat) ? projection.repeat : [2, 2];
  texture.colorSpace = colorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(
    typeof repeat[0] === 'number' ? repeat[0] : 2,
    typeof repeat[1] === 'number' ? repeat[1] : 2,
  );
  texture.anisotropy = Math.max(1, Math.round(options.textureAnisotropy ?? projection.anisotropy ?? 8));
  texture.needsUpdate = true;
  return texture;
}

type ProceduralTextureSet = {
  albedo: THREE.Texture;
  roughness: THREE.Texture;
  height: THREE.Texture;
  normal: THREE.Texture;
  ao: THREE.Texture;
  source: 'reference-pixel-extraction' | 'procedural';
};

function referenceMapUrl(spec: SculptMaterialSpec, channel: string): string | null {
  const reference = spec.referencePbr;
  if (!reference || typeof reference !== 'object') return null;
  if (reference.usable === false) return null;
  const confidence = typeof reference.confidence === 'number'
    ? reference.confidence
    : (typeof reference.estimatedFidelity === 'number' ? reference.estimatedFidelity : 0);
  const threshold = typeof reference.targetThreshold === 'number' ? reference.targetThreshold : 0.7;
  if (confidence < threshold) return null;
  const maps = reference.maps;
  if (!maps || typeof maps !== 'object') return null;
  const map = (maps as Record<string, unknown>)[channel];
  if (!map || typeof map !== 'object') return null;
  const record = map as Record<string, unknown>;
  const url = typeof record.url === 'string' && record.url.trim() ? record.url : record.path;
  return typeof url === 'string' && url.trim() ? url : null;
}

function createLoadedMapTexture(
  url: string,
  colorSpace: THREE.ColorSpace,
  spec: SculptMaterialSpec,
  options: ProceduralModelOptions,
): THREE.Texture {
  const texture = new THREE.TextureLoader().load(url);
  const projection = spec.textureProjection && typeof spec.textureProjection === 'object' ? spec.textureProjection : {};
  const repeat = Array.isArray(projection.repeat) ? projection.repeat : [1, 1];
  texture.colorSpace = colorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(
    typeof repeat[0] === 'number' ? repeat[0] : 1,
    typeof repeat[1] === 'number' ? repeat[1] : 1,
  );
  texture.anisotropy = Math.max(1, Math.round(options.textureAnisotropy ?? projection.anisotropy ?? 8));
  texture.needsUpdate = true;
  return texture;
}

function makeReferenceTextureSet(spec: SculptMaterialSpec, options: ProceduralModelOptions): ProceduralTextureSet | null {
  const albedo = referenceMapUrl(spec, 'albedo');
  const roughness = referenceMapUrl(spec, 'roughness');
  const height = referenceMapUrl(spec, 'height');
  const normal = referenceMapUrl(spec, 'normal');
  const ao = referenceMapUrl(spec, 'ao');
  if (!albedo || !roughness || !height || !normal || !ao) return null;
  return {
    albedo: createLoadedMapTexture(albedo, THREE.SRGBColorSpace, spec, options),
    roughness: createLoadedMapTexture(roughness, THREE.NoColorSpace, spec, options),
    height: createLoadedMapTexture(height, THREE.NoColorSpace, spec, options),
    normal: createLoadedMapTexture(normal, THREE.NoColorSpace, spec, options),
    ao: createLoadedMapTexture(ao, THREE.NoColorSpace, spec, options),
    source: 'reference-pixel-extraction',
  };
}

function makeProceduralTextureSet(
  id: string,
  spec: SculptMaterialSpec,
  options: ProceduralModelOptions,
): ProceduralTextureSet | null {
  if (typeof document === 'undefined') return null;
  const qualityFirst = (options.qualityPriority ?? 'reference-fidelity') === 'reference-fidelity';
  const requested = options.textureSize ?? spec.textureResolution;
  const requestedSize = typeof requested === 'number' && Number.isFinite(requested)
    ? requested
    : (qualityFirst ? 1024 : 512);
  const size = Math.max(256, Math.min(2048, 2 ** Math.round(Math.log2(requestedSize))));
  const canvases = {
    albedo: makeCanvas(size),
    roughness: makeCanvas(size),
    height: makeCanvas(size),
    normal: makeCanvas(size),
    ao: makeCanvas(size),
  };
  const contexts = {
    albedo: canvases.albedo.getContext('2d'),
    roughness: canvases.roughness.getContext('2d'),
    height: canvases.height.getContext('2d'),
    normal: canvases.normal.getContext('2d'),
    ao: canvases.ao.getContext('2d'),
  };
  if (!contexts.albedo || !contexts.roughness || !contexts.height || !contexts.normal || !contexts.ao) return null;
  const images = {
    albedo: contexts.albedo.createImageData(size, size),
    roughness: contexts.roughness.createImageData(size, size),
    height: contexts.height.createImageData(size, size),
    normal: contexts.normal.createImageData(size, size),
    ao: contexts.ao.createImageData(size, size),
  };
  const seed = hashString(id);
  const bands = surfaceBands(spec);
  const heightField = new Float32Array(size * size);
  const roughnessField = new Float32Array(size * size);
  const palette = materialPalette(spec);
  const fallback = typeof spec.baseColor === 'string' ? spec.baseColor : '#8A7A5F';
  const colors = (palette.length >= 2 ? palette : [fallback, '#6E614B', '#A08F70']).map(hexToRgb);
  const baseRoughness = clamp01(readLayerNumber(spec.roughness, ['base'], 0.76));
  const roughnessVariation = clamp01(readLayerNumber(spec.roughness, ['variation'], 0.18));
  const colorAmplitude = clamp01(readLayerNumber(spec.colorVariation, ['amplitude', 'variation'], 0.18));
  const heightCorrelation = clamp01(readLayerNumber(spec.colorVariation, ['heightCorrelation'], 0.3));
  const colorGradient: ColorGradientSpec | undefined = spec.colorGradient;
  for (let y = 0; y < size; y += 1) {
    const v = y / size;
    for (let x = 0; x < size; x += 1) {
      const u = x / size;
      const index = y * size + x;
      const height = sampleSurface(u, v, bands, seed + 101);
      const roughNoise = sampleSurface(u, v, bands, seed + 7001);
      const colorNoise = sampleSurface(u, v, bands, seed + 15013);
      heightField[index] = height;
      roughnessField[index] = clamp01(baseRoughness + (roughNoise - 0.5) * roughnessVariation * 2);
      let color: [number, number, number];
      if (colorGradient) {
        // Evidence-derived spatial gradient (Plan 1.3 Workstream C) takes priority
        // over the noise-based palette blend below — it is a measured trend, not a guess.
        color = sampleColorGradient(colorGradient, u, v);
      } else {
        const paletteValue = clamp01(
          0.5 + (colorNoise - 0.5) * colorAmplitude * 2 + (height - 0.5) * heightCorrelation
        );
        color = mixPalette(colors, paletteValue);
      }
      writePixel(images.albedo.data, index * 4, color[0], color[1], color[2]);
    }
  }
  const normalStrength = Math.max(0.05, readLayerNumber(spec.normal, ['strength', 'amplitude'], 0.35));
  const aoStrength = clamp01(readLayerNumber(spec.ambientOcclusion, ['cavityStrength', 'strength'], 0.35));
  for (let y = 0; y < size; y += 1) {
    const up = ((y - 1 + size) % size) * size;
    const down = ((y + 1) % size) * size;
    for (let x = 0; x < size; x += 1) {
      const left = (x - 1 + size) % size;
      const right = (x + 1) % size;
      const index = y * size + x;
      const center = heightField[index];
      const dx = (heightField[y * size + right] - heightField[y * size + left]) * normalStrength * 6;
      const dy = (heightField[down + x] - heightField[up + x]) * normalStrength * 6;
      const inverseLength = 1 / Math.sqrt(dx * dx + dy * dy + 1);
      const normalX = -dx * inverseLength;
      const normalY = -dy * inverseLength;
      const normalZ = inverseLength;
      const neighborAverage = (
        heightField[y * size + left] + heightField[y * size + right]
        + heightField[up + x] + heightField[down + x]
      ) * 0.25;
      const cavity = Math.max(0, neighborAverage - center);
      const ao = clamp01(1 - aoStrength * (cavity * 12 + (1 - center) * 0.16));
      const offset = index * 4;
      const heightByte = center * 255;
      const roughnessByte = roughnessField[index] * 255;
      writePixel(images.height.data, offset, heightByte, heightByte, heightByte);
      writePixel(images.roughness.data, offset, roughnessByte, roughnessByte, roughnessByte);
      writePixel(
        images.normal.data, offset,
        (normalX * 0.5 + 0.5) * 255,
        (normalY * 0.5 + 0.5) * 255,
        (normalZ * 0.5 + 0.5) * 255,
      );
      writePixel(images.ao.data, offset, ao * 255, ao * 255, ao * 255);
    }
  }
  contexts.albedo.putImageData(images.albedo, 0, 0);
  contexts.roughness.putImageData(images.roughness, 0, 0);
  contexts.height.putImageData(images.height, 0, 0);
  contexts.normal.putImageData(images.normal, 0, 0);
  contexts.ao.putImageData(images.ao, 0, 0);
  return {
    albedo: createMapTexture(canvases.albedo, THREE.SRGBColorSpace, spec, options),
    roughness: createMapTexture(canvases.roughness, THREE.NoColorSpace, spec, options),
    height: createMapTexture(canvases.height, THREE.NoColorSpace, spec, options),
    normal: createMapTexture(canvases.normal, THREE.NoColorSpace, spec, options),
    ao: createMapTexture(canvases.ao, THREE.NoColorSpace, spec, options),
    source: 'procedural',
  };
}

function createSculptMaterial(id: string, spec: SculptMaterialSpec, options: ProceduralModelOptions, denseComponent = false): THREE.MeshPhysicalMaterial {
  // A material that declares -- with evidence -- that its subject carries no texture
  // detail gets NO texture set. Synthesising one anyway is not a harmless default: the
  // branch below then forces color to white and roughness to 1 and reads both from the
  // generated maps, so the authored albedo and the reference-derived roughness are both
  // discarded, and the model gains mottling the reference does not have. Measured on the
  // tuxedo cat, whose black fur rendered as speckled grey-and-white from a palette that
  // only ever described two flat regions.
  const textureless = (spec.textureless as { declared?: boolean } | undefined)?.declared === true;
  const textures = textureless
    ? null
    : makeReferenceTextureSet(spec, options) ?? makeProceduralTextureSet(id, spec, options);
  const material = new THREE.MeshPhysicalMaterial({
    color: textures ? 0xffffff : clampedAlbedoColor(spec),
    roughness: textures ? 1 : clamp01(readLayerNumber(spec.roughness, ['base'], 0.76)),
    metalness: clampPbrMetalness(readLayerNumber(spec.metalness, ['base'], 0.0)),
    clearcoat: clamp01(readLayerNumber(spec.clearcoat, ['base', 'amount'], 0)),
    clearcoatRoughness: clamp01(readLayerNumber(spec.clearcoatRoughness, ['base'], 0.25)),
    transmission: clamp01(readLayerNumber(spec.transmission, ['base', 'amount'], 0)),
    ior: clampPbrIor(readLayerNumber(spec.ior, ['base', 'value'], 1.5)),
    thickness: Math.max(0, readLayerNumber(spec.thickness, ['base', 'amount'], 0)),
    attenuationDistance: Math.max(0.001, readLayerNumber(spec.attenuationDistance, ['base', 'value'], Infinity)),
    attenuationColor: new THREE.Color(typeof spec.attenuationColor === 'string' ? spec.attenuationColor : '#ffffff'),
    sheen: clamp01(readLayerNumber(spec.sheen, ['base', 'amount'], 0)),
    sheenColor: new THREE.Color(typeof spec.sheenColor === 'string' ? spec.sheenColor : '#ffffff'),
    sheenRoughness: clamp01(readLayerNumber(spec.sheenRoughness, ['base'], 1.0)),
    iridescence: clamp01(readLayerNumber(spec.iridescence, ['base', 'amount'], 0)),
    iridescenceIOR: clampPbrIor(readLayerNumber(spec.iridescenceIOR, ['base', 'value'], 1.3)),
    anisotropy: clamp01(readLayerNumber(spec.anisotropy, ['base', 'amount'], 0)),
    anisotropyRotation: readLayerNumber(spec.anisotropy, ['rotation'], 0),
    specularIntensity: clampPbrF0(readLayerNumber(spec.specularF0 ?? spec.f0 ?? spec.specularIntensity, ['base', 'value'], 1.0)),
    specularColor: new THREE.Color(typeof spec.specularColor === 'string' ? spec.specularColor : '#ffffff'),
    emissive: new THREE.Color(typeof spec.emissive === 'string' ? spec.emissive : '#000000'),
    emissiveIntensity: Math.max(0, readLayerNumber(spec.emissiveIntensity, ['base'], 1.0)),
    opacity: clamp01(readLayerNumber(spec.opacity, ['base'], 1)),
    transparent: readLayerNumber(spec.transmission, ['base', 'amount'], 0) > 0 || readLayerNumber(spec.opacity, ['base'], 1) < 1,
    alphaTest: Math.max(0, readLayerNumber(spec.alpha, ['cutoff', 'alphaTest'], 0)),
    wireframe: options.wireframe ?? false,
    side: spec.doubleSided === true ? THREE.DoubleSide : THREE.FrontSide,
    flatShading: spec.flatShading === true,
  });
  if (textures) {
    material.map = textures.albedo;
    material.roughnessMap = textures.roughness;
    material.normalMap = textures.normal;
    material.normalScale.setScalar(Math.max(0.05, readLayerNumber(spec.normal, ['strength', 'amplitude'], 0.35)));
    material.aoMap = textures.ao;
    material.aoMap.channel = 0;
    material.aoMapIntensity = readLayerNumber(spec.ambientOcclusion, ['cavityStrength', 'strength'], 0.35);
    const denseMesh = denseComponent || spec.denseMesh === true || spec.geometryDensity === 'dense' || spec.topologyClass === 'dense';
    const bumpScale = Math.max(0, readLayerNumber(spec.bump, ['amplitude', 'strength'], 0));
    const effectiveBumpScale = denseMesh ? Math.max(0.05, bumpScale) : bumpScale;
    if (effectiveBumpScale > 0) {
      material.bumpMap = textures.height;
      material.bumpScale = effectiveBumpScale;
    }
    const displacementScale = Math.max(0, readLayerNumber(spec.displacement, ['amplitude', 'strength'], 0));
    const effectiveDisplacementScale = denseMesh ? Math.max(0.005, displacementScale) : displacementScale;
    if (effectiveDisplacementScale > 0) {
      material.displacementMap = textures.height;
      material.displacementScale = effectiveDisplacementScale;
      material.displacementBias = -effectiveDisplacementScale * 0.5;
    }
  }
  material.envMapIntensity = readLayerNumber(spec, ['envMapIntensity'], 0.8);
  material.userData.sculptMaterial = spec;
  material.userData.proceduralMapsIndependent = true;
  material.userData.pbrConstraints = { albedoRange: [30, 240], binaryMetalness: true, f0Range: [0.02, 1], iorRange: [1, 2.5] };
  material.userData.pbrTextureSource = textures?.source ?? 'flat-fallback';
  material.userData.referencePbr = spec.referencePbr ?? null;
  material.userData.referenceMaterialId = spec.referenceMaterialId ?? spec.materialReference?.profileId ?? null;
  material.userData.materialEvidence = spec.materialEvidence ?? null;
  material.userData.validationViews = spec.materialReference?.validationViews ?? [];
  material.needsUpdate = true;
  return material;
}

type AttachmentEndpoint = {
  start: THREE.Vector3;
  midpoint: THREE.Vector3;
  quaternion: THREE.Quaternion;
  length: number;
  baseRadius: number;
  endRadius: number;
};

function readVector3(value: unknown, fallback: [number, number, number]): THREE.Vector3 {
  if (Array.isArray(value) && value.length === 3 && value.every((item) => typeof item === 'number')) {
    return new THREE.Vector3(value[0], value[1], value[2]);
  }
  return new THREE.Vector3(fallback[0], fallback[1], fallback[2]);
}

function readNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function makeAttachmentEndpoint(attachment: unknown): AttachmentEndpoint | null {
  if (!attachment || typeof attachment !== 'object') return null;
  const record = attachment as Record<string, unknown>;
  const start = readVector3(record.localStart, [0, 0, 0]);
  const end = readVector3(record.localEnd, [0, 1, 0]);
  const delta = end.clone().sub(start);
  const length = delta.length();
  if (length <= 0.0001) return null;
  const direction = delta.clone().normalize();
  const quaternion = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction);
  const baseRadius = Math.max(0.005, readNumber(record.baseRadius, 0.06));
  const endRadius = Math.max(0.003, readNumber(record.endRadius, baseRadius * 0.55));
  return {
    start,
    midpoint: delta.multiplyScalar(0.5),
    quaternion,
    length,
    baseRadius,
    endRadius,
  };
}

// Generated from ObjectSculptSpec target: Early Industrial Pneumatic Power Hammer
// Sculpt build pass: blockout
// This factory is intentionally pass-gated. Finish browser screenshot review before unlocking deeper passes.
export function createEarlyIndustrialPneumaticPowerHammerModel(options: ProceduralModelOptions = {}): THREE.Group {
  const root = new THREE.Group();
  root.name = "Early Industrial Pneumatic Power Hammer";
  root.userData.reconstructionEvidence = {"itemFamily": null, "subtype": null, "componentAdapter": null, "route": null, "exactnessTier": null, "referenceCamera": {"solved": false, "fovDegrees": 40, "aspect": 0.8002853067047075, "orientation": {"yaw": 50, "pitch": 13.2, "roll": 0}, "positionHint": [0.746, 0.228, 0.626], "note": "Manual orthographic estimate from main base-edge slopes (~0.27 and ~0.19); not a solved calibration. Compare paired screenshots before approval."}, "approximationNotes": []};
  root.userData.materialPipeline = {};
  root.userData.materialReferenceRegistry = null;

  const materialMap: Record<string, THREE.Material> = {};
  materialMap["iron"] = createSculptMaterial(
    "iron",
    {"id": "iron", "name": "iron", "type": "standard", "shaderModel": "MeshStandardMaterial / PBR approximation", "baseColor": "#55575a", "color": "#55575a", "albedo": {"dominant": "#6A6463", "secondary": ["#78716F", "#8F8783", "#A79E96", "#483E37"], "samplingNotes": "Extracted palette includes lighting; relighting review required."}, "colorVariation": {"palette": ["#6A6463", "#78716F", "#8F8783", "#A79E96", "#483E37"], "pattern": "mottled", "amplitude": 0.15, "heightCorrelation": 0.3}, "textureResolution": 1024, "textureProjection": {"mode": "uv", "repeat": [2, 2], "anisotropy": 8, "texelDensityIntent": "Preserve stable world/object-scale detail; do not stretch micro detail with component scale."}, "surfaceFrequencyBands": [{"id": "macro", "frequency": 2, "amplitude": 0.42, "role": "broad color and height breakup"}, {"id": "meso", "frequency": 12, "amplitude": 0.22, "role": "ridges, pores, grain, dents, or equivalent visible relief"}, {"id": "micro", "frequency": 56, "amplitude": 0.08, "role": "highlight breakup visible under grazing light"}], "roughness": {"base": 0.76, "variation": 0.15, "map": "independent-procedural-field", "localResponse": "higher roughness in cavities, lower roughness on worn edges"}, "metalness": {"base": 0.85, "variation": 0}, "normal": {"pattern": "derived-from-independent-height-field", "strength": 0.1, "scale": 24, "space": "tangent"}, "bump": {"pattern": "none", "amplitude": 0, "scale": 1}, "displacement": {"pattern": "none", "amplitude": 0, "scale": 1, "silhouetteAffects": false}, "ambientOcclusion": {"cavityStrength": 0.25, "contactShadowBias": 0.35, "notes": "Darken creases, seams, intersections, and recessed local features."}, "wear": {"edgeWear": 0, "scratches": [], "chips": []}, "dirt": {"amount": 0, "cavityBias": 0, "color": "#2F2A22"}, "localOverrides": [{"id": "edge-wear", "region": "exposed edges", "roughness": 0.61, "evidenceRefs": ["full-object"], "confidence": 0.75}], "shaderNotes": ["Prefer MeshPhysicalMaterial when clearcoat, sheen, transmission, or thin-surface response is observed; otherwise use MeshStandardMaterial-compatible PBR channels.", "Generate albedo, roughness, height/normal, and AO independently; never alias albedo into roughness.", "Use normal/bump/displacement only when they map to observed surface relief.", "Use displacement geometry when the observed relief changes the close-up silhouette; texture-only relief is insufficient there."], "notes": "Extraction threshold passed, not rendered material acceptance.", "referencePbr": {"usable": true, "confidence": 0.86, "targetThreshold": 0.7, "sourceImage": "D:\\打了个铁\\Weapon-Forger-hammer\\.img2threejs\\power-hammer-v2\\material-crops\\iron.png", "maps": {"albedo": {"path": "D:\\打了个铁\\Weapon-Forger-hammer\\.img2threejs\\power-hammer-v2\\material-evidence\\iron\\iron_albedo.png", "url": "iron_albedo.png", "channel": "albedo", "source": "reference-pixel-extraction"}, "roughness": {"path": "D:\\打了个铁\\Weapon-Forger-hammer\\.img2threejs\\power-hammer-v2\\material-evidence\\iron\\iron_roughness.png", "url": "iron_roughness.png", "channel": "roughness", "source": "reference-pixel-extraction"}, "height": {"path": "D:\\打了个铁\\Weapon-Forger-hammer\\.img2threejs\\power-hammer-v2\\material-evidence\\iron\\iron_height.png", "url": "iron_height.png", "channel": "height", "source": "reference-pixel-extraction"}, "normal": {"path": "D:\\打了个铁\\Weapon-Forger-hammer\\.img2threejs\\power-hammer-v2\\material-evidence\\iron\\iron_normal.png", "url": "iron_normal.png", "channel": "normal", "source": "reference-pixel-extraction"}, "ao": {"path": "D:\\打了个铁\\Weapon-Forger-hammer\\.img2threejs\\power-hammer-v2\\material-evidence\\iron\\iron_ao.png", "url": "iron_ao.png", "channel": "ao", "source": "reference-pixel-extraction"}}, "method": "reference-pixel-extraction", "limitation": "single-image PBR extraction is an estimate; 70%+ extraction confidence still needs render screenshot review Candidate evidence only: reflection bands and casting curvature must not become relief."}},
    options
  );
  materialMap["steel"] = createSculptMaterial(
    "steel",
    {"id": "steel", "name": "steel", "type": "standard", "shaderModel": "MeshStandardMaterial / PBR approximation", "baseColor": "#aaa9a5", "color": "#aaa9a5", "albedo": {"dominant": "#847A75", "secondary": ["#695F5A", "#302824", "#BDAFA4", "#FAF1E5"], "samplingNotes": "Extracted palette includes lighting; relighting review required."}, "colorVariation": {"palette": ["#847A75", "#695F5A", "#302824", "#BDAFA4", "#FAF1E5"], "pattern": "mottled", "amplitude": 0.15, "heightCorrelation": 0.3}, "textureResolution": 1024, "textureProjection": {"mode": "uv", "repeat": [2, 2], "anisotropy": 8, "texelDensityIntent": "Preserve stable world/object-scale detail; do not stretch micro detail with component scale."}, "surfaceFrequencyBands": [{"id": "macro", "frequency": 2, "amplitude": 0.42, "role": "broad color and height breakup"}, {"id": "meso", "frequency": 12, "amplitude": 0.22, "role": "ridges, pores, grain, dents, or equivalent visible relief"}, {"id": "micro", "frequency": 56, "amplitude": 0.08, "role": "highlight breakup visible under grazing light"}], "roughness": {"base": 0.24, "variation": 0.15, "map": "independent-procedural-field", "localResponse": "higher roughness in cavities, lower roughness on worn edges"}, "metalness": {"base": 1, "variation": 0}, "normal": {"pattern": "derived-from-independent-height-field", "strength": 0.1, "scale": 24, "space": "tangent"}, "bump": {"pattern": "none", "amplitude": 0, "scale": 1}, "displacement": {"pattern": "none", "amplitude": 0, "scale": 1, "silhouetteAffects": false}, "ambientOcclusion": {"cavityStrength": 0.25, "contactShadowBias": 0.35, "notes": "Darken creases, seams, intersections, and recessed local features."}, "wear": {"edgeWear": 0, "scratches": [], "chips": []}, "dirt": {"amount": 0, "cavityBias": 0, "color": "#2F2A22"}, "localOverrides": [{"id": "edge-wear", "region": "exposed edges", "roughness": 0.15, "evidenceRefs": ["full-object"], "confidence": 0.75}], "shaderNotes": ["Prefer MeshPhysicalMaterial when clearcoat, sheen, transmission, or thin-surface response is observed; otherwise use MeshStandardMaterial-compatible PBR channels.", "Generate albedo, roughness, height/normal, and AO independently; never alias albedo into roughness.", "Use normal/bump/displacement only when they map to observed surface relief.", "Use displacement geometry when the observed relief changes the close-up silhouette; texture-only relief is insufficient there."], "notes": "Extraction threshold passed, not rendered material acceptance.", "referencePbr": {"usable": true, "confidence": 0.86, "targetThreshold": 0.7, "sourceImage": "D:\\打了个铁\\Weapon-Forger-hammer\\.img2threejs\\power-hammer-v2\\material-crops\\steel.png", "maps": {"albedo": {"path": "D:\\打了个铁\\Weapon-Forger-hammer\\.img2threejs\\power-hammer-v2\\material-evidence\\steel\\steel_albedo.png", "url": "steel_albedo.png", "channel": "albedo", "source": "reference-pixel-extraction"}, "roughness": {"path": "D:\\打了个铁\\Weapon-Forger-hammer\\.img2threejs\\power-hammer-v2\\material-evidence\\steel\\steel_roughness.png", "url": "steel_roughness.png", "channel": "roughness", "source": "reference-pixel-extraction"}, "height": {"path": "D:\\打了个铁\\Weapon-Forger-hammer\\.img2threejs\\power-hammer-v2\\material-evidence\\steel\\steel_height.png", "url": "steel_height.png", "channel": "height", "source": "reference-pixel-extraction"}, "normal": {"path": "D:\\打了个铁\\Weapon-Forger-hammer\\.img2threejs\\power-hammer-v2\\material-evidence\\steel\\steel_normal.png", "url": "steel_normal.png", "channel": "normal", "source": "reference-pixel-extraction"}, "ao": {"path": "D:\\打了个铁\\Weapon-Forger-hammer\\.img2threejs\\power-hammer-v2\\material-evidence\\steel\\steel_ao.png", "url": "steel_ao.png", "channel": "ao", "source": "reference-pixel-extraction"}}, "method": "reference-pixel-extraction", "limitation": "single-image PBR extraction is an estimate; 70%+ extraction confidence still needs render screenshot review Candidate evidence only: reflection bands and casting curvature must not become relief."}},
    options
  );
  materialMap["brass"] = createSculptMaterial(
    "brass",
    {"id": "brass", "name": "brass", "type": "standard", "shaderModel": "MeshStandardMaterial / PBR approximation", "baseColor": "#a8823f", "color": "#a8823f", "albedo": {"dominant": "#413123", "secondary": ["#6A4D30", "#B0834A", "#1D1814", "#EACC96"], "samplingNotes": "Extracted palette includes lighting; relighting review required."}, "colorVariation": {"palette": ["#413123", "#6A4D30", "#B0834A", "#1D1814", "#EACC96"], "pattern": "mottled", "amplitude": 0.15, "heightCorrelation": 0.3}, "textureResolution": 1024, "textureProjection": {"mode": "uv", "repeat": [2, 2], "anisotropy": 8, "texelDensityIntent": "Preserve stable world/object-scale detail; do not stretch micro detail with component scale."}, "surfaceFrequencyBands": [{"id": "macro", "frequency": 2, "amplitude": 0.42, "role": "broad color and height breakup"}, {"id": "meso", "frequency": 12, "amplitude": 0.22, "role": "ridges, pores, grain, dents, or equivalent visible relief"}, {"id": "micro", "frequency": 56, "amplitude": 0.08, "role": "highlight breakup visible under grazing light"}], "roughness": {"base": 0.32, "variation": 0.15, "map": "independent-procedural-field", "localResponse": "higher roughness in cavities, lower roughness on worn edges"}, "metalness": {"base": 1, "variation": 0}, "normal": {"pattern": "derived-from-independent-height-field", "strength": 0.1, "scale": 24, "space": "tangent"}, "bump": {"pattern": "none", "amplitude": 0, "scale": 1}, "displacement": {"pattern": "none", "amplitude": 0, "scale": 1, "silhouetteAffects": false}, "ambientOcclusion": {"cavityStrength": 0.25, "contactShadowBias": 0.35, "notes": "Darken creases, seams, intersections, and recessed local features."}, "wear": {"edgeWear": 0, "scratches": [], "chips": []}, "dirt": {"amount": 0, "cavityBias": 0, "color": "#2F2A22"}, "localOverrides": [{"id": "edge-wear", "region": "exposed edges", "roughness": 0.17, "evidenceRefs": ["full-object"], "confidence": 0.75}], "shaderNotes": ["Prefer MeshPhysicalMaterial when clearcoat, sheen, transmission, or thin-surface response is observed; otherwise use MeshStandardMaterial-compatible PBR channels.", "Generate albedo, roughness, height/normal, and AO independently; never alias albedo into roughness.", "Use normal/bump/displacement only when they map to observed surface relief.", "Use displacement geometry when the observed relief changes the close-up silhouette; texture-only relief is insufficient there."], "notes": "Extraction threshold passed, not rendered material acceptance.", "referencePbr": {"usable": true, "confidence": 0.86, "targetThreshold": 0.7, "sourceImage": "D:\\打了个铁\\Weapon-Forger-hammer\\.img2threejs\\power-hammer-v2\\material-crops\\brass.png", "maps": {"albedo": {"path": "D:\\打了个铁\\Weapon-Forger-hammer\\.img2threejs\\power-hammer-v2\\material-evidence\\brass\\brass_albedo.png", "url": "brass_albedo.png", "channel": "albedo", "source": "reference-pixel-extraction"}, "roughness": {"path": "D:\\打了个铁\\Weapon-Forger-hammer\\.img2threejs\\power-hammer-v2\\material-evidence\\brass\\brass_roughness.png", "url": "brass_roughness.png", "channel": "roughness", "source": "reference-pixel-extraction"}, "height": {"path": "D:\\打了个铁\\Weapon-Forger-hammer\\.img2threejs\\power-hammer-v2\\material-evidence\\brass\\brass_height.png", "url": "brass_height.png", "channel": "height", "source": "reference-pixel-extraction"}, "normal": {"path": "D:\\打了个铁\\Weapon-Forger-hammer\\.img2threejs\\power-hammer-v2\\material-evidence\\brass\\brass_normal.png", "url": "brass_normal.png", "channel": "normal", "source": "reference-pixel-extraction"}, "ao": {"path": "D:\\打了个铁\\Weapon-Forger-hammer\\.img2threejs\\power-hammer-v2\\material-evidence\\brass\\brass_ao.png", "url": "brass_ao.png", "channel": "ao", "source": "reference-pixel-extraction"}}, "method": "reference-pixel-extraction", "limitation": "single-image PBR extraction is an estimate; 70%+ extraction confidence still needs render screenshot review Candidate evidence only: reflection bands and casting curvature must not become relief."}},
    options
  );
  materialMap["container"] = createSculptMaterial(
    "container",
    {"id": "container", "name": "container", "type": "standard", "shaderModel": "MeshStandardMaterial / PBR approximation", "baseColor": "#55575a", "color": "#55575a", "albedo": {"dominant": "#6A6463", "secondary": ["#78716F", "#8F8783", "#A79E96", "#483E37"], "samplingNotes": "Extracted palette includes lighting; relighting review required."}, "colorVariation": {"palette": ["#6A6463", "#78716F", "#8F8783", "#A79E96", "#483E37"], "pattern": "mottled", "amplitude": 0.15, "heightCorrelation": 0.3}, "textureResolution": 1024, "textureProjection": {"mode": "uv", "repeat": [2, 2], "anisotropy": 8, "texelDensityIntent": "Preserve stable world/object-scale detail; do not stretch micro detail with component scale."}, "surfaceFrequencyBands": [{"id": "macro", "frequency": 2, "amplitude": 0.42, "role": "broad color and height breakup"}, {"id": "meso", "frequency": 12, "amplitude": 0.22, "role": "ridges, pores, grain, dents, or equivalent visible relief"}, {"id": "micro", "frequency": 56, "amplitude": 0.08, "role": "highlight breakup visible under grazing light"}], "roughness": {"base": 0.76, "variation": 0.15, "map": "independent-procedural-field", "localResponse": "higher roughness in cavities, lower roughness on worn edges"}, "metalness": {"base": 0.85, "variation": 0}, "normal": {"pattern": "derived-from-independent-height-field", "strength": 0.1, "scale": 24, "space": "tangent"}, "bump": {"pattern": "none", "amplitude": 0, "scale": 1}, "displacement": {"pattern": "none", "amplitude": 0, "scale": 1, "silhouetteAffects": false}, "ambientOcclusion": {"cavityStrength": 0.25, "contactShadowBias": 0.35, "notes": "Darken creases, seams, intersections, and recessed local features."}, "wear": {"edgeWear": 0, "scratches": [], "chips": []}, "dirt": {"amount": 0, "cavityBias": 0, "color": "#2F2A22"}, "localOverrides": [{"id": "edge-wear", "region": "exposed edges", "roughness": 0.61, "evidenceRefs": ["full-object"], "confidence": 0.75}], "shaderNotes": ["Prefer MeshPhysicalMaterial when clearcoat, sheen, transmission, or thin-surface response is observed; otherwise use MeshStandardMaterial-compatible PBR channels.", "Generate albedo, roughness, height/normal, and AO independently; never alias albedo into roughness.", "Use normal/bump/displacement only when they map to observed surface relief.", "Use displacement geometry when the observed relief changes the close-up silhouette; texture-only relief is insufficient there."], "notes": "Extraction threshold passed, not rendered material acceptance.", "opacity": 0, "transparent": true, "referencePbr": {"usable": true, "confidence": 0.86, "targetThreshold": 0.7, "sourceImage": "D:\\打了个铁\\Weapon-Forger-hammer\\.img2threejs\\power-hammer-v2\\material-crops\\iron.png", "maps": {"albedo": {"path": "D:\\打了个铁\\Weapon-Forger-hammer\\.img2threejs\\power-hammer-v2\\material-evidence\\iron\\iron_albedo.png", "url": "iron_albedo.png", "channel": "albedo", "source": "reference-pixel-extraction"}, "roughness": {"path": "D:\\打了个铁\\Weapon-Forger-hammer\\.img2threejs\\power-hammer-v2\\material-evidence\\iron\\iron_roughness.png", "url": "iron_roughness.png", "channel": "roughness", "source": "reference-pixel-extraction"}, "height": {"path": "D:\\打了个铁\\Weapon-Forger-hammer\\.img2threejs\\power-hammer-v2\\material-evidence\\iron\\iron_height.png", "url": "iron_height.png", "channel": "height", "source": "reference-pixel-extraction"}, "normal": {"path": "D:\\打了个铁\\Weapon-Forger-hammer\\.img2threejs\\power-hammer-v2\\material-evidence\\iron\\iron_normal.png", "url": "iron_normal.png", "channel": "normal", "source": "reference-pixel-extraction"}, "ao": {"path": "D:\\打了个铁\\Weapon-Forger-hammer\\.img2threejs\\power-hammer-v2\\material-evidence\\iron\\iron_ao.png", "url": "iron_ao.png", "channel": "ao", "source": "reference-pixel-extraction"}}, "method": "reference-pixel-extraction", "limitation": "single-image PBR extraction is an estimate; 70%+ extraction confidence still needs render screenshot review Candidate evidence only: reflection bands and casting curvature must not become relief."}},
    options
  );

  const nodes: Record<string, THREE.Object3D> = { root };
  const meshes: Record<string, THREE.Mesh> = {};
  const sockets: Record<string, THREE.Object3D> = {};
  const colliders: Record<string, unknown> = {};
  const destructionGroups: Record<string, THREE.Object3D[]> = {};

  const endpoint_root_0 = makeAttachmentEndpoint(null);
  const node_root_0 = new THREE.Group();
  node_root_0.name = "root__pivot";
  node_root_0.scale.set(1, 1, 1);
  if (endpoint_root_0) {
    node_root_0.position.copy(endpoint_root_0.start);
    node_root_0.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_root_0.position.set(0.0, 0.0, 0.0);
    node_root_0.rotation.set(0.0, 0.0, 0.0);
  }
  node_root_0.userData.sculptComponent = {"id": "root", "name": "root", "level": "macro", "role": "mechanical-part", "importance": 1, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Independent rigid cast or machined part.", "geometryDescriptor": {"topologyIntent": "closed independent cast or machined solid", "edgeTreatment": {"type": "chamfer", "bevelRadius": 3, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": null, "attachment": null, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "mm", "confidence": 0.65}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "mount-base", "position": [0, 85, 0], "rotation": [0, 0, 0], "type": "assembly"}, {"id": "mount-frame", "position": [-250, 1040, -100], "rotation": [0, 1.5707963267948966, 0], "type": "assembly"}, {"id": "mount-anvil", "position": [0, 467.5, 500], "rotation": [0, 0, 0], "type": "assembly"}, {"id": "mount-front-cylinder", "position": [0, 1680, 500], "rotation": [0, 0, 0], "type": "assembly"}, {"id": "mount-rear-cylinder", "position": [0, 1460, -440], "rotation": [0, 0, 0], "type": "assembly"}, {"id": "mount-ram", "position": [0, 1290, 500], "rotation": [0, 0, 0], "type": "assembly"}, {"id": "mount-service-tall", "position": [263, 1330, -245], "rotation": [0, 0, 0], "type": "assembly"}, {"id": "mount-service-low", "position": [263, 590, -300], "rotation": [0, 0, 0], "type": "assembly"}, {"id": "mount-service-round", "position": [280, 1210, -485], "rotation": [0, 0, 1.5707963267948966], "type": "assembly"}, {"id": "mount-lubricator-front", "position": [245, 1640, 500], "rotation": [0, 0, 0], "type": "assembly"}, {"id": "mount-rib-negative-x", "position": [-220, 365, 460], "rotation": [0, 0, 0], "type": "assembly"}, {"id": "mount-rib-positive-x", "position": [220, 365, 460], "rotation": [0, 0, 0], "type": "assembly"}, {"id": "mount-base-foot-fl", "position": [-435, 20, 600], "rotation": [0, 0, 0], "type": "assembly"}, {"id": "mount-base-foot-fr", "position": [435, 20, 600], "rotation": [0, 0, 0], "type": "assembly"}, {"id": "mount-base-foot-rl", "position": [-435, 20, -600], "rotation": [0, 0, 0], "type": "assembly"}, {"id": "mount-base-foot-rr", "position": [435, 20, -600], "rotation": [0, 0, 0], "type": "assembly"}, {"id": "mount-small-service-cover", "position": [262, 300, -280], "rotation": [0, 0, 0], "type": "assembly"}], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "container"}}, "material": "container", "materialLayers": ["container"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0, "microRoughness": 0, "bumpAmplitude": 0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(106, 100, 99, 1)", "secondaryAlbedo": "rgba(120, 113, 111, 1)", "materialClass": "metal", "materialClassConfidence": 0.85, "materialRef": "container", "evidenceRefs": ["full-object"]}};
  node_root_0.userData.actionProfile = {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "mount-base", "position": [0, 85, 0], "rotation": [0, 0, 0], "type": "assembly"}, {"id": "mount-frame", "position": [-250, 1040, -100], "rotation": [0, 1.5707963267948966, 0], "type": "assembly"}, {"id": "mount-anvil", "position": [0, 467.5, 500], "rotation": [0, 0, 0], "type": "assembly"}, {"id": "mount-front-cylinder", "position": [0, 1680, 500], "rotation": [0, 0, 0], "type": "assembly"}, {"id": "mount-rear-cylinder", "position": [0, 1460, -440], "rotation": [0, 0, 0], "type": "assembly"}, {"id": "mount-ram", "position": [0, 1290, 500], "rotation": [0, 0, 0], "type": "assembly"}, {"id": "mount-service-tall", "position": [263, 1330, -245], "rotation": [0, 0, 0], "type": "assembly"}, {"id": "mount-service-low", "position": [263, 590, -300], "rotation": [0, 0, 0], "type": "assembly"}, {"id": "mount-service-round", "position": [280, 1210, -485], "rotation": [0, 0, 1.5707963267948966], "type": "assembly"}, {"id": "mount-lubricator-front", "position": [245, 1640, 500], "rotation": [0, 0, 0], "type": "assembly"}, {"id": "mount-rib-negative-x", "position": [-220, 365, 460], "rotation": [0, 0, 0], "type": "assembly"}, {"id": "mount-rib-positive-x", "position": [220, 365, 460], "rotation": [0, 0, 0], "type": "assembly"}, {"id": "mount-base-foot-fl", "position": [-435, 20, 600], "rotation": [0, 0, 0], "type": "assembly"}, {"id": "mount-base-foot-fr", "position": [435, 20, 600], "rotation": [0, 0, 0], "type": "assembly"}, {"id": "mount-base-foot-rl", "position": [-435, 20, -600], "rotation": [0, 0, 0], "type": "assembly"}, {"id": "mount-base-foot-rr", "position": [435, 20, -600], "rotation": [0, 0, 0], "type": "assembly"}, {"id": "mount-small-service-cover", "position": [262, 300, -280], "rotation": [0, 0, 0], "type": "assembly"}], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "container"}};
  (nodes["root"] ?? root).add(node_root_0);
  nodes["root"] = node_root_0;
  const mesh_root_0Geometry = endpoint_root_0
    ? new THREE.CylinderGeometry(endpoint_root_0.endRadius, endpoint_root_0.baseRadius, endpoint_root_0.length, 16, 6)
    : new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
  if (!endpoint_root_0) {
    mesh_root_0Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_root_0 = new THREE.Mesh(
    mesh_root_0Geometry,
    materialMap["container"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_root_0.name = "root";
  if (endpoint_root_0) {
    mesh_root_0.position.copy(endpoint_root_0.midpoint);
    mesh_root_0.quaternion.copy(endpoint_root_0.quaternion);
  }
  mesh_root_0.castShadow = options.castShadow ?? true;
  mesh_root_0.receiveShadow = options.receiveShadow ?? true;
  mesh_root_0.userData.sculptComponent = {"id": "root", "name": "root", "level": "macro", "role": "mechanical-part", "importance": 1, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Independent rigid cast or machined part.", "geometryDescriptor": {"topologyIntent": "closed independent cast or machined solid", "edgeTreatment": {"type": "chamfer", "bevelRadius": 3, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": null, "attachment": null, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "mm", "confidence": 0.65}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "root", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "mount-base", "position": [0, 85, 0], "rotation": [0, 0, 0], "type": "assembly"}, {"id": "mount-frame", "position": [-250, 1040, -100], "rotation": [0, 1.5707963267948966, 0], "type": "assembly"}, {"id": "mount-anvil", "position": [0, 467.5, 500], "rotation": [0, 0, 0], "type": "assembly"}, {"id": "mount-front-cylinder", "position": [0, 1680, 500], "rotation": [0, 0, 0], "type": "assembly"}, {"id": "mount-rear-cylinder", "position": [0, 1460, -440], "rotation": [0, 0, 0], "type": "assembly"}, {"id": "mount-ram", "position": [0, 1290, 500], "rotation": [0, 0, 0], "type": "assembly"}, {"id": "mount-service-tall", "position": [263, 1330, -245], "rotation": [0, 0, 0], "type": "assembly"}, {"id": "mount-service-low", "position": [263, 590, -300], "rotation": [0, 0, 0], "type": "assembly"}, {"id": "mount-service-round", "position": [280, 1210, -485], "rotation": [0, 0, 1.5707963267948966], "type": "assembly"}, {"id": "mount-lubricator-front", "position": [245, 1640, 500], "rotation": [0, 0, 0], "type": "assembly"}, {"id": "mount-rib-negative-x", "position": [-220, 365, 460], "rotation": [0, 0, 0], "type": "assembly"}, {"id": "mount-rib-positive-x", "position": [220, 365, 460], "rotation": [0, 0, 0], "type": "assembly"}, {"id": "mount-base-foot-fl", "position": [-435, 20, 600], "rotation": [0, 0, 0], "type": "assembly"}, {"id": "mount-base-foot-fr", "position": [435, 20, 600], "rotation": [0, 0, 0], "type": "assembly"}, {"id": "mount-base-foot-rl", "position": [-435, 20, -600], "rotation": [0, 0, 0], "type": "assembly"}, {"id": "mount-base-foot-rr", "position": [435, 20, -600], "rotation": [0, 0, 0], "type": "assembly"}, {"id": "mount-small-service-cover", "position": [262, 300, -280], "rotation": [0, 0, 0], "type": "assembly"}], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "container"}}, "material": "container", "materialLayers": ["container"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0, "microRoughness": 0, "bumpAmplitude": 0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(106, 100, 99, 1)", "secondaryAlbedo": "rgba(120, 113, 111, 1)", "materialClass": "metal", "materialClassConfidence": 0.85, "materialRef": "container", "evidenceRefs": ["full-object"]}};
  node_root_0.add(mesh_root_0);
  meshes["root"] = mesh_root_0;
  colliders["root"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["root"] ??= [];
  destructionGroups["root"].push(node_root_0);
  const socket_root_mount_base_0 = new THREE.Object3D();
  socket_root_mount_base_0.name = "mount-base";
  socket_root_mount_base_0.position.set(0.0, 85.0, 0.0);
  socket_root_mount_base_0.rotation.set(0.0, 0.0, 0.0);
  socket_root_mount_base_0.userData.socket = {"id": "mount-base", "position": [0, 85, 0], "rotation": [0, 0, 0], "type": "assembly"};
  node_root_0.add(socket_root_mount_base_0);
  sockets["root:mount-base"] = socket_root_mount_base_0;
  const socket_root_mount_frame_1 = new THREE.Object3D();
  socket_root_mount_frame_1.name = "mount-frame";
  socket_root_mount_frame_1.position.set(-250.0, 1040.0, -100.0);
  socket_root_mount_frame_1.rotation.set(0.0, 1.5707963267948966, 0.0);
  socket_root_mount_frame_1.userData.socket = {"id": "mount-frame", "position": [-250, 1040, -100], "rotation": [0, 1.5707963267948966, 0], "type": "assembly"};
  node_root_0.add(socket_root_mount_frame_1);
  sockets["root:mount-frame"] = socket_root_mount_frame_1;
  const socket_root_mount_anvil_2 = new THREE.Object3D();
  socket_root_mount_anvil_2.name = "mount-anvil";
  socket_root_mount_anvil_2.position.set(0.0, 467.5, 500.0);
  socket_root_mount_anvil_2.rotation.set(0.0, 0.0, 0.0);
  socket_root_mount_anvil_2.userData.socket = {"id": "mount-anvil", "position": [0, 467.5, 500], "rotation": [0, 0, 0], "type": "assembly"};
  node_root_0.add(socket_root_mount_anvil_2);
  sockets["root:mount-anvil"] = socket_root_mount_anvil_2;
  const socket_root_mount_front_cylinder_3 = new THREE.Object3D();
  socket_root_mount_front_cylinder_3.name = "mount-front-cylinder";
  socket_root_mount_front_cylinder_3.position.set(0.0, 1680.0, 500.0);
  socket_root_mount_front_cylinder_3.rotation.set(0.0, 0.0, 0.0);
  socket_root_mount_front_cylinder_3.userData.socket = {"id": "mount-front-cylinder", "position": [0, 1680, 500], "rotation": [0, 0, 0], "type": "assembly"};
  node_root_0.add(socket_root_mount_front_cylinder_3);
  sockets["root:mount-front-cylinder"] = socket_root_mount_front_cylinder_3;
  const socket_root_mount_rear_cylinder_4 = new THREE.Object3D();
  socket_root_mount_rear_cylinder_4.name = "mount-rear-cylinder";
  socket_root_mount_rear_cylinder_4.position.set(0.0, 1460.0, -440.0);
  socket_root_mount_rear_cylinder_4.rotation.set(0.0, 0.0, 0.0);
  socket_root_mount_rear_cylinder_4.userData.socket = {"id": "mount-rear-cylinder", "position": [0, 1460, -440], "rotation": [0, 0, 0], "type": "assembly"};
  node_root_0.add(socket_root_mount_rear_cylinder_4);
  sockets["root:mount-rear-cylinder"] = socket_root_mount_rear_cylinder_4;
  const socket_root_mount_ram_5 = new THREE.Object3D();
  socket_root_mount_ram_5.name = "mount-ram";
  socket_root_mount_ram_5.position.set(0.0, 1290.0, 500.0);
  socket_root_mount_ram_5.rotation.set(0.0, 0.0, 0.0);
  socket_root_mount_ram_5.userData.socket = {"id": "mount-ram", "position": [0, 1290, 500], "rotation": [0, 0, 0], "type": "assembly"};
  node_root_0.add(socket_root_mount_ram_5);
  sockets["root:mount-ram"] = socket_root_mount_ram_5;
  const socket_root_mount_service_tall_6 = new THREE.Object3D();
  socket_root_mount_service_tall_6.name = "mount-service-tall";
  socket_root_mount_service_tall_6.position.set(263.0, 1330.0, -245.0);
  socket_root_mount_service_tall_6.rotation.set(0.0, 0.0, 0.0);
  socket_root_mount_service_tall_6.userData.socket = {"id": "mount-service-tall", "position": [263, 1330, -245], "rotation": [0, 0, 0], "type": "assembly"};
  node_root_0.add(socket_root_mount_service_tall_6);
  sockets["root:mount-service-tall"] = socket_root_mount_service_tall_6;
  const socket_root_mount_service_low_7 = new THREE.Object3D();
  socket_root_mount_service_low_7.name = "mount-service-low";
  socket_root_mount_service_low_7.position.set(263.0, 590.0, -300.0);
  socket_root_mount_service_low_7.rotation.set(0.0, 0.0, 0.0);
  socket_root_mount_service_low_7.userData.socket = {"id": "mount-service-low", "position": [263, 590, -300], "rotation": [0, 0, 0], "type": "assembly"};
  node_root_0.add(socket_root_mount_service_low_7);
  sockets["root:mount-service-low"] = socket_root_mount_service_low_7;
  const socket_root_mount_service_round_8 = new THREE.Object3D();
  socket_root_mount_service_round_8.name = "mount-service-round";
  socket_root_mount_service_round_8.position.set(280.0, 1210.0, -485.0);
  socket_root_mount_service_round_8.rotation.set(0.0, 0.0, 1.5707963267948966);
  socket_root_mount_service_round_8.userData.socket = {"id": "mount-service-round", "position": [280, 1210, -485], "rotation": [0, 0, 1.5707963267948966], "type": "assembly"};
  node_root_0.add(socket_root_mount_service_round_8);
  sockets["root:mount-service-round"] = socket_root_mount_service_round_8;
  const socket_root_mount_lubricator_front_9 = new THREE.Object3D();
  socket_root_mount_lubricator_front_9.name = "mount-lubricator-front";
  socket_root_mount_lubricator_front_9.position.set(245.0, 1640.0, 500.0);
  socket_root_mount_lubricator_front_9.rotation.set(0.0, 0.0, 0.0);
  socket_root_mount_lubricator_front_9.userData.socket = {"id": "mount-lubricator-front", "position": [245, 1640, 500], "rotation": [0, 0, 0], "type": "assembly"};
  node_root_0.add(socket_root_mount_lubricator_front_9);
  sockets["root:mount-lubricator-front"] = socket_root_mount_lubricator_front_9;
  const socket_root_mount_rib_negative_x_10 = new THREE.Object3D();
  socket_root_mount_rib_negative_x_10.name = "mount-rib-negative-x";
  socket_root_mount_rib_negative_x_10.position.set(-220.0, 365.0, 460.0);
  socket_root_mount_rib_negative_x_10.rotation.set(0.0, 0.0, 0.0);
  socket_root_mount_rib_negative_x_10.userData.socket = {"id": "mount-rib-negative-x", "position": [-220, 365, 460], "rotation": [0, 0, 0], "type": "assembly"};
  node_root_0.add(socket_root_mount_rib_negative_x_10);
  sockets["root:mount-rib-negative-x"] = socket_root_mount_rib_negative_x_10;
  const socket_root_mount_rib_positive_x_11 = new THREE.Object3D();
  socket_root_mount_rib_positive_x_11.name = "mount-rib-positive-x";
  socket_root_mount_rib_positive_x_11.position.set(220.0, 365.0, 460.0);
  socket_root_mount_rib_positive_x_11.rotation.set(0.0, 0.0, 0.0);
  socket_root_mount_rib_positive_x_11.userData.socket = {"id": "mount-rib-positive-x", "position": [220, 365, 460], "rotation": [0, 0, 0], "type": "assembly"};
  node_root_0.add(socket_root_mount_rib_positive_x_11);
  sockets["root:mount-rib-positive-x"] = socket_root_mount_rib_positive_x_11;
  const socket_root_mount_base_foot_fl_12 = new THREE.Object3D();
  socket_root_mount_base_foot_fl_12.name = "mount-base-foot-fl";
  socket_root_mount_base_foot_fl_12.position.set(-435.0, 20.0, 600.0);
  socket_root_mount_base_foot_fl_12.rotation.set(0.0, 0.0, 0.0);
  socket_root_mount_base_foot_fl_12.userData.socket = {"id": "mount-base-foot-fl", "position": [-435, 20, 600], "rotation": [0, 0, 0], "type": "assembly"};
  node_root_0.add(socket_root_mount_base_foot_fl_12);
  sockets["root:mount-base-foot-fl"] = socket_root_mount_base_foot_fl_12;
  const socket_root_mount_base_foot_fr_13 = new THREE.Object3D();
  socket_root_mount_base_foot_fr_13.name = "mount-base-foot-fr";
  socket_root_mount_base_foot_fr_13.position.set(435.0, 20.0, 600.0);
  socket_root_mount_base_foot_fr_13.rotation.set(0.0, 0.0, 0.0);
  socket_root_mount_base_foot_fr_13.userData.socket = {"id": "mount-base-foot-fr", "position": [435, 20, 600], "rotation": [0, 0, 0], "type": "assembly"};
  node_root_0.add(socket_root_mount_base_foot_fr_13);
  sockets["root:mount-base-foot-fr"] = socket_root_mount_base_foot_fr_13;
  const socket_root_mount_base_foot_rl_14 = new THREE.Object3D();
  socket_root_mount_base_foot_rl_14.name = "mount-base-foot-rl";
  socket_root_mount_base_foot_rl_14.position.set(-435.0, 20.0, -600.0);
  socket_root_mount_base_foot_rl_14.rotation.set(0.0, 0.0, 0.0);
  socket_root_mount_base_foot_rl_14.userData.socket = {"id": "mount-base-foot-rl", "position": [-435, 20, -600], "rotation": [0, 0, 0], "type": "assembly"};
  node_root_0.add(socket_root_mount_base_foot_rl_14);
  sockets["root:mount-base-foot-rl"] = socket_root_mount_base_foot_rl_14;
  const socket_root_mount_base_foot_rr_15 = new THREE.Object3D();
  socket_root_mount_base_foot_rr_15.name = "mount-base-foot-rr";
  socket_root_mount_base_foot_rr_15.position.set(435.0, 20.0, -600.0);
  socket_root_mount_base_foot_rr_15.rotation.set(0.0, 0.0, 0.0);
  socket_root_mount_base_foot_rr_15.userData.socket = {"id": "mount-base-foot-rr", "position": [435, 20, -600], "rotation": [0, 0, 0], "type": "assembly"};
  node_root_0.add(socket_root_mount_base_foot_rr_15);
  sockets["root:mount-base-foot-rr"] = socket_root_mount_base_foot_rr_15;
  const socket_root_mount_small_service_cover_16 = new THREE.Object3D();
  socket_root_mount_small_service_cover_16.name = "mount-small-service-cover";
  socket_root_mount_small_service_cover_16.position.set(262.0, 300.0, -280.0);
  socket_root_mount_small_service_cover_16.rotation.set(0.0, 0.0, 0.0);
  socket_root_mount_small_service_cover_16.userData.socket = {"id": "mount-small-service-cover", "position": [262, 300, -280], "rotation": [0, 0, 0], "type": "assembly"};
  node_root_0.add(socket_root_mount_small_service_cover_16);
  sockets["root:mount-small-service-cover"] = socket_root_mount_small_service_cover_16;

  const endpoint_base_1 = makeAttachmentEndpoint(null);
  const node_base_1 = new THREE.Group();
  node_base_1.name = "base__pivot";
  node_base_1.scale.set(1, 1, 1);
  if (endpoint_base_1) {
    node_base_1.position.copy(endpoint_base_1.start);
    node_base_1.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_base_1.position.set(0.0, 85.0, 0.0);
    node_base_1.rotation.set(0.0, 0.0, 0.0);
  }
  node_base_1.userData.sculptComponent = {"id": "base", "name": "base", "level": "macro", "role": "mechanical-part", "importance": 1, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Independent rigid cast or machined part.", "geometryDescriptor": {"topologyIntent": "closed independent cast or machined solid", "edgeTreatment": {"type": "chamfer", "bevelRadius": 3, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentSocket": "mount-base", "localStart": [0, 0, 0], "localEnd": [0, 85, 0], "contactType": "overlap", "embedDepth": 3, "gapTolerance": 0.5}, "dimensions": {"width": 1050, "height": 170, "depth": 1400, "units": "mm", "confidence": 0.65}, "transform": {"position": [0, 85, 0], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "base", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "iron"}}, "material": "iron", "materialLayers": ["iron"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "base-edge", "type": "bevel", "description": "Plinth chamfer", "placement": "component boundary", "geometryEffect": "chamfer", "materialEffect": "assigned material", "sizeMm": 3, "confidence": 0.8, "evidenceRefs": ["full-object"]}], "surfaceDetail": {"macroRoughness": 0, "microRoughness": 0, "bumpAmplitude": 0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(106, 100, 99, 1)", "secondaryAlbedo": "rgba(120, 113, 111, 1)", "materialClass": "metal", "materialClassConfidence": 0.85, "materialRef": "iron", "evidenceRefs": ["full-object"]}};
  node_base_1.userData.actionProfile = {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "base", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "iron"}};
  (nodes["root"] ?? root).add(node_base_1);
  nodes["base"] = node_base_1;
  const mesh_base_1Geometry = endpoint_base_1
    ? new THREE.CylinderGeometry(endpoint_base_1.endRadius, endpoint_base_1.baseRadius, endpoint_base_1.length, 16, 6)
    : new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
  if (!endpoint_base_1) {
    mesh_base_1Geometry.scale(1050.0, 170.0, 1400.0);
  }
  const mesh_base_1 = new THREE.Mesh(
    mesh_base_1Geometry,
    materialMap["iron"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_base_1.name = "base";
  if (endpoint_base_1) {
    mesh_base_1.position.copy(endpoint_base_1.midpoint);
    mesh_base_1.quaternion.copy(endpoint_base_1.quaternion);
  }
  mesh_base_1.castShadow = options.castShadow ?? true;
  mesh_base_1.receiveShadow = options.receiveShadow ?? true;
  mesh_base_1.userData.sculptComponent = {"id": "base", "name": "base", "level": "macro", "role": "mechanical-part", "importance": 1, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Independent rigid cast or machined part.", "geometryDescriptor": {"topologyIntent": "closed independent cast or machined solid", "edgeTreatment": {"type": "chamfer", "bevelRadius": 3, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentSocket": "mount-base", "localStart": [0, 0, 0], "localEnd": [0, 85, 0], "contactType": "overlap", "embedDepth": 3, "gapTolerance": 0.5}, "dimensions": {"width": 1050, "height": 170, "depth": 1400, "units": "mm", "confidence": 0.65}, "transform": {"position": [0, 85, 0], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "base", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "iron"}}, "material": "iron", "materialLayers": ["iron"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "base-edge", "type": "bevel", "description": "Plinth chamfer", "placement": "component boundary", "geometryEffect": "chamfer", "materialEffect": "assigned material", "sizeMm": 3, "confidence": 0.8, "evidenceRefs": ["full-object"]}], "surfaceDetail": {"macroRoughness": 0, "microRoughness": 0, "bumpAmplitude": 0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(106, 100, 99, 1)", "secondaryAlbedo": "rgba(120, 113, 111, 1)", "materialClass": "metal", "materialClassConfidence": 0.85, "materialRef": "iron", "evidenceRefs": ["full-object"]}};
  node_base_1.add(mesh_base_1);
  meshes["base"] = mesh_base_1;
  colliders["base"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["base"] ??= [];
  destructionGroups["base"].push(node_base_1);

  const endpoint_frame_2 = makeAttachmentEndpoint(null);
  const node_frame_2 = new THREE.Group();
  node_frame_2.name = "frame__pivot";
  node_frame_2.scale.set(1, 1, 1);
  if (endpoint_frame_2) {
    node_frame_2.position.copy(endpoint_frame_2.start);
    node_frame_2.rotation.set(0.0, 1.5707963267948966, 0.0);
  } else {
    node_frame_2.position.set(-250.0, 1040.0, -100.0);
    node_frame_2.rotation.set(0.0, 1.5707963267948966, 0.0);
  }
  node_frame_2.userData.sculptComponent = {"id": "frame", "name": "frame", "level": "macro", "role": "mechanical-part", "importance": 1, "confidence": 0.8, "primitive": "extrude", "topologyClass": "continuous-sculpt", "topologyRationale": "One continuous thick C-shaped casting; actual open negative space rather than box stack.", "geometryDescriptor": {"topologyIntent": "closed thick continuous C-profile extrusion", "edgeTreatment": {"type": "chamfer", "bevelRadius": 3, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "profile2D": {"points": [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.23], [0.49207, 0.26105], [0.4759, 0.29041], [0.4517, 0.31804], [0.41969, 0.34391], [0.38005, 0.36795], [0.33301, 0.39014], [0.27875, 0.41042], [0.2175, 0.42875], [0.14945, 0.44509], [0.0748, 0.45939], [-0.00623, 0.47162], [-0.09344, 0.48172], [-0.18663, 0.48965], [-0.28559, 0.49537], [-0.39011, 0.49884], [-0.5, 0.5], [-0.5, 0.28], [-0.32, 0.28], [-0.27687, 0.27738], [-0.2375, 0.26986], [-0.20188, 0.25797], [-0.17, 0.24222], [-0.14187, 0.22314], [-0.1175, 0.20125], [-0.09688, 0.17707], [-0.08, 0.15111], [-0.06688, 0.12391], [-0.0575, 0.09597], [-0.05188, 0.06783], [-0.05, 0.04], [-0.05, -0.2], [-0.05263, -0.23026], [-0.06023, -0.25625], [-0.07234, -0.27828], [-0.08852, -0.29667], [-0.1083, -0.31172], [-0.13125, -0.32375], [-0.1569, -0.33307], [-0.18481, -0.34], [-0.21453, -0.34484], [-0.2456, -0.34792], [-0.27758, -0.34953], [-0.31, -0.35], [-0.5, -0.35]], "depth": 1}}, "parent": "root", "attachment": {"parentSocket": "mount-frame", "localStart": [0, 0, 0], "localEnd": [0, 975, 0], "contactType": "overlap", "embedDepth": 3, "gapTolerance": 0.5}, "dimensions": {"width": 1100, "height": 1750, "depth": 500, "units": "mm", "confidence": 0.65}, "transform": {"position": [-250, 1040, -100], "rotation": [0, 1.5707963267948966, 0]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "frame", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "iron"}}, "material": "iron", "materialLayers": ["iron"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "throat-rim", "type": "bevel", "description": "Continuous throat inner rim", "placement": "component boundary", "geometryEffect": "chamfer", "materialEffect": "assigned material", "sizeMm": 3, "confidence": 0.8, "evidenceRefs": ["full-object"]}], "surfaceDetail": {"macroRoughness": 0, "microRoughness": 0, "bumpAmplitude": 0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(106, 100, 99, 1)", "secondaryAlbedo": "rgba(120, 113, 111, 1)", "materialClass": "metal", "materialClassConfidence": 0.85, "materialRef": "iron", "evidenceRefs": ["full-object"]}};
  node_frame_2.userData.actionProfile = {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "frame", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "iron"}};
  (nodes["root"] ?? root).add(node_frame_2);
  nodes["frame"] = node_frame_2;
  const mesh_frame_2Geometry = endpoint_frame_2
    ? new THREE.CylinderGeometry(endpoint_frame_2.endRadius, endpoint_frame_2.baseRadius, endpoint_frame_2.length, 16, 6)
    : buildExtrudeGeometry({"points": [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.23], [0.49207, 0.26105], [0.4759, 0.29041], [0.4517, 0.31804], [0.41969, 0.34391], [0.38005, 0.36795], [0.33301, 0.39014], [0.27875, 0.41042], [0.2175, 0.42875], [0.14945, 0.44509], [0.0748, 0.45939], [-0.00623, 0.47162], [-0.09344, 0.48172], [-0.18663, 0.48965], [-0.28559, 0.49537], [-0.39011, 0.49884], [-0.5, 0.5], [-0.5, 0.28], [-0.32, 0.28], [-0.27687, 0.27738], [-0.2375, 0.26986], [-0.20188, 0.25797], [-0.17, 0.24222], [-0.14187, 0.22314], [-0.1175, 0.20125], [-0.09688, 0.17707], [-0.08, 0.15111], [-0.06688, 0.12391], [-0.0575, 0.09597], [-0.05188, 0.06783], [-0.05, 0.04], [-0.05, -0.2], [-0.05263, -0.23026], [-0.06023, -0.25625], [-0.07234, -0.27828], [-0.08852, -0.29667], [-0.1083, -0.31172], [-0.13125, -0.32375], [-0.1569, -0.33307], [-0.18481, -0.34], [-0.21453, -0.34484], [-0.2456, -0.34792], [-0.27758, -0.34953], [-0.31, -0.35], [-0.5, -0.35]], "depth": 1});
  if (!endpoint_frame_2) {
    mesh_frame_2Geometry.scale(1100.0, 1750.0, 500.0);
  }
  const mesh_frame_2 = new THREE.Mesh(
    mesh_frame_2Geometry,
    materialMap["iron"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_frame_2.name = "frame";
  if (endpoint_frame_2) {
    mesh_frame_2.position.copy(endpoint_frame_2.midpoint);
    mesh_frame_2.quaternion.copy(endpoint_frame_2.quaternion);
  }
  mesh_frame_2.castShadow = options.castShadow ?? true;
  mesh_frame_2.receiveShadow = options.receiveShadow ?? true;
  mesh_frame_2.userData.sculptComponent = {"id": "frame", "name": "frame", "level": "macro", "role": "mechanical-part", "importance": 1, "confidence": 0.8, "primitive": "extrude", "topologyClass": "continuous-sculpt", "topologyRationale": "One continuous thick C-shaped casting; actual open negative space rather than box stack.", "geometryDescriptor": {"topologyIntent": "closed thick continuous C-profile extrusion", "edgeTreatment": {"type": "chamfer", "bevelRadius": 3, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "profile2D": {"points": [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.23], [0.49207, 0.26105], [0.4759, 0.29041], [0.4517, 0.31804], [0.41969, 0.34391], [0.38005, 0.36795], [0.33301, 0.39014], [0.27875, 0.41042], [0.2175, 0.42875], [0.14945, 0.44509], [0.0748, 0.45939], [-0.00623, 0.47162], [-0.09344, 0.48172], [-0.18663, 0.48965], [-0.28559, 0.49537], [-0.39011, 0.49884], [-0.5, 0.5], [-0.5, 0.28], [-0.32, 0.28], [-0.27687, 0.27738], [-0.2375, 0.26986], [-0.20188, 0.25797], [-0.17, 0.24222], [-0.14187, 0.22314], [-0.1175, 0.20125], [-0.09688, 0.17707], [-0.08, 0.15111], [-0.06688, 0.12391], [-0.0575, 0.09597], [-0.05188, 0.06783], [-0.05, 0.04], [-0.05, -0.2], [-0.05263, -0.23026], [-0.06023, -0.25625], [-0.07234, -0.27828], [-0.08852, -0.29667], [-0.1083, -0.31172], [-0.13125, -0.32375], [-0.1569, -0.33307], [-0.18481, -0.34], [-0.21453, -0.34484], [-0.2456, -0.34792], [-0.27758, -0.34953], [-0.31, -0.35], [-0.5, -0.35]], "depth": 1}}, "parent": "root", "attachment": {"parentSocket": "mount-frame", "localStart": [0, 0, 0], "localEnd": [0, 975, 0], "contactType": "overlap", "embedDepth": 3, "gapTolerance": 0.5}, "dimensions": {"width": 1100, "height": 1750, "depth": 500, "units": "mm", "confidence": 0.65}, "transform": {"position": [-250, 1040, -100], "rotation": [0, 1.5707963267948966, 0]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "frame", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "iron"}}, "material": "iron", "materialLayers": ["iron"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "throat-rim", "type": "bevel", "description": "Continuous throat inner rim", "placement": "component boundary", "geometryEffect": "chamfer", "materialEffect": "assigned material", "sizeMm": 3, "confidence": 0.8, "evidenceRefs": ["full-object"]}], "surfaceDetail": {"macroRoughness": 0, "microRoughness": 0, "bumpAmplitude": 0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(106, 100, 99, 1)", "secondaryAlbedo": "rgba(120, 113, 111, 1)", "materialClass": "metal", "materialClassConfidence": 0.85, "materialRef": "iron", "evidenceRefs": ["full-object"]}};
  node_frame_2.add(mesh_frame_2);
  meshes["frame"] = mesh_frame_2;
  colliders["frame"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["frame"] ??= [];
  destructionGroups["frame"].push(node_frame_2);

  const endpoint_anvil_3 = makeAttachmentEndpoint(null);
  const node_anvil_3 = new THREE.Group();
  node_anvil_3.name = "anvil__pivot";
  node_anvil_3.scale.set(1, 1, 1);
  if (endpoint_anvil_3) {
    node_anvil_3.position.copy(endpoint_anvil_3.start);
    node_anvil_3.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_anvil_3.position.set(0.0, 467.5, 500.0);
    node_anvil_3.rotation.set(0.0, 0.0, 0.0);
  }
  node_anvil_3.userData.sculptComponent = {"id": "anvil", "name": "anvil", "level": "macro", "role": "mechanical-part", "importance": 1, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Independent rigid cast or machined part.", "geometryDescriptor": {"topologyIntent": "closed independent cast or machined solid", "edgeTreatment": {"type": "chamfer", "bevelRadius": 3, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentSocket": "mount-anvil", "localStart": [0, 0, 0], "localEnd": [0, 307.5, 0], "contactType": "overlap", "embedDepth": 3, "gapTolerance": 0.5}, "dimensions": {"width": 300, "height": 615, "depth": 340, "units": "mm", "confidence": 0.65}, "transform": {"position": [0, 467.5, 500], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "mount-lower-mount", "position": [0, 327.5, 0], "rotation": [0, 0, 0], "type": "assembly"}, {"id": "mount-lower-die", "position": [0, 367.5, 0], "rotation": [0, 0, 0], "type": "assembly"}], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "anvil", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "iron"}}, "material": "iron", "materialLayers": ["iron"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0, "microRoughness": 0, "bumpAmplitude": 0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(106, 100, 99, 1)", "secondaryAlbedo": "rgba(120, 113, 111, 1)", "materialClass": "metal", "materialClassConfidence": 0.85, "materialRef": "iron", "evidenceRefs": ["full-object"]}};
  node_anvil_3.userData.actionProfile = {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "mount-lower-mount", "position": [0, 327.5, 0], "rotation": [0, 0, 0], "type": "assembly"}, {"id": "mount-lower-die", "position": [0, 367.5, 0], "rotation": [0, 0, 0], "type": "assembly"}], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "anvil", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "iron"}};
  (nodes["root"] ?? root).add(node_anvil_3);
  nodes["anvil"] = node_anvil_3;
  const mesh_anvil_3Geometry = endpoint_anvil_3
    ? new THREE.CylinderGeometry(endpoint_anvil_3.endRadius, endpoint_anvil_3.baseRadius, endpoint_anvil_3.length, 16, 6)
    : new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
  if (!endpoint_anvil_3) {
    mesh_anvil_3Geometry.scale(300.0, 615.0, 340.0);
  }
  const mesh_anvil_3 = new THREE.Mesh(
    mesh_anvil_3Geometry,
    materialMap["iron"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_anvil_3.name = "anvil";
  if (endpoint_anvil_3) {
    mesh_anvil_3.position.copy(endpoint_anvil_3.midpoint);
    mesh_anvil_3.quaternion.copy(endpoint_anvil_3.quaternion);
  }
  mesh_anvil_3.castShadow = options.castShadow ?? true;
  mesh_anvil_3.receiveShadow = options.receiveShadow ?? true;
  mesh_anvil_3.userData.sculptComponent = {"id": "anvil", "name": "anvil", "level": "macro", "role": "mechanical-part", "importance": 1, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Independent rigid cast or machined part.", "geometryDescriptor": {"topologyIntent": "closed independent cast or machined solid", "edgeTreatment": {"type": "chamfer", "bevelRadius": 3, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentSocket": "mount-anvil", "localStart": [0, 0, 0], "localEnd": [0, 307.5, 0], "contactType": "overlap", "embedDepth": 3, "gapTolerance": 0.5}, "dimensions": {"width": 300, "height": 615, "depth": 340, "units": "mm", "confidence": 0.65}, "transform": {"position": [0, 467.5, 500], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "mount-lower-mount", "position": [0, 327.5, 0], "rotation": [0, 0, 0], "type": "assembly"}, {"id": "mount-lower-die", "position": [0, 367.5, 0], "rotation": [0, 0, 0], "type": "assembly"}], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "anvil", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "iron"}}, "material": "iron", "materialLayers": ["iron"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0, "microRoughness": 0, "bumpAmplitude": 0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(106, 100, 99, 1)", "secondaryAlbedo": "rgba(120, 113, 111, 1)", "materialClass": "metal", "materialClassConfidence": 0.85, "materialRef": "iron", "evidenceRefs": ["full-object"]}};
  node_anvil_3.add(mesh_anvil_3);
  meshes["anvil"] = mesh_anvil_3;
  colliders["anvil"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["anvil"] ??= [];
  destructionGroups["anvil"].push(node_anvil_3);
  const socket_anvil_mount_lower_mount_0 = new THREE.Object3D();
  socket_anvil_mount_lower_mount_0.name = "mount-lower-mount";
  socket_anvil_mount_lower_mount_0.position.set(0.0, 327.5, 0.0);
  socket_anvil_mount_lower_mount_0.rotation.set(0.0, 0.0, 0.0);
  socket_anvil_mount_lower_mount_0.userData.socket = {"id": "mount-lower-mount", "position": [0, 327.5, 0], "rotation": [0, 0, 0], "type": "assembly"};
  node_anvil_3.add(socket_anvil_mount_lower_mount_0);
  sockets["anvil:mount-lower-mount"] = socket_anvil_mount_lower_mount_0;
  const socket_anvil_mount_lower_die_1 = new THREE.Object3D();
  socket_anvil_mount_lower_die_1.name = "mount-lower-die";
  socket_anvil_mount_lower_die_1.position.set(0.0, 367.5, 0.0);
  socket_anvil_mount_lower_die_1.rotation.set(0.0, 0.0, 0.0);
  socket_anvil_mount_lower_die_1.userData.socket = {"id": "mount-lower-die", "position": [0, 367.5, 0], "rotation": [0, 0, 0], "type": "assembly"};
  node_anvil_3.add(socket_anvil_mount_lower_die_1);
  sockets["anvil:mount-lower-die"] = socket_anvil_mount_lower_die_1;

  const endpoint_front_cylinder_4 = makeAttachmentEndpoint(null);
  const node_front_cylinder_4 = new THREE.Group();
  node_front_cylinder_4.name = "front-cylinder__pivot";
  node_front_cylinder_4.scale.set(1, 1, 1);
  if (endpoint_front_cylinder_4) {
    node_front_cylinder_4.position.copy(endpoint_front_cylinder_4.start);
    node_front_cylinder_4.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_front_cylinder_4.position.set(0.0, 1680.0, 500.0);
    node_front_cylinder_4.rotation.set(0.0, 0.0, 0.0);
  }
  node_front_cylinder_4.userData.sculptComponent = {"id": "front-cylinder", "name": "front-cylinder", "level": "macro", "role": "mechanical-part", "importance": 1, "confidence": 0.8, "primitive": "lathe", "topologyClass": "assembled-solid", "topologyRationale": "Closed revolved rigid cylinder; centered profile retains parent-local pivot independent of attachment metadata.", "geometryDescriptor": {"topologyIntent": "closed independent cast or machined solid", "edgeTreatment": {"type": "chamfer", "bevelRadius": 3, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "latheProfile": {"points": [[0, -0.5], [0.5, -0.5], [0.5, 0.5], [0, 0.5]], "segments": 24}}, "parent": "root", "attachment": {"parentSocket": "mount-front-cylinder", "localStart": [0, 0, 0], "localEnd": [0, 410, 0], "contactType": "overlap", "embedDepth": 3, "gapTolerance": 0.5}, "dimensions": {"width": 480, "height": 500, "depth": 480, "units": "mm", "confidence": 0.65}, "transform": {"position": [0, 1680, 500], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "mount-front-cap", "position": [0, 280, 0], "rotation": [0, 0, 0], "type": "assembly"}, {"id": "mount-front-collar", "position": [0, -260, 0], "rotation": [0, 0, 0], "type": "assembly"}, {"id": "mount-guide", "position": [0, -345, 0], "rotation": [0, 0, 0], "type": "assembly"}, {"id": "mount-lubricator-top", "position": [0, 430, 0], "rotation": [0, 0, 0], "type": "assembly"}, {"id": "mount-guide-lug-negative-x", "position": [-250, -250, 0], "rotation": [0, 0, 0], "type": "assembly"}, {"id": "mount-guide-lug-positive-x", "position": [250, -250, 0], "rotation": [0, 0, 0], "type": "assembly"}], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "front-cylinder", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "iron"}}, "material": "iron", "materialLayers": ["iron"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0, "microRoughness": 0, "bumpAmplitude": 0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(106, 100, 99, 1)", "secondaryAlbedo": "rgba(120, 113, 111, 1)", "materialClass": "metal", "materialClassConfidence": 0.85, "materialRef": "iron", "evidenceRefs": ["full-object"]}};
  node_front_cylinder_4.userData.actionProfile = {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "mount-front-cap", "position": [0, 280, 0], "rotation": [0, 0, 0], "type": "assembly"}, {"id": "mount-front-collar", "position": [0, -260, 0], "rotation": [0, 0, 0], "type": "assembly"}, {"id": "mount-guide", "position": [0, -345, 0], "rotation": [0, 0, 0], "type": "assembly"}, {"id": "mount-lubricator-top", "position": [0, 430, 0], "rotation": [0, 0, 0], "type": "assembly"}, {"id": "mount-guide-lug-negative-x", "position": [-250, -250, 0], "rotation": [0, 0, 0], "type": "assembly"}, {"id": "mount-guide-lug-positive-x", "position": [250, -250, 0], "rotation": [0, 0, 0], "type": "assembly"}], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "front-cylinder", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "iron"}};
  (nodes["root"] ?? root).add(node_front_cylinder_4);
  nodes["front-cylinder"] = node_front_cylinder_4;
  const mesh_front_cylinder_4Geometry = endpoint_front_cylinder_4
    ? new THREE.CylinderGeometry(endpoint_front_cylinder_4.endRadius, endpoint_front_cylinder_4.baseRadius, endpoint_front_cylinder_4.length, 16, 6)
    : buildLatheGeometry({"points": [[0, -0.5], [0.5, -0.5], [0.5, 0.5], [0, 0.5]], "segments": 24});
  if (!endpoint_front_cylinder_4) {
    mesh_front_cylinder_4Geometry.scale(480.0, 500.0, 480.0);
  }
  const mesh_front_cylinder_4 = new THREE.Mesh(
    mesh_front_cylinder_4Geometry,
    materialMap["iron"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_front_cylinder_4.name = "front-cylinder";
  if (endpoint_front_cylinder_4) {
    mesh_front_cylinder_4.position.copy(endpoint_front_cylinder_4.midpoint);
    mesh_front_cylinder_4.quaternion.copy(endpoint_front_cylinder_4.quaternion);
  }
  mesh_front_cylinder_4.castShadow = options.castShadow ?? true;
  mesh_front_cylinder_4.receiveShadow = options.receiveShadow ?? true;
  mesh_front_cylinder_4.userData.sculptComponent = {"id": "front-cylinder", "name": "front-cylinder", "level": "macro", "role": "mechanical-part", "importance": 1, "confidence": 0.8, "primitive": "lathe", "topologyClass": "assembled-solid", "topologyRationale": "Closed revolved rigid cylinder; centered profile retains parent-local pivot independent of attachment metadata.", "geometryDescriptor": {"topologyIntent": "closed independent cast or machined solid", "edgeTreatment": {"type": "chamfer", "bevelRadius": 3, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "latheProfile": {"points": [[0, -0.5], [0.5, -0.5], [0.5, 0.5], [0, 0.5]], "segments": 24}}, "parent": "root", "attachment": {"parentSocket": "mount-front-cylinder", "localStart": [0, 0, 0], "localEnd": [0, 410, 0], "contactType": "overlap", "embedDepth": 3, "gapTolerance": 0.5}, "dimensions": {"width": 480, "height": 500, "depth": 480, "units": "mm", "confidence": 0.65}, "transform": {"position": [0, 1680, 500], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "mount-front-cap", "position": [0, 280, 0], "rotation": [0, 0, 0], "type": "assembly"}, {"id": "mount-front-collar", "position": [0, -260, 0], "rotation": [0, 0, 0], "type": "assembly"}, {"id": "mount-guide", "position": [0, -345, 0], "rotation": [0, 0, 0], "type": "assembly"}, {"id": "mount-lubricator-top", "position": [0, 430, 0], "rotation": [0, 0, 0], "type": "assembly"}, {"id": "mount-guide-lug-negative-x", "position": [-250, -250, 0], "rotation": [0, 0, 0], "type": "assembly"}, {"id": "mount-guide-lug-positive-x", "position": [250, -250, 0], "rotation": [0, 0, 0], "type": "assembly"}], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "front-cylinder", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "iron"}}, "material": "iron", "materialLayers": ["iron"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0, "microRoughness": 0, "bumpAmplitude": 0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(106, 100, 99, 1)", "secondaryAlbedo": "rgba(120, 113, 111, 1)", "materialClass": "metal", "materialClassConfidence": 0.85, "materialRef": "iron", "evidenceRefs": ["full-object"]}};
  node_front_cylinder_4.add(mesh_front_cylinder_4);
  meshes["front-cylinder"] = mesh_front_cylinder_4;
  colliders["front-cylinder"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["front-cylinder"] ??= [];
  destructionGroups["front-cylinder"].push(node_front_cylinder_4);
  const socket_front_cylinder_mount_front_cap_0 = new THREE.Object3D();
  socket_front_cylinder_mount_front_cap_0.name = "mount-front-cap";
  socket_front_cylinder_mount_front_cap_0.position.set(0.0, 280.0, 0.0);
  socket_front_cylinder_mount_front_cap_0.rotation.set(0.0, 0.0, 0.0);
  socket_front_cylinder_mount_front_cap_0.userData.socket = {"id": "mount-front-cap", "position": [0, 280, 0], "rotation": [0, 0, 0], "type": "assembly"};
  node_front_cylinder_4.add(socket_front_cylinder_mount_front_cap_0);
  sockets["front-cylinder:mount-front-cap"] = socket_front_cylinder_mount_front_cap_0;
  const socket_front_cylinder_mount_front_collar_1 = new THREE.Object3D();
  socket_front_cylinder_mount_front_collar_1.name = "mount-front-collar";
  socket_front_cylinder_mount_front_collar_1.position.set(0.0, -260.0, 0.0);
  socket_front_cylinder_mount_front_collar_1.rotation.set(0.0, 0.0, 0.0);
  socket_front_cylinder_mount_front_collar_1.userData.socket = {"id": "mount-front-collar", "position": [0, -260, 0], "rotation": [0, 0, 0], "type": "assembly"};
  node_front_cylinder_4.add(socket_front_cylinder_mount_front_collar_1);
  sockets["front-cylinder:mount-front-collar"] = socket_front_cylinder_mount_front_collar_1;
  const socket_front_cylinder_mount_guide_2 = new THREE.Object3D();
  socket_front_cylinder_mount_guide_2.name = "mount-guide";
  socket_front_cylinder_mount_guide_2.position.set(0.0, -345.0, 0.0);
  socket_front_cylinder_mount_guide_2.rotation.set(0.0, 0.0, 0.0);
  socket_front_cylinder_mount_guide_2.userData.socket = {"id": "mount-guide", "position": [0, -345, 0], "rotation": [0, 0, 0], "type": "assembly"};
  node_front_cylinder_4.add(socket_front_cylinder_mount_guide_2);
  sockets["front-cylinder:mount-guide"] = socket_front_cylinder_mount_guide_2;
  const socket_front_cylinder_mount_lubricator_top_3 = new THREE.Object3D();
  socket_front_cylinder_mount_lubricator_top_3.name = "mount-lubricator-top";
  socket_front_cylinder_mount_lubricator_top_3.position.set(0.0, 430.0, 0.0);
  socket_front_cylinder_mount_lubricator_top_3.rotation.set(0.0, 0.0, 0.0);
  socket_front_cylinder_mount_lubricator_top_3.userData.socket = {"id": "mount-lubricator-top", "position": [0, 430, 0], "rotation": [0, 0, 0], "type": "assembly"};
  node_front_cylinder_4.add(socket_front_cylinder_mount_lubricator_top_3);
  sockets["front-cylinder:mount-lubricator-top"] = socket_front_cylinder_mount_lubricator_top_3;
  const socket_front_cylinder_mount_guide_lug_negative_x_4 = new THREE.Object3D();
  socket_front_cylinder_mount_guide_lug_negative_x_4.name = "mount-guide-lug-negative-x";
  socket_front_cylinder_mount_guide_lug_negative_x_4.position.set(-250.0, -250.0, 0.0);
  socket_front_cylinder_mount_guide_lug_negative_x_4.rotation.set(0.0, 0.0, 0.0);
  socket_front_cylinder_mount_guide_lug_negative_x_4.userData.socket = {"id": "mount-guide-lug-negative-x", "position": [-250, -250, 0], "rotation": [0, 0, 0], "type": "assembly"};
  node_front_cylinder_4.add(socket_front_cylinder_mount_guide_lug_negative_x_4);
  sockets["front-cylinder:mount-guide-lug-negative-x"] = socket_front_cylinder_mount_guide_lug_negative_x_4;
  const socket_front_cylinder_mount_guide_lug_positive_x_5 = new THREE.Object3D();
  socket_front_cylinder_mount_guide_lug_positive_x_5.name = "mount-guide-lug-positive-x";
  socket_front_cylinder_mount_guide_lug_positive_x_5.position.set(250.0, -250.0, 0.0);
  socket_front_cylinder_mount_guide_lug_positive_x_5.rotation.set(0.0, 0.0, 0.0);
  socket_front_cylinder_mount_guide_lug_positive_x_5.userData.socket = {"id": "mount-guide-lug-positive-x", "position": [250, -250, 0], "rotation": [0, 0, 0], "type": "assembly"};
  node_front_cylinder_4.add(socket_front_cylinder_mount_guide_lug_positive_x_5);
  sockets["front-cylinder:mount-guide-lug-positive-x"] = socket_front_cylinder_mount_guide_lug_positive_x_5;

  const endpoint_rear_cylinder_5 = makeAttachmentEndpoint(null);
  const node_rear_cylinder_5 = new THREE.Group();
  node_rear_cylinder_5.name = "rear-cylinder__pivot";
  node_rear_cylinder_5.scale.set(1, 1, 1);
  if (endpoint_rear_cylinder_5) {
    node_rear_cylinder_5.position.copy(endpoint_rear_cylinder_5.start);
    node_rear_cylinder_5.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_rear_cylinder_5.position.set(0.0, 1460.0, -440.0);
    node_rear_cylinder_5.rotation.set(0.0, 0.0, 0.0);
  }
  node_rear_cylinder_5.userData.sculptComponent = {"id": "rear-cylinder", "name": "rear-cylinder", "level": "macro", "role": "mechanical-part", "importance": 1, "confidence": 0.8, "primitive": "lathe", "topologyClass": "assembled-solid", "topologyRationale": "Closed revolved rigid cylinder; centered profile retains parent-local pivot independent of attachment metadata.", "geometryDescriptor": {"topologyIntent": "closed independent cast or machined solid", "edgeTreatment": {"type": "chamfer", "bevelRadius": 3, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "latheProfile": {"points": [[0, -0.5], [0.5, -0.5], [0.5, 0.5], [0, 0.5]], "segments": 24}}, "parent": "root", "attachment": {"parentSocket": "mount-rear-cylinder", "localStart": [0, 0, 0], "localEnd": [0, 215, 0], "contactType": "overlap", "embedDepth": 3, "gapTolerance": 0.5}, "dimensions": {"width": 400, "height": 420, "depth": 400, "units": "mm", "confidence": 0.65}, "transform": {"position": [0, 1460, -440], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "mount-rear-cap", "position": [0, 200, 0], "rotation": [0, 0, 0], "type": "assembly"}, {"id": "mount-lubricator-rear", "position": [0, 290, 0], "rotation": [0, 0, 0], "type": "assembly"}], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "rear-cylinder", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "iron"}}, "material": "iron", "materialLayers": ["iron"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0, "microRoughness": 0, "bumpAmplitude": 0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(106, 100, 99, 1)", "secondaryAlbedo": "rgba(120, 113, 111, 1)", "materialClass": "metal", "materialClassConfidence": 0.85, "materialRef": "iron", "evidenceRefs": ["full-object"]}};
  node_rear_cylinder_5.userData.actionProfile = {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "mount-rear-cap", "position": [0, 200, 0], "rotation": [0, 0, 0], "type": "assembly"}, {"id": "mount-lubricator-rear", "position": [0, 290, 0], "rotation": [0, 0, 0], "type": "assembly"}], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "rear-cylinder", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "iron"}};
  (nodes["root"] ?? root).add(node_rear_cylinder_5);
  nodes["rear-cylinder"] = node_rear_cylinder_5;
  const mesh_rear_cylinder_5Geometry = endpoint_rear_cylinder_5
    ? new THREE.CylinderGeometry(endpoint_rear_cylinder_5.endRadius, endpoint_rear_cylinder_5.baseRadius, endpoint_rear_cylinder_5.length, 16, 6)
    : buildLatheGeometry({"points": [[0, -0.5], [0.5, -0.5], [0.5, 0.5], [0, 0.5]], "segments": 24});
  if (!endpoint_rear_cylinder_5) {
    mesh_rear_cylinder_5Geometry.scale(400.0, 420.0, 400.0);
  }
  const mesh_rear_cylinder_5 = new THREE.Mesh(
    mesh_rear_cylinder_5Geometry,
    materialMap["iron"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_rear_cylinder_5.name = "rear-cylinder";
  if (endpoint_rear_cylinder_5) {
    mesh_rear_cylinder_5.position.copy(endpoint_rear_cylinder_5.midpoint);
    mesh_rear_cylinder_5.quaternion.copy(endpoint_rear_cylinder_5.quaternion);
  }
  mesh_rear_cylinder_5.castShadow = options.castShadow ?? true;
  mesh_rear_cylinder_5.receiveShadow = options.receiveShadow ?? true;
  mesh_rear_cylinder_5.userData.sculptComponent = {"id": "rear-cylinder", "name": "rear-cylinder", "level": "macro", "role": "mechanical-part", "importance": 1, "confidence": 0.8, "primitive": "lathe", "topologyClass": "assembled-solid", "topologyRationale": "Closed revolved rigid cylinder; centered profile retains parent-local pivot independent of attachment metadata.", "geometryDescriptor": {"topologyIntent": "closed independent cast or machined solid", "edgeTreatment": {"type": "chamfer", "bevelRadius": 3, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "latheProfile": {"points": [[0, -0.5], [0.5, -0.5], [0.5, 0.5], [0, 0.5]], "segments": 24}}, "parent": "root", "attachment": {"parentSocket": "mount-rear-cylinder", "localStart": [0, 0, 0], "localEnd": [0, 215, 0], "contactType": "overlap", "embedDepth": 3, "gapTolerance": 0.5}, "dimensions": {"width": 400, "height": 420, "depth": 400, "units": "mm", "confidence": 0.65}, "transform": {"position": [0, 1460, -440], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "mount-rear-cap", "position": [0, 200, 0], "rotation": [0, 0, 0], "type": "assembly"}, {"id": "mount-lubricator-rear", "position": [0, 290, 0], "rotation": [0, 0, 0], "type": "assembly"}], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "rear-cylinder", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "iron"}}, "material": "iron", "materialLayers": ["iron"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0, "microRoughness": 0, "bumpAmplitude": 0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(106, 100, 99, 1)", "secondaryAlbedo": "rgba(120, 113, 111, 1)", "materialClass": "metal", "materialClassConfidence": 0.85, "materialRef": "iron", "evidenceRefs": ["full-object"]}};
  node_rear_cylinder_5.add(mesh_rear_cylinder_5);
  meshes["rear-cylinder"] = mesh_rear_cylinder_5;
  colliders["rear-cylinder"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["rear-cylinder"] ??= [];
  destructionGroups["rear-cylinder"].push(node_rear_cylinder_5);
  const socket_rear_cylinder_mount_rear_cap_0 = new THREE.Object3D();
  socket_rear_cylinder_mount_rear_cap_0.name = "mount-rear-cap";
  socket_rear_cylinder_mount_rear_cap_0.position.set(0.0, 200.0, 0.0);
  socket_rear_cylinder_mount_rear_cap_0.rotation.set(0.0, 0.0, 0.0);
  socket_rear_cylinder_mount_rear_cap_0.userData.socket = {"id": "mount-rear-cap", "position": [0, 200, 0], "rotation": [0, 0, 0], "type": "assembly"};
  node_rear_cylinder_5.add(socket_rear_cylinder_mount_rear_cap_0);
  sockets["rear-cylinder:mount-rear-cap"] = socket_rear_cylinder_mount_rear_cap_0;
  const socket_rear_cylinder_mount_lubricator_rear_1 = new THREE.Object3D();
  socket_rear_cylinder_mount_lubricator_rear_1.name = "mount-lubricator-rear";
  socket_rear_cylinder_mount_lubricator_rear_1.position.set(0.0, 290.0, 0.0);
  socket_rear_cylinder_mount_lubricator_rear_1.rotation.set(0.0, 0.0, 0.0);
  socket_rear_cylinder_mount_lubricator_rear_1.userData.socket = {"id": "mount-lubricator-rear", "position": [0, 290, 0], "rotation": [0, 0, 0], "type": "assembly"};
  node_rear_cylinder_5.add(socket_rear_cylinder_mount_lubricator_rear_1);
  sockets["rear-cylinder:mount-lubricator-rear"] = socket_rear_cylinder_mount_lubricator_rear_1;

  const endpoint_front_cap_6 = makeAttachmentEndpoint(null);
  const node_front_cap_6 = new THREE.Group();
  node_front_cap_6.name = "front-cap__pivot";
  node_front_cap_6.scale.set(1, 1, 1);
  if (endpoint_front_cap_6) {
    node_front_cap_6.position.copy(endpoint_front_cap_6.start);
    node_front_cap_6.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_front_cap_6.position.set(0.0, 280.0, 0.0);
    node_front_cap_6.rotation.set(0.0, 0.0, 0.0);
  }
  node_front_cap_6.userData.sculptComponent = {"id": "front-cap", "name": "front-cap", "level": "macro", "role": "mechanical-part", "importance": 1, "confidence": 0.8, "primitive": "lathe", "topologyClass": "assembled-solid", "topologyRationale": "Closed revolved rigid cylinder; centered profile retains parent-local pivot independent of attachment metadata.", "geometryDescriptor": {"topologyIntent": "closed independent cast or machined solid", "edgeTreatment": {"type": "chamfer", "bevelRadius": 3, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "latheProfile": {"points": [[0, -0.5], [0.5, -0.5], [0.5, 0.5], [0, 0.5]], "segments": 24}}, "parent": "front-cylinder", "attachment": {"parentSocket": "mount-front-cap", "localStart": [0, 0, 0], "localEnd": [0, 45, 0], "contactType": "overlap", "embedDepth": 3, "gapTolerance": 0.5}, "dimensions": {"width": 550, "height": 90, "depth": 550, "units": "mm", "confidence": 0.65}, "transform": {"position": [0, 280, 0], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "front-cap", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "iron"}}, "material": "iron", "materialLayers": ["iron"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "cap-bolt-ring", "type": "fastener", "description": "Top flange fasteners", "placement": "component boundary", "geometryEffect": "instanced system", "materialEffect": "assigned material", "sizeMm": 5, "confidence": 0.8, "evidenceRefs": ["full-object"]}, {"id": "flange-step", "type": "ridge", "description": "Raised flange rim", "placement": "component boundary", "geometryEffect": "assembly relief", "materialEffect": "assigned material", "sizeMm": 5, "confidence": 0.8, "evidenceRefs": ["full-object"]}], "surfaceDetail": {"macroRoughness": 0, "microRoughness": 0, "bumpAmplitude": 0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(106, 100, 99, 1)", "secondaryAlbedo": "rgba(120, 113, 111, 1)", "materialClass": "metal", "materialClassConfidence": 0.85, "materialRef": "iron", "evidenceRefs": ["full-object"]}};
  node_front_cap_6.userData.actionProfile = {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "front-cap", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "iron"}};
  (nodes["front-cylinder"] ?? root).add(node_front_cap_6);
  nodes["front-cap"] = node_front_cap_6;
  const mesh_front_cap_6Geometry = endpoint_front_cap_6
    ? new THREE.CylinderGeometry(endpoint_front_cap_6.endRadius, endpoint_front_cap_6.baseRadius, endpoint_front_cap_6.length, 16, 6)
    : buildLatheGeometry({"points": [[0, -0.5], [0.5, -0.5], [0.5, 0.5], [0, 0.5]], "segments": 24});
  if (!endpoint_front_cap_6) {
    mesh_front_cap_6Geometry.scale(550.0, 90.0, 550.0);
  }
  const mesh_front_cap_6 = new THREE.Mesh(
    mesh_front_cap_6Geometry,
    materialMap["iron"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_front_cap_6.name = "front-cap";
  if (endpoint_front_cap_6) {
    mesh_front_cap_6.position.copy(endpoint_front_cap_6.midpoint);
    mesh_front_cap_6.quaternion.copy(endpoint_front_cap_6.quaternion);
  }
  mesh_front_cap_6.castShadow = options.castShadow ?? true;
  mesh_front_cap_6.receiveShadow = options.receiveShadow ?? true;
  mesh_front_cap_6.userData.sculptComponent = {"id": "front-cap", "name": "front-cap", "level": "macro", "role": "mechanical-part", "importance": 1, "confidence": 0.8, "primitive": "lathe", "topologyClass": "assembled-solid", "topologyRationale": "Closed revolved rigid cylinder; centered profile retains parent-local pivot independent of attachment metadata.", "geometryDescriptor": {"topologyIntent": "closed independent cast or machined solid", "edgeTreatment": {"type": "chamfer", "bevelRadius": 3, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "latheProfile": {"points": [[0, -0.5], [0.5, -0.5], [0.5, 0.5], [0, 0.5]], "segments": 24}}, "parent": "front-cylinder", "attachment": {"parentSocket": "mount-front-cap", "localStart": [0, 0, 0], "localEnd": [0, 45, 0], "contactType": "overlap", "embedDepth": 3, "gapTolerance": 0.5}, "dimensions": {"width": 550, "height": 90, "depth": 550, "units": "mm", "confidence": 0.65}, "transform": {"position": [0, 280, 0], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "front-cap", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "iron"}}, "material": "iron", "materialLayers": ["iron"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "cap-bolt-ring", "type": "fastener", "description": "Top flange fasteners", "placement": "component boundary", "geometryEffect": "instanced system", "materialEffect": "assigned material", "sizeMm": 5, "confidence": 0.8, "evidenceRefs": ["full-object"]}, {"id": "flange-step", "type": "ridge", "description": "Raised flange rim", "placement": "component boundary", "geometryEffect": "assembly relief", "materialEffect": "assigned material", "sizeMm": 5, "confidence": 0.8, "evidenceRefs": ["full-object"]}], "surfaceDetail": {"macroRoughness": 0, "microRoughness": 0, "bumpAmplitude": 0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(106, 100, 99, 1)", "secondaryAlbedo": "rgba(120, 113, 111, 1)", "materialClass": "metal", "materialClassConfidence": 0.85, "materialRef": "iron", "evidenceRefs": ["full-object"]}};
  node_front_cap_6.add(mesh_front_cap_6);
  meshes["front-cap"] = mesh_front_cap_6;
  colliders["front-cap"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["front-cap"] ??= [];
  destructionGroups["front-cap"].push(node_front_cap_6);

  const endpoint_front_collar_7 = makeAttachmentEndpoint(null);
  const node_front_collar_7 = new THREE.Group();
  node_front_collar_7.name = "front-collar__pivot";
  node_front_collar_7.scale.set(1, 1, 1);
  if (endpoint_front_collar_7) {
    node_front_collar_7.position.copy(endpoint_front_collar_7.start);
    node_front_collar_7.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_front_collar_7.position.set(0.0, -260.0, 0.0);
    node_front_collar_7.rotation.set(0.0, 0.0, 0.0);
  }
  node_front_collar_7.userData.sculptComponent = {"id": "front-collar", "name": "front-collar", "level": "macro", "role": "mechanical-part", "importance": 1, "confidence": 0.8, "primitive": "lathe", "topologyClass": "assembled-solid", "topologyRationale": "Closed revolved rigid cylinder; centered profile retains parent-local pivot independent of attachment metadata.", "geometryDescriptor": {"topologyIntent": "closed independent cast or machined solid", "edgeTreatment": {"type": "chamfer", "bevelRadius": 3, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "latheProfile": {"points": [[0, -0.5], [0.5, -0.5], [0.5, 0.5], [0, 0.5]], "segments": 24}}, "parent": "front-cylinder", "attachment": {"parentSocket": "mount-front-collar", "localStart": [0, 0, 0], "localEnd": [0, 45, 0], "contactType": "overlap", "embedDepth": 3, "gapTolerance": 0.5}, "dimensions": {"width": 550, "height": 90, "depth": 550, "units": "mm", "confidence": 0.65}, "transform": {"position": [0, -260, 0], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "front-collar", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "iron"}}, "material": "iron", "materialLayers": ["iron"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0, "microRoughness": 0, "bumpAmplitude": 0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(106, 100, 99, 1)", "secondaryAlbedo": "rgba(120, 113, 111, 1)", "materialClass": "metal", "materialClassConfidence": 0.85, "materialRef": "iron", "evidenceRefs": ["full-object"]}};
  node_front_collar_7.userData.actionProfile = {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "front-collar", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "iron"}};
  (nodes["front-cylinder"] ?? root).add(node_front_collar_7);
  nodes["front-collar"] = node_front_collar_7;
  const mesh_front_collar_7Geometry = endpoint_front_collar_7
    ? new THREE.CylinderGeometry(endpoint_front_collar_7.endRadius, endpoint_front_collar_7.baseRadius, endpoint_front_collar_7.length, 16, 6)
    : buildLatheGeometry({"points": [[0, -0.5], [0.5, -0.5], [0.5, 0.5], [0, 0.5]], "segments": 24});
  if (!endpoint_front_collar_7) {
    mesh_front_collar_7Geometry.scale(550.0, 90.0, 550.0);
  }
  const mesh_front_collar_7 = new THREE.Mesh(
    mesh_front_collar_7Geometry,
    materialMap["iron"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_front_collar_7.name = "front-collar";
  if (endpoint_front_collar_7) {
    mesh_front_collar_7.position.copy(endpoint_front_collar_7.midpoint);
    mesh_front_collar_7.quaternion.copy(endpoint_front_collar_7.quaternion);
  }
  mesh_front_collar_7.castShadow = options.castShadow ?? true;
  mesh_front_collar_7.receiveShadow = options.receiveShadow ?? true;
  mesh_front_collar_7.userData.sculptComponent = {"id": "front-collar", "name": "front-collar", "level": "macro", "role": "mechanical-part", "importance": 1, "confidence": 0.8, "primitive": "lathe", "topologyClass": "assembled-solid", "topologyRationale": "Closed revolved rigid cylinder; centered profile retains parent-local pivot independent of attachment metadata.", "geometryDescriptor": {"topologyIntent": "closed independent cast or machined solid", "edgeTreatment": {"type": "chamfer", "bevelRadius": 3, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "latheProfile": {"points": [[0, -0.5], [0.5, -0.5], [0.5, 0.5], [0, 0.5]], "segments": 24}}, "parent": "front-cylinder", "attachment": {"parentSocket": "mount-front-collar", "localStart": [0, 0, 0], "localEnd": [0, 45, 0], "contactType": "overlap", "embedDepth": 3, "gapTolerance": 0.5}, "dimensions": {"width": 550, "height": 90, "depth": 550, "units": "mm", "confidence": 0.65}, "transform": {"position": [0, -260, 0], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "front-collar", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "iron"}}, "material": "iron", "materialLayers": ["iron"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0, "microRoughness": 0, "bumpAmplitude": 0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(106, 100, 99, 1)", "secondaryAlbedo": "rgba(120, 113, 111, 1)", "materialClass": "metal", "materialClassConfidence": 0.85, "materialRef": "iron", "evidenceRefs": ["full-object"]}};
  node_front_collar_7.add(mesh_front_collar_7);
  meshes["front-collar"] = mesh_front_collar_7;
  colliders["front-collar"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["front-collar"] ??= [];
  destructionGroups["front-collar"].push(node_front_collar_7);

  const endpoint_guide_8 = makeAttachmentEndpoint(null);
  const node_guide_8 = new THREE.Group();
  node_guide_8.name = "guide__pivot";
  node_guide_8.scale.set(1, 1, 1);
  if (endpoint_guide_8) {
    node_guide_8.position.copy(endpoint_guide_8.start);
    node_guide_8.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_guide_8.position.set(0.0, -345.0, 0.0);
    node_guide_8.rotation.set(0.0, 0.0, 0.0);
  }
  node_guide_8.userData.sculptComponent = {"id": "guide", "name": "guide", "level": "macro", "role": "mechanical-part", "importance": 1, "confidence": 0.8, "primitive": "lathe", "topologyClass": "assembled-solid", "topologyRationale": "Closed revolved rigid cylinder; centered profile retains parent-local pivot independent of attachment metadata.", "geometryDescriptor": {"topologyIntent": "closed independent cast or machined solid", "edgeTreatment": {"type": "chamfer", "bevelRadius": 3, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "latheProfile": {"points": [[0, -0.5], [0.5, -0.5], [0.5, 0.5], [0, 0.5]], "segments": 24}}, "parent": "front-cylinder", "attachment": {"parentSocket": "mount-guide", "localStart": [0, 0, 0], "localEnd": [0, 85, 0], "contactType": "overlap", "embedDepth": 3, "gapTolerance": 0.5}, "dimensions": {"width": 310, "height": 170, "depth": 310, "units": "mm", "confidence": 0.65}, "transform": {"position": [0, -345, 0], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "guide", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "iron"}}, "material": "iron", "materialLayers": ["iron"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "guide-band", "type": "seam", "description": "Lower guide collar seam", "placement": "component boundary", "geometryEffect": "assembly relief", "materialEffect": "assigned material", "sizeMm": 5, "confidence": 0.8, "evidenceRefs": ["full-object"]}], "surfaceDetail": {"macroRoughness": 0, "microRoughness": 0, "bumpAmplitude": 0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(106, 100, 99, 1)", "secondaryAlbedo": "rgba(120, 113, 111, 1)", "materialClass": "metal", "materialClassConfidence": 0.85, "materialRef": "iron", "evidenceRefs": ["full-object"]}};
  node_guide_8.userData.actionProfile = {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "guide", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "iron"}};
  (nodes["front-cylinder"] ?? root).add(node_guide_8);
  nodes["guide"] = node_guide_8;
  const mesh_guide_8Geometry = endpoint_guide_8
    ? new THREE.CylinderGeometry(endpoint_guide_8.endRadius, endpoint_guide_8.baseRadius, endpoint_guide_8.length, 16, 6)
    : buildLatheGeometry({"points": [[0, -0.5], [0.5, -0.5], [0.5, 0.5], [0, 0.5]], "segments": 24});
  if (!endpoint_guide_8) {
    mesh_guide_8Geometry.scale(310.0, 170.0, 310.0);
  }
  const mesh_guide_8 = new THREE.Mesh(
    mesh_guide_8Geometry,
    materialMap["iron"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_guide_8.name = "guide";
  if (endpoint_guide_8) {
    mesh_guide_8.position.copy(endpoint_guide_8.midpoint);
    mesh_guide_8.quaternion.copy(endpoint_guide_8.quaternion);
  }
  mesh_guide_8.castShadow = options.castShadow ?? true;
  mesh_guide_8.receiveShadow = options.receiveShadow ?? true;
  mesh_guide_8.userData.sculptComponent = {"id": "guide", "name": "guide", "level": "macro", "role": "mechanical-part", "importance": 1, "confidence": 0.8, "primitive": "lathe", "topologyClass": "assembled-solid", "topologyRationale": "Closed revolved rigid cylinder; centered profile retains parent-local pivot independent of attachment metadata.", "geometryDescriptor": {"topologyIntent": "closed independent cast or machined solid", "edgeTreatment": {"type": "chamfer", "bevelRadius": 3, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "latheProfile": {"points": [[0, -0.5], [0.5, -0.5], [0.5, 0.5], [0, 0.5]], "segments": 24}}, "parent": "front-cylinder", "attachment": {"parentSocket": "mount-guide", "localStart": [0, 0, 0], "localEnd": [0, 85, 0], "contactType": "overlap", "embedDepth": 3, "gapTolerance": 0.5}, "dimensions": {"width": 310, "height": 170, "depth": 310, "units": "mm", "confidence": 0.65}, "transform": {"position": [0, -345, 0], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "guide", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "iron"}}, "material": "iron", "materialLayers": ["iron"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "guide-band", "type": "seam", "description": "Lower guide collar seam", "placement": "component boundary", "geometryEffect": "assembly relief", "materialEffect": "assigned material", "sizeMm": 5, "confidence": 0.8, "evidenceRefs": ["full-object"]}], "surfaceDetail": {"macroRoughness": 0, "microRoughness": 0, "bumpAmplitude": 0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(106, 100, 99, 1)", "secondaryAlbedo": "rgba(120, 113, 111, 1)", "materialClass": "metal", "materialClassConfidence": 0.85, "materialRef": "iron", "evidenceRefs": ["full-object"]}};
  node_guide_8.add(mesh_guide_8);
  meshes["guide"] = mesh_guide_8;
  colliders["guide"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["guide"] ??= [];
  destructionGroups["guide"].push(node_guide_8);

  const endpoint_ram_9 = makeAttachmentEndpoint(null);
  const node_ram_9 = new THREE.Group();
  node_ram_9.name = "ram__pivot";
  node_ram_9.scale.set(1, 1, 1);
  if (endpoint_ram_9) {
    node_ram_9.position.copy(endpoint_ram_9.start);
    node_ram_9.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_ram_9.position.set(0.0, 1290.0, 500.0);
    node_ram_9.rotation.set(0.0, 0.0, 0.0);
  }
  node_ram_9.userData.sculptComponent = {"id": "ram", "name": "ram", "level": "macro", "role": "mechanical-part", "importance": 1, "confidence": 0.8, "primitive": "lathe", "topologyClass": "assembled-solid", "topologyRationale": "Closed revolved rigid cylinder; centered profile retains parent-local pivot independent of attachment metadata.", "geometryDescriptor": {"topologyIntent": "closed independent cast or machined solid", "edgeTreatment": {"type": "chamfer", "bevelRadius": 3, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "latheProfile": {"points": [[0, -0.5], [0.5, -0.5], [0.5, 0.5], [0, 0.5]], "segments": 24}}, "parent": "root", "attachment": {"parentSocket": "mount-ram", "localStart": [0, 0, 0], "localEnd": [0, 225, 0], "contactType": "socket", "embedDepth": 80, "gapTolerance": 0.5}, "dimensions": {"width": 200, "height": 450, "depth": 200, "units": "mm", "confidence": 0.65}, "transform": {"position": [0, 1290, 500], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "slider", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "mount-upper-mount", "position": [0, -210, 0], "rotation": [0, 0, 0], "type": "assembly"}, {"id": "mount-upper-die", "position": [0, -255, 0], "rotation": [0, 0, 0], "type": "assembly"}], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [{"type": "prismatic", "axis": [0, 1, 0], "min": -120, "max": 0, "units": "mm", "note": "Available travel only; actual workpiece contact can stop sooner."}], "destruction": {"breakable": false, "fractureGroup": "ram", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "steel"}}, "material": "steel", "materialLayers": ["steel"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "ram-polish", "type": "gloss", "description": "Longitudinal polished steel", "placement": "component boundary", "geometryEffect": "none", "materialEffect": "steel/edge-wear", "sizeMm": 5, "confidence": 0.8, "evidenceRefs": ["full-object"]}], "surfaceDetail": {"macroRoughness": 0, "microRoughness": 0, "bumpAmplitude": 0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(132, 122, 117, 1)", "secondaryAlbedo": "rgba(105, 95, 90, 1)", "materialClass": "metal", "materialClassConfidence": 0.85, "materialRef": "steel", "evidenceRefs": ["full-object"]}};
  node_ram_9.userData.actionProfile = {"animationRole": "slider", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "mount-upper-mount", "position": [0, -210, 0], "rotation": [0, 0, 0], "type": "assembly"}, {"id": "mount-upper-die", "position": [0, -255, 0], "rotation": [0, 0, 0], "type": "assembly"}], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [{"type": "prismatic", "axis": [0, 1, 0], "min": -120, "max": 0, "units": "mm", "note": "Available travel only; actual workpiece contact can stop sooner."}], "destruction": {"breakable": false, "fractureGroup": "ram", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "steel"}};
  (nodes["root"] ?? root).add(node_ram_9);
  nodes["ram"] = node_ram_9;
  const mesh_ram_9Geometry = endpoint_ram_9
    ? new THREE.CylinderGeometry(endpoint_ram_9.endRadius, endpoint_ram_9.baseRadius, endpoint_ram_9.length, 16, 6)
    : buildLatheGeometry({"points": [[0, -0.5], [0.5, -0.5], [0.5, 0.5], [0, 0.5]], "segments": 24});
  if (!endpoint_ram_9) {
    mesh_ram_9Geometry.scale(200.0, 450.0, 200.0);
  }
  const mesh_ram_9 = new THREE.Mesh(
    mesh_ram_9Geometry,
    materialMap["steel"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_ram_9.name = "ram";
  if (endpoint_ram_9) {
    mesh_ram_9.position.copy(endpoint_ram_9.midpoint);
    mesh_ram_9.quaternion.copy(endpoint_ram_9.quaternion);
  }
  mesh_ram_9.castShadow = options.castShadow ?? true;
  mesh_ram_9.receiveShadow = options.receiveShadow ?? true;
  mesh_ram_9.userData.sculptComponent = {"id": "ram", "name": "ram", "level": "macro", "role": "mechanical-part", "importance": 1, "confidence": 0.8, "primitive": "lathe", "topologyClass": "assembled-solid", "topologyRationale": "Closed revolved rigid cylinder; centered profile retains parent-local pivot independent of attachment metadata.", "geometryDescriptor": {"topologyIntent": "closed independent cast or machined solid", "edgeTreatment": {"type": "chamfer", "bevelRadius": 3, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "latheProfile": {"points": [[0, -0.5], [0.5, -0.5], [0.5, 0.5], [0, 0.5]], "segments": 24}}, "parent": "root", "attachment": {"parentSocket": "mount-ram", "localStart": [0, 0, 0], "localEnd": [0, 225, 0], "contactType": "socket", "embedDepth": 80, "gapTolerance": 0.5}, "dimensions": {"width": 200, "height": 450, "depth": 200, "units": "mm", "confidence": 0.65}, "transform": {"position": [0, 1290, 500], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "slider", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [{"id": "mount-upper-mount", "position": [0, -210, 0], "rotation": [0, 0, 0], "type": "assembly"}, {"id": "mount-upper-die", "position": [0, -255, 0], "rotation": [0, 0, 0], "type": "assembly"}], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [{"type": "prismatic", "axis": [0, 1, 0], "min": -120, "max": 0, "units": "mm", "note": "Available travel only; actual workpiece contact can stop sooner."}], "destruction": {"breakable": false, "fractureGroup": "ram", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "steel"}}, "material": "steel", "materialLayers": ["steel"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "ram-polish", "type": "gloss", "description": "Longitudinal polished steel", "placement": "component boundary", "geometryEffect": "none", "materialEffect": "steel/edge-wear", "sizeMm": 5, "confidence": 0.8, "evidenceRefs": ["full-object"]}], "surfaceDetail": {"macroRoughness": 0, "microRoughness": 0, "bumpAmplitude": 0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(132, 122, 117, 1)", "secondaryAlbedo": "rgba(105, 95, 90, 1)", "materialClass": "metal", "materialClassConfidence": 0.85, "materialRef": "steel", "evidenceRefs": ["full-object"]}};
  node_ram_9.add(mesh_ram_9);
  meshes["ram"] = mesh_ram_9;
  colliders["ram"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["ram"] ??= [];
  destructionGroups["ram"].push(node_ram_9);
  const socket_ram_mount_upper_mount_0 = new THREE.Object3D();
  socket_ram_mount_upper_mount_0.name = "mount-upper-mount";
  socket_ram_mount_upper_mount_0.position.set(0.0, -210.0, 0.0);
  socket_ram_mount_upper_mount_0.rotation.set(0.0, 0.0, 0.0);
  socket_ram_mount_upper_mount_0.userData.socket = {"id": "mount-upper-mount", "position": [0, -210, 0], "rotation": [0, 0, 0], "type": "assembly"};
  node_ram_9.add(socket_ram_mount_upper_mount_0);
  sockets["ram:mount-upper-mount"] = socket_ram_mount_upper_mount_0;
  const socket_ram_mount_upper_die_1 = new THREE.Object3D();
  socket_ram_mount_upper_die_1.name = "mount-upper-die";
  socket_ram_mount_upper_die_1.position.set(0.0, -255.0, 0.0);
  socket_ram_mount_upper_die_1.rotation.set(0.0, 0.0, 0.0);
  socket_ram_mount_upper_die_1.userData.socket = {"id": "mount-upper-die", "position": [0, -255, 0], "rotation": [0, 0, 0], "type": "assembly"};
  node_ram_9.add(socket_ram_mount_upper_die_1);
  sockets["ram:mount-upper-die"] = socket_ram_mount_upper_die_1;

  const endpoint_upper_mount_10 = makeAttachmentEndpoint(null);
  const node_upper_mount_10 = new THREE.Group();
  node_upper_mount_10.name = "upper-mount__pivot";
  node_upper_mount_10.scale.set(1, 1, 1);
  if (endpoint_upper_mount_10) {
    node_upper_mount_10.position.copy(endpoint_upper_mount_10.start);
    node_upper_mount_10.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_upper_mount_10.position.set(0.0, -210.0, 0.0);
    node_upper_mount_10.rotation.set(0.0, 0.0, 0.0);
  }
  node_upper_mount_10.userData.sculptComponent = {"id": "upper-mount", "name": "upper-mount", "level": "macro", "role": "mechanical-part", "importance": 1, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Independent rigid cast or machined part.", "geometryDescriptor": {"topologyIntent": "closed independent cast or machined solid", "edgeTreatment": {"type": "chamfer", "bevelRadius": 3, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "ram", "attachment": {"parentSocket": "mount-upper-mount", "localStart": [0, 0, 0], "localEnd": [0, 25, 0], "contactType": "overlap", "embedDepth": 3, "gapTolerance": 0.5}, "dimensions": {"width": 210, "height": 50, "depth": 210, "units": "mm", "confidence": 0.65}, "transform": {"position": [0, -210, 0], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "upper-mount", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "iron"}}, "material": "iron", "materialLayers": ["iron"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0, "microRoughness": 0, "bumpAmplitude": 0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(106, 100, 99, 1)", "secondaryAlbedo": "rgba(120, 113, 111, 1)", "materialClass": "metal", "materialClassConfidence": 0.85, "materialRef": "iron", "evidenceRefs": ["full-object"]}};
  node_upper_mount_10.userData.actionProfile = {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "upper-mount", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "iron"}};
  (nodes["ram"] ?? root).add(node_upper_mount_10);
  nodes["upper-mount"] = node_upper_mount_10;
  const mesh_upper_mount_10Geometry = endpoint_upper_mount_10
    ? new THREE.CylinderGeometry(endpoint_upper_mount_10.endRadius, endpoint_upper_mount_10.baseRadius, endpoint_upper_mount_10.length, 16, 6)
    : new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
  if (!endpoint_upper_mount_10) {
    mesh_upper_mount_10Geometry.scale(210.0, 50.0, 210.0);
  }
  const mesh_upper_mount_10 = new THREE.Mesh(
    mesh_upper_mount_10Geometry,
    materialMap["iron"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_upper_mount_10.name = "upper-mount";
  if (endpoint_upper_mount_10) {
    mesh_upper_mount_10.position.copy(endpoint_upper_mount_10.midpoint);
    mesh_upper_mount_10.quaternion.copy(endpoint_upper_mount_10.quaternion);
  }
  mesh_upper_mount_10.castShadow = options.castShadow ?? true;
  mesh_upper_mount_10.receiveShadow = options.receiveShadow ?? true;
  mesh_upper_mount_10.userData.sculptComponent = {"id": "upper-mount", "name": "upper-mount", "level": "macro", "role": "mechanical-part", "importance": 1, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Independent rigid cast or machined part.", "geometryDescriptor": {"topologyIntent": "closed independent cast or machined solid", "edgeTreatment": {"type": "chamfer", "bevelRadius": 3, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "ram", "attachment": {"parentSocket": "mount-upper-mount", "localStart": [0, 0, 0], "localEnd": [0, 25, 0], "contactType": "overlap", "embedDepth": 3, "gapTolerance": 0.5}, "dimensions": {"width": 210, "height": 50, "depth": 210, "units": "mm", "confidence": 0.65}, "transform": {"position": [0, -210, 0], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "upper-mount", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "iron"}}, "material": "iron", "materialLayers": ["iron"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0, "microRoughness": 0, "bumpAmplitude": 0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(106, 100, 99, 1)", "secondaryAlbedo": "rgba(120, 113, 111, 1)", "materialClass": "metal", "materialClassConfidence": 0.85, "materialRef": "iron", "evidenceRefs": ["full-object"]}};
  node_upper_mount_10.add(mesh_upper_mount_10);
  meshes["upper-mount"] = mesh_upper_mount_10;
  colliders["upper-mount"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["upper-mount"] ??= [];
  destructionGroups["upper-mount"].push(node_upper_mount_10);

  const endpoint_upper_die_11 = makeAttachmentEndpoint(null);
  const node_upper_die_11 = new THREE.Group();
  node_upper_die_11.name = "upper-die__pivot";
  node_upper_die_11.scale.set(1, 1, 1);
  if (endpoint_upper_die_11) {
    node_upper_die_11.position.copy(endpoint_upper_die_11.start);
    node_upper_die_11.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_upper_die_11.position.set(0.0, -255.0, 0.0);
    node_upper_die_11.rotation.set(0.0, 0.0, 0.0);
  }
  node_upper_die_11.userData.sculptComponent = {"id": "upper-die", "name": "upper-die", "level": "macro", "role": "mechanical-part", "importance": 1, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Independent rigid cast or machined part.", "geometryDescriptor": {"topologyIntent": "closed independent cast or machined solid", "edgeTreatment": {"type": "chamfer", "bevelRadius": 3, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "ram", "attachment": {"parentSocket": "mount-upper-die", "localStart": [0, 0, 0], "localEnd": [0, 40, 0], "contactType": "overlap", "embedDepth": 3, "gapTolerance": 0.5}, "dimensions": {"width": 180, "height": 80, "depth": 180, "units": "mm", "confidence": 0.65}, "transform": {"position": [0, -255, 0], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "upper-die", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "steel"}}, "material": "steel", "materialLayers": ["steel"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "upper-edge", "type": "bevel", "description": "Upper die bevel", "placement": "component boundary", "geometryEffect": "chamfer", "materialEffect": "assigned material", "sizeMm": 3, "confidence": 0.8, "evidenceRefs": ["full-object"]}], "surfaceDetail": {"macroRoughness": 0, "microRoughness": 0, "bumpAmplitude": 0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(132, 122, 117, 1)", "secondaryAlbedo": "rgba(105, 95, 90, 1)", "materialClass": "metal", "materialClassConfidence": 0.85, "materialRef": "steel", "evidenceRefs": ["full-object"]}};
  node_upper_die_11.userData.actionProfile = {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "upper-die", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "steel"}};
  (nodes["ram"] ?? root).add(node_upper_die_11);
  nodes["upper-die"] = node_upper_die_11;
  const mesh_upper_die_11Geometry = endpoint_upper_die_11
    ? new THREE.CylinderGeometry(endpoint_upper_die_11.endRadius, endpoint_upper_die_11.baseRadius, endpoint_upper_die_11.length, 16, 6)
    : new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
  if (!endpoint_upper_die_11) {
    mesh_upper_die_11Geometry.scale(180.0, 80.0, 180.0);
  }
  const mesh_upper_die_11 = new THREE.Mesh(
    mesh_upper_die_11Geometry,
    materialMap["steel"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_upper_die_11.name = "upper-die";
  if (endpoint_upper_die_11) {
    mesh_upper_die_11.position.copy(endpoint_upper_die_11.midpoint);
    mesh_upper_die_11.quaternion.copy(endpoint_upper_die_11.quaternion);
  }
  mesh_upper_die_11.castShadow = options.castShadow ?? true;
  mesh_upper_die_11.receiveShadow = options.receiveShadow ?? true;
  mesh_upper_die_11.userData.sculptComponent = {"id": "upper-die", "name": "upper-die", "level": "macro", "role": "mechanical-part", "importance": 1, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Independent rigid cast or machined part.", "geometryDescriptor": {"topologyIntent": "closed independent cast or machined solid", "edgeTreatment": {"type": "chamfer", "bevelRadius": 3, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "ram", "attachment": {"parentSocket": "mount-upper-die", "localStart": [0, 0, 0], "localEnd": [0, 40, 0], "contactType": "overlap", "embedDepth": 3, "gapTolerance": 0.5}, "dimensions": {"width": 180, "height": 80, "depth": 180, "units": "mm", "confidence": 0.65}, "transform": {"position": [0, -255, 0], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "upper-die", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "steel"}}, "material": "steel", "materialLayers": ["steel"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "upper-edge", "type": "bevel", "description": "Upper die bevel", "placement": "component boundary", "geometryEffect": "chamfer", "materialEffect": "assigned material", "sizeMm": 3, "confidence": 0.8, "evidenceRefs": ["full-object"]}], "surfaceDetail": {"macroRoughness": 0, "microRoughness": 0, "bumpAmplitude": 0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(132, 122, 117, 1)", "secondaryAlbedo": "rgba(105, 95, 90, 1)", "materialClass": "metal", "materialClassConfidence": 0.85, "materialRef": "steel", "evidenceRefs": ["full-object"]}};
  node_upper_die_11.add(mesh_upper_die_11);
  meshes["upper-die"] = mesh_upper_die_11;
  colliders["upper-die"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["upper-die"] ??= [];
  destructionGroups["upper-die"].push(node_upper_die_11);

  const endpoint_lower_mount_12 = makeAttachmentEndpoint(null);
  const node_lower_mount_12 = new THREE.Group();
  node_lower_mount_12.name = "lower-mount__pivot";
  node_lower_mount_12.scale.set(1, 1, 1);
  if (endpoint_lower_mount_12) {
    node_lower_mount_12.position.copy(endpoint_lower_mount_12.start);
    node_lower_mount_12.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_lower_mount_12.position.set(0.0, 327.5, 0.0);
    node_lower_mount_12.rotation.set(0.0, 0.0, 0.0);
  }
  node_lower_mount_12.userData.sculptComponent = {"id": "lower-mount", "name": "lower-mount", "level": "macro", "role": "mechanical-part", "importance": 1, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Independent rigid cast or machined part.", "geometryDescriptor": {"topologyIntent": "closed independent cast or machined solid", "edgeTreatment": {"type": "chamfer", "bevelRadius": 3, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "anvil", "attachment": {"parentSocket": "mount-lower-mount", "localStart": [0, 0, 0], "localEnd": [0, 20, 0], "contactType": "overlap", "embedDepth": 3, "gapTolerance": 0.5}, "dimensions": {"width": 260, "height": 40, "depth": 270, "units": "mm", "confidence": 0.65}, "transform": {"position": [0, 327.5, 0], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "lower-mount", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "iron"}}, "material": "iron", "materialLayers": ["iron"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0, "microRoughness": 0, "bumpAmplitude": 0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(106, 100, 99, 1)", "secondaryAlbedo": "rgba(120, 113, 111, 1)", "materialClass": "metal", "materialClassConfidence": 0.85, "materialRef": "iron", "evidenceRefs": ["full-object"]}};
  node_lower_mount_12.userData.actionProfile = {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "lower-mount", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "iron"}};
  (nodes["anvil"] ?? root).add(node_lower_mount_12);
  nodes["lower-mount"] = node_lower_mount_12;
  const mesh_lower_mount_12Geometry = endpoint_lower_mount_12
    ? new THREE.CylinderGeometry(endpoint_lower_mount_12.endRadius, endpoint_lower_mount_12.baseRadius, endpoint_lower_mount_12.length, 16, 6)
    : new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
  if (!endpoint_lower_mount_12) {
    mesh_lower_mount_12Geometry.scale(260.0, 40.0, 270.0);
  }
  const mesh_lower_mount_12 = new THREE.Mesh(
    mesh_lower_mount_12Geometry,
    materialMap["iron"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_lower_mount_12.name = "lower-mount";
  if (endpoint_lower_mount_12) {
    mesh_lower_mount_12.position.copy(endpoint_lower_mount_12.midpoint);
    mesh_lower_mount_12.quaternion.copy(endpoint_lower_mount_12.quaternion);
  }
  mesh_lower_mount_12.castShadow = options.castShadow ?? true;
  mesh_lower_mount_12.receiveShadow = options.receiveShadow ?? true;
  mesh_lower_mount_12.userData.sculptComponent = {"id": "lower-mount", "name": "lower-mount", "level": "macro", "role": "mechanical-part", "importance": 1, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Independent rigid cast or machined part.", "geometryDescriptor": {"topologyIntent": "closed independent cast or machined solid", "edgeTreatment": {"type": "chamfer", "bevelRadius": 3, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "anvil", "attachment": {"parentSocket": "mount-lower-mount", "localStart": [0, 0, 0], "localEnd": [0, 20, 0], "contactType": "overlap", "embedDepth": 3, "gapTolerance": 0.5}, "dimensions": {"width": 260, "height": 40, "depth": 270, "units": "mm", "confidence": 0.65}, "transform": {"position": [0, 327.5, 0], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "lower-mount", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "iron"}}, "material": "iron", "materialLayers": ["iron"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0, "microRoughness": 0, "bumpAmplitude": 0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(106, 100, 99, 1)", "secondaryAlbedo": "rgba(120, 113, 111, 1)", "materialClass": "metal", "materialClassConfidence": 0.85, "materialRef": "iron", "evidenceRefs": ["full-object"]}};
  node_lower_mount_12.add(mesh_lower_mount_12);
  meshes["lower-mount"] = mesh_lower_mount_12;
  colliders["lower-mount"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["lower-mount"] ??= [];
  destructionGroups["lower-mount"].push(node_lower_mount_12);

  const endpoint_lower_die_13 = makeAttachmentEndpoint(null);
  const node_lower_die_13 = new THREE.Group();
  node_lower_die_13.name = "lower-die__pivot";
  node_lower_die_13.scale.set(1, 1, 1);
  if (endpoint_lower_die_13) {
    node_lower_die_13.position.copy(endpoint_lower_die_13.start);
    node_lower_die_13.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_lower_die_13.position.set(0.0, 367.5, 0.0);
    node_lower_die_13.rotation.set(0.0, 0.0, 0.0);
  }
  node_lower_die_13.userData.sculptComponent = {"id": "lower-die", "name": "lower-die", "level": "macro", "role": "mechanical-part", "importance": 1, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Independent rigid cast or machined part.", "geometryDescriptor": {"topologyIntent": "closed independent cast or machined solid", "edgeTreatment": {"type": "chamfer", "bevelRadius": 3, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "anvil", "attachment": {"parentSocket": "mount-lower-die", "localStart": [0, 0, 0], "localEnd": [0, 40, 0], "contactType": "overlap", "embedDepth": 3, "gapTolerance": 0.5}, "dimensions": {"width": 180, "height": 80, "depth": 180, "units": "mm", "confidence": 0.65}, "transform": {"position": [0, 367.5, 0], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "lower-die", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "steel"}}, "material": "steel", "materialLayers": ["steel"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "lower-edge", "type": "bevel", "description": "Lower die bevel", "placement": "component boundary", "geometryEffect": "chamfer", "materialEffect": "assigned material", "sizeMm": 3, "confidence": 0.8, "evidenceRefs": ["full-object"]}], "surfaceDetail": {"macroRoughness": 0, "microRoughness": 0, "bumpAmplitude": 0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(132, 122, 117, 1)", "secondaryAlbedo": "rgba(105, 95, 90, 1)", "materialClass": "metal", "materialClassConfidence": 0.85, "materialRef": "steel", "evidenceRefs": ["full-object"]}};
  node_lower_die_13.userData.actionProfile = {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "lower-die", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "steel"}};
  (nodes["anvil"] ?? root).add(node_lower_die_13);
  nodes["lower-die"] = node_lower_die_13;
  const mesh_lower_die_13Geometry = endpoint_lower_die_13
    ? new THREE.CylinderGeometry(endpoint_lower_die_13.endRadius, endpoint_lower_die_13.baseRadius, endpoint_lower_die_13.length, 16, 6)
    : new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
  if (!endpoint_lower_die_13) {
    mesh_lower_die_13Geometry.scale(180.0, 80.0, 180.0);
  }
  const mesh_lower_die_13 = new THREE.Mesh(
    mesh_lower_die_13Geometry,
    materialMap["steel"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_lower_die_13.name = "lower-die";
  if (endpoint_lower_die_13) {
    mesh_lower_die_13.position.copy(endpoint_lower_die_13.midpoint);
    mesh_lower_die_13.quaternion.copy(endpoint_lower_die_13.quaternion);
  }
  mesh_lower_die_13.castShadow = options.castShadow ?? true;
  mesh_lower_die_13.receiveShadow = options.receiveShadow ?? true;
  mesh_lower_die_13.userData.sculptComponent = {"id": "lower-die", "name": "lower-die", "level": "macro", "role": "mechanical-part", "importance": 1, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Independent rigid cast or machined part.", "geometryDescriptor": {"topologyIntent": "closed independent cast or machined solid", "edgeTreatment": {"type": "chamfer", "bevelRadius": 3, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "anvil", "attachment": {"parentSocket": "mount-lower-die", "localStart": [0, 0, 0], "localEnd": [0, 40, 0], "contactType": "overlap", "embedDepth": 3, "gapTolerance": 0.5}, "dimensions": {"width": 180, "height": 80, "depth": 180, "units": "mm", "confidence": 0.65}, "transform": {"position": [0, 367.5, 0], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "lower-die", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "steel"}}, "material": "steel", "materialLayers": ["steel"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "lower-edge", "type": "bevel", "description": "Lower die bevel", "placement": "component boundary", "geometryEffect": "chamfer", "materialEffect": "assigned material", "sizeMm": 3, "confidence": 0.8, "evidenceRefs": ["full-object"]}], "surfaceDetail": {"macroRoughness": 0, "microRoughness": 0, "bumpAmplitude": 0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(132, 122, 117, 1)", "secondaryAlbedo": "rgba(105, 95, 90, 1)", "materialClass": "metal", "materialClassConfidence": 0.85, "materialRef": "steel", "evidenceRefs": ["full-object"]}};
  node_lower_die_13.add(mesh_lower_die_13);
  meshes["lower-die"] = mesh_lower_die_13;
  colliders["lower-die"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["lower-die"] ??= [];
  destructionGroups["lower-die"].push(node_lower_die_13);

  const endpoint_rear_cap_14 = makeAttachmentEndpoint(null);
  const node_rear_cap_14 = new THREE.Group();
  node_rear_cap_14.name = "rear-cap__pivot";
  node_rear_cap_14.scale.set(1, 1, 1);
  if (endpoint_rear_cap_14) {
    node_rear_cap_14.position.copy(endpoint_rear_cap_14.start);
    node_rear_cap_14.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_rear_cap_14.position.set(0.0, 200.0, 0.0);
    node_rear_cap_14.rotation.set(0.0, 0.0, 0.0);
  }
  node_rear_cap_14.userData.sculptComponent = {"id": "rear-cap", "name": "rear-cap", "level": "macro", "role": "mechanical-part", "importance": 1, "confidence": 0.8, "primitive": "lathe", "topologyClass": "assembled-solid", "topologyRationale": "Closed revolved rigid cylinder; centered profile retains parent-local pivot independent of attachment metadata.", "geometryDescriptor": {"topologyIntent": "closed independent cast or machined solid", "edgeTreatment": {"type": "chamfer", "bevelRadius": 3, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "latheProfile": {"points": [[0, -0.5], [0.5, -0.5], [0.5, 0.5], [0, 0.5]], "segments": 24}}, "parent": "rear-cylinder", "attachment": {"parentSocket": "mount-rear-cap", "localStart": [0, 0, 0], "localEnd": [0, 35, 0], "contactType": "overlap", "embedDepth": 3, "gapTolerance": 0.5}, "dimensions": {"width": 430, "height": 70, "depth": 430, "units": "mm", "confidence": 0.65}, "transform": {"position": [0, 200, 0], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "rear-cap", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "iron"}}, "material": "iron", "materialLayers": ["iron"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "rear-seam", "type": "seam", "description": "Rear cylinder lid seam", "placement": "component boundary", "geometryEffect": "assembly relief", "materialEffect": "assigned material", "sizeMm": 5, "confidence": 0.8, "evidenceRefs": ["full-object"]}], "surfaceDetail": {"macroRoughness": 0, "microRoughness": 0, "bumpAmplitude": 0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(106, 100, 99, 1)", "secondaryAlbedo": "rgba(120, 113, 111, 1)", "materialClass": "metal", "materialClassConfidence": 0.85, "materialRef": "iron", "evidenceRefs": ["full-object"]}};
  node_rear_cap_14.userData.actionProfile = {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "rear-cap", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "iron"}};
  (nodes["rear-cylinder"] ?? root).add(node_rear_cap_14);
  nodes["rear-cap"] = node_rear_cap_14;
  const mesh_rear_cap_14Geometry = endpoint_rear_cap_14
    ? new THREE.CylinderGeometry(endpoint_rear_cap_14.endRadius, endpoint_rear_cap_14.baseRadius, endpoint_rear_cap_14.length, 16, 6)
    : buildLatheGeometry({"points": [[0, -0.5], [0.5, -0.5], [0.5, 0.5], [0, 0.5]], "segments": 24});
  if (!endpoint_rear_cap_14) {
    mesh_rear_cap_14Geometry.scale(430.0, 70.0, 430.0);
  }
  const mesh_rear_cap_14 = new THREE.Mesh(
    mesh_rear_cap_14Geometry,
    materialMap["iron"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_rear_cap_14.name = "rear-cap";
  if (endpoint_rear_cap_14) {
    mesh_rear_cap_14.position.copy(endpoint_rear_cap_14.midpoint);
    mesh_rear_cap_14.quaternion.copy(endpoint_rear_cap_14.quaternion);
  }
  mesh_rear_cap_14.castShadow = options.castShadow ?? true;
  mesh_rear_cap_14.receiveShadow = options.receiveShadow ?? true;
  mesh_rear_cap_14.userData.sculptComponent = {"id": "rear-cap", "name": "rear-cap", "level": "macro", "role": "mechanical-part", "importance": 1, "confidence": 0.8, "primitive": "lathe", "topologyClass": "assembled-solid", "topologyRationale": "Closed revolved rigid cylinder; centered profile retains parent-local pivot independent of attachment metadata.", "geometryDescriptor": {"topologyIntent": "closed independent cast or machined solid", "edgeTreatment": {"type": "chamfer", "bevelRadius": 3, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "latheProfile": {"points": [[0, -0.5], [0.5, -0.5], [0.5, 0.5], [0, 0.5]], "segments": 24}}, "parent": "rear-cylinder", "attachment": {"parentSocket": "mount-rear-cap", "localStart": [0, 0, 0], "localEnd": [0, 35, 0], "contactType": "overlap", "embedDepth": 3, "gapTolerance": 0.5}, "dimensions": {"width": 430, "height": 70, "depth": 430, "units": "mm", "confidence": 0.65}, "transform": {"position": [0, 200, 0], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "rear-cap", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "iron"}}, "material": "iron", "materialLayers": ["iron"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "rear-seam", "type": "seam", "description": "Rear cylinder lid seam", "placement": "component boundary", "geometryEffect": "assembly relief", "materialEffect": "assigned material", "sizeMm": 5, "confidence": 0.8, "evidenceRefs": ["full-object"]}], "surfaceDetail": {"macroRoughness": 0, "microRoughness": 0, "bumpAmplitude": 0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(106, 100, 99, 1)", "secondaryAlbedo": "rgba(120, 113, 111, 1)", "materialClass": "metal", "materialClassConfidence": 0.85, "materialRef": "iron", "evidenceRefs": ["full-object"]}};
  node_rear_cap_14.add(mesh_rear_cap_14);
  meshes["rear-cap"] = mesh_rear_cap_14;
  colliders["rear-cap"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["rear-cap"] ??= [];
  destructionGroups["rear-cap"].push(node_rear_cap_14);

  const endpoint_lubricator_top_15 = makeAttachmentEndpoint(null);
  const node_lubricator_top_15 = new THREE.Group();
  node_lubricator_top_15.name = "lubricator-top__pivot";
  node_lubricator_top_15.scale.set(1, 1, 1);
  if (endpoint_lubricator_top_15) {
    node_lubricator_top_15.position.copy(endpoint_lubricator_top_15.start);
    node_lubricator_top_15.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_lubricator_top_15.position.set(0.0, 430.0, 0.0);
    node_lubricator_top_15.rotation.set(0.0, 0.0, 0.0);
  }
  node_lubricator_top_15.userData.sculptComponent = {"id": "lubricator-top", "name": "lubricator-top", "level": "meso", "role": "mechanical-part", "importance": 1, "confidence": 0.8, "primitive": "lathe", "topologyClass": "assembled-solid", "topologyRationale": "Closed revolved rigid cylinder; centered profile retains parent-local pivot independent of attachment metadata.", "geometryDescriptor": {"topologyIntent": "closed independent cast or machined solid", "edgeTreatment": {"type": "chamfer", "bevelRadius": 3, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "latheProfile": {"points": [[0, -0.5], [0.5, -0.5], [0.5, 0.5], [0, 0.5]], "segments": 24}}, "parent": "front-cylinder", "attachment": {"parentSocket": "mount-lubricator-top", "localStart": [0, 0, 0], "localEnd": [0, 80, 0], "contactType": "overlap", "embedDepth": 3, "gapTolerance": 0.5}, "dimensions": {"width": 55, "height": 140, "depth": 55, "units": "mm", "confidence": 0.65}, "transform": {"position": [0, 430, 0], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "lubricator-top", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "brass"}}, "material": "brass", "materialLayers": ["brass"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0, "microRoughness": 0, "bumpAmplitude": 0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(65, 49, 35, 1)", "secondaryAlbedo": "rgba(106, 77, 48, 1)", "materialClass": "metal", "materialClassConfidence": 0.85, "materialRef": "brass", "evidenceRefs": ["full-object"]}, "includeInBlockout": true};
  node_lubricator_top_15.userData.actionProfile = {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "lubricator-top", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "brass"}};
  (nodes["front-cylinder"] ?? root).add(node_lubricator_top_15);
  nodes["lubricator-top"] = node_lubricator_top_15;
  const mesh_lubricator_top_15Geometry = endpoint_lubricator_top_15
    ? new THREE.CylinderGeometry(endpoint_lubricator_top_15.endRadius, endpoint_lubricator_top_15.baseRadius, endpoint_lubricator_top_15.length, 16, 6)
    : buildLatheGeometry({"points": [[0, -0.5], [0.5, -0.5], [0.5, 0.5], [0, 0.5]], "segments": 24});
  if (!endpoint_lubricator_top_15) {
    mesh_lubricator_top_15Geometry.scale(55.0, 140.0, 55.0);
  }
  const mesh_lubricator_top_15 = new THREE.Mesh(
    mesh_lubricator_top_15Geometry,
    materialMap["brass"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_lubricator_top_15.name = "lubricator-top";
  if (endpoint_lubricator_top_15) {
    mesh_lubricator_top_15.position.copy(endpoint_lubricator_top_15.midpoint);
    mesh_lubricator_top_15.quaternion.copy(endpoint_lubricator_top_15.quaternion);
  }
  mesh_lubricator_top_15.castShadow = options.castShadow ?? true;
  mesh_lubricator_top_15.receiveShadow = options.receiveShadow ?? true;
  mesh_lubricator_top_15.userData.sculptComponent = {"id": "lubricator-top", "name": "lubricator-top", "level": "meso", "role": "mechanical-part", "importance": 1, "confidence": 0.8, "primitive": "lathe", "topologyClass": "assembled-solid", "topologyRationale": "Closed revolved rigid cylinder; centered profile retains parent-local pivot independent of attachment metadata.", "geometryDescriptor": {"topologyIntent": "closed independent cast or machined solid", "edgeTreatment": {"type": "chamfer", "bevelRadius": 3, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "latheProfile": {"points": [[0, -0.5], [0.5, -0.5], [0.5, 0.5], [0, 0.5]], "segments": 24}}, "parent": "front-cylinder", "attachment": {"parentSocket": "mount-lubricator-top", "localStart": [0, 0, 0], "localEnd": [0, 80, 0], "contactType": "overlap", "embedDepth": 3, "gapTolerance": 0.5}, "dimensions": {"width": 55, "height": 140, "depth": 55, "units": "mm", "confidence": 0.65}, "transform": {"position": [0, 430, 0], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "lubricator-top", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "brass"}}, "material": "brass", "materialLayers": ["brass"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0, "microRoughness": 0, "bumpAmplitude": 0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(65, 49, 35, 1)", "secondaryAlbedo": "rgba(106, 77, 48, 1)", "materialClass": "metal", "materialClassConfidence": 0.85, "materialRef": "brass", "evidenceRefs": ["full-object"]}, "includeInBlockout": true};
  node_lubricator_top_15.add(mesh_lubricator_top_15);
  meshes["lubricator-top"] = mesh_lubricator_top_15;
  colliders["lubricator-top"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["lubricator-top"] ??= [];
  destructionGroups["lubricator-top"].push(node_lubricator_top_15);

  const endpoint_lubricator_rear_16 = makeAttachmentEndpoint(null);
  const node_lubricator_rear_16 = new THREE.Group();
  node_lubricator_rear_16.name = "lubricator-rear__pivot";
  node_lubricator_rear_16.scale.set(1, 1, 1);
  if (endpoint_lubricator_rear_16) {
    node_lubricator_rear_16.position.copy(endpoint_lubricator_rear_16.start);
    node_lubricator_rear_16.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_lubricator_rear_16.position.set(0.0, 290.0, 0.0);
    node_lubricator_rear_16.rotation.set(0.0, 0.0, 0.0);
  }
  node_lubricator_rear_16.userData.sculptComponent = {"id": "lubricator-rear", "name": "lubricator-rear", "level": "meso", "role": "mechanical-part", "importance": 1, "confidence": 0.8, "primitive": "lathe", "topologyClass": "assembled-solid", "topologyRationale": "Closed revolved rigid cylinder; centered profile retains parent-local pivot independent of attachment metadata.", "geometryDescriptor": {"topologyIntent": "closed independent cast or machined solid", "edgeTreatment": {"type": "chamfer", "bevelRadius": 3, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "latheProfile": {"points": [[0, -0.5], [0.5, -0.5], [0.5, 0.5], [0, 0.5]], "segments": 24}}, "parent": "rear-cylinder", "attachment": {"parentSocket": "mount-lubricator-rear", "localStart": [0, 0, 0], "localEnd": [0, 70, 0], "contactType": "overlap", "embedDepth": 3, "gapTolerance": 0.5}, "dimensions": {"width": 55, "height": 140, "depth": 55, "units": "mm", "confidence": 0.65}, "transform": {"position": [0, 290, 0], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "lubricator-rear", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "brass"}}, "material": "brass", "materialLayers": ["brass"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0, "microRoughness": 0, "bumpAmplitude": 0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(65, 49, 35, 1)", "secondaryAlbedo": "rgba(106, 77, 48, 1)", "materialClass": "metal", "materialClassConfidence": 0.85, "materialRef": "brass", "evidenceRefs": ["full-object"]}, "includeInBlockout": true};
  node_lubricator_rear_16.userData.actionProfile = {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "lubricator-rear", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "brass"}};
  (nodes["rear-cylinder"] ?? root).add(node_lubricator_rear_16);
  nodes["lubricator-rear"] = node_lubricator_rear_16;
  const mesh_lubricator_rear_16Geometry = endpoint_lubricator_rear_16
    ? new THREE.CylinderGeometry(endpoint_lubricator_rear_16.endRadius, endpoint_lubricator_rear_16.baseRadius, endpoint_lubricator_rear_16.length, 16, 6)
    : buildLatheGeometry({"points": [[0, -0.5], [0.5, -0.5], [0.5, 0.5], [0, 0.5]], "segments": 24});
  if (!endpoint_lubricator_rear_16) {
    mesh_lubricator_rear_16Geometry.scale(55.0, 140.0, 55.0);
  }
  const mesh_lubricator_rear_16 = new THREE.Mesh(
    mesh_lubricator_rear_16Geometry,
    materialMap["brass"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_lubricator_rear_16.name = "lubricator-rear";
  if (endpoint_lubricator_rear_16) {
    mesh_lubricator_rear_16.position.copy(endpoint_lubricator_rear_16.midpoint);
    mesh_lubricator_rear_16.quaternion.copy(endpoint_lubricator_rear_16.quaternion);
  }
  mesh_lubricator_rear_16.castShadow = options.castShadow ?? true;
  mesh_lubricator_rear_16.receiveShadow = options.receiveShadow ?? true;
  mesh_lubricator_rear_16.userData.sculptComponent = {"id": "lubricator-rear", "name": "lubricator-rear", "level": "meso", "role": "mechanical-part", "importance": 1, "confidence": 0.8, "primitive": "lathe", "topologyClass": "assembled-solid", "topologyRationale": "Closed revolved rigid cylinder; centered profile retains parent-local pivot independent of attachment metadata.", "geometryDescriptor": {"topologyIntent": "closed independent cast or machined solid", "edgeTreatment": {"type": "chamfer", "bevelRadius": 3, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "latheProfile": {"points": [[0, -0.5], [0.5, -0.5], [0.5, 0.5], [0, 0.5]], "segments": 24}}, "parent": "rear-cylinder", "attachment": {"parentSocket": "mount-lubricator-rear", "localStart": [0, 0, 0], "localEnd": [0, 70, 0], "contactType": "overlap", "embedDepth": 3, "gapTolerance": 0.5}, "dimensions": {"width": 55, "height": 140, "depth": 55, "units": "mm", "confidence": 0.65}, "transform": {"position": [0, 290, 0], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "lubricator-rear", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "brass"}}, "material": "brass", "materialLayers": ["brass"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0, "microRoughness": 0, "bumpAmplitude": 0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(65, 49, 35, 1)", "secondaryAlbedo": "rgba(106, 77, 48, 1)", "materialClass": "metal", "materialClassConfidence": 0.85, "materialRef": "brass", "evidenceRefs": ["full-object"]}, "includeInBlockout": true};
  node_lubricator_rear_16.add(mesh_lubricator_rear_16);
  meshes["lubricator-rear"] = mesh_lubricator_rear_16;
  colliders["lubricator-rear"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["lubricator-rear"] ??= [];
  destructionGroups["lubricator-rear"].push(node_lubricator_rear_16);

  const endpoint_rib_negative_x_17 = makeAttachmentEndpoint(null);
  const node_rib_negative_x_17 = new THREE.Group();
  node_rib_negative_x_17.name = "rib-negative-x__pivot";
  node_rib_negative_x_17.scale.set(1, 1, 1);
  if (endpoint_rib_negative_x_17) {
    node_rib_negative_x_17.position.copy(endpoint_rib_negative_x_17.start);
    node_rib_negative_x_17.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_rib_negative_x_17.position.set(-220.0, 365.0, 460.0);
    node_rib_negative_x_17.rotation.set(0.0, 0.0, 0.0);
  }
  node_rib_negative_x_17.userData.sculptComponent = {"id": "rib-negative-x", "name": "rib-negative-x", "level": "macro", "role": "mechanical-part", "importance": 1, "confidence": 0.8, "primitive": "extrude", "topologyClass": "assembled-solid", "topologyRationale": "Mirrored triangular buttress: tall edge intersects anvil wall, low edge extends outward; reflection reverses contour winding.", "geometryDescriptor": {"topologyIntent": "closed independent cast or machined solid", "edgeTreatment": {"type": "chamfer", "bevelRadius": 3, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "profile2D": {"points": [[0.5, 0.5], [0.4, 0.5], [-0.5, -0.5], [0.5, -0.5]], "depth": 1}}, "parent": "root", "attachment": {"parentSocket": "mount-rib-negative-x", "localStart": [0, 0, 0], "localEnd": [0, 205, 0], "contactType": "overlap", "embedDepth": 3, "gapTolerance": 0.5}, "dimensions": {"width": 160, "height": 410, "depth": 80, "units": "mm", "confidence": 0.65}, "transform": {"position": [-220, 365, 460], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "rib-negative-x", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "iron"}}, "material": "iron", "materialLayers": ["iron"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0, "microRoughness": 0, "bumpAmplitude": 0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(106, 100, 99, 1)", "secondaryAlbedo": "rgba(120, 113, 111, 1)", "materialClass": "metal", "materialClassConfidence": 0.85, "materialRef": "iron", "evidenceRefs": ["full-object"]}};
  node_rib_negative_x_17.userData.actionProfile = {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "rib-negative-x", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "iron"}};
  (nodes["root"] ?? root).add(node_rib_negative_x_17);
  nodes["rib-negative-x"] = node_rib_negative_x_17;
  const mesh_rib_negative_x_17Geometry = endpoint_rib_negative_x_17
    ? new THREE.CylinderGeometry(endpoint_rib_negative_x_17.endRadius, endpoint_rib_negative_x_17.baseRadius, endpoint_rib_negative_x_17.length, 16, 6)
    : buildExtrudeGeometry({"points": [[0.5, 0.5], [0.4, 0.5], [-0.5, -0.5], [0.5, -0.5]], "depth": 1});
  if (!endpoint_rib_negative_x_17) {
    mesh_rib_negative_x_17Geometry.scale(160.0, 410.0, 80.0);
  }
  const mesh_rib_negative_x_17 = new THREE.Mesh(
    mesh_rib_negative_x_17Geometry,
    materialMap["iron"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_rib_negative_x_17.name = "rib-negative-x";
  if (endpoint_rib_negative_x_17) {
    mesh_rib_negative_x_17.position.copy(endpoint_rib_negative_x_17.midpoint);
    mesh_rib_negative_x_17.quaternion.copy(endpoint_rib_negative_x_17.quaternion);
  }
  mesh_rib_negative_x_17.castShadow = options.castShadow ?? true;
  mesh_rib_negative_x_17.receiveShadow = options.receiveShadow ?? true;
  mesh_rib_negative_x_17.userData.sculptComponent = {"id": "rib-negative-x", "name": "rib-negative-x", "level": "macro", "role": "mechanical-part", "importance": 1, "confidence": 0.8, "primitive": "extrude", "topologyClass": "assembled-solid", "topologyRationale": "Mirrored triangular buttress: tall edge intersects anvil wall, low edge extends outward; reflection reverses contour winding.", "geometryDescriptor": {"topologyIntent": "closed independent cast or machined solid", "edgeTreatment": {"type": "chamfer", "bevelRadius": 3, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "profile2D": {"points": [[0.5, 0.5], [0.4, 0.5], [-0.5, -0.5], [0.5, -0.5]], "depth": 1}}, "parent": "root", "attachment": {"parentSocket": "mount-rib-negative-x", "localStart": [0, 0, 0], "localEnd": [0, 205, 0], "contactType": "overlap", "embedDepth": 3, "gapTolerance": 0.5}, "dimensions": {"width": 160, "height": 410, "depth": 80, "units": "mm", "confidence": 0.65}, "transform": {"position": [-220, 365, 460], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "rib-negative-x", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "iron"}}, "material": "iron", "materialLayers": ["iron"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0, "microRoughness": 0, "bumpAmplitude": 0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(106, 100, 99, 1)", "secondaryAlbedo": "rgba(120, 113, 111, 1)", "materialClass": "metal", "materialClassConfidence": 0.85, "materialRef": "iron", "evidenceRefs": ["full-object"]}};
  node_rib_negative_x_17.add(mesh_rib_negative_x_17);
  meshes["rib-negative-x"] = mesh_rib_negative_x_17;
  colliders["rib-negative-x"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["rib-negative-x"] ??= [];
  destructionGroups["rib-negative-x"].push(node_rib_negative_x_17);

  const endpoint_rib_positive_x_18 = makeAttachmentEndpoint(null);
  const node_rib_positive_x_18 = new THREE.Group();
  node_rib_positive_x_18.name = "rib-positive-x__pivot";
  node_rib_positive_x_18.scale.set(1, 1, 1);
  if (endpoint_rib_positive_x_18) {
    node_rib_positive_x_18.position.copy(endpoint_rib_positive_x_18.start);
    node_rib_positive_x_18.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_rib_positive_x_18.position.set(220.0, 365.0, 460.0);
    node_rib_positive_x_18.rotation.set(0.0, 0.0, 0.0);
  }
  node_rib_positive_x_18.userData.sculptComponent = {"id": "rib-positive-x", "name": "rib-positive-x", "level": "macro", "role": "mechanical-part", "importance": 1, "confidence": 0.8, "primitive": "extrude", "topologyClass": "assembled-solid", "topologyRationale": "Mirrored triangular buttress: tall edge intersects anvil wall, low edge extends outward; reflection reverses contour winding.", "geometryDescriptor": {"topologyIntent": "closed independent cast or machined solid", "edgeTreatment": {"type": "chamfer", "bevelRadius": 3, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "profile2D": {"points": [[-0.5, -0.5], [0.5, -0.5], [-0.4, 0.5], [-0.5, 0.5]], "depth": 1}}, "parent": "root", "attachment": {"parentSocket": "mount-rib-positive-x", "localStart": [0, 0, 0], "localEnd": [0, 205, 0], "contactType": "overlap", "embedDepth": 3, "gapTolerance": 0.5}, "dimensions": {"width": 160, "height": 410, "depth": 80, "units": "mm", "confidence": 0.65}, "transform": {"position": [220, 365, 460], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "rib-positive-x", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "iron"}}, "material": "iron", "materialLayers": ["iron"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "rib-edge", "type": "bevel", "description": "Support rib edge", "placement": "component boundary", "geometryEffect": "chamfer", "materialEffect": "assigned material", "sizeMm": 3, "confidence": 0.8, "evidenceRefs": ["full-object"]}], "surfaceDetail": {"macroRoughness": 0, "microRoughness": 0, "bumpAmplitude": 0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(106, 100, 99, 1)", "secondaryAlbedo": "rgba(120, 113, 111, 1)", "materialClass": "metal", "materialClassConfidence": 0.85, "materialRef": "iron", "evidenceRefs": ["full-object"]}};
  node_rib_positive_x_18.userData.actionProfile = {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "rib-positive-x", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "iron"}};
  (nodes["root"] ?? root).add(node_rib_positive_x_18);
  nodes["rib-positive-x"] = node_rib_positive_x_18;
  const mesh_rib_positive_x_18Geometry = endpoint_rib_positive_x_18
    ? new THREE.CylinderGeometry(endpoint_rib_positive_x_18.endRadius, endpoint_rib_positive_x_18.baseRadius, endpoint_rib_positive_x_18.length, 16, 6)
    : buildExtrudeGeometry({"points": [[-0.5, -0.5], [0.5, -0.5], [-0.4, 0.5], [-0.5, 0.5]], "depth": 1});
  if (!endpoint_rib_positive_x_18) {
    mesh_rib_positive_x_18Geometry.scale(160.0, 410.0, 80.0);
  }
  const mesh_rib_positive_x_18 = new THREE.Mesh(
    mesh_rib_positive_x_18Geometry,
    materialMap["iron"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_rib_positive_x_18.name = "rib-positive-x";
  if (endpoint_rib_positive_x_18) {
    mesh_rib_positive_x_18.position.copy(endpoint_rib_positive_x_18.midpoint);
    mesh_rib_positive_x_18.quaternion.copy(endpoint_rib_positive_x_18.quaternion);
  }
  mesh_rib_positive_x_18.castShadow = options.castShadow ?? true;
  mesh_rib_positive_x_18.receiveShadow = options.receiveShadow ?? true;
  mesh_rib_positive_x_18.userData.sculptComponent = {"id": "rib-positive-x", "name": "rib-positive-x", "level": "macro", "role": "mechanical-part", "importance": 1, "confidence": 0.8, "primitive": "extrude", "topologyClass": "assembled-solid", "topologyRationale": "Mirrored triangular buttress: tall edge intersects anvil wall, low edge extends outward; reflection reverses contour winding.", "geometryDescriptor": {"topologyIntent": "closed independent cast or machined solid", "edgeTreatment": {"type": "chamfer", "bevelRadius": 3, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry", "profile2D": {"points": [[-0.5, -0.5], [0.5, -0.5], [-0.4, 0.5], [-0.5, 0.5]], "depth": 1}}, "parent": "root", "attachment": {"parentSocket": "mount-rib-positive-x", "localStart": [0, 0, 0], "localEnd": [0, 205, 0], "contactType": "overlap", "embedDepth": 3, "gapTolerance": 0.5}, "dimensions": {"width": 160, "height": 410, "depth": 80, "units": "mm", "confidence": 0.65}, "transform": {"position": [220, 365, 460], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "rib-positive-x", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "iron"}}, "material": "iron", "materialLayers": ["iron"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "rib-edge", "type": "bevel", "description": "Support rib edge", "placement": "component boundary", "geometryEffect": "chamfer", "materialEffect": "assigned material", "sizeMm": 3, "confidence": 0.8, "evidenceRefs": ["full-object"]}], "surfaceDetail": {"macroRoughness": 0, "microRoughness": 0, "bumpAmplitude": 0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(106, 100, 99, 1)", "secondaryAlbedo": "rgba(120, 113, 111, 1)", "materialClass": "metal", "materialClassConfidence": 0.85, "materialRef": "iron", "evidenceRefs": ["full-object"]}};
  node_rib_positive_x_18.add(mesh_rib_positive_x_18);
  meshes["rib-positive-x"] = mesh_rib_positive_x_18;
  colliders["rib-positive-x"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["rib-positive-x"] ??= [];
  destructionGroups["rib-positive-x"].push(node_rib_positive_x_18);

  const endpoint_guide_lug_negative_x_19 = makeAttachmentEndpoint(null);
  const node_guide_lug_negative_x_19 = new THREE.Group();
  node_guide_lug_negative_x_19.name = "guide-lug-negative-x__pivot";
  node_guide_lug_negative_x_19.scale.set(1, 1, 1);
  if (endpoint_guide_lug_negative_x_19) {
    node_guide_lug_negative_x_19.position.copy(endpoint_guide_lug_negative_x_19.start);
    node_guide_lug_negative_x_19.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_guide_lug_negative_x_19.position.set(-250.0, -250.0, 0.0);
    node_guide_lug_negative_x_19.rotation.set(0.0, 0.0, 0.0);
  }
  node_guide_lug_negative_x_19.userData.sculptComponent = {"id": "guide-lug-negative-x", "name": "guide-lug-negative-x", "level": "meso", "role": "mechanical-part", "importance": 1, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Independent rigid cast or machined part.", "geometryDescriptor": {"topologyIntent": "closed independent cast or machined solid", "edgeTreatment": {"type": "chamfer", "bevelRadius": 3, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "front-cylinder", "attachment": {"parentSocket": "mount-guide-lug-negative-x", "localStart": [0, 0, 0], "localEnd": [0, 45, 0], "contactType": "overlap", "embedDepth": 3, "gapTolerance": 0.5}, "dimensions": {"width": 80, "height": 150, "depth": 150, "units": "mm", "confidence": 0.8}, "transform": {"position": [-250, -250, 0], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "guide-lug-negative-x", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "iron"}}, "material": "iron", "materialLayers": ["iron"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0, "microRoughness": 0, "bumpAmplitude": 0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(106, 100, 99, 1)", "secondaryAlbedo": "rgba(120, 113, 111, 1)", "materialClass": "metal", "materialClassConfidence": 0.85, "materialRef": "iron", "evidenceRefs": ["full-object"]}, "includeInBlockout": true};
  node_guide_lug_negative_x_19.userData.actionProfile = {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "guide-lug-negative-x", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "iron"}};
  (nodes["front-cylinder"] ?? root).add(node_guide_lug_negative_x_19);
  nodes["guide-lug-negative-x"] = node_guide_lug_negative_x_19;
  const mesh_guide_lug_negative_x_19Geometry = endpoint_guide_lug_negative_x_19
    ? new THREE.CylinderGeometry(endpoint_guide_lug_negative_x_19.endRadius, endpoint_guide_lug_negative_x_19.baseRadius, endpoint_guide_lug_negative_x_19.length, 16, 6)
    : new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
  if (!endpoint_guide_lug_negative_x_19) {
    mesh_guide_lug_negative_x_19Geometry.scale(80.0, 150.0, 150.0);
  }
  const mesh_guide_lug_negative_x_19 = new THREE.Mesh(
    mesh_guide_lug_negative_x_19Geometry,
    materialMap["iron"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_guide_lug_negative_x_19.name = "guide-lug-negative-x";
  if (endpoint_guide_lug_negative_x_19) {
    mesh_guide_lug_negative_x_19.position.copy(endpoint_guide_lug_negative_x_19.midpoint);
    mesh_guide_lug_negative_x_19.quaternion.copy(endpoint_guide_lug_negative_x_19.quaternion);
  }
  mesh_guide_lug_negative_x_19.castShadow = options.castShadow ?? true;
  mesh_guide_lug_negative_x_19.receiveShadow = options.receiveShadow ?? true;
  mesh_guide_lug_negative_x_19.userData.sculptComponent = {"id": "guide-lug-negative-x", "name": "guide-lug-negative-x", "level": "meso", "role": "mechanical-part", "importance": 1, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Independent rigid cast or machined part.", "geometryDescriptor": {"topologyIntent": "closed independent cast or machined solid", "edgeTreatment": {"type": "chamfer", "bevelRadius": 3, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "front-cylinder", "attachment": {"parentSocket": "mount-guide-lug-negative-x", "localStart": [0, 0, 0], "localEnd": [0, 45, 0], "contactType": "overlap", "embedDepth": 3, "gapTolerance": 0.5}, "dimensions": {"width": 80, "height": 150, "depth": 150, "units": "mm", "confidence": 0.8}, "transform": {"position": [-250, -250, 0], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "guide-lug-negative-x", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "iron"}}, "material": "iron", "materialLayers": ["iron"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0, "microRoughness": 0, "bumpAmplitude": 0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(106, 100, 99, 1)", "secondaryAlbedo": "rgba(120, 113, 111, 1)", "materialClass": "metal", "materialClassConfidence": 0.85, "materialRef": "iron", "evidenceRefs": ["full-object"]}, "includeInBlockout": true};
  node_guide_lug_negative_x_19.add(mesh_guide_lug_negative_x_19);
  meshes["guide-lug-negative-x"] = mesh_guide_lug_negative_x_19;
  colliders["guide-lug-negative-x"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["guide-lug-negative-x"] ??= [];
  destructionGroups["guide-lug-negative-x"].push(node_guide_lug_negative_x_19);

  const endpoint_guide_lug_positive_x_20 = makeAttachmentEndpoint(null);
  const node_guide_lug_positive_x_20 = new THREE.Group();
  node_guide_lug_positive_x_20.name = "guide-lug-positive-x__pivot";
  node_guide_lug_positive_x_20.scale.set(1, 1, 1);
  if (endpoint_guide_lug_positive_x_20) {
    node_guide_lug_positive_x_20.position.copy(endpoint_guide_lug_positive_x_20.start);
    node_guide_lug_positive_x_20.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_guide_lug_positive_x_20.position.set(250.0, -250.0, 0.0);
    node_guide_lug_positive_x_20.rotation.set(0.0, 0.0, 0.0);
  }
  node_guide_lug_positive_x_20.userData.sculptComponent = {"id": "guide-lug-positive-x", "name": "guide-lug-positive-x", "level": "meso", "role": "mechanical-part", "importance": 1, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Independent rigid cast or machined part.", "geometryDescriptor": {"topologyIntent": "closed independent cast or machined solid", "edgeTreatment": {"type": "chamfer", "bevelRadius": 3, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "front-cylinder", "attachment": {"parentSocket": "mount-guide-lug-positive-x", "localStart": [0, 0, 0], "localEnd": [0, 45, 0], "contactType": "overlap", "embedDepth": 3, "gapTolerance": 0.5}, "dimensions": {"width": 80, "height": 150, "depth": 150, "units": "mm", "confidence": 0.8}, "transform": {"position": [250, -250, 0], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "guide-lug-positive-x", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "iron"}}, "material": "iron", "materialLayers": ["iron"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0, "microRoughness": 0, "bumpAmplitude": 0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(106, 100, 99, 1)", "secondaryAlbedo": "rgba(120, 113, 111, 1)", "materialClass": "metal", "materialClassConfidence": 0.85, "materialRef": "iron", "evidenceRefs": ["full-object"]}, "includeInBlockout": true};
  node_guide_lug_positive_x_20.userData.actionProfile = {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "guide-lug-positive-x", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "iron"}};
  (nodes["front-cylinder"] ?? root).add(node_guide_lug_positive_x_20);
  nodes["guide-lug-positive-x"] = node_guide_lug_positive_x_20;
  const mesh_guide_lug_positive_x_20Geometry = endpoint_guide_lug_positive_x_20
    ? new THREE.CylinderGeometry(endpoint_guide_lug_positive_x_20.endRadius, endpoint_guide_lug_positive_x_20.baseRadius, endpoint_guide_lug_positive_x_20.length, 16, 6)
    : new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
  if (!endpoint_guide_lug_positive_x_20) {
    mesh_guide_lug_positive_x_20Geometry.scale(80.0, 150.0, 150.0);
  }
  const mesh_guide_lug_positive_x_20 = new THREE.Mesh(
    mesh_guide_lug_positive_x_20Geometry,
    materialMap["iron"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_guide_lug_positive_x_20.name = "guide-lug-positive-x";
  if (endpoint_guide_lug_positive_x_20) {
    mesh_guide_lug_positive_x_20.position.copy(endpoint_guide_lug_positive_x_20.midpoint);
    mesh_guide_lug_positive_x_20.quaternion.copy(endpoint_guide_lug_positive_x_20.quaternion);
  }
  mesh_guide_lug_positive_x_20.castShadow = options.castShadow ?? true;
  mesh_guide_lug_positive_x_20.receiveShadow = options.receiveShadow ?? true;
  mesh_guide_lug_positive_x_20.userData.sculptComponent = {"id": "guide-lug-positive-x", "name": "guide-lug-positive-x", "level": "meso", "role": "mechanical-part", "importance": 1, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Independent rigid cast or machined part.", "geometryDescriptor": {"topologyIntent": "closed independent cast or machined solid", "edgeTreatment": {"type": "chamfer", "bevelRadius": 3, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "front-cylinder", "attachment": {"parentSocket": "mount-guide-lug-positive-x", "localStart": [0, 0, 0], "localEnd": [0, 45, 0], "contactType": "overlap", "embedDepth": 3, "gapTolerance": 0.5}, "dimensions": {"width": 80, "height": 150, "depth": 150, "units": "mm", "confidence": 0.8}, "transform": {"position": [250, -250, 0], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "guide-lug-positive-x", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "iron"}}, "material": "iron", "materialLayers": ["iron"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0, "microRoughness": 0, "bumpAmplitude": 0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(106, 100, 99, 1)", "secondaryAlbedo": "rgba(120, 113, 111, 1)", "materialClass": "metal", "materialClassConfidence": 0.85, "materialRef": "iron", "evidenceRefs": ["full-object"]}, "includeInBlockout": true};
  node_guide_lug_positive_x_20.add(mesh_guide_lug_positive_x_20);
  meshes["guide-lug-positive-x"] = mesh_guide_lug_positive_x_20;
  colliders["guide-lug-positive-x"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["guide-lug-positive-x"] ??= [];
  destructionGroups["guide-lug-positive-x"].push(node_guide_lug_positive_x_20);

  const endpoint_base_foot_fl_21 = makeAttachmentEndpoint(null);
  const node_base_foot_fl_21 = new THREE.Group();
  node_base_foot_fl_21.name = "base-foot-fl__pivot";
  node_base_foot_fl_21.scale.set(1, 1, 1);
  if (endpoint_base_foot_fl_21) {
    node_base_foot_fl_21.position.copy(endpoint_base_foot_fl_21.start);
    node_base_foot_fl_21.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_base_foot_fl_21.position.set(-435.0, 20.0, 600.0);
    node_base_foot_fl_21.rotation.set(0.0, 0.0, 0.0);
  }
  node_base_foot_fl_21.userData.sculptComponent = {"id": "base-foot-fl", "name": "base-foot-fl", "level": "meso", "role": "mechanical-part", "importance": 1, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Independent rigid cast or machined part.", "geometryDescriptor": {"topologyIntent": "closed independent cast or machined solid", "edgeTreatment": {"type": "chamfer", "bevelRadius": 3, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentSocket": "mount-base-foot-fl", "localStart": [0, 0, 0], "localEnd": [0, 200, 0], "contactType": "overlap", "embedDepth": 3, "gapTolerance": 0.5}, "dimensions": {"width": 180, "height": 40, "depth": 200, "units": "mm", "confidence": 0.7}, "transform": {"position": [-435, 20, 600], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "base-foot-fl", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "iron"}}, "material": "iron", "materialLayers": ["iron"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0, "microRoughness": 0, "bumpAmplitude": 0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(106, 100, 99, 1)", "secondaryAlbedo": "rgba(120, 113, 111, 1)", "materialClass": "metal", "materialClassConfidence": 0.85, "materialRef": "iron", "evidenceRefs": ["full-object"]}, "includeInBlockout": true};
  node_base_foot_fl_21.userData.actionProfile = {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "base-foot-fl", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "iron"}};
  (nodes["root"] ?? root).add(node_base_foot_fl_21);
  nodes["base-foot-fl"] = node_base_foot_fl_21;
  const mesh_base_foot_fl_21Geometry = endpoint_base_foot_fl_21
    ? new THREE.CylinderGeometry(endpoint_base_foot_fl_21.endRadius, endpoint_base_foot_fl_21.baseRadius, endpoint_base_foot_fl_21.length, 16, 6)
    : new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
  if (!endpoint_base_foot_fl_21) {
    mesh_base_foot_fl_21Geometry.scale(180.0, 40.0, 200.0);
  }
  const mesh_base_foot_fl_21 = new THREE.Mesh(
    mesh_base_foot_fl_21Geometry,
    materialMap["iron"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_base_foot_fl_21.name = "base-foot-fl";
  if (endpoint_base_foot_fl_21) {
    mesh_base_foot_fl_21.position.copy(endpoint_base_foot_fl_21.midpoint);
    mesh_base_foot_fl_21.quaternion.copy(endpoint_base_foot_fl_21.quaternion);
  }
  mesh_base_foot_fl_21.castShadow = options.castShadow ?? true;
  mesh_base_foot_fl_21.receiveShadow = options.receiveShadow ?? true;
  mesh_base_foot_fl_21.userData.sculptComponent = {"id": "base-foot-fl", "name": "base-foot-fl", "level": "meso", "role": "mechanical-part", "importance": 1, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Independent rigid cast or machined part.", "geometryDescriptor": {"topologyIntent": "closed independent cast or machined solid", "edgeTreatment": {"type": "chamfer", "bevelRadius": 3, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentSocket": "mount-base-foot-fl", "localStart": [0, 0, 0], "localEnd": [0, 200, 0], "contactType": "overlap", "embedDepth": 3, "gapTolerance": 0.5}, "dimensions": {"width": 180, "height": 40, "depth": 200, "units": "mm", "confidence": 0.7}, "transform": {"position": [-435, 20, 600], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "base-foot-fl", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "iron"}}, "material": "iron", "materialLayers": ["iron"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0, "microRoughness": 0, "bumpAmplitude": 0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(106, 100, 99, 1)", "secondaryAlbedo": "rgba(120, 113, 111, 1)", "materialClass": "metal", "materialClassConfidence": 0.85, "materialRef": "iron", "evidenceRefs": ["full-object"]}, "includeInBlockout": true};
  node_base_foot_fl_21.add(mesh_base_foot_fl_21);
  meshes["base-foot-fl"] = mesh_base_foot_fl_21;
  colliders["base-foot-fl"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["base-foot-fl"] ??= [];
  destructionGroups["base-foot-fl"].push(node_base_foot_fl_21);

  const endpoint_base_foot_fr_22 = makeAttachmentEndpoint(null);
  const node_base_foot_fr_22 = new THREE.Group();
  node_base_foot_fr_22.name = "base-foot-fr__pivot";
  node_base_foot_fr_22.scale.set(1, 1, 1);
  if (endpoint_base_foot_fr_22) {
    node_base_foot_fr_22.position.copy(endpoint_base_foot_fr_22.start);
    node_base_foot_fr_22.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_base_foot_fr_22.position.set(435.0, 20.0, 600.0);
    node_base_foot_fr_22.rotation.set(0.0, 0.0, 0.0);
  }
  node_base_foot_fr_22.userData.sculptComponent = {"id": "base-foot-fr", "name": "base-foot-fr", "level": "meso", "role": "mechanical-part", "importance": 1, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Independent rigid cast or machined part.", "geometryDescriptor": {"topologyIntent": "closed independent cast or machined solid", "edgeTreatment": {"type": "chamfer", "bevelRadius": 3, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentSocket": "mount-base-foot-fr", "localStart": [0, 0, 0], "localEnd": [0, 200, 0], "contactType": "overlap", "embedDepth": 3, "gapTolerance": 0.5}, "dimensions": {"width": 180, "height": 40, "depth": 200, "units": "mm", "confidence": 0.7}, "transform": {"position": [435, 20, 600], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "base-foot-fr", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "iron"}}, "material": "iron", "materialLayers": ["iron"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0, "microRoughness": 0, "bumpAmplitude": 0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(106, 100, 99, 1)", "secondaryAlbedo": "rgba(120, 113, 111, 1)", "materialClass": "metal", "materialClassConfidence": 0.85, "materialRef": "iron", "evidenceRefs": ["full-object"]}, "includeInBlockout": true};
  node_base_foot_fr_22.userData.actionProfile = {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "base-foot-fr", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "iron"}};
  (nodes["root"] ?? root).add(node_base_foot_fr_22);
  nodes["base-foot-fr"] = node_base_foot_fr_22;
  const mesh_base_foot_fr_22Geometry = endpoint_base_foot_fr_22
    ? new THREE.CylinderGeometry(endpoint_base_foot_fr_22.endRadius, endpoint_base_foot_fr_22.baseRadius, endpoint_base_foot_fr_22.length, 16, 6)
    : new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
  if (!endpoint_base_foot_fr_22) {
    mesh_base_foot_fr_22Geometry.scale(180.0, 40.0, 200.0);
  }
  const mesh_base_foot_fr_22 = new THREE.Mesh(
    mesh_base_foot_fr_22Geometry,
    materialMap["iron"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_base_foot_fr_22.name = "base-foot-fr";
  if (endpoint_base_foot_fr_22) {
    mesh_base_foot_fr_22.position.copy(endpoint_base_foot_fr_22.midpoint);
    mesh_base_foot_fr_22.quaternion.copy(endpoint_base_foot_fr_22.quaternion);
  }
  mesh_base_foot_fr_22.castShadow = options.castShadow ?? true;
  mesh_base_foot_fr_22.receiveShadow = options.receiveShadow ?? true;
  mesh_base_foot_fr_22.userData.sculptComponent = {"id": "base-foot-fr", "name": "base-foot-fr", "level": "meso", "role": "mechanical-part", "importance": 1, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Independent rigid cast or machined part.", "geometryDescriptor": {"topologyIntent": "closed independent cast or machined solid", "edgeTreatment": {"type": "chamfer", "bevelRadius": 3, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentSocket": "mount-base-foot-fr", "localStart": [0, 0, 0], "localEnd": [0, 200, 0], "contactType": "overlap", "embedDepth": 3, "gapTolerance": 0.5}, "dimensions": {"width": 180, "height": 40, "depth": 200, "units": "mm", "confidence": 0.7}, "transform": {"position": [435, 20, 600], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "base-foot-fr", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "iron"}}, "material": "iron", "materialLayers": ["iron"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0, "microRoughness": 0, "bumpAmplitude": 0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(106, 100, 99, 1)", "secondaryAlbedo": "rgba(120, 113, 111, 1)", "materialClass": "metal", "materialClassConfidence": 0.85, "materialRef": "iron", "evidenceRefs": ["full-object"]}, "includeInBlockout": true};
  node_base_foot_fr_22.add(mesh_base_foot_fr_22);
  meshes["base-foot-fr"] = mesh_base_foot_fr_22;
  colliders["base-foot-fr"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["base-foot-fr"] ??= [];
  destructionGroups["base-foot-fr"].push(node_base_foot_fr_22);

  const endpoint_base_foot_rl_23 = makeAttachmentEndpoint(null);
  const node_base_foot_rl_23 = new THREE.Group();
  node_base_foot_rl_23.name = "base-foot-rl__pivot";
  node_base_foot_rl_23.scale.set(1, 1, 1);
  if (endpoint_base_foot_rl_23) {
    node_base_foot_rl_23.position.copy(endpoint_base_foot_rl_23.start);
    node_base_foot_rl_23.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_base_foot_rl_23.position.set(-435.0, 20.0, -600.0);
    node_base_foot_rl_23.rotation.set(0.0, 0.0, 0.0);
  }
  node_base_foot_rl_23.userData.sculptComponent = {"id": "base-foot-rl", "name": "base-foot-rl", "level": "meso", "role": "mechanical-part", "importance": 1, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Independent rigid cast or machined part.", "geometryDescriptor": {"topologyIntent": "closed independent cast or machined solid", "edgeTreatment": {"type": "chamfer", "bevelRadius": 3, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentSocket": "mount-base-foot-rl", "localStart": [0, 0, 0], "localEnd": [0, 200, 0], "contactType": "overlap", "embedDepth": 3, "gapTolerance": 0.5}, "dimensions": {"width": 180, "height": 40, "depth": 200, "units": "mm", "confidence": 0.7}, "transform": {"position": [-435, 20, -600], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "base-foot-rl", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "iron"}}, "material": "iron", "materialLayers": ["iron"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0, "microRoughness": 0, "bumpAmplitude": 0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(106, 100, 99, 1)", "secondaryAlbedo": "rgba(120, 113, 111, 1)", "materialClass": "metal", "materialClassConfidence": 0.85, "materialRef": "iron", "evidenceRefs": ["full-object"]}, "includeInBlockout": true};
  node_base_foot_rl_23.userData.actionProfile = {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "base-foot-rl", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "iron"}};
  (nodes["root"] ?? root).add(node_base_foot_rl_23);
  nodes["base-foot-rl"] = node_base_foot_rl_23;
  const mesh_base_foot_rl_23Geometry = endpoint_base_foot_rl_23
    ? new THREE.CylinderGeometry(endpoint_base_foot_rl_23.endRadius, endpoint_base_foot_rl_23.baseRadius, endpoint_base_foot_rl_23.length, 16, 6)
    : new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
  if (!endpoint_base_foot_rl_23) {
    mesh_base_foot_rl_23Geometry.scale(180.0, 40.0, 200.0);
  }
  const mesh_base_foot_rl_23 = new THREE.Mesh(
    mesh_base_foot_rl_23Geometry,
    materialMap["iron"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_base_foot_rl_23.name = "base-foot-rl";
  if (endpoint_base_foot_rl_23) {
    mesh_base_foot_rl_23.position.copy(endpoint_base_foot_rl_23.midpoint);
    mesh_base_foot_rl_23.quaternion.copy(endpoint_base_foot_rl_23.quaternion);
  }
  mesh_base_foot_rl_23.castShadow = options.castShadow ?? true;
  mesh_base_foot_rl_23.receiveShadow = options.receiveShadow ?? true;
  mesh_base_foot_rl_23.userData.sculptComponent = {"id": "base-foot-rl", "name": "base-foot-rl", "level": "meso", "role": "mechanical-part", "importance": 1, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Independent rigid cast or machined part.", "geometryDescriptor": {"topologyIntent": "closed independent cast or machined solid", "edgeTreatment": {"type": "chamfer", "bevelRadius": 3, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentSocket": "mount-base-foot-rl", "localStart": [0, 0, 0], "localEnd": [0, 200, 0], "contactType": "overlap", "embedDepth": 3, "gapTolerance": 0.5}, "dimensions": {"width": 180, "height": 40, "depth": 200, "units": "mm", "confidence": 0.7}, "transform": {"position": [-435, 20, -600], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "base-foot-rl", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "iron"}}, "material": "iron", "materialLayers": ["iron"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0, "microRoughness": 0, "bumpAmplitude": 0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(106, 100, 99, 1)", "secondaryAlbedo": "rgba(120, 113, 111, 1)", "materialClass": "metal", "materialClassConfidence": 0.85, "materialRef": "iron", "evidenceRefs": ["full-object"]}, "includeInBlockout": true};
  node_base_foot_rl_23.add(mesh_base_foot_rl_23);
  meshes["base-foot-rl"] = mesh_base_foot_rl_23;
  colliders["base-foot-rl"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["base-foot-rl"] ??= [];
  destructionGroups["base-foot-rl"].push(node_base_foot_rl_23);

  const endpoint_base_foot_rr_24 = makeAttachmentEndpoint(null);
  const node_base_foot_rr_24 = new THREE.Group();
  node_base_foot_rr_24.name = "base-foot-rr__pivot";
  node_base_foot_rr_24.scale.set(1, 1, 1);
  if (endpoint_base_foot_rr_24) {
    node_base_foot_rr_24.position.copy(endpoint_base_foot_rr_24.start);
    node_base_foot_rr_24.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_base_foot_rr_24.position.set(435.0, 20.0, -600.0);
    node_base_foot_rr_24.rotation.set(0.0, 0.0, 0.0);
  }
  node_base_foot_rr_24.userData.sculptComponent = {"id": "base-foot-rr", "name": "base-foot-rr", "level": "meso", "role": "mechanical-part", "importance": 1, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Independent rigid cast or machined part.", "geometryDescriptor": {"topologyIntent": "closed independent cast or machined solid", "edgeTreatment": {"type": "chamfer", "bevelRadius": 3, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentSocket": "mount-base-foot-rr", "localStart": [0, 0, 0], "localEnd": [0, 200, 0], "contactType": "overlap", "embedDepth": 3, "gapTolerance": 0.5}, "dimensions": {"width": 180, "height": 40, "depth": 200, "units": "mm", "confidence": 0.7}, "transform": {"position": [435, 20, -600], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "base-foot-rr", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "iron"}}, "material": "iron", "materialLayers": ["iron"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0, "microRoughness": 0, "bumpAmplitude": 0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(106, 100, 99, 1)", "secondaryAlbedo": "rgba(120, 113, 111, 1)", "materialClass": "metal", "materialClassConfidence": 0.85, "materialRef": "iron", "evidenceRefs": ["full-object"]}, "includeInBlockout": true};
  node_base_foot_rr_24.userData.actionProfile = {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "base-foot-rr", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "iron"}};
  (nodes["root"] ?? root).add(node_base_foot_rr_24);
  nodes["base-foot-rr"] = node_base_foot_rr_24;
  const mesh_base_foot_rr_24Geometry = endpoint_base_foot_rr_24
    ? new THREE.CylinderGeometry(endpoint_base_foot_rr_24.endRadius, endpoint_base_foot_rr_24.baseRadius, endpoint_base_foot_rr_24.length, 16, 6)
    : new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
  if (!endpoint_base_foot_rr_24) {
    mesh_base_foot_rr_24Geometry.scale(180.0, 40.0, 200.0);
  }
  const mesh_base_foot_rr_24 = new THREE.Mesh(
    mesh_base_foot_rr_24Geometry,
    materialMap["iron"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_base_foot_rr_24.name = "base-foot-rr";
  if (endpoint_base_foot_rr_24) {
    mesh_base_foot_rr_24.position.copy(endpoint_base_foot_rr_24.midpoint);
    mesh_base_foot_rr_24.quaternion.copy(endpoint_base_foot_rr_24.quaternion);
  }
  mesh_base_foot_rr_24.castShadow = options.castShadow ?? true;
  mesh_base_foot_rr_24.receiveShadow = options.receiveShadow ?? true;
  mesh_base_foot_rr_24.userData.sculptComponent = {"id": "base-foot-rr", "name": "base-foot-rr", "level": "meso", "role": "mechanical-part", "importance": 1, "confidence": 0.8, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Independent rigid cast or machined part.", "geometryDescriptor": {"topologyIntent": "closed independent cast or machined solid", "edgeTreatment": {"type": "chamfer", "bevelRadius": 3, "segments": 2}, "deformationStack": [], "uvStrategy": "generated procedural coordinates", "normalStrategy": "vertex normals from generated geometry"}, "parent": "root", "attachment": {"parentSocket": "mount-base-foot-rr", "localStart": [0, 0, 0], "localEnd": [0, 200, 0], "contactType": "overlap", "embedDepth": 3, "gapTolerance": 0.5}, "dimensions": {"width": 180, "height": 40, "depth": 200, "units": "mm", "confidence": 0.7}, "transform": {"position": [435, 20, -600], "rotation": [0, 0, 0]}, "actionProfile": {"animationRole": "static-part", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "base-foot-rr", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "iron"}}, "material": "iron", "materialLayers": ["iron"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0, "microRoughness": 0, "bumpAmplitude": 0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(106, 100, 99, 1)", "secondaryAlbedo": "rgba(120, 113, 111, 1)", "materialClass": "metal", "materialClassConfidence": 0.85, "materialRef": "iron", "evidenceRefs": ["full-object"]}, "includeInBlockout": true};
  node_base_foot_rr_24.add(mesh_base_foot_rr_24);
  meshes["base-foot-rr"] = mesh_base_foot_rr_24;
  colliders["base-foot-rr"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["base-foot-rr"] ??= [];
  destructionGroups["base-foot-rr"].push(node_base_foot_rr_24);

  root.userData.sculptRuntime = { nodes, meshes, sockets, colliders, destructionGroups } satisfies ProceduralModelRuntime;
  root.userData.lookDevTargets = {"qualityPriority": "reference-fidelity", "materialPass": {"albedoPaletteRequired": true, "roughnessVariationRequired": true, "normalOrBumpRequired": true, "localOverridesRequired": true, "minimumTextureResolution": 1024, "preferredTextureResolution": 2048, "independentMapChannels": ["albedo", "roughness", "height", "normal", "ambient-occlusion"], "requiredSurfaceFrequencyBands": ["macro", "meso", "micro"], "geometryReliefRequiredWhenSilhouetteAffected": true, "referencePbrExtraction": {"requiredWhenSourceImagePresent": true, "targetThreshold": 0.7, "stopOnLowConfidence": true, "script": "forge/stage1_intake/extract_pbr_evidence.py", "acceptedLimitation": "single-image extraction is reference-derived inference, not exact photogrammetry"}, "mustAvoid": ["single flat albedo per material", "uniform roughness", "albedo texture reused as roughness/height/normal/AO", "single-frequency random noise", "plastic-looking smooth bark, stone, cloth, foliage, or aged material", "local color/detail described only in prose without material masks", "claiming exact PBR recovery when confidence is below the target threshold"]}, "lightingPass": {"requiredTerms": ["key light", "fill light", "rim or environment light", "exposure", "tone mapping", "background", "contact shadow"], "mustAvoid": ["ambient-only lighting", "flat value range", "missing contact shadow", "reference lighting copied without separating material readability"]}, "screenshotReview": ["Compare albedo palette and local color zones.", "Compare roughness/normal/bump response under light.", "Compare cavity dirt, edge wear, stains, moss, scratches, or other local masks.", "Compare key/fill/rim structure, exposure, tone mapping, background, and contact shadows.", "Capture a neutral-light render to verify material readability without reference lighting.", "Capture a grazing-light close-up to expose flat normals, uniform roughness, tiling, and plastic highlights.", "Capture a reference-matched render from the same camera framing as the source."]};
  root.userData.actionReadiness = {
    note: 'Use root.userData.sculptRuntime.nodes for transforms, sockets for attachments, colliders for physics proxies, and destructionGroups for breakable sets.',
  };
  return root;
}

export function createEarlyIndustrialPneumaticPowerHammerLookDevLights(
  mode: 'neutral' | 'grazing' | 'reference' = 'neutral',
): THREE.Group {
  const lights = new THREE.Group();
  lights.name = "Early Industrial Pneumatic Power Hammer look-dev lights";
  const hemi = new THREE.HemisphereLight(
    mode === 'reference' ? 0xfff0d6 : 0xf2f4ff,
    0x363b42,
    mode === 'grazing' ? 0.28 : mode === 'reference' ? 0.72 : 0.85,
  );
  lights.add(hemi);
  const key = new THREE.DirectionalLight(
    mode === 'reference' ? 0xffcf8a : 0xfff4e8,
    mode === 'grazing' ? 4.2 : mode === 'reference' ? 2.6 : 2.15,
  );
  if (mode === 'grazing') key.position.set(7.5, 1.1, 4.0);
  else if (mode === 'reference') key.position.set(-4.5, 7.5, 5.0);
  else key.position.set(-4.0, 6.0, 5.5);
  key.castShadow = true;
  key.shadow.mapSize.set(4096, 4096);
  key.shadow.bias = -0.00025;
  key.shadow.normalBias = 0.018;
  key.shadow.radius = 7;
  key.shadow.blurSamples = 24;
  key.shadow.camera.near = 0.5;
  key.shadow.camera.far = 30;
  key.shadow.camera.left = -2.6;
  key.shadow.camera.right = 2.6;
  key.shadow.camera.top = 2.6;
  key.shadow.camera.bottom = -2.6;
  key.shadow.camera.updateProjectionMatrix();
  lights.add(key);
  const fill = new THREE.DirectionalLight(0xa8c4ff, mode === 'grazing' ? 0.12 : 0.42);
  fill.position.set(4.0, 3.0, 3.5);
  lights.add(fill);
  const rim = new THREE.DirectionalLight(0xfff1c4, mode === 'grazing' ? 0.28 : 0.85);
  rim.position.set(0.5, 4.5, -6.0);
  lights.add(rim);
  lights.userData.reviewMode = mode;
  lights.userData.lightingFromPhoto = [{"role": "key", "type": "directional", "positionMm": [-2600, 3800, 3000], "color": "#ffffff", "intensity": 3, "castShadow": true}, {"role": "fill", "type": "directional", "positionMm": [2400, 1800, 1600], "color": "#e5edf2", "intensity": 1}, {"role": "environment", "type": "hemisphere", "sky": "#d9e1eb", "ground": "#73777a", "intensity": 0.7}, {"role": "render", "exposure": 1, "toneMapping": "ACESFilmic", "background": "#d5d6d8", "shadow": "soft contact shadow on ground at Y=0"}];
  lights.userData.lookDevTargets = {"qualityPriority": "reference-fidelity", "materialPass": {"albedoPaletteRequired": true, "roughnessVariationRequired": true, "normalOrBumpRequired": true, "localOverridesRequired": true, "minimumTextureResolution": 1024, "preferredTextureResolution": 2048, "independentMapChannels": ["albedo", "roughness", "height", "normal", "ambient-occlusion"], "requiredSurfaceFrequencyBands": ["macro", "meso", "micro"], "geometryReliefRequiredWhenSilhouetteAffected": true, "referencePbrExtraction": {"requiredWhenSourceImagePresent": true, "targetThreshold": 0.7, "stopOnLowConfidence": true, "script": "forge/stage1_intake/extract_pbr_evidence.py", "acceptedLimitation": "single-image extraction is reference-derived inference, not exact photogrammetry"}, "mustAvoid": ["single flat albedo per material", "uniform roughness", "albedo texture reused as roughness/height/normal/AO", "single-frequency random noise", "plastic-looking smooth bark, stone, cloth, foliage, or aged material", "local color/detail described only in prose without material masks", "claiming exact PBR recovery when confidence is below the target threshold"]}, "lightingPass": {"requiredTerms": ["key light", "fill light", "rim or environment light", "exposure", "tone mapping", "background", "contact shadow"], "mustAvoid": ["ambient-only lighting", "flat value range", "missing contact shadow", "reference lighting copied without separating material readability"]}, "screenshotReview": ["Compare albedo palette and local color zones.", "Compare roughness/normal/bump response under light.", "Compare cavity dirt, edge wear, stains, moss, scratches, or other local masks.", "Compare key/fill/rim structure, exposure, tone mapping, background, and contact shadows.", "Capture a neutral-light render to verify material readability without reference lighting.", "Capture a grazing-light close-up to expose flat normals, uniform roughness, tiling, and plastic highlights.", "Capture a reference-matched render from the same camera framing as the source."]};
  return lights;
}

// PBR materials (clearcoat/iridescence/transmission/anisotropy) need an environment
// map to visually behave as intended — call this once per renderer and assign the
// result to scene.environment before rendering. No external HDR asset required.
export function createEarlyIndustrialPneumaticPowerHammerEnvironment(renderer: THREE.WebGLRenderer): THREE.Texture {
  const pmrem = new THREE.PMREMGenerator(renderer);
  const texture = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  pmrem.dispose();
  return texture;
}

// Plan 1.3 §3.2 — auto-framing by bounding box. The Divine Eye can only compare a
// render to the reference if the object is FRAMED consistently (an object framed
// differently scores as wrong even when its shape is right). This positions the camera
// deterministically from the object's bounding box so it fills the frame at a stable
// margin, and sets near/far to the object scale. Call after adding the model to the
// scene, and again on resize (after updating camera.aspect).
export function frameEarlyIndustrialPneumaticPowerHammerCamera(
  camera: THREE.PerspectiveCamera,
  object: THREE.Object3D,
  options: { margin?: number; azimuthDeg?: number; elevationDeg?: number } = {},
): void {
  const box = new THREE.Box3().setFromObject(object);
  if (box.isEmpty()) return;
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const margin = options.margin ?? 1.15;
  const maxDim = Math.max(size.x, size.y, size.z) * margin;
  const fov = (camera.fov * Math.PI) / 180;
  // distance so the largest object dimension fits vertically in the frame
  const distance = (maxDim / 2) / Math.tan(fov / 2);
  const az = ((options.azimuthDeg ?? 0) * Math.PI) / 180;
  const el = ((options.elevationDeg ?? 0) * Math.PI) / 180;
  const dir = new THREE.Vector3(
    Math.sin(az) * Math.cos(el),
    Math.sin(el),
    Math.cos(az) * Math.cos(el),
  );
  camera.position.copy(center).addScaledVector(dir, distance);
  camera.near = Math.max(0.01, distance - maxDim);
  camera.far = distance + maxDim * 2;
  camera.lookAt(center);
  camera.updateProjectionMatrix();
}

// Plan 1.3 §3.2c — PRESENTATION composer (DOF + bloom). CRITICAL (R-POSTFX): this is
// for the showcase/hero render ONLY. The Divine Eye's EVALUATION render MUST use a
// plain renderer with NO composer — bloom blows highlights and DOF blurs edges, which
// would corrupt the deterministic IoU/DCD/edge/blowout signals. Enable dof/bloom ONLY
// when the reference photo actually exhibits them (detect_reference_effects.py authorizes).
export function createEarlyIndustrialPneumaticPowerHammerPresentationComposer(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
  options: { dof?: boolean; bloom?: boolean; bloomStrength?: number; dofFocus?: number; dofAperture?: number } = {},
): EffectComposer {
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  if (options.dof) {
    composer.addPass(new BokehPass(scene, camera, {
      focus: options.dofFocus ?? 10.0,
      aperture: options.dofAperture ?? 0.0002,
      maxblur: 0.01,
    }));
  }
  if (options.bloom) {
    const size = new THREE.Vector2();
    renderer.getSize(size);
    composer.addPass(new UnrealBloomPass(size, options.bloomStrength ?? 0.4, 0.4, 0.85));
  }
  return composer;
}

export function configureEarlyIndustrialPneumaticPowerHammerRenderer(renderer: THREE.WebGLRenderer): void {
  // Load-bearing for view-dependent finishes (anodized / Doppler): without ACES + sRGB
  // the environment reflection reads flat/washed instead of a believable metal response.
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
}

export function createEarlyIndustrialPneumaticPowerHammerInspectControls(
  camera: THREE.Camera,
  domElement: HTMLElement,
): OrbitControls {
  // View-dependent finishes only read correctly once the user orbits — their color
  // comes from the environment reflection, not albedo, so free rotation matters here.
  const controls = new OrbitControls(camera, domElement);
  controls.enableDamping = true;
  controls.minDistance = 1.0;
  controls.maxDistance = 8.0;
  controls.autoRotate = false;
  return controls;
}
