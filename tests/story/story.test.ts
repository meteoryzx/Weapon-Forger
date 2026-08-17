import { describe, expect, it } from "vitest";

import { evaluateWeapon, type WeaponData } from "../../src/evaluate/index.ts";
import { applyForgeOperation, createForgeState } from "../../src/forge/index.ts";
import { tellStory } from "../../src/story/index.ts";

function weaponFrom(operations: ReadonlyArray<Parameters<typeof applyForgeOperation>[1]>, sectionCount = 8): WeaponData {
  let state = createForgeState({ sectionCount });
  for (const operation of operations) state = applyForgeOperation(state, operation);
  return evaluateWeapon(state);
}

describe("story", () => {
  it("returns the same story for the same weapon and seed", () => {
    const weapon = weaponFrom([{ kind: "heat", temperatureC: 950 }, { kind: "quench", medium: "water" }]);
    expect(tellStory(weapon, "demo")).toEqual(tellStory(weapon, "demo"));
  });

  it("breaks a cracked weapon during the block situation and ends broken", () => {
    let state = createForgeState({ sectionCount: 31 });
    state = applyForgeOperation(state, { kind: "heat", temperatureC: 450 });
    for (let hit = 0; hit < 6; hit += 1) {
      state = applyForgeOperation(state, { kind: "hammer", sectionIndex: 15, energy: 1, lateralBias: 0 });
    }
    const story = tellStory(evaluateWeapon(state), "test");

    expect(story.events.some((event) => event.branchId === "block-break")).toBe(true);
    expect(story.ending.id).toBe("broken");
  });

  it("gives a sharp, hardened blade different consequences than a blunt one", () => {
    const sharp: Parameters<typeof applyForgeOperation>[1][] = [
      { kind: "heat", temperatureC: 950 },
      { kind: "quench", medium: "water" },
    ];
    for (let index = 0; index < 8; index += 1) sharp.push({ kind: "grind", sectionIndex: index, amount: 1 });
    const blunt = weaponFrom([{ kind: "heat", temperatureC: 950 }]);

    const sharpStory = tellStory(weaponFrom(sharp), "demo");
    const bluntStory = tellStory(blunt, "demo");

    expect(sharpStory.events).not.toEqual(bluntStory.events);
    expect(bluntStory.events.some((event) => event.branchId === "cut-dull")).toBe(true);
  });

  it("records which weapon facts every event reads", () => {
    const weapon = weaponFrom([{ kind: "heat", temperatureC: 950 }, { kind: "quench", medium: "water" }]);
    const story = tellStory(weapon, "demo");
    for (const event of story.events) expect(event.reads.length).toBeGreaterThan(0);
    expect(story.npcName.length).toBeGreaterThan(0);
  });
});
