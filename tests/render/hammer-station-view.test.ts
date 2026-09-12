import { describe, expect, it } from "vitest";
import { createForgeSnapshot, createForgeState, HAMMER_HOME } from "../../src/forge/index.ts";
import { HammerStationView } from "../../src/render/hammer-station-view.ts";

describe("hammer animation recovery",()=>{
  it("renders the raised final pose even when frames skip the entire recovery interval",()=>{
    const view=new HammerStationView();
    view.update(createForgeSnapshot(createForgeState({sectionCount:24})),HAMMER_HOME);
    view.setAim({x:0,z:0},0.55);
    const restingHeight=view.tool.position.y;
    view.strike(100);view.tick(196);
    expect(view.tool.position.y).toBeLessThan(restingHeight);
    view.finishStrike(1000);
    expect(view.tick(3000)).toBe(true);
    expect(view.tool.position.y).toBeCloseTo(restingHeight,10);
    expect(view.tick(3016)).toBe(false);
    view.dispose();
  });
});
