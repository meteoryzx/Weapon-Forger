import type { WeaponData } from "../evaluate/index.ts";
import { ENDING_BROKEN, ENDING_FAMOUS, ENDING_SCARRED, NPC_NAMES, SITUATIONS } from "./story-data.ts";
import type { StoryCondition, StoryEnding, StoryEvent, StoryResult } from "./story-types.ts";

// 同一 WeaponData 与种子永远得到同一故事。后果分支由武器事实条件决定（可解释），
// 种子只用于挑选 NPC 名字这类不影响因果的润色。
export function tellStory(weapon: WeaponData, seed: string): StoryResult {
  const random = mulberry32(hashString(storyHashInput(weapon, seed)));
  const npcName = NPC_NAMES[Math.floor(random() * NPC_NAMES.length)] ?? NPC_NAMES[0];

  const events = SITUATIONS.map((situation): StoryEvent => {
    const branch = situation.branches.find((candidate) => matchesCondition(weapon, candidate.condition))
      ?? situation.branches.at(-1);
    if (!branch) throw new Error(`Situation ${situation.id} needs at least one branch.`);
    return {
      situationId: situation.id,
      branchId: branch.id,
      title: branch.title,
      text: branch.text,
      reads: branch.reads,
    };
  });

  return { seed, npcName, events, ending: selectEnding(weapon, events) };
}

function selectEnding(weapon: WeaponData, events: readonly StoryEvent[]): StoryEnding {
  const broke = events.some((event) => event.branchId === "block-break");
  if (broke) return { ...ENDING_BROKEN };
  if (weapon.dimensions.sharpness >= 0.7 && weapon.dimensions.hardness >= 0.7) return { ...ENDING_FAMOUS };
  return { ...ENDING_SCARRED };
}

function matchesCondition(weapon: WeaponData, condition: StoryCondition): boolean {
  switch (condition.kind) {
    case "dimension": {
      const value = weapon.dimensions[condition.dimension];
      if (condition.min !== undefined && value < condition.min) return false;
      if (condition.max !== undefined && value > condition.max) return false;
      return true;
    }
    case "has-trait":
      return weapon.traits.some((trait) => trait.id === condition.traitId);
    case "has-flaw":
      return weapon.flaws.some((flaw) => flaw.id === condition.flawId);
    case "not":
      return !matchesCondition(weapon, condition.condition);
    case "all":
      return condition.conditions.every((child) => matchesCondition(weapon, child));
    case "any":
      return condition.conditions.some((child) => matchesCondition(weapon, child));
    case "default":
      return true;
  }
}

function storyHashInput(weapon: WeaponData, seed: string): string {
  return [
    weapon.ruleVersion,
    weapon.materialId,
    JSON.stringify(weapon.dimensions),
    weapon.traits.map((trait) => trait.id).join(","),
    weapon.flaws.map((flaw) => flaw.id).join(","),
    seed,
  ].join(":");
}

function hashString(input: string): number {
  let hash = 2_166_136_261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return hash >>> 0;
}

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6D2B79F5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}
