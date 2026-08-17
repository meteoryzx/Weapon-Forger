// 六维翻译层的数据旋钮。所有数值都在这里，作者调平衡只改此文件或材料表，
// 不碰逻辑。注释标明每个旋钮影响哪个维度。
export const EVALUATE_RULES = {
  // 硬度：未淬火（退火态）的基础硬度，以及油淬相对水淬的硬度折扣。
  annealedHardness: 0.18,
  quenchHardnessOilFactor: 0.8,

  // 韧性扣分：脆裂风险来自淬火介质与淬火时是否过热。
  quenchBrittlenessWater: 0.3,
  quenchBrittlenessOil: 0.12,
  quenchBrittlenessOverheat: 0.45,
  crackToughnessPenalty: 0.45,
  overheatToughnessPenaltyPerDose: 0.5,
  damageToughnessWeight: 0.5,

  // 锋利：薄刃、研磨覆盖率、均匀度、硬度四者的权重。
  sharpnessThinnessWeight: 0.35,
  sharpnessCoverageWeight: 0.35,
  sharpnessEvennessWeight: 0.15,
  sharpnessHardnessWeight: 0.15,

  // 平衡：轴向重心偏移与左右质量对称各占的权重。
  balanceAxialWeight: 0.6,
  balanceLateralWeight: 0.4,

  // 外观：基础分、研磨均匀度、几何对称、工艺缺陷的贡献。
  appearanceBase: 0.25,
  appearanceEvennessWeight: 0.4,
  appearanceSymmetryWeight: 0.35,

  // traits / flaws 判定阈值。
  sharpTraitSharpness: 0.7,
  hardTraitHardness: 0.7,
  toughTraitToughness: 0.7,
  balancedTraitBalance: 0.75,
  thinEdgeThinness: 0.55,
  frontHeavyAxialOffset: 0.2,
  backHeavyAxialOffset: -0.2,
  unevenEdgeEvenness: 0.6,
  unsharpenedCoverage: 0.3,
  overheatFlawDose: 0.5,
} as const;
