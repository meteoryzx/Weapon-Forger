import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const dataDir = join(root, "assets/data");
const files = readdirSync(dataDir).filter((name) => name.endsWith(".json"));

for (const file of files) JSON.parse(readFileSync(join(dataDir, file), "utf8"));

const materials = JSON.parse(readFileSync(join(dataDir, "materials.json"), "utf8")).materials;
const nodes = JSON.parse(readFileSync(join(dataDir, "adventure_nodes.json"), "utf8")).nodes;
const story = JSON.parse(readFileSync(join(dataDir, "story_text.json"), "utf8"));

function assertUnique(items, key, label) {
  const values = items.map((item) => item[key]);
  if (new Set(values).size !== values.length) throw new Error(`${label} 存在重复 ${key}`);
}

assertUnique(materials, "id", "材料表");
assertUnique(nodes, "id", "冒险节点表");

const missingStoryKeys = nodes.flatMap((node) => [
  ...node.seg.map((segment) => segment.textKey),
  ...(node.hiddenSeg ? [node.hiddenSeg.textKey] : []),
]).filter((key) => !(key in story.nodes));

if (missingStoryKeys.length) throw new Error(`故事文案缺少键：${missingStoryKeys.join(", ")}`);
console.log(`数据校验通过：${materials.length} 种材料、${nodes.length} 个节点、${Object.keys(story.nodes).length} 条节点文案。`);
