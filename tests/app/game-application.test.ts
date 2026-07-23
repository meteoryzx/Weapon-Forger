import { describe, expect, it } from "vitest";

import { GameApplication } from "../../src/app/game-application.ts";

describe("heating application", () => {
  it("starts cold, heats in the furnace, and cools at the inspection position", () => {
    const application = new GameApplication();
    const initial = application.getSnapshot();

    expect(initial.phase).toBe("heating");
    expect(initial.billetLocation).toBe("inspection");
    expect(initial.averageTemperatureC).toBe(20);
    expect(initial.grid).toEqual({ widthBlocks: 24, heightBlocks: 4 });

    application.applyIntent({ kind: "move-billet", destination: "furnace", elapsedMs: 0 });
    const heatingPreview = application.getSnapshot(15_000);
    expect(heatingPreview.billetLocation).toBe("furnace");
    expect(heatingPreview.averageTemperatureC).toBeGreaterThan(650);

    const inspected = application.applyIntent({
      kind: "move-billet", destination: "inspection", elapsedMs: 15_000,
    });
    expect(inspected.averageTemperatureC).toBeCloseTo(heatingPreview.averageTemperatureC, 0);
    const coolingPreview = application.getSnapshot(10_000);
    expect(coolingPreview.averageTemperatureC).toBeLessThan(inspected.averageTemperatureC);
  });
});
