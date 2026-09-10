import { describe, expect, it } from "vitest";
import { MaterialSelection, MATERIAL_RACK_PAGE_SIZE } from "../../src/app/material-selection.ts";
import { FORGE_RULES, SPRING_STEEL } from "../../src/forge/index.ts";
import { GameApplication } from "../../src/app/game-application.ts";

describe("material inspection and ownership", () => {
  it("starts empty and only creates a workpiece on confirmation", () => {
    const selection = new MaterialSelection();
    expect(selection.getPieces()).toEqual([]);
    expect(selection.confirm()).toBeNull();
    selection.inspect("high-carbon-steel");
    expect(selection.getCandidate()?.carbon).toBe(0.9);
    expect(selection.getPieces()).toEqual([]);
    selection.cancel();
    expect(selection.confirm()).toBeNull();
    expect(selection.getAcquiredCount()).toBe(0);
    selection.inspect("high-carbon-steel");
    const app = selection.confirm()!;
    expect(app.getState().workpiece.material.carbon).toBe(0.9);
    expect(app.getState().bench).toEqual([]);
    expect(selection.getPieces()).toHaveLength(1);
    expect(selection.getAcquiredCount()).toBe(1);
    expect(selection.getTableWorkpieceIds()).toEqual([app.getState().workpiece.id]);
    expect(selection.confirm()).toBeNull();
    expect(selection.getPieces()).toHaveLength(1);
  });

  it("browsing and cancellation do not modify an existing forged piece", () => {
    const app = new GameApplication(SPRING_STEEL);
    app.applyIntent({ kind: "cut", sectionIndex: 12 });
    const before = structuredClone(app.getState());
    const selection = new MaterialSelection(app);
    selection.inspect("mild-steel");
    selection.inspect("high-carbon-steel");
    selection.cancel();
    expect(app.getState()).toEqual(before);
    expect(selection.take("missing-piece")).toBe(false);
    expect(app.getState()).toEqual(before);
    expect(() => selection.inspect("unknown-steel")).toThrow();
  });

  it("takes an owned piece by identity and preserves its processed state", () => {
    const selection = new MaterialSelection();
    selection.inspect("spring-steel");
    const app = selection.confirm()!;
    app.applyIntent({ kind: "move-billet", destination: "furnace", elapsedMs: 0 });
    app.applyIntent({ kind: "move-billet", destination: "inspection", elapsedMs: 12_000 });
    app.applyIntent({ kind: "cut", sectionIndex: 12 });
    app.applyIntent({ kind: "temper", temperatureC: 210 });
    const processed = structuredClone(app.getState().workpiece);
    selection.inspect("high-carbon-steel");
    expect(selection.confirm()).toBe(app);
    const highCarbon = selection.getPieces().find((piece) => piece.materialId === "high-carbon-steel")!;
    expect(selection.take(highCarbon.workpieceId)).toBe(true);
    expect(app.getState().workpiece.material.carbon).toBe(0.9);
    const order = selection.getPieces().map((piece) => piece.workpieceId);
    expect(selection.take(processed.id)).toBe(true);
    expect(app.getState().workpiece).toEqual(processed);
    expect(selection.getPieces().map((piece) => piece.workpieceId)).toEqual(order);
    expect(app.getSnapshot().averageTemperatureC).toBeGreaterThan(20);
    expect(app.getSnapshot().temperTemperatureC).toBe(210);
  });

  it("four display slots never cap ownership or discard cut products", () => {
    const selection = new MaterialSelection();
    let app: GameApplication | null = null;
    for (let index = 0; index < MATERIAL_RACK_PAGE_SIZE + 1; index++) {
      selection.inspect("mild-steel");
      app = selection.confirm();
    }
    app!.applyIntent({ kind: "cut", sectionIndex: 12 });
    const pieces = selection.getPieces();
    expect(pieces).toHaveLength(6);
    expect(new Set(pieces.map((piece) => piece.workpieceId)).size).toBe(6);
    const pages = [pieces.slice(0, 4), pieces.slice(4, 8)];
    expect(pages.map((page) => page.length)).toEqual([4, 2]);
    expect(selection.getTableWorkpieceIds()).toHaveLength(6);
    for (const piece of pieces) expect(selection.take(piece.workpieceId)).toBe(true);
    expect(selection.getPieces()).toHaveLength(6);
  });

  it("new stock has its rule-defined size even after the active piece is cut to one section", () => {
    const selection = new MaterialSelection();
    selection.inspect("spring-steel");
    const app = selection.confirm()!;
    app.applyIntent({ kind: "cut", sectionIndex: 1 });
    selection.inspect("high-carbon-steel");
    selection.confirm();
    const newStock = selection.getPieces().find((piece) => piece.materialId === "high-carbon-steel")!;
    expect(newStock.sections).toHaveLength(FORGE_RULES.defaultSectionCount);
    expect(newStock.sections.reduce((sum, section) => sum + section.length, 0)).toBeCloseTo(FORGE_RULES.workpieceLength, 8);
    expect(newStock.averageTemperatureC).toBe(20);
    expect(app.getState().workpiece.sections).toHaveLength(1);
  });

  it("returns the same active workpiece to the rack without changing its history", () => {
    const selection = new MaterialSelection();
    selection.inspect("spring-steel");
    const app = selection.confirm()!;
    app.applyIntent({ kind: "cut", sectionIndex: 12 });
    const before = structuredClone(app.getState().workpiece);
    expect(selection.isOnTable(before.id)).toBe(true);
    expect(selection.returnCurrentToRack()).toBe(true);
    expect(selection.isOnTable(before.id)).toBe(false);
    expect(app.getState().workpiece).toEqual(before);
    expect(selection.returnCurrentToRack()).toBe(false);
    expect(selection.take(before.id)).toBe(true);
    expect(selection.isOnTable(before.id)).toBe(true);
    expect(app.getState().workpiece).toEqual(before);
  });
});
