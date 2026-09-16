import type { ForgeFacts } from "../forge/index.ts";

/**
 * A deliberately small downstream interpretation of forge facts. These are
 * weapon-game values, so they stay outside the portable forge simulation.
 */
export interface WeaponResult {
  readonly materialIds: readonly string[];
  readonly massKg: number;
  readonly reachMm: number;
  readonly balanceOffsetMm: number;
  readonly edgeEffectiveness: number;
  readonly hardness: number;
  readonly durability: number;
  readonly usable: boolean;
}

const WEAPON_RESULT_TUNING = {
  oilQuenchHardness: 0.82,
  waterQuenchHardness: 0.92,
  airHardness: 0.15,
  temperHardnessLoss: 0.08,
  temperDurabilityGain: 0.1,
  usableDurability: 0.35,
} as const;

export function deriveWeaponResult(facts: ForgeFacts): WeaponResult {
  const edgeCoverage = clamp(facts.edgeCoverage);
  const edgeEvenness = clamp(facts.edgeEvenness);
  const edgeEffectiveness = clamp(edgeCoverage * edgeEvenness);
  const quenchHardness = facts.quenchMedium === "water"
    ? WEAPON_RESULT_TUNING.waterQuenchHardness
    : facts.quenchMedium === "oil"
      ? WEAPON_RESULT_TUNING.oilQuenchHardness
      : WEAPON_RESULT_TUNING.airHardness;
  const temperFactor = facts.temperTemperatureC === null
    ? 0
    : clamp(1 - Math.abs(facts.temperTemperatureC - 220) / 220);
  const hardness = clamp(
    facts.carbon * 0.45
      + facts.hardenability * quenchHardness * 0.35
      + edgeEffectiveness * 0.2
      - temperFactor * WEAPON_RESULT_TUNING.temperHardnessLoss
      - facts.damage * 0.25,
  );
  const durability = clamp(
    facts.materialDamageResistance
      * clamp(facts.jointIntegrity)
      * (1 - clamp(facts.damage))
      * (1 - clamp(facts.stress) * 0.35)
      + temperFactor * WEAPON_RESULT_TUNING.temperDurabilityGain,
  );

  return {
    materialIds: [...new Set(facts.materialRegions.map(region => region.materialId))],
    massKg: facts.totalVolume * facts.densityKgPerM3 * 1e-9,
    reachMm: Math.max(0, facts.totalLength),
    balanceOffsetMm: facts.centerOfMass - facts.totalLength / 2,
    edgeEffectiveness,
    hardness,
    durability,
    usable: facts.totalVolume > 0
      && facts.totalLength > 0
      && !facts.cracked
      && durability >= WEAPON_RESULT_TUNING.usableDurability,
  };
}

function clamp(value: number, minimum = 0, maximum = 1): number {
  return Math.min(maximum, Math.max(minimum, Number.isFinite(value) ? value : minimum));
}
