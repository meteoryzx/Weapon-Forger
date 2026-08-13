import { describe, expect, it } from "vitest";

import { HAMMER_INPUT_RULES, hammerEnergyForPressDuration } from "../../src/platform/hammer-charge.ts";

describe("hammerEnergyForPressDuration", () => {
  it("maps a tap to the fixed light-hammer energy", () => {
    expect(hammerEnergyForPressDuration(0)).toBe(HAMMER_INPUT_RULES.lightHammerEnergy);
    expect(hammerEnergyForPressDuration(-10)).toBe(HAMMER_INPUT_RULES.lightHammerEnergy);
  });

  it("scales a held press deterministically and caps it at a heavy hammer", () => {
    expect(hammerEnergyForPressDuration(350)).toBe(0.65);
    expect(hammerEnergyForPressDuration(HAMMER_INPUT_RULES.fullChargeDurationMs)).toBe(HAMMER_INPUT_RULES.heavyHammerEnergy);
    expect(hammerEnergyForPressDuration(2_000)).toBe(HAMMER_INPUT_RULES.heavyHammerEnergy);
  });
});
