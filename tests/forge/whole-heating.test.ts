import { describe, expect, it } from "vitest";
import { applyForgeOperation, createForgeState, createForgeSnapshot, replayForgeState, totalVolume, type ForgeOperation } from "../../src/forge/index.ts";

describe("whole-workpiece heating cycles", () => {
  it("records ongoing heating and cooling without moving or resetting material", () => {
    const initial = createForgeState({ sectionCount: 12 });
    const operations: ForgeOperation[] = [
      { kind: "move-billet", destination: "furnace", elapsedMs: 0 },
      { kind: "move-billet", destination: "furnace", elapsedMs: 6000 },
      { kind: "move-billet", destination: "inspection", elapsedMs: 0 },
      { kind: "move-billet", destination: "inspection", elapsedMs: 4000 },
    ];
    const hot = operations.slice(0, 2).reduce(applyForgeOperation, initial);
    const takenOut = applyForgeOperation(hot, operations[2]!);
    expect(createForgeSnapshot(takenOut).averageTemperatureC).toBe(createForgeSnapshot(hot).averageTemperatureC);
    const cool = applyForgeOperation(takenOut, operations[3]!);
    expect(createForgeSnapshot(cool).averageTemperatureC).toBeLessThan(createForgeSnapshot(hot).averageTemperatureC);
    expect(cool.workpiece.id).toBe(initial.workpiece.id);
    expect(totalVolume(cool)).toBe(totalVolume(initial));
    expect(cool.workpiece.thermal.peakTemperatureC).toBe(hot.workpiece.thermal.peakTemperatureC);
    expect(replayForgeState(initial, operations)).toEqual(cool);
  });
});
