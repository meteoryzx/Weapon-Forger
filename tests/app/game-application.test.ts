import { describe, expect, it } from "vitest";

import { GameApplication } from "../../src/app/game-application.ts";

describe("R0 browser application", () => {
  it("starts with a heated solid block grid and applies a local hammer intent", () => {
    const application = new GameApplication();
    const before = application.getSnapshot();
    const centerIndex = Math.floor(before.sections.length / 2);
    const after = application.applyIntent({ kind: "hammer", sectionIndex: centerIndex, energy: 0.85, lateralBias: 0 });

    expect(before.sections).toHaveLength(24);
    expect(before.grid).toEqual({ widthBlocks: 4, heightBlocks: 4 });
    expect(before.sections[centerIndex]?.blocks).toHaveLength(16);
    expect(before.sections[centerIndex]?.temperatureC).toBe(950);
    const beforeTarget = before.sections[centerIndex]?.blocks.find((block) => block.widthIndex === 2 && block.heightIndex === 3);
    const afterTarget = after.sections[centerIndex]?.blocks.find((block) => block.widthIndex === 2 && block.heightIndex === 3);
    expect(afterTarget?.thickness).toBeLessThan(beforeTarget?.thickness ?? Infinity);
  });
});
