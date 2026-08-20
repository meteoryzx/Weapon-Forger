import { FORGE_DERIVATION_RULES, FORGE_RULES } from "./forge-rules.ts";
import { createForgeSnapshot, totalVolume } from "./forge-simulation.ts";
import type { ForgeSnapshot, ForgeState } from "./forge-types.ts";

export interface ForgeFacts {
  readonly carbon: number;
  readonly densityKgPerM3: number;
  readonly hardenability: number;
  readonly materialDamageResistance: number;
  readonly layerCount: number;
  readonly totalVolume: number;
  readonly totalLength: number;
  readonly centerOfMass: number;
  readonly averageThickness: number;
  readonly averageTemperatureC: number;
  readonly peakTemperatureC: number;
  readonly hotExposureSeconds: number;
  readonly stress: number;
  readonly plasticStrain: number;
  readonly elasticStrain: number;
  readonly mechanicalWorkJ: number;
  readonly damage: number;
  readonly cracked: boolean;
  readonly quenchMedium: "water" | "oil" | null;
  readonly quenchStartTemperatureC: number | null;
  readonly temperTemperatureC: number | null;
  readonly edgeCoverage: number;
  readonly edgeEvenness: number;
  readonly jointIntegrity: number;
}

export interface ForgeDerivedAttribute {
  readonly id: string;
  readonly value: number;
  readonly source: readonly string[];
}

export interface ForgeDerivedData {
  readonly profileId: string;
  readonly profileVersion: string;
  readonly attributes: readonly ForgeDerivedAttribute[];
  readonly traits: readonly string[];
  readonly flaws: readonly string[];
}

export interface ForgeAttributeRule {
  readonly id: string;
  readonly calculate: (facts: ForgeFacts) => number;
  readonly source: readonly string[];
}

export interface ForgeDerivationProfile {
  readonly id: string;
  readonly version: string;
  readonly attributes: readonly ForgeAttributeRule[];
  readonly classify?: (facts: ForgeFacts) => {
    readonly traits: readonly string[];
    readonly flaws: readonly string[];
  };
}

export const REALISTIC_FORGE_PROFILE: ForgeDerivationProfile = {
  id: "realistic-forge",
  version: "1",
  attributes: [
    {
      id: "sharpness",
      calculate: (facts) => clamp(
        facts.edgeCoverage * FORGE_DERIVATION_RULES.edgeCoverageWeight
          + facts.edgeEvenness * FORGE_DERIVATION_RULES.edgeEvennessWeight,
      ),
      source: ["edgeCoverage", "edgeEvenness"],
    },
    {
      id: "hardness",
      calculate: (facts) => clamp(
        facts.carbon * FORGE_DERIVATION_RULES.hardnessCarbonWeight
          + quenchHardening(facts) * FORGE_DERIVATION_RULES.hardnessQuenchWeight
          + temperHardness(facts) * FORGE_DERIVATION_RULES.hardnessTemperWeight,
      ),
      source: ["carbon", "quenchMedium", "quenchStartTemperatureC", "temperTemperatureC"],
    },
    {
      id: "toughness",
      calculate: (facts) => clamp(
        facts.materialDamageResistance * FORGE_DERIVATION_RULES.toughnessMaterialWeight
          + (1 - facts.damage) * FORGE_DERIVATION_RULES.toughnessDamageWeight
          + temperToughness(facts) * FORGE_DERIVATION_RULES.toughnessHeatTreatmentWeight,
      ),
      source: ["materialDamageResistance", "damage", "cracked", "temperTemperatureC"],
    },
    {
      id: "weight",
      calculate: (facts) => facts.totalVolume * facts.densityKgPerM3
        / FORGE_DERIVATION_RULES.weightReferenceVolume,
      source: ["totalVolume", "densityKgPerM3"],
    },
    {
      id: "balance",
      calculate: (facts) => clamp(1 - Math.abs(facts.centerOfMass - facts.totalLength / 2)
        / Math.max(facts.totalLength / 2, 1)),
      source: ["centerOfMass", "totalLength"],
    },
    {
      id: "appearance",
      calculate: (facts) => clamp(
        facts.edgeEvenness * FORGE_DERIVATION_RULES.appearanceEvennessWeight
          + facts.edgeCoverage * FORGE_DERIVATION_RULES.appearanceCoverageWeight
          + Math.min(facts.layerCount / FORGE_DERIVATION_RULES.layeredAppearanceReference, 1)
            * FORGE_DERIVATION_RULES.appearanceLayerWeight,
      ),
      source: ["edgeEvenness", "edgeCoverage", "layerCount"],
    },
  ],
  classify: (facts) => ({
    traits: facts.layerCount > 1 ? ["layered-material"] : [],
    flaws: [
      ...(facts.cracked ? ["cracked"] : []),
      ...(facts.jointIntegrity < 0.5 ? ["weak-joint"] : []),
      ...(facts.damage > 0.35 ? ["damaged"] : []),
    ],
  }),
};

export function createForgeFacts(state: ForgeState, snapshot = createForgeSnapshot(state)): ForgeFacts {
  const sections = state.workpiece.sections;
  const totalLength = sections.reduce((sum, section) => sum + section.length, 0);
  const totalSectionVolume = totalVolume(state);
  const centerOfMass = totalSectionVolume === 0
    ? 0
    : sections.reduce((sum, section) => {
      const sectionVolume = section.blocks.reduce((subtotal, block) => subtotal + block.volume, 0);
      return sum + section.position * sectionVolume;
    }, 0) / totalSectionVolume;
  const averageThickness = sections.length === 0
    ? 0
    : sections.reduce((sum, section) => sum + section.thickness, 0) / sections.length;
  const stress = average(sections.map((section) => section.stress));
  const plasticStrain = average(sections.map((section) => section.plasticStrain));
  const elasticStrain = average(sections.map((section) => section.elasticStrain));
  const mechanicalWorkJ = sections.reduce((sum, section) => sum + section.mechanicalWorkJ, 0);
  const damage = average(sections.map((section) => section.damage));
  const jointIntegrity = average(state.workpiece.joints.map((joint) => joint.integrity), 1);

  return {
    carbon: state.workpiece.material.carbon,
    densityKgPerM3: state.workpiece.material.densityKgPerM3,
    hardenability: state.workpiece.material.hardenability,
    materialDamageResistance: state.workpiece.material.damageResistance,
    layerCount: state.workpiece.layerCount,
    totalVolume: totalSectionVolume,
    totalLength,
    centerOfMass,
    averageThickness,
    averageTemperatureC: snapshot.averageTemperatureC,
    peakTemperatureC: snapshot.peakTemperatureC,
    hotExposureSeconds: snapshot.hotExposureSeconds,
    stress,
    plasticStrain,
    elasticStrain,
    mechanicalWorkJ,
    damage: clamp(Math.max(damage, snapshot.hasCracks ? 1 : 0)),
    cracked: snapshot.hasCracks,
    quenchMedium: state.workpiece.quench.medium,
    quenchStartTemperatureC: state.workpiece.quench.startTemperatureC,
    temperTemperatureC: state.workpiece.temper.temperatureC,
    edgeCoverage: snapshot.edgeCoverage,
    edgeEvenness: snapshot.edgeEvenness,
    jointIntegrity,
  };
}

export function deriveForgeData(
  state: ForgeState,
  profile: ForgeDerivationProfile = REALISTIC_FORGE_PROFILE,
): ForgeDerivedData {
  const facts = createForgeFacts(state);
  const classification = profile.classify?.(facts) ?? { traits: [], flaws: [] };
  return {
    profileId: profile.id,
    profileVersion: profile.version,
    attributes: profile.attributes.map((rule) => ({
      id: rule.id,
      value: rule.calculate(facts),
      source: rule.source,
    })),
    traits: classification.traits,
    flaws: classification.flaws,
  };
}

function quenchHardening(facts: ForgeFacts): number {
  if (facts.quenchMedium === null || facts.quenchStartTemperatureC === null) return 0;
  const temperatureFit = clamp(1 - Math.abs(
    facts.quenchStartTemperatureC - FORGE_RULES.quenchIdealStartC,
  ) / FORGE_DERIVATION_RULES.quenchTemperatureWindowC);
  const mediumFactor = facts.quenchMedium === "water" ? 1 : FORGE_DERIVATION_RULES.oilQuenchFactor;
  return facts.hardenability * temperatureFit * mediumFactor;
}

function temperHardness(facts: ForgeFacts): number {
  if (facts.temperTemperatureC === null) return 1;
  return clamp(1 - facts.temperTemperatureC / FORGE_DERIVATION_RULES.temperSofteningRangeC);
}

function temperToughness(facts: ForgeFacts): number {
  if (facts.temperTemperatureC === null) return 0;
  return clamp(facts.temperTemperatureC / FORGE_DERIVATION_RULES.temperSofteningRangeC);
}

function average(values: readonly number[], fallback = 0): number {
  return values.length === 0 ? fallback : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function clamp(value: number): number {
  return Math.min(1, Math.max(0, value));
}
