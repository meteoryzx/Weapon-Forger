import { FORGE_RULES, type CutOperation, type ForgeSnapshotWorkpiece } from "../forge/index.ts";
import { solidBounds } from "../forge/solid-geometry.ts";

// Table coordinates: x right, z toward the player; y is vertical in Three.js.
// These temporary poses never rotate/deform the persisted material geometry.
export interface CutPose { readonly x: number; readonly z: number; readonly angle: number }
export const CUT_TABLE = { halfWidth: 205, halfDepth: 125, surface: 72, scale: 0.8 } as const;
export const CUT_HOME: CutPose = { x: 0, z: -20, angle: 0 };
// The finite sweep ends at the tabletop center, making partial cuts accessible
// there. Rendering, animation and execution all consume these same endpoints.
export const SAW_PATH = { x: 0, startZ: -FORGE_RULES.sawTravelLength * CUT_TABLE.scale, endZ: 0 } as const;

export function cutBounds(piece: ForgeSnapshotWorkpiece) {
  if (piece.geometry.solids) return solidBounds(piece.geometry.solids, piece.geometry);
  const nodes = piece.geometry.nodes;
  return { minX: Math.min(...nodes.map(n => n.axialPosition)), maxX: Math.max(...nodes.map(n => n.axialPosition)),
    minY: Math.min(...nodes.map(n => n.verticalOffset)), maxY: Math.max(...nodes.map(n => n.verticalOffset)),
    minZ: Math.min(...nodes.map(n => n.lateralOffset)), maxZ: Math.max(...nodes.map(n => n.lateralOffset)) };
}

export function tablePoint(piece: ForgeSnapshotWorkpiece, pose: CutPose, x: number, z: number) {
  const bounds = cutBounds(piece), c = Math.cos(pose.angle), s = Math.sin(pose.angle);
  const dx = (x - (bounds.minX + bounds.maxX) / 2) * CUT_TABLE.scale;
  const dz = (z - (bounds.minZ + bounds.maxZ) / 2) * CUT_TABLE.scale;
  return { x: pose.x + c * dx + s * dz, z: pose.z - s * dx + c * dz };
}

export function validCutPose(pose: CutPose): boolean {
  // Overhang is allowed. Only the finite tool sweep determines whether a cut
  // reaches material; table bounds and other stored pieces never clamp a pose.
  return [pose.x, pose.z, pose.angle].every(Number.isFinite);
}

export function cutOperationFor(piece: ForgeSnapshotWorkpiece, pose: CutPose, operationIndex: number): CutOperation {
  const bounds = cutBounds(piece), c = Math.cos(pose.angle), s = Math.sin(pose.angle);
  const local = (z: number) => ({
    axialPosition: (bounds.minX + bounds.maxX) / 2 + (c * (SAW_PATH.x-pose.x) - s * (z-pose.z)) / CUT_TABLE.scale,
    lateralOffset: (bounds.minZ + bounds.maxZ) / 2 + (s * (SAW_PATH.x-pose.x) + c * (z-pose.z)) / CUT_TABLE.scale,
  });
  return { kind: "cut", path: { id: `saw-${operationIndex}`, start: local(SAW_PATH.startZ), end: local(SAW_PATH.endZ), kerfWidth: FORGE_RULES.sawKerfWidth } };
}
