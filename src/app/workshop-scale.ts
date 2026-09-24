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

// Station roots are allowed to face different walls while forge physics keeps
// its local anvil frame. The press faces the left operator station: the player
// stands on world -X and looks toward the +X/right wall. The hammer and grinder
// are intentionally turned 180 degrees from their previous presentation.
export const POWER_STATION_YAW = -Math.PI / 2;
export const PRESS_STATION_YAW = Math.PI / 2;
export const GRINDER_STATION_YAW = Math.PI;

/** Convert a world-space tabletop delta into a powered station's local pose delta. */
export function worldDeltaToStationPose(deltaX: number, deltaZ: number, stationYaw: number): { x: number; z: number } {
  const c = Math.cos(stationYaw), s = Math.sin(stationYaw);
  return { x: c * deltaX - s * deltaZ, z: s * deltaX + c * deltaZ };
}

/** Convert a station-local X/Z offset into the authored world frame. */
export function stationPoseToWorldDelta(localX: number, localZ: number, stationYaw: number): { x: number; z: number } {
  const c = Math.cos(stationYaw), s = Math.sin(stationYaw);
  return { x: c * localX + s * localZ, z: -s * localX + c * localZ };
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
  // The room is organized as a U around one clear operator aisle: material
  // handling on the left, forging in the middle/right, heat treatment at the
  // back, and finishing below the saw.  Positions leave real service gaps;
  // station footprints must never merely touch.
  materials: { origin: [-120, 0, -135], footprint: [134, 116], workSurfaceY: 40, cameraTarget: [-120, 48, -135] },
  cut: { origin: [-150, 0, 35], footprint: [68, 100], workSurfaceY: 40, cameraTarget: [-150, 40, 35] },
  anvil: { origin: [-12, 0, 0], footprint: [66, 48], workSurfaceY: 40, cameraTarget: [-12, 40, 0] },
  furnace: { origin: [70, 0, -135], footprint: [82, 142], workSurfaceY: 40, cameraTarget: [70, 48, -105] },
  temper: { origin: [150, 0, -135], footprint: [82, 142], workSurfaceY: 40, cameraTarget: [150, 48, -105] },
  quench: { origin: [-11, 0, -150], footprint: [48, 92], workSurfaceY: 40, cameraTarget: [-11, 40, -150] },
  // Keep both quench basins as separate stations while leaving a real service
  // gap before the furnace's measured left edge.
  "quench-oil": { origin: [24, 0, -150], footprint: [48, 92], workSurfaceY: 40, cameraTarget: [24, 40, -150] },
  grind: { origin: [-145, 0, 155], footprint: [92, 92], workSurfaceY: 40, cameraTarget: [-145, 40, 177] },
  // The authored hammer is approximately 1100 mm wide by 500 mm deep in
  // local space. Its +90 degree presentation yaw swaps those axes in the
  // room, so the reserved envelope must be wider in X and shallower in Z.
  // Pull the hammer away from the east/right wall while keeping its service
  // side clear of the anvil and its lower-right press neighbour.
  power: { origin: [105, 0, 20], footprint: [124, 84], workSurfaceY: 40, cameraTarget: [105, 40, 60] },
  // The +90 degree presentation swaps the press' authored width/depth;
  // reserve the measured rotated envelope and keep its service side inside the back wall.
  press: { origin: [120, 0, 155], footprint: [80, 82], workSurfaceY: 40, cameraTarget: [120, 40, 155] },
};

export function stationLayout(name: keyof typeof WORKSHOP_LAYOUT): WorkshopStationDefinition {
  return WORKSHOP_LAYOUT[name]!;
}
