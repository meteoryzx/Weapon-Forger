import { describe, expect, it } from "vitest";
import {
  applyForgeOperation,
  createForgeFacts,
  createForgeState,
  HIGH_CARBON_STEEL,
  type ForgeState,
} from "../../src/forge/index.ts";
import { deriveWeaponResult } from "../../src/weapon/index.ts";

function forgedBlade(): ForgeState {
  let state = createForgeState({ material: HIGH_CARBON_STEEL, sectionCount: 16 });
  state = applyForgeOperation(state, { kind: "heat", temperatureC: 950 });
  state = applyForgeOperation(state, { kind: "hammer", sectionIndex: 8, energy: 0.5 });
  state = applyForgeOperation(state, { kind: "quench", medium: "oil" });
  state = applyForgeOperation(state, { kind: "temper", temperatureC: 220, durationMs: 60_000 });
  state = applyForgeOperation(state, {
    kind: "grind",
    sectionIndex: 8,
    amount: 0.7,
    contact: {
      axialPosition: 8,
      verticalOffset: 0,
      axialWidth: 5,
      verticalHeight: 24,
      depth: 1.5,
      angle: Math.PI / 8,
    },
  });
  return state;
}

describe("weapon result consumer", () => {
  it("derives a usable blade profile from the shared forge facts", () => {
    const raw = deriveWeaponResult(createForgeFacts(createForgeState({ sectionCount: 16 })));
    const forged = deriveWeaponResult(createForgeFacts(forgedBlade()));

    expect(forged.materialIds).toEqual(["high-carbon-steel"]);
    expect(forged.massKg).toBeGreaterThan(0);
    expect(forged.reachMm).toBeGreaterThan(0);
    expect(forged.edgeEffectiveness).toBeGreaterThan(raw.edgeEffectiveness);
    expect(forged.hardness).toBeGreaterThan(raw.hardness);
    expect(forged.durability).toBeGreaterThan(0);
    expect(forged.usable).toBe(true);
  });

  it("changes downstream hardness and durability when the forge facts change", () => {
    const oil = deriveWeaponResult(createForgeFacts(forgedBlade()));
    let waterState = forgedBlade();
    waterState = applyForgeOperation(waterState, { kind: "quench", medium: "water" });
    const water = deriveWeaponResult(createForgeFacts(waterState));

    expect(water.hardness).toBeGreaterThan(oil.hardness);
    expect(water.materialIds).toEqual(oil.materialIds);
  });

  it("is deterministic for the same facts", () => {
    const facts = createForgeFacts(forgedBlade());
    expect(deriveWeaponResult(facts)).toEqual(deriveWeaponResult(facts));
  });
});
