import { describe, expect, it } from "vitest";

import { GameApplication } from "../../src/app/game-application.ts";

describe("R0 browser application", () => {
  it("starts with a heated solid block grid and applies a local hammer intent", () => {
    const application = new GameApplication();
    const before = application.getSnapshot();
    const centerIndex = Math.floor(before.sections.length / 2);
    const after = application.applyIntent({ kind: "hammer", sectionIndex: centerIndex, energy: 0.85, lateralBias: 0 });

    expect(before.sections).toHaveLength(168);
    expect(before.grid).toEqual({ widthBlocks: 24, heightBlocks: 4 });
    expect(before.sections[centerIndex]?.blocks).toHaveLength(96);
    expect(before.sections[centerIndex]?.temperatureC).toBe(950);
    const planeSize = (before.grid.widthBlocks + 1) * (before.grid.heightBlocks + 1);
    const centerWidth = before.grid.widthBlocks / 2;
    const topNodeIndex = centerIndex * planeSize
      + before.grid.heightBlocks * (before.grid.widthBlocks + 1)
      + centerWidth;
    expect(after.nodes[topNodeIndex]?.verticalOffset).toBeLessThan(
      before.nodes[topNodeIndex]?.verticalOffset ?? -Infinity,
    );
  });
});
