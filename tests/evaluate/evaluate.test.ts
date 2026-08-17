import { describe, expect, it } from "vitest";

import { evaluateWeapon, type WeaponData } from "../../src/evaluate/index.ts";
import { applyForgeOperation, createForgeState } from "../../src/forge/index.ts";

function evaluate(operations: ReadonlyArray<Parameters<typeof applyForgeOperation>[1]>, sectionCount = 8): WeaponData {
  let state = createForgeState({ sectionCount });
  for (const operation of operations) state = applyForgeOperation(state, operation);
  return evaluateWeapon(state);
}

describe("evaluate", () => {
  it("is deterministic for the same forged state", () => {
    const operations = [
      { kind: "heat", temperatureC: 950 },
      { kind: "quench", medium: "water" },
      { kind: "grind", sectionIndex: 2, amount: 0.5 },
    ] as const;
    expect(evaluate(operations)).toEqual(evaluate(operations));
  });

  it("keeps an unquenched, unground billet soft and blunt but tough", () => {
    const weapon = evaluate([{ kind: "heat", temperatureC: 900 }]);
    expect(weapon.dimensions.hardness).toBeCloseTo(0.18, 8);
    expect(weapon.dimensions.sharpness).toBeLessThan(0.5);
    expect(weapon.dimensions.toughness).toBeGreaterThan(0.7);
  });

  it("hardens more with water than oil, and more from hot than cold", () => {
    const annealed = evaluate([{ kind: "heat", temperatureC: 950 }]);
    const oil = evaluate([{ kind: "heat", temperatureC: 950 }, { kind: "quench", medium: "oil" }]);
    const water = evaluate([{ kind: "heat", temperatureC: 950 }, { kind: "quench", medium: "water" }]);
    const coldWater = evaluate([{ kind: "heat", temperatureC: 400 }, { kind: "quench", medium: "water" }]);

    expect(water.dimensions.hardness).toBeGreaterThan(oil.dimensions.hardness);
    expect(oil.dimensions.hardness).toBeGreaterThan(annealed.dimensions.hardness);
    expect(coldWater.dimensions.hardness).toBeLessThan(water.dimensions.hardness);
  });

  it("grinding raises sharpness and leaves no unsharpened flaw", () => {
    const unground = evaluate([{ kind: "heat", temperatureC: 950 }, { kind: "quench", medium: "water" }]);
    const ground: Parameters<typeof applyForgeOperation>[1][] = [
      { kind: "heat", temperatureC: 950 },
      { kind: "quench", medium: "water" },
    ];
    for (let index = 0; index < 8; index += 1) ground.push({ kind: "grind", sectionIndex: index, amount: 1 });
    const groundWeapon = evaluate(ground);

    expect(groundWeapon.dimensions.sharpness).toBeGreaterThan(unground.dimensions.sharpness);
    expect(unground.flaws.some((flaw) => flaw.id === "unsharpened")).toBe(true);
    expect(groundWeapon.flaws.some((flaw) => flaw.id === "unsharpened")).toBe(false);
  });

  it("turns a cold-forged cracked billet into a toughness-reducing crack flaw", () => {
    let state = createForgeState({ sectionCount: 31 });
    state = applyForgeOperation(state, { kind: "heat", temperatureC: 450 });
    for (let hit = 0; hit < 6; hit += 1) {
      state = applyForgeOperation(state, { kind: "hammer", sectionIndex: 15, energy: 1, lateralBias: 0 });
    }
    const weapon = evaluateWeapon(state);

    expect(weapon.flaws.some((flaw) => flaw.id === "cracked")).toBe(true);
    expect(weapon.dimensions.toughness).toBeLessThan(0.5);
  });

  it("labels every trait and flaw with a traceable source", () => {
    const weapon = evaluate([
      { kind: "heat", temperatureC: 950 },
      { kind: "quench", medium: "water" },
      { kind: "grind", sectionIndex: 0, amount: 1 },
    ]);
    for (const trait of weapon.traits) expect(trait.source.length).toBeGreaterThan(0);
    for (const flaw of weapon.flaws) expect(flaw.source.length).toBeGreaterThan(0);
  });
});
