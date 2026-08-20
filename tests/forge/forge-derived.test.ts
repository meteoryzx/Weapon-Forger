import { describe, expect, it } from "vitest";

import {
  applyForgeOperation,
  deriveForgeData,
  createForgeState,
  REALISTIC_FORGE_PROFILE,
  type ForgeDerivationProfile,
} from "../../src/forge/index.ts";

describe("forge derived data", () => {
  it("derives stable realistic attributes from an eight-verb replay", () => {
    let state = createForgeState({ sectionCount: 8 });
    const operations = [
      { kind: "select-material", materialId: "high-carbon-steel" },
      { kind: "cut", sectionIndex: 4 },
      { kind: "weld", benchIndex: 1 },
      { kind: "heat", temperatureC: 950 },
      { kind: "hammer", sectionIndex: 3, energy: 0.6, faceBias: 0.5 },
      { kind: "quench", medium: "water" },
      { kind: "temper", temperatureC: 220 },
      { kind: "grind", sectionIndex: 3, amount: 0.8 },
    ] as const;
    for (const operation of operations) state = applyForgeOperation(state, operation);

    const data = deriveForgeData(state);
    expect(data.profileId).toBe(REALISTIC_FORGE_PROFILE.id);
    expect(data.attributes.map((attribute) => attribute.id)).toEqual([
      "sharpness", "hardness", "toughness", "weight", "balance", "appearance",
    ]);
    expect(data.attributes.every((attribute) => Number.isFinite(attribute.value))).toBe(true);
    expect(data.traits).toContain("layered-material");
  });

  it("lets a downstream game add fictional attributes without changing forge state", () => {
    const magicProfile: ForgeDerivationProfile = {
      id: "arcane-action-game",
      version: "1",
      attributes: [
        {
          id: "armor-break",
          calculate: (facts) => facts.hardenability * 0.7 + facts.layerCount / 10,
          source: ["hardenability", "layerCount"],
        },
        {
          id: "rune-capacity",
          calculate: (facts) => facts.layerCount * facts.jointIntegrity,
          source: ["layerCount", "jointIntegrity"],
        },
      ],
    };
    const state = createForgeState({ sectionCount: 8 });
    const data = deriveForgeData(state, magicProfile);

    expect(data.profileId).toBe("arcane-action-game");
    expect(data.attributes.map((attribute) => attribute.id)).toEqual(["armor-break", "rune-capacity"]);
    expect(data.attributes.every((attribute) => attribute.source.length > 0)).toBe(true);
  });
});
