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

// Generated from ObjectSculptSpec target: Early Industrial Hydraulic Forge Press
// Sculpt build pass: blockout
// This factory is intentionally pass-gated. Finish browser screenshot review before unlocking deeper passes.
export function createEarlyIndustrialHydraulicForgePressModel(options: ProceduralModelOptions = {}): THREE.Group {
  const root = new THREE.Group();
  root.name = "Early Industrial Hydraulic Forge Press";
  root.userData.reconstructionEvidence = {"itemFamily": null, "subtype": null, "componentAdapter": null, "route": null, "exactnessTier": null, "referenceCamera": {"solved": false, "orientation": {"yaw": 24, "pitch": 8, "roll": 0}, "positionHint": [0.42, 0.14, 1], "note": "Approximate main concept view; orthographic studio camera. No exact camera solve claimed."}, "approximationNotes": []};
  root.userData.materialPipeline = {};
  root.userData.materialReferenceRegistry = null;

  const materialMap: Record<string, THREE.Material> = {};
  materialMap["iron"] = createSculptMaterial(
    "iron",
    {"id": "iron", "name": "iron", "type": "standard", "shaderModel": "MeshStandardMaterial / PBR approximation", "baseColor": "#555f60", "color": "#555f60", "albedo": {"dominant": "#555f60", "secondary": ["#555f60"], "samplingNotes": "User-authorized shared palette from power-hammer-model.ts / workshop-model-kit.ts, not inverse-rendered albedo."}, "colorVariation": {"palette": ["#555f60"], "pattern": "none", "amplitude": 0}, "textureResolution": 1024, "textureProjection": {"mode": "uv", "repeat": [2, 2], "anisotropy": 8, "texelDensityIntent": "Preserve stable world/object-scale detail; do not stretch micro detail with component scale."}, "surfaceFrequencyBands": [], "roughness": {"base": 0.72}, "metalness": {"base": 0.72, "variation": 0}, "normal": {"pattern": "none", "strength": 0, "scale": 1, "space": "tangent"}, "bump": {"pattern": "none", "amplitude": 0, "scale": 1}, "displacement": {"pattern": "none", "amplitude": 0, "scale": 1, "silhouetteAffects": false}, "ambientOcclusion": {"cavityStrength": 0.25, "contactShadowBias": 0.35, "notes": "Darken creases, seams, intersections, and recessed local features."}, "wear": {"edgeWear": 0, "scratches": [], "chips": []}, "dirt": {"amount": 0, "cavityBias": 0, "color": "#2F2A22"}, "localOverrides": [{"id": "service-panel-tone", "componentRefs": ["service-panel"], "color": "#444d4e", "roughness": 0.72, "evidenceRefs": ["full-object"], "notes": "Dark cover like power-hammer-model.ts."}], "shaderNotes": ["Prefer MeshPhysicalMaterial when clearcoat, sheen, transmission, or thin-surface response is observed; otherwise use MeshStandardMaterial-compatible PBR channels.", "Generate albedo, roughness, height/normal, and AO independently; never alias albedo into roughness.", "Use normal/bump/displacement only when they map to observed surface relief.", "Use displacement geometry when the observed relief changes the close-up silhouette; texture-only relief is insufficient there."], "notes": "Reduced-detail scope: no extracted textures, rust, scratches or normal maps."},
    options
  );
  materialMap["steel"] = createSculptMaterial(
    "steel",
    {"id": "steel", "name": "steel", "type": "standard", "shaderModel": "MeshStandardMaterial / PBR approximation", "baseColor": "#a3a9a6", "color": "#a3a9a6", "albedo": {"dominant": "#a3a9a6", "secondary": ["#a3a9a6"], "samplingNotes": "User-authorized shared palette from power-hammer-model.ts / workshop-model-kit.ts, not inverse-rendered albedo."}, "colorVariation": {"palette": ["#a3a9a6"], "pattern": "none", "amplitude": 0}, "textureResolution": 1024, "textureProjection": {"mode": "uv", "repeat": [2, 2], "anisotropy": 8, "texelDensityIntent": "Preserve stable world/object-scale detail; do not stretch micro detail with component scale."}, "surfaceFrequencyBands": [], "roughness": {"base": 0.32}, "metalness": {"base": 0.85, "variation": 0}, "normal": {"pattern": "none", "strength": 0, "scale": 1, "space": "tangent"}, "bump": {"pattern": "none", "amplitude": 0, "scale": 1}, "displacement": {"pattern": "none", "amplitude": 0, "scale": 1, "silhouetteAffects": false}, "ambientOcclusion": {"cavityStrength": 0.25, "contactShadowBias": 0.35, "notes": "Darken creases, seams, intersections, and recessed local features."}, "wear": {"edgeWear": 0, "scratches": [], "chips": []}, "dirt": {"amount": 0, "cavityBias": 0, "color": "#2F2A22"}, "localOverrides": [], "shaderNotes": ["Prefer MeshPhysicalMaterial when clearcoat, sheen, transmission, or thin-surface response is observed; otherwise use MeshStandardMaterial-compatible PBR channels.", "Generate albedo, roughness, height/normal, and AO independently; never alias albedo into roughness.", "Use normal/bump/displacement only when they map to observed surface relief.", "Use displacement geometry when the observed relief changes the close-up silhouette; texture-only relief is insufficient there."], "notes": "Reduced-detail scope: no extracted textures, rust, scratches or normal maps."},
    options
  );
  materialMap["brass"] = createSculptMaterial(
    "brass",
    {"id": "brass", "name": "brass", "type": "standard", "shaderModel": "MeshStandardMaterial / PBR approximation", "baseColor": "#b59755", "color": "#b59755", "albedo": {"dominant": "#b59755", "secondary": ["#b59755"], "samplingNotes": "User-authorized shared palette from power-hammer-model.ts / workshop-model-kit.ts, not inverse-rendered albedo."}, "colorVariation": {"palette": ["#b59755"], "pattern": "none", "amplitude": 0}, "textureResolution": 1024, "textureProjection": {"mode": "uv", "repeat": [2, 2], "anisotropy": 8, "texelDensityIntent": "Preserve stable world/object-scale detail; do not stretch micro detail with component scale."}, "surfaceFrequencyBands": [], "roughness": {"base": 0.44}, "metalness": {"base": 0.72, "variation": 0}, "normal": {"pattern": "none", "strength": 0, "scale": 1, "space": "tangent"}, "bump": {"pattern": "none", "amplitude": 0, "scale": 1}, "displacement": {"pattern": "none", "amplitude": 0, "scale": 1, "silhouetteAffects": false}, "ambientOcclusion": {"cavityStrength": 0.25, "contactShadowBias": 0.35, "notes": "Darken creases, seams, intersections, and recessed local features."}, "wear": {"edgeWear": 0, "scratches": [], "chips": []}, "dirt": {"amount": 0, "cavityBias": 0, "color": "#2F2A22"}, "localOverrides": [], "shaderNotes": ["Prefer MeshPhysicalMaterial when clearcoat, sheen, transmission, or thin-surface response is observed; otherwise use MeshStandardMaterial-compatible PBR channels.", "Generate albedo, roughness, height/normal, and AO independently; never alias albedo into roughness.", "Use normal/bump/displacement only when they map to observed surface relief.", "Use displacement geometry when the observed relief changes the close-up silhouette; texture-only relief is insufficient there."], "notes": "Reduced-detail scope: no extracted textures, rust, scratches or normal maps."},
    options
  );
  materialMap["dial"] = createSculptMaterial(
    "dial",
    {"id": "dial", "name": "dial", "type": "standard", "shaderModel": "MeshStandardMaterial / PBR approximation", "baseColor": "#e3dfcf", "color": "#e3dfcf", "albedo": {"dominant": "#e3dfcf", "secondary": ["#e3dfcf"], "samplingNotes": "User-authorized shared palette from power-hammer-model.ts / workshop-model-kit.ts, not inverse-rendered albedo."}, "colorVariation": {"palette": ["#e3dfcf"], "pattern": "none", "amplitude": 0}, "textureResolution": 1024, "textureProjection": {"mode": "uv", "repeat": [2, 2], "anisotropy": 8, "texelDensityIntent": "Preserve stable world/object-scale detail; do not stretch micro detail with component scale."}, "surfaceFrequencyBands": [], "roughness": {"base": 0.85}, "metalness": {"base": 0, "variation": 0}, "normal": {"pattern": "none", "strength": 0, "scale": 1, "space": "tangent"}, "bump": {"pattern": "none", "amplitude": 0, "scale": 1}, "displacement": {"pattern": "none", "amplitude": 0, "scale": 1, "silhouetteAffects": false}, "ambientOcclusion": {"cavityStrength": 0.25, "contactShadowBias": 0.35, "notes": "Darken creases, seams, intersections, and recessed local features."}, "wear": {"edgeWear": 0, "scratches": [], "chips": []}, "dirt": {"amount": 0, "cavityBias": 0, "color": "#2F2A22"}, "localOverrides": [], "shaderNotes": ["Prefer MeshPhysicalMaterial when clearcoat, sheen, transmission, or thin-surface response is observed; otherwise use MeshStandardMaterial-compatible PBR channels.", "Generate albedo, roughness, height/normal, and AO independently; never alias albedo into roughness.", "Use normal/bump/displacement only when they map to observed surface relief.", "Use displacement geometry when the observed relief changes the close-up silhouette; texture-only relief is insufficient there."], "notes": "Reduced-detail scope: no extracted textures, rust, scratches or normal maps."},
    options
  );

  const nodes: Record<string, THREE.Object3D> = { root };
  const meshes: Record<string, THREE.Mesh> = {};
  const sockets: Record<string, THREE.Object3D> = {};
  const colliders: Record<string, unknown> = {};
  const destructionGroups: Record<string, THREE.Object3D[]> = {};

  const endpoint_base_0 = makeAttachmentEndpoint(null);
  const node_base_0 = new THREE.Group();
  node_base_0.name = "base__pivot";
  node_base_0.scale.set(1, 1, 1);
  if (endpoint_base_0) {
    node_base_0.position.copy(endpoint_base_0.start);
    node_base_0.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_base_0.position.set(0.0, 50.0, 0.0);
    node_base_0.rotation.set(0.0, 0.0, 0.0);
  }
  node_base_0.userData.sculptComponent = {"id": "base", "name": "base", "level": "macro", "role": "base", "importance": 1, "confidence": 0.5, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Discrete rigid mechanical part with flat faces or circular section.", "geometryDescriptor": {"notes": "Dimensions describe nominal assembly envelope; profile points, repeated placement and physical joints in geometryContract."}, "parent": null, "attachment": null, "dimensions": {"width": 980, "height": 100, "depth": 900, "units": "mm", "confidence": 1}, "transform": {"position": [0, 50, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "base"}}, "material": "iron", "materialLayers": ["iron"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0, "microRoughness": 0, "bumpAmplitude": 0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object", "full-object"], "details": [], "fidelityTier": "structural", "parentId": null, "colorMaterialRecipe": {"dominantAlbedo": "rgba(85, 95, 96, 1)", "secondaryAlbedo": "rgba(85, 95, 96, 1)", "materialClass": "metal", "materialClassConfidence": 0.9, "roughnessRange": [0.3, 0.8], "metalnessRange": [0.7, 0.85], "evidenceRefs": ["full-object"], "notes": "Shared workshop palette requested by user; not pixel sampling."}};
  node_base_0.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "base"}};
  (nodes["root"] ?? root).add(node_base_0);
  nodes["base"] = node_base_0;
  const mesh_base_0Geometry = endpoint_base_0
    ? new THREE.CylinderGeometry(endpoint_base_0.endRadius, endpoint_base_0.baseRadius, endpoint_base_0.length, 8, 4)
    : new THREE.BoxGeometry(1, 1, 1, 1, 1, 1);
  if (!endpoint_base_0) {
    mesh_base_0Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_base_0 = new THREE.Mesh(
    mesh_base_0Geometry,
    materialMap["iron"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_base_0.name = "base";
  if (endpoint_base_0) {
    mesh_base_0.position.copy(endpoint_base_0.midpoint);
    mesh_base_0.quaternion.copy(endpoint_base_0.quaternion);
  }
  mesh_base_0.castShadow = options.castShadow ?? true;
  mesh_base_0.receiveShadow = options.receiveShadow ?? true;
  mesh_base_0.userData.sculptComponent = {"id": "base", "name": "base", "level": "macro", "role": "base", "importance": 1, "confidence": 0.5, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Discrete rigid mechanical part with flat faces or circular section.", "geometryDescriptor": {"notes": "Dimensions describe nominal assembly envelope; profile points, repeated placement and physical joints in geometryContract."}, "parent": null, "attachment": null, "dimensions": {"width": 980, "height": 100, "depth": 900, "units": "mm", "confidence": 1}, "transform": {"position": [0, 50, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "base"}}, "material": "iron", "materialLayers": ["iron"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0, "microRoughness": 0, "bumpAmplitude": 0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object", "full-object"], "details": [], "fidelityTier": "structural", "parentId": null, "colorMaterialRecipe": {"dominantAlbedo": "rgba(85, 95, 96, 1)", "secondaryAlbedo": "rgba(85, 95, 96, 1)", "materialClass": "metal", "materialClassConfidence": 0.9, "roughnessRange": [0.3, 0.8], "metalnessRange": [0.7, 0.85], "evidenceRefs": ["full-object"], "notes": "Shared workshop palette requested by user; not pixel sampling."}};
  node_base_0.add(mesh_base_0);
  meshes["base"] = mesh_base_0;
  colliders["base"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["root"] ??= [];
  destructionGroups["root"].push(node_base_0);

  const endpoint_gate_frame_1 = makeAttachmentEndpoint(null);
  const node_gate_frame_1 = new THREE.Group();
  node_gate_frame_1.name = "gate-frame__pivot";
  node_gate_frame_1.scale.set(1, 1, 1);
  if (endpoint_gate_frame_1) {
    node_gate_frame_1.position.copy(endpoint_gate_frame_1.start);
    node_gate_frame_1.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_gate_frame_1.position.set(0.0, 960.0, 0.0);
    node_gate_frame_1.rotation.set(0.0, 0.0, 0.0);
  }
  node_gate_frame_1.userData.sculptComponent = {"id": "gate-frame", "name": "gate-frame", "level": "macro", "role": "gate-frame", "importance": 1, "confidence": 0.5, "primitive": "extrude", "topologyClass": "assembled-solid", "topologyRationale": "Connected cast profile with planar faces and explicitly open negative space.", "geometryDescriptor": {"notes": "Dimensions describe nominal assembly envelope; profile points, repeated placement and physical joints in geometryContract."}, "parent": null, "attachment": null, "dimensions": {"width": 920, "height": 1720, "depth": 480, "units": "mm", "confidence": 1}, "transform": {"position": [0, 960, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "base"}}, "material": "iron", "materialLayers": ["iron"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "identity", "type": "geometry", "description": "Reference gate-frame silhouette/response", "evidenceRefs": ["full-object"]}], "surfaceDetail": {"macroRoughness": 0, "microRoughness": 0, "bumpAmplitude": 0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object", "full-object"], "details": [], "fidelityTier": "structural", "parentId": null, "colorMaterialRecipe": {"dominantAlbedo": "rgba(85, 95, 96, 1)", "secondaryAlbedo": "rgba(85, 95, 96, 1)", "materialClass": "metal", "materialClassConfidence": 0.9, "roughnessRange": [0.3, 0.8], "metalnessRange": [0.7, 0.85], "evidenceRefs": ["full-object"], "notes": "Shared workshop palette requested by user; not pixel sampling."}};
  node_gate_frame_1.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "base"}};
  (nodes["root"] ?? root).add(node_gate_frame_1);
  nodes["gate-frame"] = node_gate_frame_1;
  const mesh_gate_frame_1Geometry = endpoint_gate_frame_1
    ? new THREE.CylinderGeometry(endpoint_gate_frame_1.endRadius, endpoint_gate_frame_1.baseRadius, endpoint_gate_frame_1.length, 8, 4)
    : buildExtrudeGeometry({"points": [[-0.3, -0.3], [0.3, -0.3], [0.3, 0.3], [-0.3, 0.3]], "depth": 0.1});
  if (!endpoint_gate_frame_1) {
    mesh_gate_frame_1Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_gate_frame_1 = new THREE.Mesh(
    mesh_gate_frame_1Geometry,
    materialMap["iron"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_gate_frame_1.name = "gate-frame";
  if (endpoint_gate_frame_1) {
    mesh_gate_frame_1.position.copy(endpoint_gate_frame_1.midpoint);
    mesh_gate_frame_1.quaternion.copy(endpoint_gate_frame_1.quaternion);
  }
  mesh_gate_frame_1.castShadow = options.castShadow ?? true;
  mesh_gate_frame_1.receiveShadow = options.receiveShadow ?? true;
  mesh_gate_frame_1.userData.sculptComponent = {"id": "gate-frame", "name": "gate-frame", "level": "macro", "role": "gate-frame", "importance": 1, "confidence": 0.5, "primitive": "extrude", "topologyClass": "assembled-solid", "topologyRationale": "Connected cast profile with planar faces and explicitly open negative space.", "geometryDescriptor": {"notes": "Dimensions describe nominal assembly envelope; profile points, repeated placement and physical joints in geometryContract."}, "parent": null, "attachment": null, "dimensions": {"width": 920, "height": 1720, "depth": 480, "units": "mm", "confidence": 1}, "transform": {"position": [0, 960, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "base"}}, "material": "iron", "materialLayers": ["iron"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "identity", "type": "geometry", "description": "Reference gate-frame silhouette/response", "evidenceRefs": ["full-object"]}], "surfaceDetail": {"macroRoughness": 0, "microRoughness": 0, "bumpAmplitude": 0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object", "full-object"], "details": [], "fidelityTier": "structural", "parentId": null, "colorMaterialRecipe": {"dominantAlbedo": "rgba(85, 95, 96, 1)", "secondaryAlbedo": "rgba(85, 95, 96, 1)", "materialClass": "metal", "materialClassConfidence": 0.9, "roughnessRange": [0.3, 0.8], "metalnessRange": [0.7, 0.85], "evidenceRefs": ["full-object"], "notes": "Shared workshop palette requested by user; not pixel sampling."}};
  node_gate_frame_1.add(mesh_gate_frame_1);
  meshes["gate-frame"] = mesh_gate_frame_1;
  colliders["gate-frame"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["root"] ??= [];
  destructionGroups["root"].push(node_gate_frame_1);

  const endpoint_pedestal_2 = makeAttachmentEndpoint(null);
  const node_pedestal_2 = new THREE.Group();
  node_pedestal_2.name = "pedestal__pivot";
  node_pedestal_2.scale.set(1, 1, 1);
  if (endpoint_pedestal_2) {
    node_pedestal_2.position.copy(endpoint_pedestal_2.start);
    node_pedestal_2.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_pedestal_2.position.set(0.0, 447.5, 0.0);
    node_pedestal_2.rotation.set(0.0, 0.0, 0.0);
  }
  node_pedestal_2.userData.sculptComponent = {"id": "pedestal", "name": "pedestal", "level": "macro", "role": "pedestal", "importance": 1, "confidence": 0.5, "primitive": "extrude", "topologyClass": "assembled-solid", "topologyRationale": "Connected cast profile with planar faces and explicitly open negative space.", "geometryDescriptor": {"notes": "Dimensions describe nominal assembly envelope; profile points, repeated placement and physical joints in geometryContract."}, "parent": null, "attachment": null, "dimensions": {"width": 380, "height": 695, "depth": 330, "units": "mm", "confidence": 1}, "transform": {"position": [0, 447.5, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "base"}}, "material": "iron", "materialLayers": ["iron"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0, "microRoughness": 0, "bumpAmplitude": 0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object", "full-object"], "details": [], "fidelityTier": "structural", "parentId": null, "colorMaterialRecipe": {"dominantAlbedo": "rgba(85, 95, 96, 1)", "secondaryAlbedo": "rgba(85, 95, 96, 1)", "materialClass": "metal", "materialClassConfidence": 0.9, "roughnessRange": [0.3, 0.8], "metalnessRange": [0.7, 0.85], "evidenceRefs": ["full-object"], "notes": "Shared workshop palette requested by user; not pixel sampling."}};
  node_pedestal_2.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "base"}};
  (nodes["root"] ?? root).add(node_pedestal_2);
  nodes["pedestal"] = node_pedestal_2;
  const mesh_pedestal_2Geometry = endpoint_pedestal_2
    ? new THREE.CylinderGeometry(endpoint_pedestal_2.endRadius, endpoint_pedestal_2.baseRadius, endpoint_pedestal_2.length, 8, 4)
    : buildExtrudeGeometry({"points": [[-0.3, -0.3], [0.3, -0.3], [0.3, 0.3], [-0.3, 0.3]], "depth": 0.1});
  if (!endpoint_pedestal_2) {
    mesh_pedestal_2Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_pedestal_2 = new THREE.Mesh(
    mesh_pedestal_2Geometry,
    materialMap["iron"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_pedestal_2.name = "pedestal";
  if (endpoint_pedestal_2) {
    mesh_pedestal_2.position.copy(endpoint_pedestal_2.midpoint);
    mesh_pedestal_2.quaternion.copy(endpoint_pedestal_2.quaternion);
  }
  mesh_pedestal_2.castShadow = options.castShadow ?? true;
  mesh_pedestal_2.receiveShadow = options.receiveShadow ?? true;
  mesh_pedestal_2.userData.sculptComponent = {"id": "pedestal", "name": "pedestal", "level": "macro", "role": "pedestal", "importance": 1, "confidence": 0.5, "primitive": "extrude", "topologyClass": "assembled-solid", "topologyRationale": "Connected cast profile with planar faces and explicitly open negative space.", "geometryDescriptor": {"notes": "Dimensions describe nominal assembly envelope; profile points, repeated placement and physical joints in geometryContract."}, "parent": null, "attachment": null, "dimensions": {"width": 380, "height": 695, "depth": 330, "units": "mm", "confidence": 1}, "transform": {"position": [0, 447.5, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "base"}}, "material": "iron", "materialLayers": ["iron"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0, "microRoughness": 0, "bumpAmplitude": 0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object", "full-object"], "details": [], "fidelityTier": "structural", "parentId": null, "colorMaterialRecipe": {"dominantAlbedo": "rgba(85, 95, 96, 1)", "secondaryAlbedo": "rgba(85, 95, 96, 1)", "materialClass": "metal", "materialClassConfidence": 0.9, "roughnessRange": [0.3, 0.8], "metalnessRange": [0.7, 0.85], "evidenceRefs": ["full-object"], "notes": "Shared workshop palette requested by user; not pixel sampling."}};
  node_pedestal_2.add(mesh_pedestal_2);
  meshes["pedestal"] = mesh_pedestal_2;
  colliders["pedestal"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["root"] ??= [];
  destructionGroups["root"].push(node_pedestal_2);

  const attachment_cylinder_shell_3 = null;
  const endpoint_cylinder_shell_3 = makeAttachmentEndpoint(attachment_cylinder_shell_3);
  const node_cylinder_shell_3 = new THREE.Group();
  node_cylinder_shell_3.name = "cylinder-shell__pivot";
  node_cylinder_shell_3.scale.set(1, 1, 1);
  if (endpoint_cylinder_shell_3) {
    node_cylinder_shell_3.position.copy(endpoint_cylinder_shell_3.start);
    node_cylinder_shell_3.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_cylinder_shell_3.position.set(0.0, 1685.0, 0.0);
    node_cylinder_shell_3.rotation.set(0.0, 0.0, 0.0);
  }
  node_cylinder_shell_3.userData.sculptComponent = {"id": "cylinder-shell", "name": "cylinder-shell", "level": "macro", "role": "cylinder-shell", "importance": 1, "confidence": 0.5, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Discrete rigid mechanical part with flat faces or circular section.", "geometryDescriptor": {"notes": "Dimensions describe nominal assembly envelope; profile points, repeated placement and physical joints in geometryContract."}, "parent": null, "attachment": null, "dimensions": {"width": 290, "height": 330, "depth": 290, "units": "mm", "confidence": 1}, "transform": {"position": [0, 1685, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "base"}}, "material": "iron", "materialLayers": ["iron"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "identity", "type": "geometry", "description": "Reference cylinder-shell silhouette/response", "evidenceRefs": ["full-object"]}], "surfaceDetail": {"macroRoughness": 0, "microRoughness": 0, "bumpAmplitude": 0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object", "full-object"], "details": [], "fidelityTier": "structural", "parentId": null, "colorMaterialRecipe": {"dominantAlbedo": "rgba(85, 95, 96, 1)", "secondaryAlbedo": "rgba(85, 95, 96, 1)", "materialClass": "metal", "materialClassConfidence": 0.9, "roughnessRange": [0.3, 0.8], "metalnessRange": [0.7, 0.85], "evidenceRefs": ["full-object"], "notes": "Shared workshop palette requested by user; not pixel sampling."}};
  node_cylinder_shell_3.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "base"}};
  (nodes["root"] ?? root).add(node_cylinder_shell_3);
  nodes["cylinder-shell"] = node_cylinder_shell_3;
  const mesh_cylinder_shell_3Geometry = endpoint_cylinder_shell_3
    ? new THREE.CylinderGeometry(endpoint_cylinder_shell_3.endRadius, endpoint_cylinder_shell_3.baseRadius, endpoint_cylinder_shell_3.length, 8, 4)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 10, 4);
  if (!endpoint_cylinder_shell_3) {
    mesh_cylinder_shell_3Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_cylinder_shell_3 = new THREE.Mesh(
    mesh_cylinder_shell_3Geometry,
    materialMap["iron"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_cylinder_shell_3.name = "cylinder-shell";
  if (endpoint_cylinder_shell_3) {
    mesh_cylinder_shell_3.position.copy(endpoint_cylinder_shell_3.midpoint);
    mesh_cylinder_shell_3.quaternion.copy(endpoint_cylinder_shell_3.quaternion);
  }
  mesh_cylinder_shell_3.castShadow = options.castShadow ?? true;
  mesh_cylinder_shell_3.receiveShadow = options.receiveShadow ?? true;
  mesh_cylinder_shell_3.userData.sculptComponent = {"id": "cylinder-shell", "name": "cylinder-shell", "level": "macro", "role": "cylinder-shell", "importance": 1, "confidence": 0.5, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Discrete rigid mechanical part with flat faces or circular section.", "geometryDescriptor": {"notes": "Dimensions describe nominal assembly envelope; profile points, repeated placement and physical joints in geometryContract."}, "parent": null, "attachment": null, "dimensions": {"width": 290, "height": 330, "depth": 290, "units": "mm", "confidence": 1}, "transform": {"position": [0, 1685, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "base"}}, "material": "iron", "materialLayers": ["iron"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "identity", "type": "geometry", "description": "Reference cylinder-shell silhouette/response", "evidenceRefs": ["full-object"]}], "surfaceDetail": {"macroRoughness": 0, "microRoughness": 0, "bumpAmplitude": 0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object", "full-object"], "details": [], "fidelityTier": "structural", "parentId": null, "colorMaterialRecipe": {"dominantAlbedo": "rgba(85, 95, 96, 1)", "secondaryAlbedo": "rgba(85, 95, 96, 1)", "materialClass": "metal", "materialClassConfidence": 0.9, "roughnessRange": [0.3, 0.8], "metalnessRange": [0.7, 0.85], "evidenceRefs": ["full-object"], "notes": "Shared workshop palette requested by user; not pixel sampling."}};
  node_cylinder_shell_3.add(mesh_cylinder_shell_3);
  meshes["cylinder-shell"] = mesh_cylinder_shell_3;
  colliders["cylinder-shell"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["root"] ??= [];
  destructionGroups["root"].push(node_cylinder_shell_3);

  const endpoint_crosshead_4 = makeAttachmentEndpoint(null);
  const node_crosshead_4 = new THREE.Group();
  node_crosshead_4.name = "crosshead__pivot";
  node_crosshead_4.scale.set(1, 1, 1);
  if (endpoint_crosshead_4) {
    node_crosshead_4.position.copy(endpoint_crosshead_4.start);
    node_crosshead_4.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_crosshead_4.position.set(0.0, 1200.0, 0.0);
    node_crosshead_4.rotation.set(0.0, 0.0, 0.0);
  }
  node_crosshead_4.userData.sculptComponent = {"id": "crosshead", "name": "crosshead", "level": "macro", "role": "crosshead", "importance": 1, "confidence": 0.5, "primitive": "extrude", "topologyClass": "assembled-solid", "topologyRationale": "Connected cast profile with planar faces and explicitly open negative space.", "geometryDescriptor": {"notes": "Dimensions describe nominal assembly envelope; profile points, repeated placement and physical joints in geometryContract."}, "parent": null, "attachment": null, "dimensions": {"width": 650, "height": 160, "depth": 220, "units": "mm", "confidence": 1}, "transform": {"position": [0, 1200, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "rigid-moving", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "base"}}, "material": "iron", "materialLayers": ["iron"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "identity", "type": "geometry", "description": "Reference crosshead silhouette/response", "evidenceRefs": ["full-object"]}], "surfaceDetail": {"macroRoughness": 0, "microRoughness": 0, "bumpAmplitude": 0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object", "full-object"], "details": [], "fidelityTier": "structural", "parentId": null, "colorMaterialRecipe": {"dominantAlbedo": "rgba(85, 95, 96, 1)", "secondaryAlbedo": "rgba(85, 95, 96, 1)", "materialClass": "metal", "materialClassConfidence": 0.9, "roughnessRange": [0.3, 0.8], "metalnessRange": [0.7, 0.85], "evidenceRefs": ["full-object"], "notes": "Shared workshop palette requested by user; not pixel sampling."}};
  node_crosshead_4.userData.actionProfile = {"animationRole": "rigid-moving", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "base"}};
  (nodes["root"] ?? root).add(node_crosshead_4);
  nodes["crosshead"] = node_crosshead_4;
  const mesh_crosshead_4Geometry = endpoint_crosshead_4
    ? new THREE.CylinderGeometry(endpoint_crosshead_4.endRadius, endpoint_crosshead_4.baseRadius, endpoint_crosshead_4.length, 8, 4)
    : buildExtrudeGeometry({"points": [[-0.3, -0.3], [0.3, -0.3], [0.3, 0.3], [-0.3, 0.3]], "depth": 0.1});
  if (!endpoint_crosshead_4) {
    mesh_crosshead_4Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_crosshead_4 = new THREE.Mesh(
    mesh_crosshead_4Geometry,
    materialMap["iron"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_crosshead_4.name = "crosshead";
  if (endpoint_crosshead_4) {
    mesh_crosshead_4.position.copy(endpoint_crosshead_4.midpoint);
    mesh_crosshead_4.quaternion.copy(endpoint_crosshead_4.quaternion);
  }
  mesh_crosshead_4.castShadow = options.castShadow ?? true;
  mesh_crosshead_4.receiveShadow = options.receiveShadow ?? true;
  mesh_crosshead_4.userData.sculptComponent = {"id": "crosshead", "name": "crosshead", "level": "macro", "role": "crosshead", "importance": 1, "confidence": 0.5, "primitive": "extrude", "topologyClass": "assembled-solid", "topologyRationale": "Connected cast profile with planar faces and explicitly open negative space.", "geometryDescriptor": {"notes": "Dimensions describe nominal assembly envelope; profile points, repeated placement and physical joints in geometryContract."}, "parent": null, "attachment": null, "dimensions": {"width": 650, "height": 160, "depth": 220, "units": "mm", "confidence": 1}, "transform": {"position": [0, 1200, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "rigid-moving", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "base"}}, "material": "iron", "materialLayers": ["iron"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "identity", "type": "geometry", "description": "Reference crosshead silhouette/response", "evidenceRefs": ["full-object"]}], "surfaceDetail": {"macroRoughness": 0, "microRoughness": 0, "bumpAmplitude": 0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object", "full-object"], "details": [], "fidelityTier": "structural", "parentId": null, "colorMaterialRecipe": {"dominantAlbedo": "rgba(85, 95, 96, 1)", "secondaryAlbedo": "rgba(85, 95, 96, 1)", "materialClass": "metal", "materialClassConfidence": 0.9, "roughnessRange": [0.3, 0.8], "metalnessRange": [0.7, 0.85], "evidenceRefs": ["full-object"], "notes": "Shared workshop palette requested by user; not pixel sampling."}};
  node_crosshead_4.add(mesh_crosshead_4);
  meshes["crosshead"] = mesh_crosshead_4;
  colliders["crosshead"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["root"] ??= [];
  destructionGroups["root"].push(node_crosshead_4);

  const attachment_piston_5 = null;
  const endpoint_piston_5 = makeAttachmentEndpoint(attachment_piston_5);
  const node_piston_5 = new THREE.Group();
  node_piston_5.name = "piston__pivot";
  node_piston_5.scale.set(1, 1, 1);
  if (endpoint_piston_5) {
    node_piston_5.position.copy(endpoint_piston_5.start);
    node_piston_5.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_piston_5.position.set(0.0, 1470.0, 0.0);
    node_piston_5.rotation.set(0.0, 0.0, 0.0);
  }
  node_piston_5.userData.sculptComponent = {"id": "piston", "name": "piston", "level": "meso", "role": "piston", "importance": 1, "confidence": 0.5, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Discrete rigid mechanical part with flat faces or circular section.", "geometryDescriptor": {"notes": "Dimensions describe nominal assembly envelope; profile points, repeated placement and physical joints in geometryContract."}, "parent": null, "attachment": null, "dimensions": {"width": 112, "height": 440, "depth": 112, "units": "mm", "confidence": 1}, "transform": {"position": [0, 1470, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "rigid-moving", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "base"}}, "material": "steel", "materialLayers": ["steel"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "identity", "type": "geometry", "description": "Reference piston silhouette/response", "evidenceRefs": ["full-object"]}], "surfaceDetail": {"macroRoughness": 0, "microRoughness": 0, "bumpAmplitude": 0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object", "full-object"], "details": [], "fidelityTier": "structural", "parentId": null, "colorMaterialRecipe": {"dominantAlbedo": "rgba(163, 169, 166, 1)", "secondaryAlbedo": "rgba(163, 169, 166, 1)", "materialClass": "metal", "materialClassConfidence": 0.9, "roughnessRange": [0.3, 0.8], "metalnessRange": [0.7, 0.85], "evidenceRefs": ["full-object"], "notes": "Shared workshop palette requested by user; not pixel sampling."}};
  node_piston_5.userData.actionProfile = {"animationRole": "rigid-moving", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "base"}};
  (nodes["root"] ?? root).add(node_piston_5);
  nodes["piston"] = node_piston_5;
  const mesh_piston_5Geometry = endpoint_piston_5
    ? new THREE.CylinderGeometry(endpoint_piston_5.endRadius, endpoint_piston_5.baseRadius, endpoint_piston_5.length, 8, 4)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 10, 4);
  if (!endpoint_piston_5) {
    mesh_piston_5Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_piston_5 = new THREE.Mesh(
    mesh_piston_5Geometry,
    materialMap["steel"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_piston_5.name = "piston";
  if (endpoint_piston_5) {
    mesh_piston_5.position.copy(endpoint_piston_5.midpoint);
    mesh_piston_5.quaternion.copy(endpoint_piston_5.quaternion);
  }
  mesh_piston_5.castShadow = options.castShadow ?? true;
  mesh_piston_5.receiveShadow = options.receiveShadow ?? true;
  mesh_piston_5.userData.sculptComponent = {"id": "piston", "name": "piston", "level": "meso", "role": "piston", "importance": 1, "confidence": 0.5, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Discrete rigid mechanical part with flat faces or circular section.", "geometryDescriptor": {"notes": "Dimensions describe nominal assembly envelope; profile points, repeated placement and physical joints in geometryContract."}, "parent": null, "attachment": null, "dimensions": {"width": 112, "height": 440, "depth": 112, "units": "mm", "confidence": 1}, "transform": {"position": [0, 1470, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "rigid-moving", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "base"}}, "material": "steel", "materialLayers": ["steel"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "identity", "type": "geometry", "description": "Reference piston silhouette/response", "evidenceRefs": ["full-object"]}], "surfaceDetail": {"macroRoughness": 0, "microRoughness": 0, "bumpAmplitude": 0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object", "full-object"], "details": [], "fidelityTier": "structural", "parentId": null, "colorMaterialRecipe": {"dominantAlbedo": "rgba(163, 169, 166, 1)", "secondaryAlbedo": "rgba(163, 169, 166, 1)", "materialClass": "metal", "materialClassConfidence": 0.9, "roughnessRange": [0.3, 0.8], "metalnessRange": [0.7, 0.85], "evidenceRefs": ["full-object"], "notes": "Shared workshop palette requested by user; not pixel sampling."}};
  node_piston_5.add(mesh_piston_5);
  meshes["piston"] = mesh_piston_5;
  colliders["piston"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["root"] ??= [];
  destructionGroups["root"].push(node_piston_5);

  const endpoint_upper_holder_6 = makeAttachmentEndpoint(null);
  const node_upper_holder_6 = new THREE.Group();
  node_upper_holder_6.name = "upper-holder__pivot";
  node_upper_holder_6.scale.set(1, 1, 1);
  if (endpoint_upper_holder_6) {
    node_upper_holder_6.position.copy(endpoint_upper_holder_6.start);
    node_upper_holder_6.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_upper_holder_6.position.set(0.0, 1067.5, 0.0);
    node_upper_holder_6.rotation.set(0.0, 0.0, 0.0);
  }
  node_upper_holder_6.userData.sculptComponent = {"id": "upper-holder", "name": "upper-holder", "level": "meso", "role": "upper-holder", "importance": 1, "confidence": 0.5, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Discrete rigid mechanical part with flat faces or circular section.", "geometryDescriptor": {"notes": "Dimensions describe nominal assembly envelope; profile points, repeated placement and physical joints in geometryContract."}, "parent": null, "attachment": null, "dimensions": {"width": 150, "height": 105, "depth": 135, "units": "mm", "confidence": 1}, "transform": {"position": [0, 1067.5, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "rigid-moving", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "base"}}, "material": "iron", "materialLayers": ["iron"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0, "microRoughness": 0, "bumpAmplitude": 0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object", "full-object"], "details": [], "fidelityTier": "structural", "parentId": null, "colorMaterialRecipe": {"dominantAlbedo": "rgba(85, 95, 96, 1)", "secondaryAlbedo": "rgba(85, 95, 96, 1)", "materialClass": "metal", "materialClassConfidence": 0.9, "roughnessRange": [0.3, 0.8], "metalnessRange": [0.7, 0.85], "evidenceRefs": ["full-object"], "notes": "Shared workshop palette requested by user; not pixel sampling."}};
  node_upper_holder_6.userData.actionProfile = {"animationRole": "rigid-moving", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "base"}};
  (nodes["root"] ?? root).add(node_upper_holder_6);
  nodes["upper-holder"] = node_upper_holder_6;
  const mesh_upper_holder_6Geometry = endpoint_upper_holder_6
    ? new THREE.CylinderGeometry(endpoint_upper_holder_6.endRadius, endpoint_upper_holder_6.baseRadius, endpoint_upper_holder_6.length, 8, 4)
    : new THREE.BoxGeometry(1, 1, 1, 1, 1, 1);
  if (!endpoint_upper_holder_6) {
    mesh_upper_holder_6Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_upper_holder_6 = new THREE.Mesh(
    mesh_upper_holder_6Geometry,
    materialMap["iron"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_upper_holder_6.name = "upper-holder";
  if (endpoint_upper_holder_6) {
    mesh_upper_holder_6.position.copy(endpoint_upper_holder_6.midpoint);
    mesh_upper_holder_6.quaternion.copy(endpoint_upper_holder_6.quaternion);
  }
  mesh_upper_holder_6.castShadow = options.castShadow ?? true;
  mesh_upper_holder_6.receiveShadow = options.receiveShadow ?? true;
  mesh_upper_holder_6.userData.sculptComponent = {"id": "upper-holder", "name": "upper-holder", "level": "meso", "role": "upper-holder", "importance": 1, "confidence": 0.5, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Discrete rigid mechanical part with flat faces or circular section.", "geometryDescriptor": {"notes": "Dimensions describe nominal assembly envelope; profile points, repeated placement and physical joints in geometryContract."}, "parent": null, "attachment": null, "dimensions": {"width": 150, "height": 105, "depth": 135, "units": "mm", "confidence": 1}, "transform": {"position": [0, 1067.5, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "rigid-moving", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "base"}}, "material": "iron", "materialLayers": ["iron"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0, "microRoughness": 0, "bumpAmplitude": 0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object", "full-object"], "details": [], "fidelityTier": "structural", "parentId": null, "colorMaterialRecipe": {"dominantAlbedo": "rgba(85, 95, 96, 1)", "secondaryAlbedo": "rgba(85, 95, 96, 1)", "materialClass": "metal", "materialClassConfidence": 0.9, "roughnessRange": [0.3, 0.8], "metalnessRange": [0.7, 0.85], "evidenceRefs": ["full-object"], "notes": "Shared workshop palette requested by user; not pixel sampling."}};
  node_upper_holder_6.add(mesh_upper_holder_6);
  meshes["upper-holder"] = mesh_upper_holder_6;
  colliders["upper-holder"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["root"] ??= [];
  destructionGroups["root"].push(node_upper_holder_6);

  const endpoint_upper_die_7 = makeAttachmentEndpoint(null);
  const node_upper_die_7 = new THREE.Group();
  node_upper_die_7.name = "upper-die__pivot";
  node_upper_die_7.scale.set(1, 1, 1);
  if (endpoint_upper_die_7) {
    node_upper_die_7.position.copy(endpoint_upper_die_7.start);
    node_upper_die_7.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_upper_die_7.position.set(0.0, 1005.0, 0.0);
    node_upper_die_7.rotation.set(0.0, 0.0, 0.0);
  }
  node_upper_die_7.userData.sculptComponent = {"id": "upper-die", "name": "upper-die", "level": "meso", "role": "upper-die", "importance": 1, "confidence": 0.5, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Discrete rigid mechanical part with flat faces or circular section.", "geometryDescriptor": {"notes": "Dimensions describe nominal assembly envelope; profile points, repeated placement and physical joints in geometryContract."}, "parent": null, "attachment": null, "dimensions": {"width": 48, "height": 20, "depth": 48, "units": "mm", "confidence": 1}, "transform": {"position": [0, 1005, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "rigid-moving", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "base"}}, "material": "steel", "materialLayers": ["steel"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0, "microRoughness": 0, "bumpAmplitude": 0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object", "full-object"], "details": [], "fidelityTier": "structural", "parentId": null, "colorMaterialRecipe": {"dominantAlbedo": "rgba(163, 169, 166, 1)", "secondaryAlbedo": "rgba(163, 169, 166, 1)", "materialClass": "metal", "materialClassConfidence": 0.9, "roughnessRange": [0.3, 0.8], "metalnessRange": [0.7, 0.85], "evidenceRefs": ["full-object"], "notes": "Shared workshop palette requested by user; not pixel sampling."}};
  node_upper_die_7.userData.actionProfile = {"animationRole": "rigid-moving", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "base"}};
  (nodes["root"] ?? root).add(node_upper_die_7);
  nodes["upper-die"] = node_upper_die_7;
  const mesh_upper_die_7Geometry = endpoint_upper_die_7
    ? new THREE.CylinderGeometry(endpoint_upper_die_7.endRadius, endpoint_upper_die_7.baseRadius, endpoint_upper_die_7.length, 8, 4)
    : new THREE.BoxGeometry(1, 1, 1, 1, 1, 1);
  if (!endpoint_upper_die_7) {
    mesh_upper_die_7Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_upper_die_7 = new THREE.Mesh(
    mesh_upper_die_7Geometry,
    materialMap["steel"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_upper_die_7.name = "upper-die";
  if (endpoint_upper_die_7) {
    mesh_upper_die_7.position.copy(endpoint_upper_die_7.midpoint);
    mesh_upper_die_7.quaternion.copy(endpoint_upper_die_7.quaternion);
  }
  mesh_upper_die_7.castShadow = options.castShadow ?? true;
  mesh_upper_die_7.receiveShadow = options.receiveShadow ?? true;
  mesh_upper_die_7.userData.sculptComponent = {"id": "upper-die", "name": "upper-die", "level": "meso", "role": "upper-die", "importance": 1, "confidence": 0.5, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Discrete rigid mechanical part with flat faces or circular section.", "geometryDescriptor": {"notes": "Dimensions describe nominal assembly envelope; profile points, repeated placement and physical joints in geometryContract."}, "parent": null, "attachment": null, "dimensions": {"width": 48, "height": 20, "depth": 48, "units": "mm", "confidence": 1}, "transform": {"position": [0, 1005, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "rigid-moving", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "base"}}, "material": "steel", "materialLayers": ["steel"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0, "microRoughness": 0, "bumpAmplitude": 0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object", "full-object"], "details": [], "fidelityTier": "structural", "parentId": null, "colorMaterialRecipe": {"dominantAlbedo": "rgba(163, 169, 166, 1)", "secondaryAlbedo": "rgba(163, 169, 166, 1)", "materialClass": "metal", "materialClassConfidence": 0.9, "roughnessRange": [0.3, 0.8], "metalnessRange": [0.7, 0.85], "evidenceRefs": ["full-object"], "notes": "Shared workshop palette requested by user; not pixel sampling."}};
  node_upper_die_7.add(mesh_upper_die_7);
  meshes["upper-die"] = mesh_upper_die_7;
  colliders["upper-die"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["root"] ??= [];
  destructionGroups["root"].push(node_upper_die_7);

  const endpoint_lower_holder_8 = makeAttachmentEndpoint(null);
  const node_lower_holder_8 = new THREE.Group();
  node_lower_holder_8.name = "lower-holder__pivot";
  node_lower_holder_8.scale.set(1, 1, 1);
  if (endpoint_lower_holder_8) {
    node_lower_holder_8.position.copy(endpoint_lower_holder_8.start);
    node_lower_holder_8.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_lower_holder_8.position.set(0.0, 825.0, 0.0);
    node_lower_holder_8.rotation.set(0.0, 0.0, 0.0);
  }
  node_lower_holder_8.userData.sculptComponent = {"id": "lower-holder", "name": "lower-holder", "level": "meso", "role": "lower-holder", "importance": 1, "confidence": 0.5, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Discrete rigid mechanical part with flat faces or circular section.", "geometryDescriptor": {"notes": "Dimensions describe nominal assembly envelope; profile points, repeated placement and physical joints in geometryContract."}, "parent": null, "attachment": null, "dimensions": {"width": 270, "height": 60, "depth": 155, "units": "mm", "confidence": 1}, "transform": {"position": [0, 825, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "base"}}, "material": "iron", "materialLayers": ["iron"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0, "microRoughness": 0, "bumpAmplitude": 0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object", "full-object"], "details": [], "fidelityTier": "structural", "parentId": null, "colorMaterialRecipe": {"dominantAlbedo": "rgba(85, 95, 96, 1)", "secondaryAlbedo": "rgba(85, 95, 96, 1)", "materialClass": "metal", "materialClassConfidence": 0.9, "roughnessRange": [0.3, 0.8], "metalnessRange": [0.7, 0.85], "evidenceRefs": ["full-object"], "notes": "Shared workshop palette requested by user; not pixel sampling."}};
  node_lower_holder_8.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "base"}};
  (nodes["root"] ?? root).add(node_lower_holder_8);
  nodes["lower-holder"] = node_lower_holder_8;
  const mesh_lower_holder_8Geometry = endpoint_lower_holder_8
    ? new THREE.CylinderGeometry(endpoint_lower_holder_8.endRadius, endpoint_lower_holder_8.baseRadius, endpoint_lower_holder_8.length, 8, 4)
    : new THREE.BoxGeometry(1, 1, 1, 1, 1, 1);
  if (!endpoint_lower_holder_8) {
    mesh_lower_holder_8Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_lower_holder_8 = new THREE.Mesh(
    mesh_lower_holder_8Geometry,
    materialMap["iron"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_lower_holder_8.name = "lower-holder";
  if (endpoint_lower_holder_8) {
    mesh_lower_holder_8.position.copy(endpoint_lower_holder_8.midpoint);
    mesh_lower_holder_8.quaternion.copy(endpoint_lower_holder_8.quaternion);
  }
  mesh_lower_holder_8.castShadow = options.castShadow ?? true;
  mesh_lower_holder_8.receiveShadow = options.receiveShadow ?? true;
  mesh_lower_holder_8.userData.sculptComponent = {"id": "lower-holder", "name": "lower-holder", "level": "meso", "role": "lower-holder", "importance": 1, "confidence": 0.5, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Discrete rigid mechanical part with flat faces or circular section.", "geometryDescriptor": {"notes": "Dimensions describe nominal assembly envelope; profile points, repeated placement and physical joints in geometryContract."}, "parent": null, "attachment": null, "dimensions": {"width": 270, "height": 60, "depth": 155, "units": "mm", "confidence": 1}, "transform": {"position": [0, 825, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "base"}}, "material": "iron", "materialLayers": ["iron"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0, "microRoughness": 0, "bumpAmplitude": 0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object", "full-object"], "details": [], "fidelityTier": "structural", "parentId": null, "colorMaterialRecipe": {"dominantAlbedo": "rgba(85, 95, 96, 1)", "secondaryAlbedo": "rgba(85, 95, 96, 1)", "materialClass": "metal", "materialClassConfidence": 0.9, "roughnessRange": [0.3, 0.8], "metalnessRange": [0.7, 0.85], "evidenceRefs": ["full-object"], "notes": "Shared workshop palette requested by user; not pixel sampling."}};
  node_lower_holder_8.add(mesh_lower_holder_8);
  meshes["lower-holder"] = mesh_lower_holder_8;
  colliders["lower-holder"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["root"] ??= [];
  destructionGroups["root"].push(node_lower_holder_8);

  const endpoint_lower_support_9 = makeAttachmentEndpoint(null);
  const node_lower_support_9 = new THREE.Group();
  node_lower_support_9.name = "lower-support__pivot";
  node_lower_support_9.scale.set(1, 1, 1);
  if (endpoint_lower_support_9) {
    node_lower_support_9.position.copy(endpoint_lower_support_9.start);
    node_lower_support_9.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_lower_support_9.position.set(0.0, 865.0, 0.0);
    node_lower_support_9.rotation.set(0.0, 0.0, 0.0);
  }
  node_lower_support_9.userData.sculptComponent = {"id": "lower-support", "name": "lower-support", "level": "meso", "role": "lower-support", "importance": 1, "confidence": 0.5, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Discrete rigid mechanical part with flat faces or circular section.", "geometryDescriptor": {"notes": "Dimensions describe nominal assembly envelope; profile points, repeated placement and physical joints in geometryContract."}, "parent": null, "attachment": null, "dimensions": {"width": 224, "height": 20, "depth": 104, "units": "mm", "confidence": 1}, "transform": {"position": [0, 865, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "base"}}, "material": "steel", "materialLayers": ["steel"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0, "microRoughness": 0, "bumpAmplitude": 0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object", "full-object"], "details": [], "fidelityTier": "structural", "parentId": null, "colorMaterialRecipe": {"dominantAlbedo": "rgba(163, 169, 166, 1)", "secondaryAlbedo": "rgba(163, 169, 166, 1)", "materialClass": "metal", "materialClassConfidence": 0.9, "roughnessRange": [0.3, 0.8], "metalnessRange": [0.7, 0.85], "evidenceRefs": ["full-object"], "notes": "Shared workshop palette requested by user; not pixel sampling."}};
  node_lower_support_9.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "base"}};
  (nodes["root"] ?? root).add(node_lower_support_9);
  nodes["lower-support"] = node_lower_support_9;
  const mesh_lower_support_9Geometry = endpoint_lower_support_9
    ? new THREE.CylinderGeometry(endpoint_lower_support_9.endRadius, endpoint_lower_support_9.baseRadius, endpoint_lower_support_9.length, 8, 4)
    : new THREE.BoxGeometry(1, 1, 1, 1, 1, 1);
  if (!endpoint_lower_support_9) {
    mesh_lower_support_9Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_lower_support_9 = new THREE.Mesh(
    mesh_lower_support_9Geometry,
    materialMap["steel"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_lower_support_9.name = "lower-support";
  if (endpoint_lower_support_9) {
    mesh_lower_support_9.position.copy(endpoint_lower_support_9.midpoint);
    mesh_lower_support_9.quaternion.copy(endpoint_lower_support_9.quaternion);
  }
  mesh_lower_support_9.castShadow = options.castShadow ?? true;
  mesh_lower_support_9.receiveShadow = options.receiveShadow ?? true;
  mesh_lower_support_9.userData.sculptComponent = {"id": "lower-support", "name": "lower-support", "level": "meso", "role": "lower-support", "importance": 1, "confidence": 0.5, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Discrete rigid mechanical part with flat faces or circular section.", "geometryDescriptor": {"notes": "Dimensions describe nominal assembly envelope; profile points, repeated placement and physical joints in geometryContract."}, "parent": null, "attachment": null, "dimensions": {"width": 224, "height": 20, "depth": 104, "units": "mm", "confidence": 1}, "transform": {"position": [0, 865, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "base"}}, "material": "steel", "materialLayers": ["steel"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0, "microRoughness": 0, "bumpAmplitude": 0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object", "full-object"], "details": [], "fidelityTier": "structural", "parentId": null, "colorMaterialRecipe": {"dominantAlbedo": "rgba(163, 169, 166, 1)", "secondaryAlbedo": "rgba(163, 169, 166, 1)", "materialClass": "metal", "materialClassConfidence": 0.9, "roughnessRange": [0.3, 0.8], "metalnessRange": [0.7, 0.85], "evidenceRefs": ["full-object"], "notes": "Shared workshop palette requested by user; not pixel sampling."}};
  node_lower_support_9.add(mesh_lower_support_9);
  meshes["lower-support"] = mesh_lower_support_9;
  colliders["lower-support"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["root"] ??= [];
  destructionGroups["root"].push(node_lower_support_9);

  const endpoint_guide_left_10 = makeAttachmentEndpoint(null);
  const node_guide_left_10 = new THREE.Group();
  node_guide_left_10.name = "guide-left__pivot";
  node_guide_left_10.scale.set(1, 1, 1);
  if (endpoint_guide_left_10) {
    node_guide_left_10.position.copy(endpoint_guide_left_10.start);
    node_guide_left_10.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_guide_left_10.position.set(-285.0, 1215.0, 0.0);
    node_guide_left_10.rotation.set(0.0, 0.0, 0.0);
  }
  node_guide_left_10.userData.sculptComponent = {"id": "guide-left", "name": "guide-left", "level": "meso", "role": "guide-left", "importance": 1, "confidence": 0.5, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Discrete rigid mechanical part with flat faces or circular section.", "geometryDescriptor": {"notes": "Dimensions describe nominal assembly envelope; profile points, repeated placement and physical joints in geometryContract."}, "parent": null, "attachment": null, "dimensions": {"width": 30, "height": 800, "depth": 90, "units": "mm", "confidence": 1}, "transform": {"position": [-285, 1215, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "base"}}, "material": "steel", "materialLayers": ["steel"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "identity", "type": "geometry", "description": "Reference guide-left silhouette/response", "evidenceRefs": ["full-object"]}], "surfaceDetail": {"macroRoughness": 0, "microRoughness": 0, "bumpAmplitude": 0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object", "full-object"], "details": [], "fidelityTier": "structural", "parentId": null, "colorMaterialRecipe": {"dominantAlbedo": "rgba(163, 169, 166, 1)", "secondaryAlbedo": "rgba(163, 169, 166, 1)", "materialClass": "metal", "materialClassConfidence": 0.9, "roughnessRange": [0.3, 0.8], "metalnessRange": [0.7, 0.85], "evidenceRefs": ["full-object"], "notes": "Shared workshop palette requested by user; not pixel sampling."}};
  node_guide_left_10.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "base"}};
  (nodes["root"] ?? root).add(node_guide_left_10);
  nodes["guide-left"] = node_guide_left_10;
  const mesh_guide_left_10Geometry = endpoint_guide_left_10
    ? new THREE.CylinderGeometry(endpoint_guide_left_10.endRadius, endpoint_guide_left_10.baseRadius, endpoint_guide_left_10.length, 8, 4)
    : new THREE.BoxGeometry(1, 1, 1, 1, 1, 1);
  if (!endpoint_guide_left_10) {
    mesh_guide_left_10Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_guide_left_10 = new THREE.Mesh(
    mesh_guide_left_10Geometry,
    materialMap["steel"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_guide_left_10.name = "guide-left";
  if (endpoint_guide_left_10) {
    mesh_guide_left_10.position.copy(endpoint_guide_left_10.midpoint);
    mesh_guide_left_10.quaternion.copy(endpoint_guide_left_10.quaternion);
  }
  mesh_guide_left_10.castShadow = options.castShadow ?? true;
  mesh_guide_left_10.receiveShadow = options.receiveShadow ?? true;
  mesh_guide_left_10.userData.sculptComponent = {"id": "guide-left", "name": "guide-left", "level": "meso", "role": "guide-left", "importance": 1, "confidence": 0.5, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Discrete rigid mechanical part with flat faces or circular section.", "geometryDescriptor": {"notes": "Dimensions describe nominal assembly envelope; profile points, repeated placement and physical joints in geometryContract."}, "parent": null, "attachment": null, "dimensions": {"width": 30, "height": 800, "depth": 90, "units": "mm", "confidence": 1}, "transform": {"position": [-285, 1215, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "base"}}, "material": "steel", "materialLayers": ["steel"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "identity", "type": "geometry", "description": "Reference guide-left silhouette/response", "evidenceRefs": ["full-object"]}], "surfaceDetail": {"macroRoughness": 0, "microRoughness": 0, "bumpAmplitude": 0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object", "full-object"], "details": [], "fidelityTier": "structural", "parentId": null, "colorMaterialRecipe": {"dominantAlbedo": "rgba(163, 169, 166, 1)", "secondaryAlbedo": "rgba(163, 169, 166, 1)", "materialClass": "metal", "materialClassConfidence": 0.9, "roughnessRange": [0.3, 0.8], "metalnessRange": [0.7, 0.85], "evidenceRefs": ["full-object"], "notes": "Shared workshop palette requested by user; not pixel sampling."}};
  node_guide_left_10.add(mesh_guide_left_10);
  meshes["guide-left"] = mesh_guide_left_10;
  colliders["guide-left"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["root"] ??= [];
  destructionGroups["root"].push(node_guide_left_10);

  const endpoint_guide_right_11 = makeAttachmentEndpoint(null);
  const node_guide_right_11 = new THREE.Group();
  node_guide_right_11.name = "guide-right__pivot";
  node_guide_right_11.scale.set(1, 1, 1);
  if (endpoint_guide_right_11) {
    node_guide_right_11.position.copy(endpoint_guide_right_11.start);
    node_guide_right_11.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_guide_right_11.position.set(285.0, 1215.0, 0.0);
    node_guide_right_11.rotation.set(0.0, 0.0, 0.0);
  }
  node_guide_right_11.userData.sculptComponent = {"id": "guide-right", "name": "guide-right", "level": "meso", "role": "guide-right", "importance": 1, "confidence": 0.5, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Discrete rigid mechanical part with flat faces or circular section.", "geometryDescriptor": {"notes": "Dimensions describe nominal assembly envelope; profile points, repeated placement and physical joints in geometryContract."}, "parent": null, "attachment": null, "dimensions": {"width": 30, "height": 800, "depth": 90, "units": "mm", "confidence": 1}, "transform": {"position": [285, 1215, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "base"}}, "material": "steel", "materialLayers": ["steel"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0, "microRoughness": 0, "bumpAmplitude": 0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object", "full-object"], "details": [], "fidelityTier": "structural", "parentId": null, "colorMaterialRecipe": {"dominantAlbedo": "rgba(163, 169, 166, 1)", "secondaryAlbedo": "rgba(163, 169, 166, 1)", "materialClass": "metal", "materialClassConfidence": 0.9, "roughnessRange": [0.3, 0.8], "metalnessRange": [0.7, 0.85], "evidenceRefs": ["full-object"], "notes": "Shared workshop palette requested by user; not pixel sampling."}};
  node_guide_right_11.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "base"}};
  (nodes["root"] ?? root).add(node_guide_right_11);
  nodes["guide-right"] = node_guide_right_11;
  const mesh_guide_right_11Geometry = endpoint_guide_right_11
    ? new THREE.CylinderGeometry(endpoint_guide_right_11.endRadius, endpoint_guide_right_11.baseRadius, endpoint_guide_right_11.length, 8, 4)
    : new THREE.BoxGeometry(1, 1, 1, 1, 1, 1);
  if (!endpoint_guide_right_11) {
    mesh_guide_right_11Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_guide_right_11 = new THREE.Mesh(
    mesh_guide_right_11Geometry,
    materialMap["steel"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_guide_right_11.name = "guide-right";
  if (endpoint_guide_right_11) {
    mesh_guide_right_11.position.copy(endpoint_guide_right_11.midpoint);
    mesh_guide_right_11.quaternion.copy(endpoint_guide_right_11.quaternion);
  }
  mesh_guide_right_11.castShadow = options.castShadow ?? true;
  mesh_guide_right_11.receiveShadow = options.receiveShadow ?? true;
  mesh_guide_right_11.userData.sculptComponent = {"id": "guide-right", "name": "guide-right", "level": "meso", "role": "guide-right", "importance": 1, "confidence": 0.5, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Discrete rigid mechanical part with flat faces or circular section.", "geometryDescriptor": {"notes": "Dimensions describe nominal assembly envelope; profile points, repeated placement and physical joints in geometryContract."}, "parent": null, "attachment": null, "dimensions": {"width": 30, "height": 800, "depth": 90, "units": "mm", "confidence": 1}, "transform": {"position": [285, 1215, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "base"}}, "material": "steel", "materialLayers": ["steel"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0, "microRoughness": 0, "bumpAmplitude": 0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object", "full-object"], "details": [], "fidelityTier": "structural", "parentId": null, "colorMaterialRecipe": {"dominantAlbedo": "rgba(163, 169, 166, 1)", "secondaryAlbedo": "rgba(163, 169, 166, 1)", "materialClass": "metal", "materialClassConfidence": 0.9, "roughnessRange": [0.3, 0.8], "metalnessRange": [0.7, 0.85], "evidenceRefs": ["full-object"], "notes": "Shared workshop palette requested by user; not pixel sampling."}};
  node_guide_right_11.add(mesh_guide_right_11);
  meshes["guide-right"] = mesh_guide_right_11;
  colliders["guide-right"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["root"] ??= [];
  destructionGroups["root"].push(node_guide_right_11);

  const endpoint_shoe_left_12 = makeAttachmentEndpoint(null);
  const node_shoe_left_12 = new THREE.Group();
  node_shoe_left_12.name = "shoe-left__pivot";
  node_shoe_left_12.scale.set(1, 1, 1);
  if (endpoint_shoe_left_12) {
    node_shoe_left_12.position.copy(endpoint_shoe_left_12.start);
    node_shoe_left_12.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_shoe_left_12.position.set(-290.0, 1200.0, 0.0);
    node_shoe_left_12.rotation.set(0.0, 0.0, 0.0);
  }
  node_shoe_left_12.userData.sculptComponent = {"id": "shoe-left", "name": "shoe-left", "level": "meso", "role": "shoe-left", "importance": 1, "confidence": 0.5, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Discrete rigid mechanical part with flat faces or circular section.", "geometryDescriptor": {"notes": "Dimensions describe nominal assembly envelope; profile points, repeated placement and physical joints in geometryContract."}, "parent": null, "attachment": null, "dimensions": {"width": 80, "height": 200, "depth": 135, "units": "mm", "confidence": 1}, "transform": {"position": [-290, 1200, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "rigid-moving", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "base"}}, "material": "iron", "materialLayers": ["iron"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0, "microRoughness": 0, "bumpAmplitude": 0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object", "full-object"], "details": [], "fidelityTier": "structural", "parentId": null, "colorMaterialRecipe": {"dominantAlbedo": "rgba(85, 95, 96, 1)", "secondaryAlbedo": "rgba(85, 95, 96, 1)", "materialClass": "metal", "materialClassConfidence": 0.9, "roughnessRange": [0.3, 0.8], "metalnessRange": [0.7, 0.85], "evidenceRefs": ["full-object"], "notes": "Shared workshop palette requested by user; not pixel sampling."}};
  node_shoe_left_12.userData.actionProfile = {"animationRole": "rigid-moving", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "base"}};
  (nodes["root"] ?? root).add(node_shoe_left_12);
  nodes["shoe-left"] = node_shoe_left_12;
  const mesh_shoe_left_12Geometry = endpoint_shoe_left_12
    ? new THREE.CylinderGeometry(endpoint_shoe_left_12.endRadius, endpoint_shoe_left_12.baseRadius, endpoint_shoe_left_12.length, 8, 4)
    : new THREE.BoxGeometry(1, 1, 1, 1, 1, 1);
  if (!endpoint_shoe_left_12) {
    mesh_shoe_left_12Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_shoe_left_12 = new THREE.Mesh(
    mesh_shoe_left_12Geometry,
    materialMap["iron"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_shoe_left_12.name = "shoe-left";
  if (endpoint_shoe_left_12) {
    mesh_shoe_left_12.position.copy(endpoint_shoe_left_12.midpoint);
    mesh_shoe_left_12.quaternion.copy(endpoint_shoe_left_12.quaternion);
  }
  mesh_shoe_left_12.castShadow = options.castShadow ?? true;
  mesh_shoe_left_12.receiveShadow = options.receiveShadow ?? true;
  mesh_shoe_left_12.userData.sculptComponent = {"id": "shoe-left", "name": "shoe-left", "level": "meso", "role": "shoe-left", "importance": 1, "confidence": 0.5, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Discrete rigid mechanical part with flat faces or circular section.", "geometryDescriptor": {"notes": "Dimensions describe nominal assembly envelope; profile points, repeated placement and physical joints in geometryContract."}, "parent": null, "attachment": null, "dimensions": {"width": 80, "height": 200, "depth": 135, "units": "mm", "confidence": 1}, "transform": {"position": [-290, 1200, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "rigid-moving", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "base"}}, "material": "iron", "materialLayers": ["iron"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0, "microRoughness": 0, "bumpAmplitude": 0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object", "full-object"], "details": [], "fidelityTier": "structural", "parentId": null, "colorMaterialRecipe": {"dominantAlbedo": "rgba(85, 95, 96, 1)", "secondaryAlbedo": "rgba(85, 95, 96, 1)", "materialClass": "metal", "materialClassConfidence": 0.9, "roughnessRange": [0.3, 0.8], "metalnessRange": [0.7, 0.85], "evidenceRefs": ["full-object"], "notes": "Shared workshop palette requested by user; not pixel sampling."}};
  node_shoe_left_12.add(mesh_shoe_left_12);
  meshes["shoe-left"] = mesh_shoe_left_12;
  colliders["shoe-left"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["root"] ??= [];
  destructionGroups["root"].push(node_shoe_left_12);

  const endpoint_shoe_right_13 = makeAttachmentEndpoint(null);
  const node_shoe_right_13 = new THREE.Group();
  node_shoe_right_13.name = "shoe-right__pivot";
  node_shoe_right_13.scale.set(1, 1, 1);
  if (endpoint_shoe_right_13) {
    node_shoe_right_13.position.copy(endpoint_shoe_right_13.start);
    node_shoe_right_13.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_shoe_right_13.position.set(290.0, 1200.0, 0.0);
    node_shoe_right_13.rotation.set(0.0, 0.0, 0.0);
  }
  node_shoe_right_13.userData.sculptComponent = {"id": "shoe-right", "name": "shoe-right", "level": "meso", "role": "shoe-right", "importance": 1, "confidence": 0.5, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Discrete rigid mechanical part with flat faces or circular section.", "geometryDescriptor": {"notes": "Dimensions describe nominal assembly envelope; profile points, repeated placement and physical joints in geometryContract."}, "parent": null, "attachment": null, "dimensions": {"width": 80, "height": 200, "depth": 135, "units": "mm", "confidence": 1}, "transform": {"position": [290, 1200, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "rigid-moving", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "base"}}, "material": "iron", "materialLayers": ["iron"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0, "microRoughness": 0, "bumpAmplitude": 0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object", "full-object"], "details": [], "fidelityTier": "structural", "parentId": null, "colorMaterialRecipe": {"dominantAlbedo": "rgba(85, 95, 96, 1)", "secondaryAlbedo": "rgba(85, 95, 96, 1)", "materialClass": "metal", "materialClassConfidence": 0.9, "roughnessRange": [0.3, 0.8], "metalnessRange": [0.7, 0.85], "evidenceRefs": ["full-object"], "notes": "Shared workshop palette requested by user; not pixel sampling."}};
  node_shoe_right_13.userData.actionProfile = {"animationRole": "rigid-moving", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "base"}};
  (nodes["root"] ?? root).add(node_shoe_right_13);
  nodes["shoe-right"] = node_shoe_right_13;
  const mesh_shoe_right_13Geometry = endpoint_shoe_right_13
    ? new THREE.CylinderGeometry(endpoint_shoe_right_13.endRadius, endpoint_shoe_right_13.baseRadius, endpoint_shoe_right_13.length, 8, 4)
    : new THREE.BoxGeometry(1, 1, 1, 1, 1, 1);
  if (!endpoint_shoe_right_13) {
    mesh_shoe_right_13Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_shoe_right_13 = new THREE.Mesh(
    mesh_shoe_right_13Geometry,
    materialMap["iron"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_shoe_right_13.name = "shoe-right";
  if (endpoint_shoe_right_13) {
    mesh_shoe_right_13.position.copy(endpoint_shoe_right_13.midpoint);
    mesh_shoe_right_13.quaternion.copy(endpoint_shoe_right_13.quaternion);
  }
  mesh_shoe_right_13.castShadow = options.castShadow ?? true;
  mesh_shoe_right_13.receiveShadow = options.receiveShadow ?? true;
  mesh_shoe_right_13.userData.sculptComponent = {"id": "shoe-right", "name": "shoe-right", "level": "meso", "role": "shoe-right", "importance": 1, "confidence": 0.5, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Discrete rigid mechanical part with flat faces or circular section.", "geometryDescriptor": {"notes": "Dimensions describe nominal assembly envelope; profile points, repeated placement and physical joints in geometryContract."}, "parent": null, "attachment": null, "dimensions": {"width": 80, "height": 200, "depth": 135, "units": "mm", "confidence": 1}, "transform": {"position": [290, 1200, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "rigid-moving", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "base"}}, "material": "iron", "materialLayers": ["iron"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0, "microRoughness": 0, "bumpAmplitude": 0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object", "full-object"], "details": [], "fidelityTier": "structural", "parentId": null, "colorMaterialRecipe": {"dominantAlbedo": "rgba(85, 95, 96, 1)", "secondaryAlbedo": "rgba(85, 95, 96, 1)", "materialClass": "metal", "materialClassConfidence": 0.9, "roughnessRange": [0.3, 0.8], "metalnessRange": [0.7, 0.85], "evidenceRefs": ["full-object"], "notes": "Shared workshop palette requested by user; not pixel sampling."}};
  node_shoe_right_13.add(mesh_shoe_right_13);
  meshes["shoe-right"] = mesh_shoe_right_13;
  colliders["shoe-right"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["root"] ??= [];
  destructionGroups["root"].push(node_shoe_right_13);

  const attachment_gauge_14 = null;
  const endpoint_gauge_14 = makeAttachmentEndpoint(attachment_gauge_14);
  const node_gauge_14 = new THREE.Group();
  node_gauge_14.name = "gauge__pivot";
  node_gauge_14.scale.set(1, 1, 1);
  if (endpoint_gauge_14) {
    node_gauge_14.position.copy(endpoint_gauge_14.start);
    node_gauge_14.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_gauge_14.position.set(470.0, 1420.0, 90.0);
    node_gauge_14.rotation.set(0.0, 0.0, 0.0);
  }
  node_gauge_14.userData.sculptComponent = {"id": "gauge", "name": "gauge", "level": "meso", "role": "gauge", "importance": 1, "confidence": 0.5, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Discrete rigid mechanical part with flat faces or circular section.", "geometryDescriptor": {"notes": "Dimensions describe nominal assembly envelope; profile points, repeated placement and physical joints in geometryContract."}, "parent": null, "attachment": null, "dimensions": {"width": 120, "height": 28, "depth": 120, "units": "mm", "confidence": 1}, "transform": {"position": [470, 1420, 90], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "base"}}, "material": "brass", "materialLayers": ["brass"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "identity", "type": "geometry", "description": "Reference gauge silhouette/response", "evidenceRefs": ["full-object"]}], "surfaceDetail": {"macroRoughness": 0, "microRoughness": 0, "bumpAmplitude": 0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object", "full-object"], "details": [], "fidelityTier": "structural", "parentId": null, "colorMaterialRecipe": {"dominantAlbedo": "rgba(181, 151, 85, 1)", "secondaryAlbedo": "rgba(181, 151, 85, 1)", "materialClass": "metal", "materialClassConfidence": 0.9, "roughnessRange": [0.3, 0.8], "metalnessRange": [0.7, 0.85], "evidenceRefs": ["full-object"], "notes": "Shared workshop palette requested by user; not pixel sampling."}};
  node_gauge_14.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "base"}};
  (nodes["root"] ?? root).add(node_gauge_14);
  nodes["gauge"] = node_gauge_14;
  const mesh_gauge_14Geometry = endpoint_gauge_14
    ? new THREE.CylinderGeometry(endpoint_gauge_14.endRadius, endpoint_gauge_14.baseRadius, endpoint_gauge_14.length, 8, 4)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 10, 4);
  if (!endpoint_gauge_14) {
    mesh_gauge_14Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_gauge_14 = new THREE.Mesh(
    mesh_gauge_14Geometry,
    materialMap["brass"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_gauge_14.name = "gauge";
  if (endpoint_gauge_14) {
    mesh_gauge_14.position.copy(endpoint_gauge_14.midpoint);
    mesh_gauge_14.quaternion.copy(endpoint_gauge_14.quaternion);
  }
  mesh_gauge_14.castShadow = options.castShadow ?? true;
  mesh_gauge_14.receiveShadow = options.receiveShadow ?? true;
  mesh_gauge_14.userData.sculptComponent = {"id": "gauge", "name": "gauge", "level": "meso", "role": "gauge", "importance": 1, "confidence": 0.5, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Discrete rigid mechanical part with flat faces or circular section.", "geometryDescriptor": {"notes": "Dimensions describe nominal assembly envelope; profile points, repeated placement and physical joints in geometryContract."}, "parent": null, "attachment": null, "dimensions": {"width": 120, "height": 28, "depth": 120, "units": "mm", "confidence": 1}, "transform": {"position": [470, 1420, 90], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "base"}}, "material": "brass", "materialLayers": ["brass"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "identity", "type": "geometry", "description": "Reference gauge silhouette/response", "evidenceRefs": ["full-object"]}], "surfaceDetail": {"macroRoughness": 0, "microRoughness": 0, "bumpAmplitude": 0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object", "full-object"], "details": [], "fidelityTier": "structural", "parentId": null, "colorMaterialRecipe": {"dominantAlbedo": "rgba(181, 151, 85, 1)", "secondaryAlbedo": "rgba(181, 151, 85, 1)", "materialClass": "metal", "materialClassConfidence": 0.9, "roughnessRange": [0.3, 0.8], "metalnessRange": [0.7, 0.85], "evidenceRefs": ["full-object"], "notes": "Shared workshop palette requested by user; not pixel sampling."}};
  node_gauge_14.add(mesh_gauge_14);
  meshes["gauge"] = mesh_gauge_14;
  colliders["gauge"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["root"] ??= [];
  destructionGroups["root"].push(node_gauge_14);

  const attachment_lever_15 = null;
  const endpoint_lever_15 = makeAttachmentEndpoint(attachment_lever_15);
  const node_lever_15 = new THREE.Group();
  node_lever_15.name = "lever__pivot";
  node_lever_15.scale.set(1, 1, 1);
  if (endpoint_lever_15) {
    node_lever_15.position.copy(endpoint_lever_15.start);
    node_lever_15.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_lever_15.position.set(476.0, 1200.0, 100.0);
    node_lever_15.rotation.set(0.0, 0.0, 0.0);
  }
  node_lever_15.userData.sculptComponent = {"id": "lever", "name": "lever", "level": "meso", "role": "lever", "importance": 1, "confidence": 0.5, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Discrete rigid mechanical part with flat faces or circular section.", "geometryDescriptor": {"notes": "Dimensions describe nominal assembly envelope; profile points, repeated placement and physical joints in geometryContract."}, "parent": null, "attachment": null, "dimensions": {"width": 22, "height": 185, "depth": 22, "units": "mm", "confidence": 1}, "transform": {"position": [476, 1200, 100], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "base"}}, "material": "brass", "materialLayers": ["brass"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "identity", "type": "geometry", "description": "Reference lever silhouette/response", "evidenceRefs": ["full-object"]}], "surfaceDetail": {"macroRoughness": 0, "microRoughness": 0, "bumpAmplitude": 0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object", "full-object"], "details": [], "fidelityTier": "structural", "parentId": null, "colorMaterialRecipe": {"dominantAlbedo": "rgba(181, 151, 85, 1)", "secondaryAlbedo": "rgba(181, 151, 85, 1)", "materialClass": "metal", "materialClassConfidence": 0.9, "roughnessRange": [0.3, 0.8], "metalnessRange": [0.7, 0.85], "evidenceRefs": ["full-object"], "notes": "Shared workshop palette requested by user; not pixel sampling."}};
  node_lever_15.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "base"}};
  (nodes["root"] ?? root).add(node_lever_15);
  nodes["lever"] = node_lever_15;
  const mesh_lever_15Geometry = endpoint_lever_15
    ? new THREE.CylinderGeometry(endpoint_lever_15.endRadius, endpoint_lever_15.baseRadius, endpoint_lever_15.length, 8, 4)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 10, 4);
  if (!endpoint_lever_15) {
    mesh_lever_15Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_lever_15 = new THREE.Mesh(
    mesh_lever_15Geometry,
    materialMap["brass"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_lever_15.name = "lever";
  if (endpoint_lever_15) {
    mesh_lever_15.position.copy(endpoint_lever_15.midpoint);
    mesh_lever_15.quaternion.copy(endpoint_lever_15.quaternion);
  }
  mesh_lever_15.castShadow = options.castShadow ?? true;
  mesh_lever_15.receiveShadow = options.receiveShadow ?? true;
  mesh_lever_15.userData.sculptComponent = {"id": "lever", "name": "lever", "level": "meso", "role": "lever", "importance": 1, "confidence": 0.5, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Discrete rigid mechanical part with flat faces or circular section.", "geometryDescriptor": {"notes": "Dimensions describe nominal assembly envelope; profile points, repeated placement and physical joints in geometryContract."}, "parent": null, "attachment": null, "dimensions": {"width": 22, "height": 185, "depth": 22, "units": "mm", "confidence": 1}, "transform": {"position": [476, 1200, 100], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "base"}}, "material": "brass", "materialLayers": ["brass"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "identity", "type": "geometry", "description": "Reference lever silhouette/response", "evidenceRefs": ["full-object"]}], "surfaceDetail": {"macroRoughness": 0, "microRoughness": 0, "bumpAmplitude": 0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object", "full-object"], "details": [], "fidelityTier": "structural", "parentId": null, "colorMaterialRecipe": {"dominantAlbedo": "rgba(181, 151, 85, 1)", "secondaryAlbedo": "rgba(181, 151, 85, 1)", "materialClass": "metal", "materialClassConfidence": 0.9, "roughnessRange": [0.3, 0.8], "metalnessRange": [0.7, 0.85], "evidenceRefs": ["full-object"], "notes": "Shared workshop palette requested by user; not pixel sampling."}};
  node_lever_15.add(mesh_lever_15);
  meshes["lever"] = mesh_lever_15;
  colliders["lever"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["root"] ??= [];
  destructionGroups["root"].push(node_lever_15);

  const endpoint_foot_braces_16 = makeAttachmentEndpoint(null);
  const node_foot_braces_16 = new THREE.Group();
  node_foot_braces_16.name = "foot-braces__pivot";
  node_foot_braces_16.scale.set(1, 1, 1);
  if (endpoint_foot_braces_16) {
    node_foot_braces_16.position.copy(endpoint_foot_braces_16.start);
    node_foot_braces_16.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_foot_braces_16.position.set(0.0, 255.0, 0.0);
    node_foot_braces_16.rotation.set(0.0, 0.0, 0.0);
  }
  node_foot_braces_16.userData.sculptComponent = {"id": "foot-braces", "name": "foot-braces", "level": "meso", "role": "foot-braces", "importance": 1, "confidence": 0.5, "primitive": "extrude", "topologyClass": "assembled-solid", "topologyRationale": "Connected cast profile with planar faces and explicitly open negative space.", "geometryDescriptor": {"notes": "Dimensions describe nominal assembly envelope; profile points, repeated placement and physical joints in geometryContract."}, "parent": null, "attachment": null, "dimensions": {"width": 130, "height": 310, "depth": 205, "units": "mm", "confidence": 1}, "transform": {"position": [0, 255, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "base"}}, "material": "iron", "materialLayers": ["iron"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "identity", "type": "geometry", "description": "Reference foot-braces silhouette/response", "evidenceRefs": ["full-object"]}], "surfaceDetail": {"macroRoughness": 0, "microRoughness": 0, "bumpAmplitude": 0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object", "full-object"], "details": [], "fidelityTier": "structural", "parentId": null, "colorMaterialRecipe": {"dominantAlbedo": "rgba(85, 95, 96, 1)", "secondaryAlbedo": "rgba(85, 95, 96, 1)", "materialClass": "metal", "materialClassConfidence": 0.9, "roughnessRange": [0.3, 0.8], "metalnessRange": [0.7, 0.85], "evidenceRefs": ["full-object"], "notes": "Shared workshop palette requested by user; not pixel sampling."}};
  node_foot_braces_16.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "base"}};
  (nodes["root"] ?? root).add(node_foot_braces_16);
  nodes["foot-braces"] = node_foot_braces_16;
  const mesh_foot_braces_16Geometry = endpoint_foot_braces_16
    ? new THREE.CylinderGeometry(endpoint_foot_braces_16.endRadius, endpoint_foot_braces_16.baseRadius, endpoint_foot_braces_16.length, 8, 4)
    : buildExtrudeGeometry({"points": [[-0.3, -0.3], [0.3, -0.3], [0.3, 0.3], [-0.3, 0.3]], "depth": 0.1});
  if (!endpoint_foot_braces_16) {
    mesh_foot_braces_16Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_foot_braces_16 = new THREE.Mesh(
    mesh_foot_braces_16Geometry,
    materialMap["iron"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_foot_braces_16.name = "foot-braces";
  if (endpoint_foot_braces_16) {
    mesh_foot_braces_16.position.copy(endpoint_foot_braces_16.midpoint);
    mesh_foot_braces_16.quaternion.copy(endpoint_foot_braces_16.quaternion);
  }
  mesh_foot_braces_16.castShadow = options.castShadow ?? true;
  mesh_foot_braces_16.receiveShadow = options.receiveShadow ?? true;
  mesh_foot_braces_16.userData.sculptComponent = {"id": "foot-braces", "name": "foot-braces", "level": "meso", "role": "foot-braces", "importance": 1, "confidence": 0.5, "primitive": "extrude", "topologyClass": "assembled-solid", "topologyRationale": "Connected cast profile with planar faces and explicitly open negative space.", "geometryDescriptor": {"notes": "Dimensions describe nominal assembly envelope; profile points, repeated placement and physical joints in geometryContract."}, "parent": null, "attachment": null, "dimensions": {"width": 130, "height": 310, "depth": 205, "units": "mm", "confidence": 1}, "transform": {"position": [0, 255, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "base"}}, "material": "iron", "materialLayers": ["iron"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "identity", "type": "geometry", "description": "Reference foot-braces silhouette/response", "evidenceRefs": ["full-object"]}], "surfaceDetail": {"macroRoughness": 0, "microRoughness": 0, "bumpAmplitude": 0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object", "full-object"], "details": [], "fidelityTier": "structural", "parentId": null, "colorMaterialRecipe": {"dominantAlbedo": "rgba(85, 95, 96, 1)", "secondaryAlbedo": "rgba(85, 95, 96, 1)", "materialClass": "metal", "materialClassConfidence": 0.9, "roughnessRange": [0.3, 0.8], "metalnessRange": [0.7, 0.85], "evidenceRefs": ["full-object"], "notes": "Shared workshop palette requested by user; not pixel sampling."}};
  node_foot_braces_16.add(mesh_foot_braces_16);
  meshes["foot-braces"] = mesh_foot_braces_16;
  colliders["foot-braces"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["root"] ??= [];
  destructionGroups["root"].push(node_foot_braces_16);

  const endpoint_service_panel_17 = makeAttachmentEndpoint(null);
  const node_service_panel_17 = new THREE.Group();
  node_service_panel_17.name = "service-panel__pivot";
  node_service_panel_17.scale.set(1, 1, 1);
  if (endpoint_service_panel_17) {
    node_service_panel_17.position.copy(endpoint_service_panel_17.start);
    node_service_panel_17.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_service_panel_17.position.set(462.0, 885.0, -5.0);
    node_service_panel_17.rotation.set(0.0, 0.0, 0.0);
  }
  node_service_panel_17.userData.sculptComponent = {"id": "service-panel", "name": "service-panel", "level": "meso", "role": "service-panel", "importance": 1, "confidence": 0.5, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Discrete rigid mechanical part with flat faces or circular section.", "geometryDescriptor": {"notes": "Dimensions describe nominal assembly envelope; profile points, repeated placement and physical joints in geometryContract."}, "parent": null, "attachment": null, "dimensions": {"width": 14, "height": 310, "depth": 245, "units": "mm", "confidence": 1}, "transform": {"position": [462, 885, -5], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "base"}}, "material": "iron", "materialLayers": ["iron"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0, "microRoughness": 0, "bumpAmplitude": 0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object", "full-object"], "details": [], "fidelityTier": "structural", "parentId": null, "colorMaterialRecipe": {"dominantAlbedo": "rgba(85, 95, 96, 1)", "secondaryAlbedo": "rgba(85, 95, 96, 1)", "materialClass": "metal", "materialClassConfidence": 0.9, "roughnessRange": [0.3, 0.8], "metalnessRange": [0.7, 0.85], "evidenceRefs": ["full-object"], "notes": "Shared workshop palette requested by user; not pixel sampling."}};
  node_service_panel_17.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "base"}};
  (nodes["root"] ?? root).add(node_service_panel_17);
  nodes["service-panel"] = node_service_panel_17;
  const mesh_service_panel_17Geometry = endpoint_service_panel_17
    ? new THREE.CylinderGeometry(endpoint_service_panel_17.endRadius, endpoint_service_panel_17.baseRadius, endpoint_service_panel_17.length, 8, 4)
    : new THREE.BoxGeometry(1, 1, 1, 1, 1, 1);
  if (!endpoint_service_panel_17) {
    mesh_service_panel_17Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_service_panel_17 = new THREE.Mesh(
    mesh_service_panel_17Geometry,
    materialMap["iron"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_service_panel_17.name = "service-panel";
  if (endpoint_service_panel_17) {
    mesh_service_panel_17.position.copy(endpoint_service_panel_17.midpoint);
    mesh_service_panel_17.quaternion.copy(endpoint_service_panel_17.quaternion);
  }
  mesh_service_panel_17.castShadow = options.castShadow ?? true;
  mesh_service_panel_17.receiveShadow = options.receiveShadow ?? true;
  mesh_service_panel_17.userData.sculptComponent = {"id": "service-panel", "name": "service-panel", "level": "meso", "role": "service-panel", "importance": 1, "confidence": 0.5, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Discrete rigid mechanical part with flat faces or circular section.", "geometryDescriptor": {"notes": "Dimensions describe nominal assembly envelope; profile points, repeated placement and physical joints in geometryContract."}, "parent": null, "attachment": null, "dimensions": {"width": 14, "height": 310, "depth": 245, "units": "mm", "confidence": 1}, "transform": {"position": [462, 885, -5], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "base"}}, "material": "iron", "materialLayers": ["iron"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0, "microRoughness": 0, "bumpAmplitude": 0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object", "full-object"], "details": [], "fidelityTier": "structural", "parentId": null, "colorMaterialRecipe": {"dominantAlbedo": "rgba(85, 95, 96, 1)", "secondaryAlbedo": "rgba(85, 95, 96, 1)", "materialClass": "metal", "materialClassConfidence": 0.9, "roughnessRange": [0.3, 0.8], "metalnessRange": [0.7, 0.85], "evidenceRefs": ["full-object"], "notes": "Shared workshop palette requested by user; not pixel sampling."}};
  node_service_panel_17.add(mesh_service_panel_17);
  meshes["service-panel"] = mesh_service_panel_17;
  colliders["service-panel"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["root"] ??= [];
  destructionGroups["root"].push(node_service_panel_17);

  const attachment_cap_fasteners_18 = null;
  const endpoint_cap_fasteners_18 = makeAttachmentEndpoint(attachment_cap_fasteners_18);
  const node_cap_fasteners_18 = new THREE.Group();
  node_cap_fasteners_18.name = "cap-fasteners__pivot";
  node_cap_fasteners_18.scale.set(1, 1, 1);
  if (endpoint_cap_fasteners_18) {
    node_cap_fasteners_18.position.copy(endpoint_cap_fasteners_18.start);
    node_cap_fasteners_18.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_cap_fasteners_18.position.set(0.0, 1860.0, 0.0);
    node_cap_fasteners_18.rotation.set(0.0, 0.0, 0.0);
  }
  node_cap_fasteners_18.userData.sculptComponent = {"id": "cap-fasteners", "name": "cap-fasteners", "level": "micro", "role": "cap-fasteners", "importance": 1, "confidence": 0.5, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Discrete rigid mechanical part with flat faces or circular section.", "geometryDescriptor": {"notes": "Dimensions describe nominal assembly envelope; profile points, repeated placement and physical joints in geometryContract."}, "parent": null, "attachment": null, "dimensions": {"width": 34, "height": 20, "depth": 34, "units": "mm", "confidence": 1}, "transform": {"position": [0, 1860, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "base"}}, "material": "steel", "materialLayers": ["steel"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "identity", "type": "geometry", "description": "Reference cap-fasteners silhouette/response", "evidenceRefs": ["full-object"]}], "surfaceDetail": {"macroRoughness": 0, "microRoughness": 0, "bumpAmplitude": 0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object", "full-object"], "details": [], "fidelityTier": "structural", "parentId": null, "colorMaterialRecipe": {"dominantAlbedo": "rgba(163, 169, 166, 1)", "secondaryAlbedo": "rgba(163, 169, 166, 1)", "materialClass": "metal", "materialClassConfidence": 0.9, "roughnessRange": [0.3, 0.8], "metalnessRange": [0.7, 0.85], "evidenceRefs": ["full-object"], "notes": "Shared workshop palette requested by user; not pixel sampling."}};
  node_cap_fasteners_18.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "base"}};
  (nodes["root"] ?? root).add(node_cap_fasteners_18);
  nodes["cap-fasteners"] = node_cap_fasteners_18;
  const mesh_cap_fasteners_18Geometry = endpoint_cap_fasteners_18
    ? new THREE.CylinderGeometry(endpoint_cap_fasteners_18.endRadius, endpoint_cap_fasteners_18.baseRadius, endpoint_cap_fasteners_18.length, 8, 4)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 10, 4);
  if (!endpoint_cap_fasteners_18) {
    mesh_cap_fasteners_18Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_cap_fasteners_18 = new THREE.Mesh(
    mesh_cap_fasteners_18Geometry,
    materialMap["steel"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_cap_fasteners_18.name = "cap-fasteners";
  if (endpoint_cap_fasteners_18) {
    mesh_cap_fasteners_18.position.copy(endpoint_cap_fasteners_18.midpoint);
    mesh_cap_fasteners_18.quaternion.copy(endpoint_cap_fasteners_18.quaternion);
  }
  mesh_cap_fasteners_18.castShadow = options.castShadow ?? true;
  mesh_cap_fasteners_18.receiveShadow = options.receiveShadow ?? true;
  mesh_cap_fasteners_18.userData.sculptComponent = {"id": "cap-fasteners", "name": "cap-fasteners", "level": "micro", "role": "cap-fasteners", "importance": 1, "confidence": 0.5, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "Discrete rigid mechanical part with flat faces or circular section.", "geometryDescriptor": {"notes": "Dimensions describe nominal assembly envelope; profile points, repeated placement and physical joints in geometryContract."}, "parent": null, "attachment": null, "dimensions": {"width": 34, "height": 20, "depth": 34, "units": "mm", "confidence": 1}, "transform": {"position": [0, 1860, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "base"}}, "material": "steel", "materialLayers": ["steel"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "identity", "type": "geometry", "description": "Reference cap-fasteners silhouette/response", "evidenceRefs": ["full-object"]}], "surfaceDetail": {"macroRoughness": 0, "microRoughness": 0, "bumpAmplitude": 0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object", "full-object"], "details": [], "fidelityTier": "structural", "parentId": null, "colorMaterialRecipe": {"dominantAlbedo": "rgba(163, 169, 166, 1)", "secondaryAlbedo": "rgba(163, 169, 166, 1)", "materialClass": "metal", "materialClassConfidence": 0.9, "roughnessRange": [0.3, 0.8], "metalnessRange": [0.7, 0.85], "evidenceRefs": ["full-object"], "notes": "Shared workshop palette requested by user; not pixel sampling."}};
  node_cap_fasteners_18.add(mesh_cap_fasteners_18);
  meshes["cap-fasteners"] = mesh_cap_fasteners_18;
  colliders["cap-fasteners"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["root"] ??= [];
  destructionGroups["root"].push(node_cap_fasteners_18);

  const endpoint_dial_marks_19 = makeAttachmentEndpoint(null);
  const node_dial_marks_19 = new THREE.Group();
  node_dial_marks_19.name = "dial-marks__pivot";
  node_dial_marks_19.scale.set(1, 1, 1);
  if (endpoint_dial_marks_19) {
    node_dial_marks_19.position.copy(endpoint_dial_marks_19.start);
    node_dial_marks_19.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_dial_marks_19.position.set(0.0, 0.0, 0.0);
    node_dial_marks_19.rotation.set(0.0, 0.0, 0.0);
  }
  node_dial_marks_19.userData.sculptComponent = {"id": "dial-marks", "name": "dial-marks", "level": "micro", "role": "dial-marks", "importance": 1, "confidence": 0.5, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Discrete rigid mechanical part with flat faces or circular section.", "geometryDescriptor": {"notes": "Dimensions describe nominal assembly envelope; profile points, repeated placement and physical joints in geometryContract."}, "parent": null, "attachment": null, "dimensions": {"width": 4, "height": 12, "depth": 2, "units": "mm", "confidence": 1}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "base"}}, "material": "steel", "materialLayers": ["steel"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0, "microRoughness": 0, "bumpAmplitude": 0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object", "full-object"], "details": [], "fidelityTier": "structural", "parentId": null, "colorMaterialRecipe": {"dominantAlbedo": "rgba(163, 169, 166, 1)", "secondaryAlbedo": "rgba(163, 169, 166, 1)", "materialClass": "metal", "materialClassConfidence": 0.9, "roughnessRange": [0.3, 0.8], "metalnessRange": [0.7, 0.85], "evidenceRefs": ["full-object"], "notes": "Shared workshop palette requested by user; not pixel sampling."}};
  node_dial_marks_19.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "base"}};
  (nodes["root"] ?? root).add(node_dial_marks_19);
  nodes["dial-marks"] = node_dial_marks_19;
  const mesh_dial_marks_19Geometry = endpoint_dial_marks_19
    ? new THREE.CylinderGeometry(endpoint_dial_marks_19.endRadius, endpoint_dial_marks_19.baseRadius, endpoint_dial_marks_19.length, 8, 4)
    : new THREE.BoxGeometry(1, 1, 1, 1, 1, 1);
  if (!endpoint_dial_marks_19) {
    mesh_dial_marks_19Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_dial_marks_19 = new THREE.Mesh(
    mesh_dial_marks_19Geometry,
    materialMap["steel"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_dial_marks_19.name = "dial-marks";
  if (endpoint_dial_marks_19) {
    mesh_dial_marks_19.position.copy(endpoint_dial_marks_19.midpoint);
    mesh_dial_marks_19.quaternion.copy(endpoint_dial_marks_19.quaternion);
  }
  mesh_dial_marks_19.castShadow = options.castShadow ?? true;
  mesh_dial_marks_19.receiveShadow = options.receiveShadow ?? true;
  mesh_dial_marks_19.userData.sculptComponent = {"id": "dial-marks", "name": "dial-marks", "level": "micro", "role": "dial-marks", "importance": 1, "confidence": 0.5, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "Discrete rigid mechanical part with flat faces or circular section.", "geometryDescriptor": {"notes": "Dimensions describe nominal assembly envelope; profile points, repeated placement and physical joints in geometryContract."}, "parent": null, "attachment": null, "dimensions": {"width": 4, "height": 12, "depth": 2, "units": "mm", "confidence": 1}, "transform": {"position": [0, 0, 0], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 1, 0], "confidence": 0.5}, "transformChannels": {"translate": true, "rotate": true, "scale": true, "bend": false, "twist": false, "detach": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "root", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "base"}}, "material": "steel", "materialLayers": ["steel"], "deformations": [], "joints": [], "seams": [], "localFeatures": [], "surfaceDetail": {"macroRoughness": 0, "microRoughness": 0, "bumpAmplitude": 0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["full-object", "full-object"], "details": [], "fidelityTier": "structural", "parentId": null, "colorMaterialRecipe": {"dominantAlbedo": "rgba(163, 169, 166, 1)", "secondaryAlbedo": "rgba(163, 169, 166, 1)", "materialClass": "metal", "materialClassConfidence": 0.9, "roughnessRange": [0.3, 0.8], "metalnessRange": [0.7, 0.85], "evidenceRefs": ["full-object"], "notes": "Shared workshop palette requested by user; not pixel sampling."}};
  node_dial_marks_19.add(mesh_dial_marks_19);
  meshes["dial-marks"] = mesh_dial_marks_19;
  colliders["dial-marks"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false, "notes": "Replace with sphere/capsule/compound proxy when the object shape demands it."};
  destructionGroups["root"] ??= [];
  destructionGroups["root"].push(node_dial_marks_19);

  root.userData.sculptRuntime = { nodes, meshes, sockets, colliders, destructionGroups } satisfies ProceduralModelRuntime;
  root.userData.lookDevTargets = {"qualityPriority": "user-approved-shared-palette", "materialPass": {"albedoPaletteRequired": true, "roughnessVariationRequired": true, "normalOrBumpRequired": true, "localOverridesRequired": true, "minimumTextureResolution": 1024, "preferredTextureResolution": 2048, "independentMapChannels": ["albedo", "roughness", "height", "normal", "ambient-occlusion"], "requiredSurfaceFrequencyBands": ["macro", "meso", "micro"], "geometryReliefRequiredWhenSilhouetteAffected": true, "referencePbrExtraction": {"requiredWhenSourceImagePresent": true, "targetThreshold": 0.7, "stopOnLowConfidence": true, "script": "forge/stage1_intake/extract_pbr_evidence.py", "acceptedLimitation": "single-image extraction is reference-derived inference, not exact photogrammetry"}, "mustAvoid": ["single flat albedo per material", "uniform roughness", "albedo texture reused as roughness/height/normal/AO", "single-frequency random noise", "plastic-looking smooth bark, stone, cloth, foliage, or aged material", "local color/detail described only in prose without material masks", "claiming exact PBR recovery when confidence is below the target threshold"]}, "lightingPass": {"requiredTerms": ["key light", "fill light", "rim or environment light", "exposure", "tone mapping", "background", "contact shadow"], "mustAvoid": ["ambient-only lighting", "flat value range", "missing contact shadow", "reference lighting copied without separating material readability"]}, "screenshotReview": ["Compare albedo palette and local color zones.", "Compare roughness/normal/bump response under light.", "Compare cavity dirt, edge wear, stains, moss, scratches, or other local masks.", "Compare key/fill/rim structure, exposure, tone mapping, background, and contact shadows.", "Capture a neutral-light render to verify material readability without reference lighting.", "Capture a grazing-light close-up to expose flat normals, uniform roughness, tiling, and plastic highlights.", "Capture a reference-matched render from the same camera framing as the source."]};
  root.userData.actionReadiness = {
    note: 'Use root.userData.sculptRuntime.nodes for transforms, sockets for attachments, colliders for physics proxies, and destructionGroups for breakable sets.',
  };
  return root;
}

export function createEarlyIndustrialHydraulicForgePressLookDevLights(
  mode: 'neutral' | 'grazing' | 'reference' = 'neutral',
): THREE.Group {
  const lights = new THREE.Group();
  lights.name = "Early Industrial Hydraulic Forge Press look-dev lights";
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
  lights.userData.lightingFromPhoto = ["Key upper front left, directional white intensity 3; broad top highlights.", "Hemisphere fill gray intensity 1.5 and right fill .8; environment reflections from RoomEnvironment.", "ACES tone mapping exposure1, neutral #d5d6d8 background, ground contact shadow; no baked lighting."];
  lights.userData.lookDevTargets = {"qualityPriority": "user-approved-shared-palette", "materialPass": {"albedoPaletteRequired": true, "roughnessVariationRequired": true, "normalOrBumpRequired": true, "localOverridesRequired": true, "minimumTextureResolution": 1024, "preferredTextureResolution": 2048, "independentMapChannels": ["albedo", "roughness", "height", "normal", "ambient-occlusion"], "requiredSurfaceFrequencyBands": ["macro", "meso", "micro"], "geometryReliefRequiredWhenSilhouetteAffected": true, "referencePbrExtraction": {"requiredWhenSourceImagePresent": true, "targetThreshold": 0.7, "stopOnLowConfidence": true, "script": "forge/stage1_intake/extract_pbr_evidence.py", "acceptedLimitation": "single-image extraction is reference-derived inference, not exact photogrammetry"}, "mustAvoid": ["single flat albedo per material", "uniform roughness", "albedo texture reused as roughness/height/normal/AO", "single-frequency random noise", "plastic-looking smooth bark, stone, cloth, foliage, or aged material", "local color/detail described only in prose without material masks", "claiming exact PBR recovery when confidence is below the target threshold"]}, "lightingPass": {"requiredTerms": ["key light", "fill light", "rim or environment light", "exposure", "tone mapping", "background", "contact shadow"], "mustAvoid": ["ambient-only lighting", "flat value range", "missing contact shadow", "reference lighting copied without separating material readability"]}, "screenshotReview": ["Compare albedo palette and local color zones.", "Compare roughness/normal/bump response under light.", "Compare cavity dirt, edge wear, stains, moss, scratches, or other local masks.", "Compare key/fill/rim structure, exposure, tone mapping, background, and contact shadows.", "Capture a neutral-light render to verify material readability without reference lighting.", "Capture a grazing-light close-up to expose flat normals, uniform roughness, tiling, and plastic highlights.", "Capture a reference-matched render from the same camera framing as the source."]};
  return lights;
}

// PBR materials (clearcoat/iridescence/transmission/anisotropy) need an environment
// map to visually behave as intended — call this once per renderer and assign the
// result to scene.environment before rendering. No external HDR asset required.
export function createEarlyIndustrialHydraulicForgePressEnvironment(renderer: THREE.WebGLRenderer): THREE.Texture {
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
export function frameEarlyIndustrialHydraulicForgePressCamera(
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
export function createEarlyIndustrialHydraulicForgePressPresentationComposer(
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

export function configureEarlyIndustrialHydraulicForgePressRenderer(renderer: THREE.WebGLRenderer): void {
  // Load-bearing for view-dependent finishes (anodized / Doppler): without ACES + sRGB
  // the environment reflection reads flat/washed instead of a believable metal response.
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
}

export function createEarlyIndustrialHydraulicForgePressInspectControls(
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
