import {
  FORGE_PARAMETER_VERSION,
  FORGE_RULES,
  edgeCoverage,
  edgeEvenness,
  totalVolume,
  type BladeSection,
  type ForgeState,
} from "../forge/index.ts";
import { EVALUATE_RULES } from "./evaluate-rules.ts";
import type { WeaponData, WeaponDimensions, WeaponFlaw, WeaponTrait } from "./evaluate-types.ts";

// 把最终锻造状态翻译成隐藏六维、特性与缺陷。每个维度都有可追溯的状态来源，
// 且是纯函数：同一状态永远得到同一 WeaponData。
export function evaluateWeapon(state: ForgeState): WeaponData {
  const dimensions = deriveDimensions(state);
  return {
    ruleVersion: FORGE_PARAMETER_VERSION,
    materialId: state.workpiece.material.id,
    dimensions,
    traits: deriveTraits(state, dimensions),
    flaws: deriveFlaws(state),
  };
}

function deriveDimensions(state: ForgeState): WeaponDimensions {
  const sections = state.workpiece.sections;
  const coverage = edgeCoverage(sections);
  const evenness = edgeEvenness(sections);
  const hardness = deriveHardness(state);
  const toughness = deriveToughness(state);
  const weight = deriveWeight(state);
  const balance = deriveBalance(state);
  const appearance = deriveAppearance(state, evenness);

  const edgeThinness = deriveEdgeThinness(sections);
  const sharpness = clamp(
    EVALUATE_RULES.sharpnessThinnessWeight * edgeThinness
    + EVALUATE_RULES.sharpnessCoverageWeight * coverage
    + EVALUATE_RULES.sharpnessEvennessWeight * evenness
    + EVALUATE_RULES.sharpnessHardnessWeight * hardness,
    0,
    1,
  );

  return { sharpness, hardness, toughness, weight, balance, appearance };
}

// 硬度 = 退火基础 + 材料可硬化潜力 × 淬火窗口 × 介质折扣。淬火窗口只在
// [最低温, 理想温] 之间爬升，过热仍拿满硬度，但脆性在韧性里单独扣。
function deriveHardness(state: ForgeState): number {
  const base = EVALUATE_RULES.annealedHardness;
  const quench = state.workpiece.quench;
  if (quench.medium === null || quench.startTemperatureC === null) return base;
  const window = quenchWindowFactor(quench.startTemperatureC);
  const mediumFactor = quench.medium === "water" ? 1 : EVALUATE_RULES.quenchHardnessOilFactor;
  return clamp(base + state.workpiece.material.hardenability * window * mediumFactor * (1 - base), 0, 1);
}

function quenchWindowFactor(startTemperatureC: number): number {
  if (startTemperatureC < FORGE_RULES.quenchMinimumStartC) return 0;
  if (startTemperatureC >= FORGE_RULES.quenchIdealStartC) return 1;
  return (startTemperatureC - FORGE_RULES.quenchMinimumStartC)
    / (FORGE_RULES.quenchIdealStartC - FORGE_RULES.quenchMinimumStartC);
}

// 韧性 = 材料基础韧性，减去损伤、裂纹、过热与淬火脆性四类扣分。
function deriveToughness(state: ForgeState): number {
  const sections = state.workpiece.sections;
  const averageDamage = average(sections.map((section) => section.damage));
  const hasCracks = sections.some((section) => section.cracked);
  const overheatDose = state.workpiece.thermal.overheatDose;
  const quenchBrittleness = deriveQuenchBrittleness(state);

  const base = clamp(state.workpiece.material.damageResistance, 0, 1);
  return clamp(
    base
    - EVALUATE_RULES.damageToughnessWeight * averageDamage
    - (hasCracks ? EVALUATE_RULES.crackToughnessPenalty : 0)
    - EVALUATE_RULES.overheatToughnessPenaltyPerDose * overheatDose
    - quenchBrittleness,
    0,
    1,
  );
}

function deriveQuenchBrittleness(state: ForgeState): number {
  const quench = state.workpiece.quench;
  if (quench.medium === null || quench.startTemperatureC === null) return 0;
  const mediumBrittleness = quench.medium === "water"
    ? EVALUATE_RULES.quenchBrittlenessWater
    : EVALUATE_RULES.quenchBrittlenessOil;
  const overheatRatio = clamp(
    (quench.startTemperatureC - state.workpiece.material.overheatTemperatureC)
    / (1300 - state.workpiece.material.overheatTemperatureC),
    0,
    1,
  );
  return clamp(mediumBrittleness + overheatRatio * EVALUATE_RULES.quenchBrittlenessOverheat, 0, 1);
}

// 重量 = 实际质量 / 初始整坯质量。当前锻打守恒体积、研磨不改几何，所以重量
// 基本只由材料密度决定；减料/装配进入后此维度才会被玩家主动改变。
function deriveWeight(state: ForgeState): number {
  const massKg = totalVolume(state) * 1e-9 * state.workpiece.material.densityKgPerM3;
  const initialVolumeMm3 = FORGE_RULES.workpieceLength * FORGE_RULES.initialSectionWidth * FORGE_RULES.initialSectionThickness;
  const initialMassKg = initialVolumeMm3 * 1e-9 * state.workpiece.material.densityKgPerM3;
  return clamp(massKg / initialMassKg, 0, 1);
}

// 平衡 = 轴向重心偏移 + 左右质量对称。锻打使质量重新分布，故该维度由玩家控制。
function deriveBalance(state: ForgeState): number {
  const axial = axialCenterOfMass(state);
  const geometricCenter = FORGE_RULES.workpieceLength / 2;
  const axialOffset = clamp(Math.abs(axial - geometricCenter) / (FORGE_RULES.workpieceLength / 2), 0, 1);
  const axialBalance = 1 - axialOffset;

  const lateral = lateralCenterOfMass(state);
  const lateralOffset = clamp(Math.abs(lateral) / (FORGE_RULES.initialSectionWidth / 2), 0, 1);
  const lateralBalance = 1 - lateralOffset;

  return EVALUATE_RULES.balanceAxialWeight * axialBalance + EVALUATE_RULES.balanceLateralWeight * lateralBalance;
}

function deriveAppearance(state: ForgeState, evenness: number): number {
  const lateral = lateralCenterOfMass(state);
  const symmetry = 1 - clamp(Math.abs(lateral) / (FORGE_RULES.initialSectionWidth / 2), 0, 1);
  const flawPenalty = state.workpiece.sections.some((section) => section.cracked) ? 0.2 : 0;
  return clamp(
    EVALUATE_RULES.appearanceBase
    + EVALUATE_RULES.appearanceEvennessWeight * evenness
    + EVALUATE_RULES.appearanceSymmetryWeight * symmetry
    - flawPenalty,
    0,
    1,
  );
}

function deriveEdgeThinness(sections: readonly BladeSection[]): number {
  const averageThickness = average(sections.map((section) => section.thickness));
  return clamp(1 - averageThickness / FORGE_RULES.initialSectionThickness, 0, 1);
}

function deriveTraits(state: ForgeState, dimensions: WeaponDimensions): readonly WeaponTrait[] {
  const traits: WeaponTrait[] = [];
  const sections = state.workpiece.sections;
  const coverage = edgeCoverage(sections);
  const edgeThinness = deriveEdgeThinness(sections);

  if (dimensions.sharpness >= EVALUATE_RULES.sharpTraitSharpness) {
    traits.push({ id: "sharp", label: "锋利", source: ["sharpness", "groundAmount", "hardness"] });
  }
  if (edgeThinness >= EVALUATE_RULES.thinEdgeThinness) {
    traits.push({ id: "thin-edge", label: "薄刃", source: ["section.thickness"] });
  }
  if (dimensions.hardness >= EVALUATE_RULES.hardTraitHardness) {
    traits.push({ id: "hardened", label: "淬火硬化", source: ["quench.medium", "quench.startTemperatureC"] });
  }
  if (dimensions.toughness >= EVALUATE_RULES.toughTraitToughness) {
    traits.push({ id: "tough", label: "坚韧", source: ["material.damageResistance", "damage", "cracked"] });
  }
  if (dimensions.balance >= EVALUATE_RULES.balancedTraitBalance) {
    traits.push({ id: "balanced", label: "重心协调", source: ["mass distribution"] });
  }
  const axialOffset = normalizedAxialOffset(state);
  if (axialOffset >= EVALUATE_RULES.frontHeavyAxialOffset) {
    traits.push({ id: "front-heavy", label: "前端偏重", source: ["axial center of mass"] });
  } else if (axialOffset <= EVALUATE_RULES.backHeavyAxialOffset) {
    traits.push({ id: "back-heavy", label: "尾重", source: ["axial center of mass"] });
  }
  if (coverage >= EVALUATE_RULES.unsharpenedCoverage && dimensions.hardness >= EVALUATE_RULES.hardTraitHardness) {
    traits.push({ id: "hard-edged", label: "硬而锋利的刃", source: ["groundAmount", "hardness"] });
  }
  return traits;
}

function deriveFlaws(state: ForgeState): readonly WeaponFlaw[] {
  const flaws: WeaponFlaw[] = [];
  const sections = state.workpiece.sections;
  const coverage = edgeCoverage(sections);
  const evenness = edgeEvenness(sections);

  if (sections.some((section) => section.cracked)) {
    flaws.push({ id: "cracked", label: "裂纹", severity: 1, source: ["section.cracked"] });
  }
  if (state.workpiece.thermal.overheatDose >= EVALUATE_RULES.overheatFlawDose) {
    flaws.push({
      id: "overheated",
      label: "过热损伤",
      severity: clamp(state.workpiece.thermal.overheatDose, 0, 1),
      source: ["thermal.overheatDose"],
    });
  }
  if (state.workpiece.quench.medium !== null) {
    const brittleness = deriveQuenchBrittleness(state);
    if (brittleness >= 0.4) {
      flaws.push({ id: "quench-brittle", label: "淬火脆裂风险", severity: brittleness, source: ["quench.medium", "quench.startTemperatureC"] });
    }
  }
  if (coverage < EVALUATE_RULES.unsharpenedCoverage) {
    flaws.push({
      id: "unsharpened",
      label: "刃口未开",
      severity: clamp(1 - coverage, 0, 1),
      source: ["groundAmount"],
    });
  }
  if (coverage >= EVALUATE_RULES.unsharpenedCoverage && evenness < EVALUATE_RULES.unevenEdgeEvenness) {
    flaws.push({
      id: "uneven-edge",
      label: "刃口不均",
      severity: clamp(1 - evenness, 0, 1),
      source: ["groundAmount distribution"],
    });
  }
  return flaws;
}

function axialCenterOfMass(state: ForgeState): number {
  let weighted = 0;
  let total = 0;
  for (const section of state.workpiece.sections) {
    const sectionMass = section.blocks.reduce((sum, block) => sum + block.volume, 0);
    weighted += section.position * sectionMass;
    total += sectionMass;
  }
  return total === 0 ? FORGE_RULES.workpieceLength / 2 : weighted / total;
}

function normalizedAxialOffset(state: ForgeState): number {
  const center = axialCenterOfMass(state);
  return (center - FORGE_RULES.workpieceLength / 2) / (FORGE_RULES.workpieceLength / 2);
}

function lateralCenterOfMass(state: ForgeState): number {
  let weighted = 0;
  let total = 0;
  for (const section of state.workpiece.sections) {
    for (const block of section.blocks) {
      weighted += block.lateralOffset * block.volume;
      total += block.volume;
    }
  }
  return total === 0 ? 0 : weighted / total;
}

function average(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
