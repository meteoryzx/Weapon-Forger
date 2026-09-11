import { describe, expect, it } from "vitest";

import {
  createForgeState,
  outlineArea,
  splitOutlineByFiniteThroughCut,
  type FiniteThroughCut,
  type WorkpieceOutlinePoint,
} from "../../src/forge/index.ts";

function bounds(outline: readonly WorkpieceOutlinePoint[]) {
  const axial = outline.map((point) => point.axialPosition);
  const lateral = outline.map((point) => point.lateralOffset);
  return {
    axialMinimum: Math.min(...axial),
    axialMaximum: Math.max(...axial),
    lateralMinimum: Math.min(...lateral),
    lateralMaximum: Math.max(...lateral),
  };
}

function expectAreaConservation(
  original: readonly WorkpieceOutlinePoint[],
  result: ReturnType<typeof splitOutlineByFiniteThroughCut>,
): void {
  expect(outlineArea(result.negative)).toBeGreaterThan(0);
  expect(outlineArea(result.positive)).toBeGreaterThan(0);
  expect(outlineArea(result.negative) + outlineArea(result.positive) + result.removedArea)
    .toBeCloseTo(outlineArea(original), 8);
}

describe("upgradeable 2.5D workpiece geometry", () => {
  it("derives one identified positive outer contour from the structured workpiece", () => {
    const geometry = createForgeState({ sectionCount: 8 }).workpiece.geometry;

    expect(geometry.kind).toBe("planar-height-field-v1");
    expect(geometry.outline.length).toBe(18);
    expect(new Set(geometry.outline.map((point) => point.id)).size).toBe(geometry.outline.length);
    expect(outlineArea(geometry.outline)).toBeGreaterThan(0);
  });

  it("splits an orthogonal finite path into two connected positive outlines with kerf conservation", () => {
    const outline = createForgeState({ sectionCount: 8 }).workpiece.geometry.outline;
    const extent = bounds(outline);
    const center = (extent.axialMinimum + extent.axialMaximum) / 2;
    const result = splitOutlineByFiniteThroughCut(outline, {
      id: "orthogonal-cut",
      start: { axialPosition: center, lateralOffset: extent.lateralMinimum - 5 },
      end: { axialPosition: center, lateralOffset: extent.lateralMaximum + 5 },
      kerfWidth: 1,
    });

    expect(result.negative.length).toBeGreaterThanOrEqual(4);
    expect(result.positive.length).toBeGreaterThanOrEqual(4);
    expectAreaConservation(outline, result);
  });

  it("supports a deterministic diagonal finite through-cut without creating invalid pieces", () => {
    const outline = createForgeState({ sectionCount: 8 }).workpiece.geometry.outline;
    const extent = bounds(outline);
    const cut: FiniteThroughCut = {
      id: "diagonal-cut",
      start: {
        axialPosition: extent.axialMinimum - 5,
        lateralOffset: extent.lateralMinimum - 5,
      },
      end: {
        axialPosition: extent.axialMaximum + 5,
        lateralOffset: extent.lateralMaximum + 5,
      },
      kerfWidth: 1.5,
    };

    const first = splitOutlineByFiniteThroughCut(outline, cut);
    const second = splitOutlineByFiniteThroughCut(outline, cut);

    expect(first).toEqual(second);
    expectAreaConservation(outline, first);
  });

  it("gives both pieces distinct identities when a cut passes through existing vertices", () => {
    const outline = createForgeState({ sectionCount: 8 }).workpiece.geometry.outline;
    const extent = bounds(outline);
    const result = splitOutlineByFiniteThroughCut(outline, {
      id: "corner-cut",
      start: {
        axialPosition: extent.axialMinimum - 1,
        lateralOffset: extent.lateralMinimum - 3,
      },
      end: {
        axialPosition: extent.axialMaximum + 1,
        lateralOffset: extent.lateralMaximum + 3,
      },
      kerfWidth: 0,
    });
    const negativeIds = new Set(result.negative.map((point) => point.id));

    expect(result.positive.every((point) => !negativeIds.has(point.id))).toBe(true);
    expectAreaConservation(outline, result);
  });

  it("rejects a finite path that does not enter and leave the workpiece", () => {
    const outline = createForgeState({ sectionCount: 8 }).workpiece.geometry.outline;
    const extent = bounds(outline);
    expect(() => splitOutlineByFiniteThroughCut(outline, {
      id: "short-cut",
      start: { axialPosition: extent.axialMinimum + 1, lateralOffset: 0 },
      end: { axialPosition: extent.axialMaximum - 1, lateralOffset: 0 },
      kerfWidth: 1,
    })).toThrow("enter and leave");
  });
});
