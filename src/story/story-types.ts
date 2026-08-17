import type { WeaponDimensions } from "../evaluate/index.ts";

// 每个事件都声明它读取了哪个维度、特性或缺陷，保证后果可追溯到武器事实。
export interface StoryEvent {
  readonly situationId: string;
  readonly branchId: string;
  readonly title: string;
  readonly text: string;
  readonly reads: readonly string[];
}

export interface StoryEnding {
  readonly id: string;
  readonly title: string;
  readonly text: string;
  readonly reads: readonly string[];
}

export interface StoryResult {
  readonly seed: string;
  readonly npcName: string;
  readonly events: readonly StoryEvent[];
  readonly ending: StoryEnding;
}

export type StoryCondition =
  | { readonly kind: "dimension"; readonly dimension: keyof WeaponDimensions; readonly min?: number; readonly max?: number }
  | { readonly kind: "has-trait"; readonly traitId: string }
  | { readonly kind: "has-flaw"; readonly flawId: string }
  | { readonly kind: "not"; readonly condition: StoryCondition }
  | { readonly kind: "all"; readonly conditions: readonly StoryCondition[] }
  | { readonly kind: "any"; readonly conditions: readonly StoryCondition[] }
  | { readonly kind: "default" };

export interface StoryBranch {
  readonly id: string;
  readonly title: string;
  readonly text: string;
  readonly condition: StoryCondition;
  readonly reads: readonly string[];
}
