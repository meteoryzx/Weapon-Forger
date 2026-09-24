import { FORGE_RULES, type CutOperation, type ForgeSnapshotWorkpiece } from "../forge/index.ts";
import { Euler, Quaternion, Vector3 } from "three";
import { solidBounds } from "../forge/solid-geometry.ts";
import { WORKSHOP_SURFACE_Y, WORKSHOP_UNITS_PER_MM } from "./workshop-scale.ts";

// Table coordinates: x right, z toward the player; y is vertical in Three.js.
// These temporary poses never rotate/deform the persisted material geometry.
export interface CutPose {
  readonly x: number;
  readonly z: number;
  /** World Y rotation (Q/E). */
  readonly angle: number;
  /** World X rotation (W/S). */
  readonly pitch?: number;
  /** World Z rotation (A/D). */
  readonly roll?: number;
}
export const CUT_TABLE = { halfWidth: 48, halfDepth: 32, surface: WORKSHOP_SURFACE_Y, scale: WORKSHOP_UNITS_PER_MM } as const;
// The blade starts 90 mm before the table centre. At the shared 0.08 scene
// scale, the billet's 48 mm width therefore stays under the finite sweep.
// The finite sweep ends at the tabletop center, making partial cuts accessible
// there. Rendering, animation and execution all consume these same endpoints.
export const SAW_PATH = { x: 0, startZ: -FORGE_RULES.sawTravelLength * CUT_TABLE.scale, endZ: 0 } as const;
export const CUT_HOME: CutPose = { x: 0, z: (SAW_PATH.startZ + SAW_PATH.endZ) / 2, angle: 0, pitch: 0, roll: 0 };

export function cutQuaternion(pose: CutPose): Quaternion {
  return new Quaternion().setFromEuler(new Euler(pose.pitch ?? 0, pose.angle, pose.roll ?? 0, "YXZ"));
}

export function cutBounds(piece: ForgeSnapshotWorkpiece) {
  if (piece.geometry.solids) return solidBounds(piece.geometry.solids, piece.geometry);
  const nodes = piece.geometry.nodes;
  return { minX: Math.min(...nodes.map(n => n.axialPosition)), maxX: Math.max(...nodes.map(n => n.axialPosition)),
    minY: Math.min(...nodes.map(n => n.verticalOffset)), maxY: Math.max(...nodes.map(n => n.verticalOffset)),
    minZ: Math.min(...nodes.map(n => n.lateralOffset)), maxZ: Math.max(...nodes.map(n => n.lateralOffset)) };
}

export function tablePoint(piece: ForgeSnapshotWorkpiece, pose: CutPose, x: number, z: number) {
  const bounds = cutBounds(piece);
  const point = new Vector3(
    (x - (bounds.minX + bounds.maxX) / 2) * CUT_TABLE.scale,
    0,
    (z - (bounds.minZ + bounds.maxZ) / 2) * CUT_TABLE.scale,
  ).applyQuaternion(cutQuaternion(pose));
  return { x: pose.x + point.x, z: pose.z + point.z };
}

export function validCutPose(pose: CutPose): boolean {
  // Overhang is allowed. Only the finite tool sweep determines whether a cut
  // reaches material; table bounds and other stored pieces never clamp a pose.
  return [pose.x, pose.z, pose.angle, pose.pitch ?? 0, pose.roll ?? 0].every(Number.isFinite);
}

export function cutOperationFor(piece: ForgeSnapshotWorkpiece, pose: CutPose, operationIndex: number): CutOperation {
  const bounds = cutBounds(piece), inverse = cutQuaternion(pose).invert();
  const centerX=(bounds.minX+bounds.maxX)/2, centerZ=(bounds.minZ+bounds.maxZ)/2;
  const local = (z: number) => {
    const point=new Vector3(SAW_PATH.x-pose.x,0,z-pose.z).applyQuaternion(inverse).multiplyScalar(1/CUT_TABLE.scale);
    return {axialPosition:centerX+point.x,lateralOffset:centerZ+point.z};
  };
  return { kind: "cut", path: { id: `saw-${operationIndex}`, start: local(SAW_PATH.startZ), end: local(SAW_PATH.endZ), kerfWidth: FORGE_RULES.sawKerfWidth } };
}
