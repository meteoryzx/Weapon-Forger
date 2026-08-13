export const HAMMER_INPUT_RULES = {
  lightHammerEnergy: 0.3,
  heavyHammerEnergy: 1,
  fullChargeDurationMs: 700,
} as const;

export function hammerEnergyForPressDuration(durationMs: number): number {
  const clampedDuration = Math.min(Math.max(durationMs, 0), HAMMER_INPUT_RULES.fullChargeDurationMs);
  const progress = clampedDuration / HAMMER_INPUT_RULES.fullChargeDurationMs;
  const energy = HAMMER_INPUT_RULES.lightHammerEnergy
    + (HAMMER_INPUT_RULES.heavyHammerEnergy - HAMMER_INPUT_RULES.lightHammerEnergy) * progress;
  return Math.round(energy * 1_000) / 1_000;
}
