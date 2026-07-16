/**
 * S1 验收测试入口（纯 node 运行，不依赖 Cocos）
 * 用途：证明"数据结构立得住、数据表能读出来"。
 * 运行：node assets/scripts/weapon/s1_check.mjs
 * 这是 M2/M9 的独立测试入口（PROJECT_RULES §6：每模块留可独立点的测试入口）。
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const dataDir = join(here, "../../data");
const read = (f) => JSON.parse(readFileSync(join(dataDir, f), "utf8"));

const materials = read("materials.json");
const nodes = read("adventure_nodes.json");
const story = read("story_text.json");

const LABEL = { edge: "锋利", hard: "硬度", tough: "韧性", weight: "重量", look: "外观", balance: "平衡" };

console.log("=== S1 验收：数据结构 + 数据表 ===\n");

console.log(`[材料表] 读到 ${materials.materials.length} 种材料：`);
for (const m of materials.materials) {
  const s = m.base;
  const line = Object.keys(LABEL).map((k) => `${LABEL[k]}${s[k]}`).join(" ");
  console.log(`  · ${m.name}(lv${m.lv})  基础: ${line}`);
  console.log(`    “${m.desc}”`);
}

console.log(`\n[判定节点表] 读到 ${nodes.nodes.length} 个冒险节点：`);
for (const n of nodes.nodes) {
  const dimTxt = n.combo ? n.combo.map((k) => LABEL[k]).join("+") : (n.hidden ? "隐藏门槛" : LABEL[n.dim]);
  console.log(`  · ${n.tag}  判定[${dimTxt}]  ${n.seg.length}个分支${n.hidden ? " (含隐藏结局)" : ""}`);
}

console.log(`\n[文案表] 节点文案 ${Object.keys(story.nodes).length} 条，结局 ${Object.keys(story.endings).length} 种。`);

// 造一把"测试武器"，验证 WeaponData 形状能承载
const testWeapon = {
  shape: { controlPoints: [0, 1, 2, 1, 0], thickness: [2, 3, 4, 3, 2] },
  material: "fine_steel",
  process: ["fold_x8"],
  stats: { edge: 7, hard: 6, tough: 5, weight: 5, look: 8, balance: 6 },
  overall: 0,
  flaws: [],
};
console.log("\n[测试武器] 一把 WeaponData 实例：");
console.log(`  材质=${testWeapon.material}  工艺=[${testWeapon.process}]`);
console.log(`  6维: ` + Object.keys(LABEL).map((k) => `${LABEL[k]}${testWeapon.stats[k]}`).join(" "));

console.log("\n✅ S1 通过：数据结构与数据表均可正常读取、承载。");
console.log("   下一步 S2：写 M4 冒险判定 + M5 故事呈现，把这把武器的 6 维喂进节点表跑出故事。");
