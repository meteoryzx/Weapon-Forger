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

// Generated from ObjectSculptSpec target: manual vertical belt grinder
// Sculpt build pass: blockout
// This factory is intentionally pass-gated. Finish browser screenshot review before unlocking deeper passes.
export function createManualVerticalBeltGrinderModel(options: ProceduralModelOptions = {}): THREE.Group {
  const root = new THREE.Group();
  root.name = "manual vertical belt grinder";
  root.userData.reconstructionEvidence = {"itemFamily": null, "subtype": null, "componentAdapter": null, "route": null, "exactnessTier": null, "referenceCamera": {"solved": false, "fovDegrees": 40, "aspect": 1, "orientation": {"yaw": 0, "pitch": 0, "roll": 0}, "positionHint": [0, 0, 3], "note": "For likeness work, solve the reference camera (forge/stage1_intake/solve_camera_pose.py) so the review render aligns with the photo and the reference can be projected. Confirm by overlay review."}, "approximationNotes": []};
  root.userData.materialPipeline = {};
  root.userData.materialReferenceRegistry = null;

  const materialMap: Record<string, THREE.Material> = {};
  materialMap["iron"] = createSculptMaterial(
    "iron",
    {"id": "iron", "name": "iron", "type": "standard", "shaderModel": "MeshStandardMaterial / PBR approximation", "baseColor": "#4B413C", "color": "#4B413C", "albedo": {"dominant": "#4B413C", "secondary": ["#39312E", "#5F524D", "#161413", "#BDAFA7"], "samplingNotes": "reference crop"}, "colorVariation": {"palette": ["#8A7A5F", "#6E614B", "#A08F70"], "pattern": "mottled", "amplitude": 0.15, "heightCorrelation": 0.3}, "textureResolution": 1024, "textureProjection": {"mode": "uv", "repeat": [2, 2], "anisotropy": 8, "texelDensityIntent": "Preserve stable world/object-scale detail; do not stretch micro detail with component scale."}, "surfaceFrequencyBands": [{"id": "macro", "frequency": 2, "amplitude": 0.42, "role": "broad color and height breakup"}, {"id": "meso", "frequency": 12, "amplitude": 0.22, "role": "ridges, pores, grain, dents, or equivalent visible relief"}, {"id": "micro", "frequency": 56, "amplitude": 0.08, "role": "highlight breakup visible under grazing light"}], "roughness": {"base": 0.75, "variation": 0.15, "map": "independent-procedural-field", "localResponse": "higher roughness in cavities, lower roughness on worn edges"}, "metalness": {"base": 0.72, "variation": 0.08}, "normal": {"pattern": "derived-from-independent-height-field", "strength": 0.35, "scale": 24, "space": "tangent"}, "bump": {"pattern": "none", "amplitude": 0, "scale": 1}, "displacement": {"pattern": "none", "amplitude": 0, "scale": 1, "silhouetteAffects": false}, "ambientOcclusion": {"cavityStrength": 0.25, "contactShadowBias": 0.35, "notes": "Darken creases, seams, intersections, and recessed local features."}, "wear": {"edgeWear": 0, "scratches": [], "chips": []}, "dirt": {"amount": 0, "cavityBias": 0, "color": "#2F2A22"}, "localOverrides": [{"id": "contact-wear", "mask": "exposed edges and contact regions", "roughness": 0.32, "evidenceRefs": ["hero"], "description": "localized contact wear; cavities stay rough"}], "shaderNotes": ["Prefer MeshPhysicalMaterial when clearcoat, sheen, transmission, or thin-surface response is observed; otherwise use MeshStandardMaterial-compatible PBR channels.", "Generate albedo, roughness, height/normal, and AO independently; never alias albedo into roughness.", "Use normal/bump/displacement only when they map to observed surface relief.", "Use displacement geometry when the observed relief changes the close-up silhouette; texture-only relief is insufficient there."], "notes": "Pixel-derived inference from the named material crop. Small crops do not certify exact surface reconstruction.", "referencePbr": {"usable": true, "version": "1", "sourceImage": "D:\\打了个铁\\Weapon-Forger-hammer\\artifacts\\grinder-reference\\iron.png", "extractor": "extract_pbr_evidence.py", "method": "independent channel inference", "verdict": "pass", "hardLimit": "single crop inference", "confidence": 0.849, "estimatedFidelity": 0.849, "targetThreshold": 0.7, "maps": {"albedo": {"path": "D:\\打了个铁\\Weapon-Forger-hammer\\public\\grinder\\iron\\iron_albedo.png", "url": "iron_albedo.png", "channel": "albedo", "source": "reference-pixel-extraction"}, "roughness": {"path": "D:\\打了个铁\\Weapon-Forger-hammer\\public\\grinder\\iron\\iron_roughness.png", "url": "iron_roughness.png", "channel": "roughness", "source": "reference-pixel-extraction"}, "height": {"path": "D:\\打了个铁\\Weapon-Forger-hammer\\public\\grinder\\iron\\iron_height.png", "url": "iron_height.png", "channel": "height", "source": "reference-pixel-extraction"}, "normal": {"path": "D:\\打了个铁\\Weapon-Forger-hammer\\public\\grinder\\iron\\iron_normal.png", "url": "iron_normal.png", "channel": "normal", "source": "reference-pixel-extraction"}, "ao": {"path": "D:\\打了个铁\\Weapon-Forger-hammer\\public\\grinder\\iron\\iron_ao.png", "url": "iron_ao.png", "channel": "ao", "source": "reference-pixel-extraction"}}}},
    options
  );
  materialMap["steel"] = createSculptMaterial(
    "steel",
    {"id": "steel", "name": "steel", "type": "standard", "shaderModel": "MeshStandardMaterial / PBR approximation", "baseColor": "#866F6D", "color": "#866F6D", "albedo": {"dominant": "#866F6D", "secondary": ["#7E6865", "#967E79", "#483C38", "#DFD1C9"], "samplingNotes": "reference crop"}, "colorVariation": {"palette": ["#8A7A5F", "#6E614B", "#A08F70"], "pattern": "mottled", "amplitude": 0.15, "heightCorrelation": 0.3}, "textureResolution": 1024, "textureProjection": {"mode": "uv", "repeat": [2, 2], "anisotropy": 8, "texelDensityIntent": "Preserve stable world/object-scale detail; do not stretch micro detail with component scale."}, "surfaceFrequencyBands": [{"id": "macro", "frequency": 2, "amplitude": 0.42, "role": "broad color and height breakup"}, {"id": "meso", "frequency": 12, "amplitude": 0.22, "role": "ridges, pores, grain, dents, or equivalent visible relief"}, {"id": "micro", "frequency": 56, "amplitude": 0.08, "role": "highlight breakup visible under grazing light"}], "roughness": {"base": 0.75, "variation": 0.15, "map": "independent-procedural-field", "localResponse": "higher roughness in cavities, lower roughness on worn edges"}, "metalness": {"base": 0.72, "variation": 0.08}, "normal": {"pattern": "derived-from-independent-height-field", "strength": 0.35, "scale": 24, "space": "tangent"}, "bump": {"pattern": "none", "amplitude": 0, "scale": 1}, "displacement": {"pattern": "none", "amplitude": 0, "scale": 1, "silhouetteAffects": false}, "ambientOcclusion": {"cavityStrength": 0.25, "contactShadowBias": 0.35, "notes": "Darken creases, seams, intersections, and recessed local features."}, "wear": {"edgeWear": 0, "scratches": [], "chips": []}, "dirt": {"amount": 0, "cavityBias": 0, "color": "#2F2A22"}, "localOverrides": [{"id": "contact-wear", "mask": "exposed edges and contact regions", "roughness": 0.32, "evidenceRefs": ["hero"], "description": "localized contact wear; cavities stay rough"}], "shaderNotes": ["Prefer MeshPhysicalMaterial when clearcoat, sheen, transmission, or thin-surface response is observed; otherwise use MeshStandardMaterial-compatible PBR channels.", "Generate albedo, roughness, height/normal, and AO independently; never alias albedo into roughness.", "Use normal/bump/displacement only when they map to observed surface relief.", "Use displacement geometry when the observed relief changes the close-up silhouette; texture-only relief is insufficient there."], "notes": "Pixel-derived inference from the named material crop. Small crops do not certify exact surface reconstruction.", "referencePbr": {"usable": true, "version": "1", "sourceImage": "D:\\打了个铁\\Weapon-Forger-hammer\\artifacts\\grinder-reference\\steel.png", "extractor": "extract_pbr_evidence.py", "method": "independent channel inference", "verdict": "pass", "hardLimit": "single crop inference", "confidence": 0.842, "estimatedFidelity": 0.842, "targetThreshold": 0.7, "maps": {"albedo": {"path": "D:\\打了个铁\\Weapon-Forger-hammer\\public\\grinder\\steel\\steel_albedo.png", "url": "steel_albedo.png", "channel": "albedo", "source": "reference-pixel-extraction"}, "roughness": {"path": "D:\\打了个铁\\Weapon-Forger-hammer\\public\\grinder\\steel\\steel_roughness.png", "url": "steel_roughness.png", "channel": "roughness", "source": "reference-pixel-extraction"}, "height": {"path": "D:\\打了个铁\\Weapon-Forger-hammer\\public\\grinder\\steel\\steel_height.png", "url": "steel_height.png", "channel": "height", "source": "reference-pixel-extraction"}, "normal": {"path": "D:\\打了个铁\\Weapon-Forger-hammer\\public\\grinder\\steel\\steel_normal.png", "url": "steel_normal.png", "channel": "normal", "source": "reference-pixel-extraction"}, "ao": {"path": "D:\\打了个铁\\Weapon-Forger-hammer\\public\\grinder\\steel\\steel_ao.png", "url": "steel_ao.png", "channel": "ao", "source": "reference-pixel-extraction"}}}},
    options
  );
  materialMap["abrasive"] = createSculptMaterial(
    "abrasive",
    {"id": "abrasive", "name": "abrasive", "type": "standard", "shaderModel": "MeshStandardMaterial / PBR approximation", "baseColor": "#763E34", "color": "#763E34", "albedo": {"dominant": "#763E34", "secondary": ["#6D352E", "#81473A", "#622D28", "#925545"], "samplingNotes": "reference crop"}, "colorVariation": {"palette": ["#8A7A5F", "#6E614B", "#A08F70"], "pattern": "mottled", "amplitude": 0.15, "heightCorrelation": 0.3}, "textureResolution": 1024, "textureProjection": {"mode": "uv", "repeat": [2, 2], "anisotropy": 8, "texelDensityIntent": "Preserve stable world/object-scale detail; do not stretch micro detail with component scale."}, "surfaceFrequencyBands": [{"id": "macro", "frequency": 2, "amplitude": 0.42, "role": "broad color and height breakup"}, {"id": "meso", "frequency": 12, "amplitude": 0.22, "role": "ridges, pores, grain, dents, or equivalent visible relief"}, {"id": "micro", "frequency": 56, "amplitude": 0.08, "role": "highlight breakup visible under grazing light"}], "roughness": {"base": 0.75, "variation": 0.15, "map": "independent-procedural-field", "localResponse": "higher roughness in cavities, lower roughness on worn edges"}, "metalness": {"base": 0, "variation": 0.08}, "normal": {"pattern": "derived-from-independent-height-field", "strength": 0.35, "scale": 24, "space": "tangent"}, "bump": {"pattern": "none", "amplitude": 0, "scale": 1}, "displacement": {"pattern": "none", "amplitude": 0, "scale": 1, "silhouetteAffects": false}, "ambientOcclusion": {"cavityStrength": 0.25, "contactShadowBias": 0.35, "notes": "Darken creases, seams, intersections, and recessed local features."}, "wear": {"edgeWear": 0, "scratches": [], "chips": []}, "dirt": {"amount": 0, "cavityBias": 0, "color": "#2F2A22"}, "localOverrides": [{"id": "contact-wear", "mask": "exposed edges and contact regions", "roughness": 0.91, "evidenceRefs": ["hero"], "description": "localized contact wear; cavities stay rough"}], "shaderNotes": ["Prefer MeshPhysicalMaterial when clearcoat, sheen, transmission, or thin-surface response is observed; otherwise use MeshStandardMaterial-compatible PBR channels.", "Generate albedo, roughness, height/normal, and AO independently; never alias albedo into roughness.", "Use normal/bump/displacement only when they map to observed surface relief.", "Use displacement geometry when the observed relief changes the close-up silhouette; texture-only relief is insufficient there."], "notes": "Pixel-derived inference from the named material crop. Small crops do not certify exact surface reconstruction.", "referencePbr": {"usable": true, "version": "1", "sourceImage": "D:\\打了个铁\\Weapon-Forger-hammer\\artifacts\\grinder-reference\\abrasive.png", "extractor": "extract_pbr_evidence.py", "method": "independent channel inference", "verdict": "pass", "hardLimit": "single crop inference", "confidence": 0.751, "estimatedFidelity": 0.751, "targetThreshold": 0.7, "maps": {"albedo": {"path": "D:\\打了个铁\\Weapon-Forger-hammer\\public\\grinder\\abrasive\\abrasive_albedo.png", "url": "abrasive_albedo.png", "channel": "albedo", "source": "reference-pixel-extraction"}, "roughness": {"path": "D:\\打了个铁\\Weapon-Forger-hammer\\public\\grinder\\abrasive\\abrasive_roughness.png", "url": "abrasive_roughness.png", "channel": "roughness", "source": "reference-pixel-extraction"}, "height": {"path": "D:\\打了个铁\\Weapon-Forger-hammer\\public\\grinder\\abrasive\\abrasive_height.png", "url": "abrasive_height.png", "channel": "height", "source": "reference-pixel-extraction"}, "normal": {"path": "D:\\打了个铁\\Weapon-Forger-hammer\\public\\grinder\\abrasive\\abrasive_normal.png", "url": "abrasive_normal.png", "channel": "normal", "source": "reference-pixel-extraction"}, "ao": {"path": "D:\\打了个铁\\Weapon-Forger-hammer\\public\\grinder\\abrasive\\abrasive_ao.png", "url": "abrasive_ao.png", "channel": "ao", "source": "reference-pixel-extraction"}}}},
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
    node_base_0.position.set(0.02, 0.075, 0.0);
    node_base_0.rotation.set(0.0, 0.0, 0.0);
  }
  node_base_0.userData.sculptComponent = {"id": "base", "name": "base", "level": "macro", "role": "base", "importance": 1, "confidence": 0.85, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "A distinct manufactured mechanical component; its contacting joints remain independently named.", "geometryDescriptor": {"edgeTreatment": {"type": "chamfer", "bevelRadius": 0.002, "segments": 1}, "deformationStack": [], "uvStrategy": "object-space metres", "normalStrategy": "flat bevels and smooth cylindrical faces"}, "parent": null, "attachment": null, "dimensions": {"width": 0.66, "height": 0.085, "depth": 0.4, "units": "metres", "confidence": 0.85}, "transform": {"position": [0.02, 0.075, 0], "rotation": [0, 0, 0], "scale": [0.66, 0.085, 0.4]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 0, 1], "confidence": 1}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.66, 0.085, 0.4], "isTrigger": false}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "base", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "iron"}}, "material": "iron", "materialLayers": ["iron"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "anchor-bolts", "kind": "fastener", "description": "four hex anchoring heads", "evidenceRefs": ["hero"]}], "surfaceDetail": {"macroRoughness": 0, "microRoughness": 0, "bumpAmplitude": 0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["hero", "front", "side"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(75,65,60,1)", "secondaryAlbedo": "rgba(145,132,122,1)", "materialClass": "metal", "materialClassConfidence": 0.9}};
  node_base_0.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 0, 1], "confidence": 1}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.66, 0.085, 0.4], "isTrigger": false}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "base", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "iron"}};
  (nodes["root"] ?? root).add(node_base_0);
  nodes["base"] = node_base_0;
  const mesh_base_0Geometry = endpoint_base_0
    ? new THREE.CylinderGeometry(endpoint_base_0.endRadius, endpoint_base_0.baseRadius, endpoint_base_0.length, 16, 6)
    : new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
  if (!endpoint_base_0) {
    mesh_base_0Geometry.scale(0.66, 0.085, 0.4);
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
  mesh_base_0.userData.sculptComponent = {"id": "base", "name": "base", "level": "macro", "role": "base", "importance": 1, "confidence": 0.85, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "A distinct manufactured mechanical component; its contacting joints remain independently named.", "geometryDescriptor": {"edgeTreatment": {"type": "chamfer", "bevelRadius": 0.002, "segments": 1}, "deformationStack": [], "uvStrategy": "object-space metres", "normalStrategy": "flat bevels and smooth cylindrical faces"}, "parent": null, "attachment": null, "dimensions": {"width": 0.66, "height": 0.085, "depth": 0.4, "units": "metres", "confidence": 0.85}, "transform": {"position": [0.02, 0.075, 0], "rotation": [0, 0, 0], "scale": [0.66, 0.085, 0.4]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 0, 1], "confidence": 1}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.66, 0.085, 0.4], "isTrigger": false}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "base", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "iron"}}, "material": "iron", "materialLayers": ["iron"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "anchor-bolts", "kind": "fastener", "description": "four hex anchoring heads", "evidenceRefs": ["hero"]}], "surfaceDetail": {"macroRoughness": 0, "microRoughness": 0, "bumpAmplitude": 0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["hero", "front", "side"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(75,65,60,1)", "secondaryAlbedo": "rgba(145,132,122,1)", "materialClass": "metal", "materialClassConfidence": 0.9}};
  node_base_0.add(mesh_base_0);
  meshes["base"] = mesh_base_0;
  colliders["base"] = {"type": "box", "offset": [0, 0, 0], "scale": [0.66, 0.085, 0.4], "isTrigger": false};
  destructionGroups["base"] ??= [];
  destructionGroups["base"].push(node_base_0);

  const endpoint_spine_1 = makeAttachmentEndpoint(null);
  const node_spine_1 = new THREE.Group();
  node_spine_1.name = "spine__pivot";
  node_spine_1.scale.set(1, 1, 1);
  if (endpoint_spine_1) {
    node_spine_1.position.copy(endpoint_spine_1.start);
    node_spine_1.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_spine_1.position.set(0.11, 0.64, 0.0);
    node_spine_1.rotation.set(0.0, 0.0, 0.0);
  }
  node_spine_1.userData.sculptComponent = {"id": "spine", "name": "spine", "level": "macro", "role": "spine", "importance": 1, "confidence": 0.85, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "A distinct manufactured mechanical component; its contacting joints remain independently named.", "geometryDescriptor": {"edgeTreatment": {"type": "chamfer", "bevelRadius": 0.002, "segments": 1}, "deformationStack": [], "uvStrategy": "object-space metres", "normalStrategy": "flat bevels and smooth cylindrical faces"}, "parent": null, "attachment": null, "dimensions": {"width": 0.1, "height": 1.02, "depth": 0.18, "units": "metres", "confidence": 0.85}, "transform": {"position": [0.11, 0.64, 0], "rotation": [0, 0, 0], "scale": [0.1, 1.02, 0.18]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 0, 1], "confidence": 1}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.1, 1.02, 0.18], "isTrigger": false}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "spine", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "iron"}}, "material": "iron", "materialLayers": ["iron"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "tension-slot", "kind": "groove", "description": "recessed vertical adjustment slot", "evidenceRefs": ["hero"]}], "surfaceDetail": {"macroRoughness": 0, "microRoughness": 0, "bumpAmplitude": 0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["hero", "front", "side"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(75,65,60,1)", "secondaryAlbedo": "rgba(145,132,122,1)", "materialClass": "metal", "materialClassConfidence": 0.9}};
  node_spine_1.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 0, 1], "confidence": 1}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.1, 1.02, 0.18], "isTrigger": false}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "spine", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "iron"}};
  (nodes["root"] ?? root).add(node_spine_1);
  nodes["spine"] = node_spine_1;
  const mesh_spine_1Geometry = endpoint_spine_1
    ? new THREE.CylinderGeometry(endpoint_spine_1.endRadius, endpoint_spine_1.baseRadius, endpoint_spine_1.length, 16, 6)
    : new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
  if (!endpoint_spine_1) {
    mesh_spine_1Geometry.scale(0.1, 1.02, 0.18);
  }
  const mesh_spine_1 = new THREE.Mesh(
    mesh_spine_1Geometry,
    materialMap["iron"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_spine_1.name = "spine";
  if (endpoint_spine_1) {
    mesh_spine_1.position.copy(endpoint_spine_1.midpoint);
    mesh_spine_1.quaternion.copy(endpoint_spine_1.quaternion);
  }
  mesh_spine_1.castShadow = options.castShadow ?? true;
  mesh_spine_1.receiveShadow = options.receiveShadow ?? true;
  mesh_spine_1.userData.sculptComponent = {"id": "spine", "name": "spine", "level": "macro", "role": "spine", "importance": 1, "confidence": 0.85, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "A distinct manufactured mechanical component; its contacting joints remain independently named.", "geometryDescriptor": {"edgeTreatment": {"type": "chamfer", "bevelRadius": 0.002, "segments": 1}, "deformationStack": [], "uvStrategy": "object-space metres", "normalStrategy": "flat bevels and smooth cylindrical faces"}, "parent": null, "attachment": null, "dimensions": {"width": 0.1, "height": 1.02, "depth": 0.18, "units": "metres", "confidence": 0.85}, "transform": {"position": [0.11, 0.64, 0], "rotation": [0, 0, 0], "scale": [0.1, 1.02, 0.18]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 0, 1], "confidence": 1}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.1, 1.02, 0.18], "isTrigger": false}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "spine", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "iron"}}, "material": "iron", "materialLayers": ["iron"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "tension-slot", "kind": "groove", "description": "recessed vertical adjustment slot", "evidenceRefs": ["hero"]}], "surfaceDetail": {"macroRoughness": 0, "microRoughness": 0, "bumpAmplitude": 0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["hero", "front", "side"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(75,65,60,1)", "secondaryAlbedo": "rgba(145,132,122,1)", "materialClass": "metal", "materialClassConfidence": 0.9}};
  node_spine_1.add(mesh_spine_1);
  meshes["spine"] = mesh_spine_1;
  colliders["spine"] = {"type": "box", "offset": [0, 0, 0], "scale": [0.1, 1.02, 0.18], "isTrigger": false};
  destructionGroups["spine"] ??= [];
  destructionGroups["spine"].push(node_spine_1);

  const endpoint_abrasive_loop_2 = makeAttachmentEndpoint(null);
  const node_abrasive_loop_2 = new THREE.Group();
  node_abrasive_loop_2.name = "abrasive-loop__pivot";
  node_abrasive_loop_2.scale.set(1, 1, 1);
  if (endpoint_abrasive_loop_2) {
    node_abrasive_loop_2.position.copy(endpoint_abrasive_loop_2.start);
    node_abrasive_loop_2.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_abrasive_loop_2.position.set(0.0, 0.0, -0.06);
    node_abrasive_loop_2.rotation.set(0.0, 0.0, 0.0);
  }
  node_abrasive_loop_2.userData.sculptComponent = {"id": "abrasive-loop", "name": "abrasive-loop", "level": "macro", "role": "abrasive-loop", "importance": 1, "confidence": 0.85, "primitive": "extrude", "topologyClass": "assembled-solid", "topologyRationale": "A distinct manufactured mechanical component; its contacting joints remain independently named.", "geometryDescriptor": {"edgeTreatment": {"type": "none", "bevelRadius": 0, "segments": 1}, "deformationStack": [], "uvStrategy": "object-space metres", "normalStrategy": "flat bevels and smooth cylindrical faces", "profile2D": {"points": [[0.123, 1.16], [0.12240772138068022, 1.1720561082605359], [0.12063658948959734, 1.1839961096079836], [0.11770366129506168, 1.1957050153022988], [0.11363718249888827, 1.207070062180906], [0.10847631551484767, 1.2179817986295975], [0.10227076231321307, 1.228335138661411], [0.09508028576361664, 1.2380303739521283], [0.08697413408594536, 1.2469741340859453], [0.07803037395212839, 1.2550802857636165], [0.06833513866141108, 1.262270762313213], [0.05798179862959773, 1.2684763155148475], [0.04707006218090605, 1.2736371824988881], [0.035705015302298866, 1.2777036612950616], [0.023996109607983783, 1.2806365894895972], [0.012056108260535974, 1.2824077213806802], [7.531577814756222e-18, 1.283], [-0.012056108260535959, 1.2824077213806802], [-0.02399610960798377, 1.2806365894895972], [-0.035705015302298845, 1.2777036612950616], [-0.047070062180906036, 1.2736371824988881], [-0.057981798629597715, 1.2684763155148475], [-0.06833513866141104, 1.262270762313213], [-0.07803037395212838, 1.2550802857636165], [-0.08697413408594534, 1.2469741340859453], [-0.09508028576361664, 1.2380303739521283], [-0.10227076231321308, 1.228335138661411], [-0.10847631551484765, 1.2179817986295975], [-0.11363718249888827, 1.207070062180906], [-0.11770366129506168, 1.1957050153022988], [-0.12063658948959734, 1.1839961096079836], [-0.1224077213806802, 1.1720561082605359], [-0.123, 1.16], [-0.123, 0.3], [-0.12240772138068022, 0.28794389173946405], [-0.12063658948959734, 0.2760038903920162], [-0.1177036612950617, 0.26429498469770113], [-0.11363718249888828, 0.25292993781909395], [-0.10847631551484767, 0.24201820137040228], [-0.1022707623132131, 0.23166486133858893], [-0.09508028576361666, 0.22196962604787163], [-0.08697413408594537, 0.21302586591405465], [-0.07803037395212845, 0.2049197142363834], [-0.06833513866141107, 0.1977292376867869], [-0.05798179862959774, 0.19152368448515233], [-0.04707006218090611, 0.18636281750111175], [-0.03570501530229888, 0.1822963387049383], [-0.023996109607983825, 0.17936341051040267], [-0.012056108260535936, 0.17759227861931975], [-2.2594733444268666e-17, 0.177], [0.012056108260535891, 0.17759227861931975], [0.02399610960798378, 0.17936341051040267], [0.03570501530229883, 0.18229633870493828], [0.04707006218090607, 0.18636281750111172], [0.0579817986295977, 0.19152368448515233], [0.06833513866141103, 0.1977292376867869], [0.07803037395212832, 0.20491971423638328], [0.08697413408594533, 0.21302586591405462], [0.09508028576361666, 0.22196962604787163], [0.10227076231321307, 0.23166486133858893], [0.10847631551484764, 0.24201820137040225], [0.11363718249888824, 0.2529299378190939], [0.11770366129506168, 0.2642949846977011], [0.12063658948959732, 0.27600389039201617], [0.12240772138068022, 0.28794389173946405], [0.123, 0.29999999999999993]], "holes": [[[0.12, 0.29999999999999993], [0.11942216720066362, 0.2882379431604527], [0.11769423364838763, 0.27658916135806455], [0.11483284028786506, 0.2651658387294645], [0.11086554390135438, 0.25407798811618915], [0.10583055172180257, 0.24343239158088023], [0.09977635347630542, 0.23333157203764773], [0.09276125440352845, 0.22387280590036257], [0.08485281374238568, 0.21514718625761425], [0.07612719409963739, 0.20723874559647149], [0.06666842796235221, 0.20022364652369454], [0.05656760841911971, 0.19416944827819738], [0.0459220118838108, 0.1891344560986456], [0.034834161270535444, 0.18516715971213493], [0.023410838641935397, 0.18230576635161233], [0.011762056839547211, 0.18057783279933637], [-2.2043642384652355e-17, 0.18], [-0.011762056839547255, 0.18057783279933637], [-0.02341083864193544, 0.18230576635161236], [-0.03483416127053549, 0.18516715971213493], [-0.045922011883810836, 0.1891344560986456], [-0.05656760841911975, 0.1941694482781974], [-0.06666842796235226, 0.20022364652369457], [-0.07612719409963752, 0.2072387455964716], [-0.08485281374238572, 0.2151471862576143], [-0.09276125440352845, 0.22387280590036257], [-0.09977635347630545, 0.23333157203764776], [-0.1058305517218026, 0.24343239158088026], [-0.11086554390135442, 0.2540779881161892], [-0.11483284028786507, 0.26516583872946453], [-0.11769423364838764, 0.2765891613580646], [-0.11942216720066362, 0.2882379431604527], [-0.12, 0.3], [-0.12, 1.16], [-0.11942216720066362, 1.1717620568395473], [-0.11769423364838764, 1.1834108386419353], [-0.11483284028786506, 1.1948341612705353], [-0.1108655439013544, 1.2059220118838108], [-0.10583055172180258, 1.2165676084191197], [-0.09977635347630544, 1.226668427962352], [-0.09276125440352843, 1.2361271940996374], [-0.0848528137423857, 1.2448528137423855], [-0.07612719409963745, 1.2527612544035285], [-0.06666842796235223, 1.2597763534763053], [-0.05656760841911972, 1.2658305517218025], [-0.045922011883810766, 1.2708655439013543], [-0.03483416127053546, 1.274832840287865], [-0.023410838641935383, 1.2776942336483876], [-0.011762056839547277, 1.2794221672006636], [7.347880794884118e-18, 1.2799999999999998], [0.011762056839547293, 1.2794221672006636], [0.0234108386419354, 1.2776942336483876], [0.03483416127053548, 1.274832840287865], [0.04592201188381078, 1.2708655439013543], [0.05656760841911974, 1.2658305517218025], [0.06666842796235227, 1.2597763534763053], [0.07612719409963746, 1.2527612544035283], [0.08485281374238571, 1.2448528137423855], [0.09276125440352843, 1.2361271940996374], [0.09977635347630542, 1.226668427962352], [0.1058305517218026, 1.2165676084191197], [0.1108655439013544, 1.2059220118838108], [0.11483284028786506, 1.1948341612705353], [0.11769423364838764, 1.1834108386419353], [0.11942216720066362, 1.1717620568395473], [0.12, 1.16]]], "depth": 0.12}, "topologyIntent": "Closed constant-thickness strip over tangent straight runs and semicircular wraps; never separate top/bottom plates."}, "parent": null, "attachment": null, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "metres", "confidence": 0.85}, "transform": {"position": [0, 0, -0.06], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "belt-uv-translation", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 0, 1], "confidence": 1}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "abrasive-loop", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "abrasive"}}, "material": "abrasive", "materialLayers": ["abrasive"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "belt-joint", "kind": "seam", "description": "oblique joining seam on loop", "evidenceRefs": ["hero"]}, {"id": "belt-grit", "kind": "ridge", "description": "fine abrasive grains on front and wraps", "evidenceRefs": ["hero"]}], "surfaceDetail": {"macroRoughness": 0, "microRoughness": 0, "bumpAmplitude": 0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["hero", "front", "side"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(118,62,52,1)", "secondaryAlbedo": "rgba(146,85,69,1)", "materialClass": "fabric", "materialClassConfidence": 0.9}};
  node_abrasive_loop_2.userData.actionProfile = {"animationRole": "belt-uv-translation", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 0, 1], "confidence": 1}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "abrasive-loop", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "abrasive"}};
  (nodes["root"] ?? root).add(node_abrasive_loop_2);
  nodes["abrasive-loop"] = node_abrasive_loop_2;
  const mesh_abrasive_loop_2Geometry = endpoint_abrasive_loop_2
    ? new THREE.CylinderGeometry(endpoint_abrasive_loop_2.endRadius, endpoint_abrasive_loop_2.baseRadius, endpoint_abrasive_loop_2.length, 16, 6)
    : buildExtrudeGeometry({"points": [[0.123, 1.16], [0.12240772138068022, 1.1720561082605359], [0.12063658948959734, 1.1839961096079836], [0.11770366129506168, 1.1957050153022988], [0.11363718249888827, 1.207070062180906], [0.10847631551484767, 1.2179817986295975], [0.10227076231321307, 1.228335138661411], [0.09508028576361664, 1.2380303739521283], [0.08697413408594536, 1.2469741340859453], [0.07803037395212839, 1.2550802857636165], [0.06833513866141108, 1.262270762313213], [0.05798179862959773, 1.2684763155148475], [0.04707006218090605, 1.2736371824988881], [0.035705015302298866, 1.2777036612950616], [0.023996109607983783, 1.2806365894895972], [0.012056108260535974, 1.2824077213806802], [7.531577814756222e-18, 1.283], [-0.012056108260535959, 1.2824077213806802], [-0.02399610960798377, 1.2806365894895972], [-0.035705015302298845, 1.2777036612950616], [-0.047070062180906036, 1.2736371824988881], [-0.057981798629597715, 1.2684763155148475], [-0.06833513866141104, 1.262270762313213], [-0.07803037395212838, 1.2550802857636165], [-0.08697413408594534, 1.2469741340859453], [-0.09508028576361664, 1.2380303739521283], [-0.10227076231321308, 1.228335138661411], [-0.10847631551484765, 1.2179817986295975], [-0.11363718249888827, 1.207070062180906], [-0.11770366129506168, 1.1957050153022988], [-0.12063658948959734, 1.1839961096079836], [-0.1224077213806802, 1.1720561082605359], [-0.123, 1.16], [-0.123, 0.3], [-0.12240772138068022, 0.28794389173946405], [-0.12063658948959734, 0.2760038903920162], [-0.1177036612950617, 0.26429498469770113], [-0.11363718249888828, 0.25292993781909395], [-0.10847631551484767, 0.24201820137040228], [-0.1022707623132131, 0.23166486133858893], [-0.09508028576361666, 0.22196962604787163], [-0.08697413408594537, 0.21302586591405465], [-0.07803037395212845, 0.2049197142363834], [-0.06833513866141107, 0.1977292376867869], [-0.05798179862959774, 0.19152368448515233], [-0.04707006218090611, 0.18636281750111175], [-0.03570501530229888, 0.1822963387049383], [-0.023996109607983825, 0.17936341051040267], [-0.012056108260535936, 0.17759227861931975], [-2.2594733444268666e-17, 0.177], [0.012056108260535891, 0.17759227861931975], [0.02399610960798378, 0.17936341051040267], [0.03570501530229883, 0.18229633870493828], [0.04707006218090607, 0.18636281750111172], [0.0579817986295977, 0.19152368448515233], [0.06833513866141103, 0.1977292376867869], [0.07803037395212832, 0.20491971423638328], [0.08697413408594533, 0.21302586591405462], [0.09508028576361666, 0.22196962604787163], [0.10227076231321307, 0.23166486133858893], [0.10847631551484764, 0.24201820137040225], [0.11363718249888824, 0.2529299378190939], [0.11770366129506168, 0.2642949846977011], [0.12063658948959732, 0.27600389039201617], [0.12240772138068022, 0.28794389173946405], [0.123, 0.29999999999999993]], "holes": [[[0.12, 0.29999999999999993], [0.11942216720066362, 0.2882379431604527], [0.11769423364838763, 0.27658916135806455], [0.11483284028786506, 0.2651658387294645], [0.11086554390135438, 0.25407798811618915], [0.10583055172180257, 0.24343239158088023], [0.09977635347630542, 0.23333157203764773], [0.09276125440352845, 0.22387280590036257], [0.08485281374238568, 0.21514718625761425], [0.07612719409963739, 0.20723874559647149], [0.06666842796235221, 0.20022364652369454], [0.05656760841911971, 0.19416944827819738], [0.0459220118838108, 0.1891344560986456], [0.034834161270535444, 0.18516715971213493], [0.023410838641935397, 0.18230576635161233], [0.011762056839547211, 0.18057783279933637], [-2.2043642384652355e-17, 0.18], [-0.011762056839547255, 0.18057783279933637], [-0.02341083864193544, 0.18230576635161236], [-0.03483416127053549, 0.18516715971213493], [-0.045922011883810836, 0.1891344560986456], [-0.05656760841911975, 0.1941694482781974], [-0.06666842796235226, 0.20022364652369457], [-0.07612719409963752, 0.2072387455964716], [-0.08485281374238572, 0.2151471862576143], [-0.09276125440352845, 0.22387280590036257], [-0.09977635347630545, 0.23333157203764776], [-0.1058305517218026, 0.24343239158088026], [-0.11086554390135442, 0.2540779881161892], [-0.11483284028786507, 0.26516583872946453], [-0.11769423364838764, 0.2765891613580646], [-0.11942216720066362, 0.2882379431604527], [-0.12, 0.3], [-0.12, 1.16], [-0.11942216720066362, 1.1717620568395473], [-0.11769423364838764, 1.1834108386419353], [-0.11483284028786506, 1.1948341612705353], [-0.1108655439013544, 1.2059220118838108], [-0.10583055172180258, 1.2165676084191197], [-0.09977635347630544, 1.226668427962352], [-0.09276125440352843, 1.2361271940996374], [-0.0848528137423857, 1.2448528137423855], [-0.07612719409963745, 1.2527612544035285], [-0.06666842796235223, 1.2597763534763053], [-0.05656760841911972, 1.2658305517218025], [-0.045922011883810766, 1.2708655439013543], [-0.03483416127053546, 1.274832840287865], [-0.023410838641935383, 1.2776942336483876], [-0.011762056839547277, 1.2794221672006636], [7.347880794884118e-18, 1.2799999999999998], [0.011762056839547293, 1.2794221672006636], [0.0234108386419354, 1.2776942336483876], [0.03483416127053548, 1.274832840287865], [0.04592201188381078, 1.2708655439013543], [0.05656760841911974, 1.2658305517218025], [0.06666842796235227, 1.2597763534763053], [0.07612719409963746, 1.2527612544035283], [0.08485281374238571, 1.2448528137423855], [0.09276125440352843, 1.2361271940996374], [0.09977635347630542, 1.226668427962352], [0.1058305517218026, 1.2165676084191197], [0.1108655439013544, 1.2059220118838108], [0.11483284028786506, 1.1948341612705353], [0.11769423364838764, 1.1834108386419353], [0.11942216720066362, 1.1717620568395473], [0.12, 1.16]]], "depth": 0.12});
  if (!endpoint_abrasive_loop_2) {
    mesh_abrasive_loop_2Geometry.scale(1.0, 1.0, 1.0);
  }
  const mesh_abrasive_loop_2 = new THREE.Mesh(
    mesh_abrasive_loop_2Geometry,
    materialMap["abrasive"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_abrasive_loop_2.name = "abrasive-loop";
  if (endpoint_abrasive_loop_2) {
    mesh_abrasive_loop_2.position.copy(endpoint_abrasive_loop_2.midpoint);
    mesh_abrasive_loop_2.quaternion.copy(endpoint_abrasive_loop_2.quaternion);
  }
  mesh_abrasive_loop_2.castShadow = options.castShadow ?? true;
  mesh_abrasive_loop_2.receiveShadow = options.receiveShadow ?? true;
  mesh_abrasive_loop_2.userData.sculptComponent = {"id": "abrasive-loop", "name": "abrasive-loop", "level": "macro", "role": "abrasive-loop", "importance": 1, "confidence": 0.85, "primitive": "extrude", "topologyClass": "assembled-solid", "topologyRationale": "A distinct manufactured mechanical component; its contacting joints remain independently named.", "geometryDescriptor": {"edgeTreatment": {"type": "none", "bevelRadius": 0, "segments": 1}, "deformationStack": [], "uvStrategy": "object-space metres", "normalStrategy": "flat bevels and smooth cylindrical faces", "profile2D": {"points": [[0.123, 1.16], [0.12240772138068022, 1.1720561082605359], [0.12063658948959734, 1.1839961096079836], [0.11770366129506168, 1.1957050153022988], [0.11363718249888827, 1.207070062180906], [0.10847631551484767, 1.2179817986295975], [0.10227076231321307, 1.228335138661411], [0.09508028576361664, 1.2380303739521283], [0.08697413408594536, 1.2469741340859453], [0.07803037395212839, 1.2550802857636165], [0.06833513866141108, 1.262270762313213], [0.05798179862959773, 1.2684763155148475], [0.04707006218090605, 1.2736371824988881], [0.035705015302298866, 1.2777036612950616], [0.023996109607983783, 1.2806365894895972], [0.012056108260535974, 1.2824077213806802], [7.531577814756222e-18, 1.283], [-0.012056108260535959, 1.2824077213806802], [-0.02399610960798377, 1.2806365894895972], [-0.035705015302298845, 1.2777036612950616], [-0.047070062180906036, 1.2736371824988881], [-0.057981798629597715, 1.2684763155148475], [-0.06833513866141104, 1.262270762313213], [-0.07803037395212838, 1.2550802857636165], [-0.08697413408594534, 1.2469741340859453], [-0.09508028576361664, 1.2380303739521283], [-0.10227076231321308, 1.228335138661411], [-0.10847631551484765, 1.2179817986295975], [-0.11363718249888827, 1.207070062180906], [-0.11770366129506168, 1.1957050153022988], [-0.12063658948959734, 1.1839961096079836], [-0.1224077213806802, 1.1720561082605359], [-0.123, 1.16], [-0.123, 0.3], [-0.12240772138068022, 0.28794389173946405], [-0.12063658948959734, 0.2760038903920162], [-0.1177036612950617, 0.26429498469770113], [-0.11363718249888828, 0.25292993781909395], [-0.10847631551484767, 0.24201820137040228], [-0.1022707623132131, 0.23166486133858893], [-0.09508028576361666, 0.22196962604787163], [-0.08697413408594537, 0.21302586591405465], [-0.07803037395212845, 0.2049197142363834], [-0.06833513866141107, 0.1977292376867869], [-0.05798179862959774, 0.19152368448515233], [-0.04707006218090611, 0.18636281750111175], [-0.03570501530229888, 0.1822963387049383], [-0.023996109607983825, 0.17936341051040267], [-0.012056108260535936, 0.17759227861931975], [-2.2594733444268666e-17, 0.177], [0.012056108260535891, 0.17759227861931975], [0.02399610960798378, 0.17936341051040267], [0.03570501530229883, 0.18229633870493828], [0.04707006218090607, 0.18636281750111172], [0.0579817986295977, 0.19152368448515233], [0.06833513866141103, 0.1977292376867869], [0.07803037395212832, 0.20491971423638328], [0.08697413408594533, 0.21302586591405462], [0.09508028576361666, 0.22196962604787163], [0.10227076231321307, 0.23166486133858893], [0.10847631551484764, 0.24201820137040225], [0.11363718249888824, 0.2529299378190939], [0.11770366129506168, 0.2642949846977011], [0.12063658948959732, 0.27600389039201617], [0.12240772138068022, 0.28794389173946405], [0.123, 0.29999999999999993]], "holes": [[[0.12, 0.29999999999999993], [0.11942216720066362, 0.2882379431604527], [0.11769423364838763, 0.27658916135806455], [0.11483284028786506, 0.2651658387294645], [0.11086554390135438, 0.25407798811618915], [0.10583055172180257, 0.24343239158088023], [0.09977635347630542, 0.23333157203764773], [0.09276125440352845, 0.22387280590036257], [0.08485281374238568, 0.21514718625761425], [0.07612719409963739, 0.20723874559647149], [0.06666842796235221, 0.20022364652369454], [0.05656760841911971, 0.19416944827819738], [0.0459220118838108, 0.1891344560986456], [0.034834161270535444, 0.18516715971213493], [0.023410838641935397, 0.18230576635161233], [0.011762056839547211, 0.18057783279933637], [-2.2043642384652355e-17, 0.18], [-0.011762056839547255, 0.18057783279933637], [-0.02341083864193544, 0.18230576635161236], [-0.03483416127053549, 0.18516715971213493], [-0.045922011883810836, 0.1891344560986456], [-0.05656760841911975, 0.1941694482781974], [-0.06666842796235226, 0.20022364652369457], [-0.07612719409963752, 0.2072387455964716], [-0.08485281374238572, 0.2151471862576143], [-0.09276125440352845, 0.22387280590036257], [-0.09977635347630545, 0.23333157203764776], [-0.1058305517218026, 0.24343239158088026], [-0.11086554390135442, 0.2540779881161892], [-0.11483284028786507, 0.26516583872946453], [-0.11769423364838764, 0.2765891613580646], [-0.11942216720066362, 0.2882379431604527], [-0.12, 0.3], [-0.12, 1.16], [-0.11942216720066362, 1.1717620568395473], [-0.11769423364838764, 1.1834108386419353], [-0.11483284028786506, 1.1948341612705353], [-0.1108655439013544, 1.2059220118838108], [-0.10583055172180258, 1.2165676084191197], [-0.09977635347630544, 1.226668427962352], [-0.09276125440352843, 1.2361271940996374], [-0.0848528137423857, 1.2448528137423855], [-0.07612719409963745, 1.2527612544035285], [-0.06666842796235223, 1.2597763534763053], [-0.05656760841911972, 1.2658305517218025], [-0.045922011883810766, 1.2708655439013543], [-0.03483416127053546, 1.274832840287865], [-0.023410838641935383, 1.2776942336483876], [-0.011762056839547277, 1.2794221672006636], [7.347880794884118e-18, 1.2799999999999998], [0.011762056839547293, 1.2794221672006636], [0.0234108386419354, 1.2776942336483876], [0.03483416127053548, 1.274832840287865], [0.04592201188381078, 1.2708655439013543], [0.05656760841911974, 1.2658305517218025], [0.06666842796235227, 1.2597763534763053], [0.07612719409963746, 1.2527612544035283], [0.08485281374238571, 1.2448528137423855], [0.09276125440352843, 1.2361271940996374], [0.09977635347630542, 1.226668427962352], [0.1058305517218026, 1.2165676084191197], [0.1108655439013544, 1.2059220118838108], [0.11483284028786506, 1.1948341612705353], [0.11769423364838764, 1.1834108386419353], [0.11942216720066362, 1.1717620568395473], [0.12, 1.16]]], "depth": 0.12}, "topologyIntent": "Closed constant-thickness strip over tangent straight runs and semicircular wraps; never separate top/bottom plates."}, "parent": null, "attachment": null, "dimensions": {"width": 1, "height": 1, "depth": 1, "units": "metres", "confidence": 0.85}, "transform": {"position": [0, 0, -0.06], "rotation": [0, 0, 0], "scale": [1, 1, 1]}, "actionProfile": {"animationRole": "belt-uv-translation", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 0, 1], "confidence": 1}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "abrasive-loop", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "abrasive"}}, "material": "abrasive", "materialLayers": ["abrasive"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "belt-joint", "kind": "seam", "description": "oblique joining seam on loop", "evidenceRefs": ["hero"]}, {"id": "belt-grit", "kind": "ridge", "description": "fine abrasive grains on front and wraps", "evidenceRefs": ["hero"]}], "surfaceDetail": {"macroRoughness": 0, "microRoughness": 0, "bumpAmplitude": 0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["hero", "front", "side"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(118,62,52,1)", "secondaryAlbedo": "rgba(146,85,69,1)", "materialClass": "fabric", "materialClassConfidence": 0.9}};
  node_abrasive_loop_2.add(mesh_abrasive_loop_2);
  meshes["abrasive-loop"] = mesh_abrasive_loop_2;
  colliders["abrasive-loop"] = {"type": "box", "offset": [0, 0, 0], "scale": [1, 1, 1], "isTrigger": false};
  destructionGroups["abrasive-loop"] ??= [];
  destructionGroups["abrasive-loop"].push(node_abrasive_loop_2);

  const endpoint_work_rest_3 = makeAttachmentEndpoint(null);
  const node_work_rest_3 = new THREE.Group();
  node_work_rest_3.name = "work-rest__pivot";
  node_work_rest_3.scale.set(1, 1, 1);
  if (endpoint_work_rest_3) {
    node_work_rest_3.position.copy(endpoint_work_rest_3.start);
    node_work_rest_3.rotation.set(0.0, 0.0, 0.0);
  } else {
    node_work_rest_3.position.set(-0.2435, 0.864, 0.0);
    node_work_rest_3.rotation.set(0.0, 0.0, 0.0);
  }
  node_work_rest_3.userData.sculptComponent = {"id": "work-rest", "name": "work-rest", "level": "macro", "role": "work-rest", "importance": 1, "confidence": 0.85, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "A distinct manufactured mechanical component; its contacting joints remain independently named.", "geometryDescriptor": {"edgeTreatment": {"type": "chamfer", "bevelRadius": 0.002, "segments": 1}, "deformationStack": [], "uvStrategy": "object-space metres", "normalStrategy": "flat bevels and smooth cylindrical faces"}, "parent": null, "attachment": null, "dimensions": {"width": 0.235, "height": 0.022, "depth": 0.44, "units": "metres", "confidence": 0.85}, "transform": {"position": [-0.2435, 0.864, 0], "rotation": [0, 0, 0], "scale": [0.235, 0.022, 0.44]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 0, 1], "confidence": 1}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "visibility": true, "materialState": true}, "sockets": [{"id": "billet-home", "localPosition": [0.0945, 0.011, 0], "axis": [1, 0, 0]}], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.235, 0.022, 0.44], "isTrigger": false}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "work-rest", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "steel"}}, "material": "steel", "materialLayers": ["steel"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "rest-bevel", "kind": "bevel", "description": "2mm exposed leading edge chamfer", "evidenceRefs": ["hero"]}, {"id": "working-scratches", "kind": "scratch", "description": "directional metal contact scratches", "evidenceRefs": ["hero"]}], "surfaceDetail": {"macroRoughness": 0, "microRoughness": 0, "bumpAmplitude": 0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["hero", "front", "side"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(75,65,60,1)", "secondaryAlbedo": "rgba(145,132,122,1)", "materialClass": "metal", "materialClassConfidence": 0.9}};
  node_work_rest_3.userData.actionProfile = {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 0, 1], "confidence": 1}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "visibility": true, "materialState": true}, "sockets": [{"id": "billet-home", "localPosition": [0.0945, 0.011, 0], "axis": [1, 0, 0]}], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.235, 0.022, 0.44], "isTrigger": false}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "work-rest", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "steel"}};
  (nodes["root"] ?? root).add(node_work_rest_3);
  nodes["work-rest"] = node_work_rest_3;
  const mesh_work_rest_3Geometry = endpoint_work_rest_3
    ? new THREE.CylinderGeometry(endpoint_work_rest_3.endRadius, endpoint_work_rest_3.baseRadius, endpoint_work_rest_3.length, 16, 6)
    : new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
  if (!endpoint_work_rest_3) {
    mesh_work_rest_3Geometry.scale(0.235, 0.022, 0.44);
  }
  const mesh_work_rest_3 = new THREE.Mesh(
    mesh_work_rest_3Geometry,
    materialMap["steel"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_work_rest_3.name = "work-rest";
  if (endpoint_work_rest_3) {
    mesh_work_rest_3.position.copy(endpoint_work_rest_3.midpoint);
    mesh_work_rest_3.quaternion.copy(endpoint_work_rest_3.quaternion);
  }
  mesh_work_rest_3.castShadow = options.castShadow ?? true;
  mesh_work_rest_3.receiveShadow = options.receiveShadow ?? true;
  mesh_work_rest_3.userData.sculptComponent = {"id": "work-rest", "name": "work-rest", "level": "macro", "role": "work-rest", "importance": 1, "confidence": 0.85, "primitive": "box", "topologyClass": "assembled-solid", "topologyRationale": "A distinct manufactured mechanical component; its contacting joints remain independently named.", "geometryDescriptor": {"edgeTreatment": {"type": "chamfer", "bevelRadius": 0.002, "segments": 1}, "deformationStack": [], "uvStrategy": "object-space metres", "normalStrategy": "flat bevels and smooth cylindrical faces"}, "parent": null, "attachment": null, "dimensions": {"width": 0.235, "height": 0.022, "depth": 0.44, "units": "metres", "confidence": 0.85}, "transform": {"position": [-0.2435, 0.864, 0], "rotation": [0, 0, 0], "scale": [0.235, 0.022, 0.44]}, "actionProfile": {"animationRole": "static", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 0, 1], "confidence": 1}, "transformChannels": {"translate": false, "rotate": false, "scale": false, "visibility": true, "materialState": true}, "sockets": [{"id": "billet-home", "localPosition": [0.0945, 0.011, 0], "axis": [1, 0, 0]}], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.235, 0.022, 0.44], "isTrigger": false}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "work-rest", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "steel"}}, "material": "steel", "materialLayers": ["steel"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "rest-bevel", "kind": "bevel", "description": "2mm exposed leading edge chamfer", "evidenceRefs": ["hero"]}, {"id": "working-scratches", "kind": "scratch", "description": "directional metal contact scratches", "evidenceRefs": ["hero"]}], "surfaceDetail": {"macroRoughness": 0, "microRoughness": 0, "bumpAmplitude": 0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["hero", "front", "side"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(75,65,60,1)", "secondaryAlbedo": "rgba(145,132,122,1)", "materialClass": "metal", "materialClassConfidence": 0.9}};
  node_work_rest_3.add(mesh_work_rest_3);
  meshes["work-rest"] = mesh_work_rest_3;
  colliders["work-rest"] = {"type": "box", "offset": [0, 0, 0], "scale": [0.235, 0.022, 0.44], "isTrigger": false};
  destructionGroups["work-rest"] ??= [];
  destructionGroups["work-rest"].push(node_work_rest_3);
  const socket_work_rest_billet_home_0 = new THREE.Object3D();
  socket_work_rest_billet_home_0.name = "billet-home";
  socket_work_rest_billet_home_0.position.set(0.0945, 0.011, 0.0);
  socket_work_rest_billet_home_0.rotation.set(0, 0, 0);
  socket_work_rest_billet_home_0.userData.socket = {"id": "billet-home", "localPosition": [0.0945, 0.011, 0], "axis": [1, 0, 0]};
  node_work_rest_3.add(socket_work_rest_billet_home_0);
  sockets["work-rest:billet-home"] = socket_work_rest_billet_home_0;

  const attachment_drive_wheel_4 = null;
  const endpoint_drive_wheel_4 = makeAttachmentEndpoint(attachment_drive_wheel_4);
  const node_drive_wheel_4 = new THREE.Group();
  node_drive_wheel_4.name = "drive-wheel__pivot";
  node_drive_wheel_4.scale.set(1, 1, 1);
  if (endpoint_drive_wheel_4) {
    node_drive_wheel_4.position.copy(endpoint_drive_wheel_4.start);
    node_drive_wheel_4.rotation.set(1.5707963267948966, 0.0, 0.0);
  } else {
    node_drive_wheel_4.position.set(0.36, 0.46, 0.13);
    node_drive_wheel_4.rotation.set(1.5707963267948966, 0.0, 0.0);
  }
  node_drive_wheel_4.userData.sculptComponent = {"id": "drive-wheel", "name": "drive-wheel", "level": "macro", "role": "drive-wheel", "importance": 1, "confidence": 0.85, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "A distinct manufactured mechanical component; its contacting joints remain independently named.", "geometryDescriptor": {"edgeTreatment": {"type": "chamfer", "bevelRadius": 0.002, "segments": 1}, "deformationStack": [], "uvStrategy": "object-space metres", "normalStrategy": "flat bevels and smooth cylindrical faces"}, "parent": null, "attachment": null, "dimensions": {"width": 0.25, "height": 0.056, "depth": 0.25, "units": "metres", "confidence": 0.85}, "transform": {"position": [0.36, 0.46, 0.13], "rotation": [1.5707963267948966, 0, 0], "scale": [0.25, 0.056, 0.25]}, "actionProfile": {"animationRole": "rotor", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 0, 1], "confidence": 1}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.25, 0.056, 0.25], "isTrigger": false}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "drive-wheel", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "iron"}}, "material": "iron", "materialLayers": ["iron"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "drive-rim", "kind": "ridge", "description": "raised side transmission rim", "evidenceRefs": ["hero"]}], "surfaceDetail": {"macroRoughness": 0, "microRoughness": 0, "bumpAmplitude": 0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["hero", "front", "side"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(75,65,60,1)", "secondaryAlbedo": "rgba(145,132,122,1)", "materialClass": "metal", "materialClassConfidence": 0.9}};
  node_drive_wheel_4.userData.actionProfile = {"animationRole": "rotor", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 0, 1], "confidence": 1}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.25, 0.056, 0.25], "isTrigger": false}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "drive-wheel", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "iron"}};
  (nodes["root"] ?? root).add(node_drive_wheel_4);
  nodes["drive-wheel"] = node_drive_wheel_4;
  const mesh_drive_wheel_4Geometry = endpoint_drive_wheel_4
    ? new THREE.CylinderGeometry(endpoint_drive_wheel_4.endRadius, endpoint_drive_wheel_4.baseRadius, endpoint_drive_wheel_4.length, 16, 6)
    : new THREE.CylinderGeometry(0.5, 0.5, 1, 24, 8);
  if (!endpoint_drive_wheel_4) {
    mesh_drive_wheel_4Geometry.scale(0.25, 0.056, 0.25);
  }
  const mesh_drive_wheel_4 = new THREE.Mesh(
    mesh_drive_wheel_4Geometry,
    materialMap["iron"] ?? new THREE.MeshStandardMaterial({ color: 0x888888 })
  );
  mesh_drive_wheel_4.name = "drive-wheel";
  if (endpoint_drive_wheel_4) {
    mesh_drive_wheel_4.position.copy(endpoint_drive_wheel_4.midpoint);
    mesh_drive_wheel_4.quaternion.copy(endpoint_drive_wheel_4.quaternion);
  }
  mesh_drive_wheel_4.castShadow = options.castShadow ?? true;
  mesh_drive_wheel_4.receiveShadow = options.receiveShadow ?? true;
  mesh_drive_wheel_4.userData.sculptComponent = {"id": "drive-wheel", "name": "drive-wheel", "level": "macro", "role": "drive-wheel", "importance": 1, "confidence": 0.85, "primitive": "cylinder", "topologyClass": "assembled-solid", "topologyRationale": "A distinct manufactured mechanical component; its contacting joints remain independently named.", "geometryDescriptor": {"edgeTreatment": {"type": "chamfer", "bevelRadius": 0.002, "segments": 1}, "deformationStack": [], "uvStrategy": "object-space metres", "normalStrategy": "flat bevels and smooth cylindrical faces"}, "parent": null, "attachment": null, "dimensions": {"width": 0.25, "height": 0.056, "depth": 0.25, "units": "metres", "confidence": 0.85}, "transform": {"position": [0.36, 0.46, 0.13], "rotation": [1.5707963267948966, 0, 0], "scale": [0.25, 0.056, 0.25]}, "actionProfile": {"animationRole": "rotor", "pivot": {"mode": "center", "localPosition": [0, 0, 0], "axis": [0, 0, 1], "confidence": 1}, "transformChannels": {"translate": false, "rotate": true, "scale": false, "visibility": true, "materialState": true}, "sockets": [], "collider": {"type": "box", "offset": [0, 0, 0], "scale": [0.25, 0.056, 0.25], "isTrigger": false}, "constraints": [], "destruction": {"breakable": false, "fractureGroup": "drive-wheel", "seamRefs": [], "detachableFragments": [], "breakImpulse": 0, "debrisMaterial": "iron"}}, "material": "iron", "materialLayers": ["iron"], "deformations": [], "joints": [], "seams": [], "localFeatures": [{"id": "drive-rim", "kind": "ridge", "description": "raised side transmission rim", "evidenceRefs": ["hero"]}], "surfaceDetail": {"macroRoughness": 0, "microRoughness": 0, "bumpAmplitude": 0, "normalPattern": "", "displacementPattern": "", "occlusionPattern": "", "edgeWearPattern": "", "notes": ""}, "evidenceRefs": ["hero", "front", "side"], "details": [], "fidelityTier": "blockout", "colorMaterialRecipe": {"dominantAlbedo": "rgba(75,65,60,1)", "secondaryAlbedo": "rgba(145,132,122,1)", "materialClass": "metal", "materialClassConfidence": 0.9}};
  node_drive_wheel_4.add(mesh_drive_wheel_4);
  meshes["drive-wheel"] = mesh_drive_wheel_4;
  colliders["drive-wheel"] = {"type": "box", "offset": [0, 0, 0], "scale": [0.25, 0.056, 0.25], "isTrigger": false};
  destructionGroups["drive-wheel"] ??= [];
  destructionGroups["drive-wheel"].push(node_drive_wheel_4);

  root.userData.sculptRuntime = { nodes, meshes, sockets, colliders, destructionGroups } satisfies ProceduralModelRuntime;
  root.userData.lookDevTargets = {"qualityPriority": "reference-fidelity", "materialPass": {"albedoPaletteRequired": true, "roughnessVariationRequired": true, "normalOrBumpRequired": true, "localOverridesRequired": true, "minimumTextureResolution": 1024, "preferredTextureResolution": 2048, "independentMapChannels": ["albedo", "roughness", "height", "normal", "ambient-occlusion"], "requiredSurfaceFrequencyBands": ["macro", "meso", "micro"], "geometryReliefRequiredWhenSilhouetteAffected": true, "referencePbrExtraction": {"requiredWhenSourceImagePresent": true, "targetThreshold": 0.7, "stopOnLowConfidence": true, "script": "forge/stage1_intake/extract_pbr_evidence.py", "acceptedLimitation": "single-image extraction is reference-derived inference, not exact photogrammetry"}, "mustAvoid": ["single flat albedo per material", "uniform roughness", "albedo texture reused as roughness/height/normal/AO", "single-frequency random noise", "plastic-looking smooth bark, stone, cloth, foliage, or aged material", "local color/detail described only in prose without material masks", "claiming exact PBR recovery when confidence is below the target threshold"]}, "lightingPass": {"requiredTerms": ["key light", "fill light", "rim or environment light", "exposure", "tone mapping", "background", "contact shadow"], "mustAvoid": ["ambient-only lighting", "flat value range", "missing contact shadow", "reference lighting copied without separating material readability"]}, "screenshotReview": ["Compare albedo palette and local color zones.", "Compare roughness/normal/bump response under light.", "Compare cavity dirt, edge wear, stains, moss, scratches, or other local masks.", "Compare key/fill/rim structure, exposure, tone mapping, background, and contact shadows.", "Capture a neutral-light render to verify material readability without reference lighting.", "Capture a grazing-light close-up to expose flat normals, uniform roughness, tiling, and plastic highlights.", "Capture a reference-matched render from the same camera framing as the source."]};
  root.userData.actionReadiness = {
    note: 'Use root.userData.sculptRuntime.nodes for transforms, sockets for attachments, colliders for physics proxies, and destructionGroups for breakable sets.',
  };
  return root;
}

export function createManualVerticalBeltGrinderLookDevLights(
  mode: 'neutral' | 'grazing' | 'reference' = 'neutral',
): THREE.Group {
  const lights = new THREE.Group();
  lights.name = "manual vertical belt grinder look-dev lights";
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
  lights.userData.lightingFromPhoto = [{"type": "key light", "position": [-3, 4, 3], "color": "#fff0df", "intensity": 3}, {"type": "fill light", "position": [-2, 1, -3], "color": "#bac9df", "intensity": 1}, {"type": "rim light", "position": [3, 4, -1], "color": "#fff0d8", "intensity": 2}, {"exposure": 1.1, "toneMapping": "ACESFilmic", "background": "#353638", "contactShadow": "soft ground shadow under base and feet"}];
  lights.userData.lookDevTargets = {"qualityPriority": "reference-fidelity", "materialPass": {"albedoPaletteRequired": true, "roughnessVariationRequired": true, "normalOrBumpRequired": true, "localOverridesRequired": true, "minimumTextureResolution": 1024, "preferredTextureResolution": 2048, "independentMapChannels": ["albedo", "roughness", "height", "normal", "ambient-occlusion"], "requiredSurfaceFrequencyBands": ["macro", "meso", "micro"], "geometryReliefRequiredWhenSilhouetteAffected": true, "referencePbrExtraction": {"requiredWhenSourceImagePresent": true, "targetThreshold": 0.7, "stopOnLowConfidence": true, "script": "forge/stage1_intake/extract_pbr_evidence.py", "acceptedLimitation": "single-image extraction is reference-derived inference, not exact photogrammetry"}, "mustAvoid": ["single flat albedo per material", "uniform roughness", "albedo texture reused as roughness/height/normal/AO", "single-frequency random noise", "plastic-looking smooth bark, stone, cloth, foliage, or aged material", "local color/detail described only in prose without material masks", "claiming exact PBR recovery when confidence is below the target threshold"]}, "lightingPass": {"requiredTerms": ["key light", "fill light", "rim or environment light", "exposure", "tone mapping", "background", "contact shadow"], "mustAvoid": ["ambient-only lighting", "flat value range", "missing contact shadow", "reference lighting copied without separating material readability"]}, "screenshotReview": ["Compare albedo palette and local color zones.", "Compare roughness/normal/bump response under light.", "Compare cavity dirt, edge wear, stains, moss, scratches, or other local masks.", "Compare key/fill/rim structure, exposure, tone mapping, background, and contact shadows.", "Capture a neutral-light render to verify material readability without reference lighting.", "Capture a grazing-light close-up to expose flat normals, uniform roughness, tiling, and plastic highlights.", "Capture a reference-matched render from the same camera framing as the source."]};
  return lights;
}

// PBR materials (clearcoat/iridescence/transmission/anisotropy) need an environment
// map to visually behave as intended — call this once per renderer and assign the
// result to scene.environment before rendering. No external HDR asset required.
export function createManualVerticalBeltGrinderEnvironment(renderer: THREE.WebGLRenderer): THREE.Texture {
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
export function frameManualVerticalBeltGrinderCamera(
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
export function createManualVerticalBeltGrinderPresentationComposer(
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

export function configureManualVerticalBeltGrinderRenderer(renderer: THREE.WebGLRenderer): void {
  // Load-bearing for view-dependent finishes (anodized / Doppler): without ACES + sRGB
  // the environment reflection reads flat/washed instead of a believable metal response.
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
}

export function createManualVerticalBeltGrinderInspectControls(
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
