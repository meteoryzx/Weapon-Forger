import { describe, expect, it } from "vitest";

import { GameApplication } from "../../src/app/game-application.ts";

describe("R0 browser application", () => {
  it("starts with a heated 24-section billet and applies a hammer intent", () => {
    const application = new GameApplication();
    const before = application.getSnapshot();
    const after = application.applyIntent({ kind: "hammer", sectionIndex: 12, energy: 0.85, lateralBias: 0 });

    expect(before.sections).toHaveLength(24);
    expect(before.sections[12]?.temperatureC).toBe(950);
    expect(after.sections[12]?.thickness).toBeLessThan(before.sections[12]?.thickness ?? Infinity);
  });
});
