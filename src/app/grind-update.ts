import type { BladeSection, GrindOperation, WorkpieceOutlinePoint, WorkpieceSolid } from "../forge/index.ts";

export type AbrasiveUpdate = { readonly changed: false } | {
  readonly changed: true;
  readonly operation: GrindOperation;
  readonly solids: readonly WorkpieceSolid[];
  readonly removedSolidIds: readonly string[];
  readonly order: Int32Array;
  readonly sections: readonly { index:number; section:BladeSection }[];
  readonly outline: readonly WorkpieceOutlinePoint[];
  readonly positions: Float32Array;
  readonly colors: Float32Array;
  readonly computeMs: number;
};
