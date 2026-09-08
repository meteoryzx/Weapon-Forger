import { describe, expect, it } from "vitest";

import {
  DEFAULT_FORGE_MATERIAL,
  FORGE_RULES,
  equivalentLogStrain,
  integrateMechanicalResponse,
  yieldStrengthMPa,
  type MechanicalGeometry,
  type MechanicalState,
} from "../../src/forge/index.ts";

const beforeGeometry: MechanicalGeometry = {
  length: 10,
  width: 10,
  thickness: 10,
  volume: 1_000,
};

const afterGeometry: MechanicalGeometry = {
  length: 12,
  width: 9.2,
  thickness: 9.06,
  volume: 1_000,
};

function mechanicalState(overrides: Partial<MechanicalState> = {}): MechanicalState {
  return {
    temperatureC: 950,
    plasticity: 0.8,
    stress: 0,
    plasticStrain: 0,
    elasticStrain: 0,
    damage: 0,
    thermalDamage: 0,
    mechanicalWorkJ: 0,
    volume: beforeGeometry.volume,
    ...overrides,
  };
}

const supportedLoad = {
  impactWeight: 1,
  localisation: 0,
  thinSectionRisk: 0,
  supportRatio: 1,
} as const;

describe("shared mechanical response", () => {
  it("uses deviatoric logarithmic strain instead of counting operations", () => {
    expect(equivalentLogStrain(beforeGeometry, beforeGeometry)).toBe(0);
    expect(equivalentLogStrain(beforeGeometry, afterGeometry)).toBeGreaterThan(0);
    expect(equivalentLogStrain(
      beforeGeometry,
      { length: 11, width: 11, thickness: 11, volume: 1_000 },
    )).toBe(0);
  });

  it("softens yield strength with heat and hardens with accumulated plastic strain", () => {
    const cold = yieldStrengthMPa(mechanicalState({ temperatureC: 450, plasticity: 0 }), DEFAULT_FORGE_MATERIAL);
    const hot = yieldStrengthMPa(mechanicalState(), DEFAULT_FORGE_MATERIAL);
    const worked = yieldStrengthMPa(mechanicalState({ plasticStrain: FORGE_RULES.hardeningReferenceStrain }), DEFAULT_FORGE_MATERIAL);

    expect(cold).toBeGreaterThan(hot);
    expect(worked).toBeGreaterThan(hot);
  });

  it("routes the same deformation through hot plastic flow or cold residual stress", () => {
    const hot = integrateMechanicalResponse(
      mechanicalState(),
      beforeGeometry,
      afterGeometry,
      DEFAULT_FORGE_MATERIAL,
      supportedLoad,
    );
    const cold = integrateMechanicalResponse(
      mechanicalState({ temperatureC: 450, plasticity: 0 }),
      beforeGeometry,
      afterGeometry,
      DEFAULT_FORGE_MATERIAL,
      supportedLoad,
    );

    expect(hot.plasticStrainIncrement).toBeGreaterThan(cold.plasticStrainIncrement);
    expect(cold.stress).toBeGreaterThan(hot.stress);
    expect(cold.damage).toBeGreaterThan(hot.damage);
    expect(hot.mechanicalWorkJ).toBeGreaterThan(0);
    expect(cold.mechanicalWorkJ).toBeGreaterThan(0);
  });

  it("raises damage from localisation and unsupported loading, not from a hit counter", () => {
    const uniform = integrateMechanicalResponse(
      mechanicalState(),
      beforeGeometry,
      afterGeometry,
      DEFAULT_FORGE_MATERIAL,
      supportedLoad,
    );
    const concentrated = integrateMechanicalResponse(
      mechanicalState(),
      beforeGeometry,
      afterGeometry,
      DEFAULT_FORGE_MATERIAL,
      { ...supportedLoad, localisation: 1, thinSectionRisk: 1, supportRatio: 0 },
    );

    expect(concentrated.damage).toBeGreaterThan(uniform.damage);
    expect(concentrated.mechanicalWorkJ).toBe(uniform.mechanicalWorkJ);
  });
});
