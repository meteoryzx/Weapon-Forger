import { describe, expect, it } from "vitest";

import { thermalSteelAppearance } from "../../src/render/thermal-color.ts";

describe("thermal steel appearance", () => {
  it("keeps cold steel metallic and derives increasing red-orange emission from temperature", () => {
    const cold = thermalSteelAppearance(20);
    const dullRed = thermalSteelAppearance(550);
    const orange = thermalSteelAppearance(950);

    expect(cold.emissiveIntensity).toBe(0);
    expect(dullRed.emissiveIntensity).toBeGreaterThan(0);
    expect(dullRed.emissive.r).toBeGreaterThan(dullRed.emissive.g);
    expect(dullRed.emissive.g).toBeGreaterThanOrEqual(dullRed.emissive.b);
    expect(orange.emissiveIntensity).toBeGreaterThan(dullRed.emissiveIntensity);
    expect(orange.surface.r).toBeGreaterThan(orange.surface.b);
  });
});
