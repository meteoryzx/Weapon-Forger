import type { StoryBranch, StoryCondition } from "./story-types.ts";

// 故事内容属于数据，不写进逻辑。每个分支的 condition 声明它读取的武器事实，
// reads 记录同一事实，供作者追溯「这个后果来自哪个维度/特性/缺陷」。

const sharp = (min: number): StoryCondition => ({ kind: "dimension", dimension: "sharpness", min });
const tough = (min: number): StoryCondition => ({ kind: "dimension", dimension: "toughness", min });
const appearance = (min: number): StoryCondition => ({ kind: "dimension", dimension: "appearance", min });
const balance = (max: number): StoryCondition => ({ kind: "dimension", dimension: "balance", max });
const flaw = (flawId: string): StoryCondition => ({ kind: "has-flaw", flawId });

export const NPC_NAMES = ["埃德加", "薇拉", "老铁匠学徒卡姆"] as const;

// 情境一：砍断绳索/障碍，读取锋利与刃口。
export const SITUATION_CUT: readonly StoryBranch[] = [
  {
    id: "cut-clean",
    title: "绳索应声而断",
    text: "利刃一挥，粗绳齐整断开。NPC 看着切口，低声赞叹。",
    condition: sharp(0.7),
    reads: ["sharpness"],
  },
  {
    id: "cut-dull",
    title: "钝刃锯磨",
    text: "刃口太钝，NPC 来回锯磨许久才勉强割断，手腕酸痛。",
    condition: flaw("unsharpened"),
    reads: ["unsharpened"],
  },
  {
    id: "cut-rough",
    title: "勉强割断",
    text: "绳子断了，但切口参差不齐，费了不少力气。",
    condition: { kind: "default" },
    reads: ["sharpness"],
  },
];

// 情境二：格挡重击，读取裂纹与韧性。
export const SITUATION_BLOCK: readonly StoryBranch[] = [
  {
    id: "block-break",
    title: "格挡时断裂",
    text: "重击落下，武器在裂纹处应声折断。NPC 看着断口，脸色发白。",
    condition: flaw("cracked"),
    reads: ["cracked"],
  },
  {
    id: "block-hold",
    title: "稳稳格挡",
    text: "武器稳稳挡住重击，虎口震得发麻，却毫发无损。",
    condition: tough(0.7),
    reads: ["toughness"],
  },
  {
    id: "block-bend",
    title: "弯折变形",
    text: "武器弯折变形，勉强没断，但已不再趁手。",
    condition: { kind: "default" },
    reads: ["toughness"],
  },
];

// 情境三：面对强盗，读取外观与平衡。
export const SITUATION_FACE_BANDITS: readonly StoryBranch[] = [
  {
    id: "bandit-deter",
    title: "不战而退",
    text: "强盗见利刃寒光逼人，掂量一番后悻悻退去。",
    condition: appearance(0.7),
    reads: ["appearance"],
  },
  {
    id: "bandit-slow",
    title: "笨重失手",
    text: "武器沉重失衡，NPC 挥动迟缓，被抢走了盘缠。",
    condition: balance(0.4),
    reads: ["balance"],
  },
  {
    id: "bandit-scuffle",
    title: "缠斗脱身",
    text: "一番纠缠后 NPC 才脱身，身上多了几处擦伤。",
    condition: { kind: "default" },
    reads: ["balance", "appearance"],
  },
];

export const SITUATIONS = [
  { id: "cut", label: "砍断绳索", branches: SITUATION_CUT },
  { id: "block", label: "格挡重击", branches: SITUATION_BLOCK },
  { id: "bandits", label: "面对强盗", branches: SITUATION_FACE_BANDITS },
] as const;

export const ENDING_FAMOUS = {
  id: "famous",
  title: "传家之刃",
  text: "这趟冒险之后，这把武器成了 NPC 逢人便夸的传家之物。",
  reads: ["sharpness", "hardness"],
} as const;

export const ENDING_SCARRED = {
  id: "scarred",
  title: "伤痕累累",
  text: "冒险有惊无险地结束了，武器上留下了累累伤痕，也留下了故事。",
  reads: [],
} as const;

export const ENDING_BROKEN = {
  id: "broken",
  title: "折戟",
  text: "武器最终折断了。NPC 把断刃包好带走，说要记住那个裂纹。",
  reads: ["cracked"],
} as const;
