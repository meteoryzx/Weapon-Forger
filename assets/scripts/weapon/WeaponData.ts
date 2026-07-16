/**
 * M2 · WeaponData —— 全项目唯一真相源（纯数据结构，无任何逻辑）
 *
 * 约束（见 PROJECT_RULES §2 数据流铁律）：
 *  - 只有 M1(锻造交互) 和 M3(数值评估) 能写它；其他模块只读。
 *  - M6 渲染禁止反向写。
 *  - 修改本结构须记 DECISION_LOG 并通知全模块。
 *
 * 本文件不依赖 Cocos，可直接被 node/ts 运行验证。
 */

/** 6 维数值，等级制 0–10。三对物理取舍见 PROJECT_RULES §4 / 全案 §3.1b。 */
export interface WeaponStats {
  edge: number;    // 锋利
  hard: number;    // 硬度
  tough: number;   // 韧性
  weight: number;  // 重量
  look: number;    // 外观
  balance: number; // 平衡
}

/** 外形参数（WeaponShape）。锻打留痕存这里，M1 写、M6 读，不进冒险判定。 */
export interface WeaponShape {
  controlPoints: number[]; // 刀身轮廓控制点（弯/直/长短）
  thickness: number[];     // 各段厚度（敲打留痕，决定重量分布与平衡）
}

/** 一把武器的完整数据。 */
export interface WeaponData {
  shape: WeaponShape;   // 外形         M1写 / M6读
  material: string;     // 材质ID       M1写（引用 M9 材料表）
  process: string[];    // 工艺标签     M1写（折叠/覆土/淬火介质/淬毒等特殊功能也走这里）
  stats: WeaponStats;   // 6维0-10      M3写 / M4,M6读
  overall: number;      // 总评分       M3写 / M6,M8读（不参与冒险判定）
  flaws: string[];      // 负面状态如"裂纹"  M1写 / M4,M5读
}

/** 造一把"空白坯料"的默认值，供测试与初始化用。 */
export function createBlankWeapon(): WeaponData {
  return {
    shape: { controlPoints: [0, 0, 0, 0, 0], thickness: [1, 1, 1, 1, 1] },
    material: "",
    process: [],
    stats: { edge: 0, hard: 0, tough: 0, weight: 0, look: 0, balance: 0 },
    overall: 0,
    flaws: [],
  };
}

export const STAT_KEYS: (keyof WeaponStats)[] = ["edge", "hard", "tough", "weight", "look", "balance"];
export const STAT_LABELS: Record<keyof WeaponStats, string> = {
  edge: "锋利", hard: "硬度", tough: "韧性", weight: "重量", look: "外观", balance: "平衡",
};
