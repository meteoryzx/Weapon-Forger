import { describe, expect, it } from "vitest";
import { ForgePressCycle } from "../../src/app/forge-press-cycle.ts";

describe("continuous press cycle", () => {
  it("approaches contact before loading and caps cumulative dwell", () => {
    const cycle = new ForgePressCycle();
    expect(cycle.begin(0, 30)).toBe(true);
    cycle.tick(250); expect(cycle.phase).toBe("closing");
    expect(cycle.gap(250)).toBe(75); expect(cycle.dwell(250)).toBe(0);
    cycle.tick(500); expect(cycle.phase).toBe("loading");
    expect(cycle.gap(700, 26)).toBe(26); expect(cycle.dwell(700)).toBe(200);
    expect(cycle.dwell(9000)).toBe(4000);
    cycle.release(9000); expect(cycle.phase).toBe("settling");
    expect(cycle.dwell(12000)).toBe(4000);
    cycle.retract(12000, 26); cycle.tick(12500);
    expect(cycle.phase).toBe("idle"); expect(cycle.gap(12500)).toBe(120);
  });
  it("release before contact reverses from the current height without compression", () => {
    const cycle = new ForgePressCycle(); cycle.begin(0, 30); cycle.release(100);
    expect(cycle.phase).toBe("opening"); expect(cycle.gap(100)).toBe(102);
    expect(cycle.dwell(900)).toBe(0); cycle.tick(900); expect(cycle.busy).toBe(false);
  });
  it("freezes release time while waiting for the solver and rejects overlapping starts", () => {
    const cycle = new ForgePressCycle(); cycle.begin(0, 30); cycle.release(750);
    expect(cycle.dwell(3000)).toBe(250); expect(cycle.begin(3000, 20)).toBe(false);
    cycle.retract(4000, 25); expect(cycle.gap(4000)).toBe(25);
  });
});
