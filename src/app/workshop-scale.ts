// Shared physical-to-scene conversion. Workstations fit the material; material
// is never rescaled to fit a slot, a tool opening or a particular camera.
// Scene units are authored around the existing Three.js room dimensions:
// 875 mm work surfaces map to 70 units, so one scene unit is 12.5 mm.
export const WORKSHOP_UNITS_PER_MM = 0.08;
export const WORKSHOP_FLOOR_Y = -30;
export const WORKSHOP_SURFACE_Y = workshopUnits(875) + WORKSHOP_FLOOR_Y;
export const FURNACE_BODY_SCALE_Y = 0.78;
export const QUENCH_BODY_SCALE_Y = 0.55;
export const FURNACE_HEARTH_Y = WORKSHOP_FLOOR_Y + (WORKSHOP_SURFACE_Y - WORKSHOP_FLOOR_Y) * FURNACE_BODY_SCALE_Y;
export const QUENCH_SURFACE_Y = WORKSHOP_FLOOR_Y + (WORKSHOP_SURFACE_Y - WORKSHOP_FLOOR_Y) * QUENCH_BODY_SCALE_Y;

// Authoring contract for every workstation model. Keep dimensions in mm here;
// render code converts them at the boundary instead of inventing local scales.
export const WORKSHOP_STANDARD = {
  humanHeightMm: 1750,
  eyeHeightMm: 1600,
  workSurfaceHeightMm: 875,
  workbenchDepthMm: 800,
  anvilSurfaceHeightMm: 875,
  standardBilletMm: { length: 336, width: 48, thickness: 8 },
  camera: { fov: 48, downwardDegrees: 30 },
  room: { width: 5600, depth: 5200, clearPath: 600 },
} as const;

export function workshopUnits(mm: number): number {
  return mm * WORKSHOP_UNITS_PER_MM;
}

export interface WorkshopStationDefinition {
  readonly origin: readonly [number, number, number];
  readonly footprint: readonly [number, number];
  readonly workSurfaceY: number;
  readonly cameraTarget: readonly [number, number, number];
}

// One source of truth for the playable room. Origins are scene units; physical
// dimensions remain in millimetres and are converted at model boundaries.
export const WORKSHOP_LAYOUT: Record<string, WorkshopStationDefinition> = {
  materials: { origin: [-125, 0, -112], footprint: [134, 116], workSurfaceY: 40, cameraTarget: [-125, 48, -120] },
  cut: { origin: [-145, 0, 70], footprint: [68, 100], workSurfaceY: 40, cameraTarget: [-145, 40, 70] },
  anvil: { origin: [0, 0, 0], footprint: [66, 48], workSurfaceY: 40, cameraTarget: [0, 40, 0] },
  furnace: { origin: [76, 0, -135], footprint: [82, 142], workSurfaceY: 40, cameraTarget: [76, 48, -98] },
  quench: { origin: [-34, 0, -160], footprint: [48, 92], workSurfaceY: 40, cameraTarget: [-34, 40, -160] },
  "quench-oil": { origin: [15, 0, -160], footprint: [48, 92], workSurfaceY: 40, cameraTarget: [15, 40, -160] },
  grind: { origin: [150, 0, 132], footprint: [92, 92], workSurfaceY: 40, cameraTarget: [150, 40, 154] },
  power: { origin: [150, 0, 24], footprint: [76, 84], workSurfaceY: 40, cameraTarget: [150, 40, 24] },
};

export function stationLayout(name: keyof typeof WORKSHOP_LAYOUT): WorkshopStationDefinition {
  return WORKSHOP_LAYOUT[name]!;
}
