import { evaluateWeapon, type WeaponData } from "../evaluate/index.ts";
import {
  FORGE_MATERIALS,
  type ForgeIntent,
  type ForgeMaterial,
  type ForgeSnapshot,
} from "../forge/index.ts";
import { tellStory, type StoryResult } from "../story/index.ts";
import { GameApplication } from "./game-application.ts";

export type DemoStage = "select" | "heat" | "forge" | "quench" | "grind" | "story";

const STORY_SEED = "demo-1";

// 线性流程编排：选料 -> 加热 -> 锻打 -> 淬火 -> 研磨 -> 完成 -> 故事。
// 不存物理规则、不 import Three.js；只负责工序顺序和最终评估/故事的调用。
export class DemoFlow {
  private app: GameApplication | null = null;
  private stage: DemoStage = "select";
  private weapon: WeaponData | null = null;
  private story: StoryResult | null = null;

  getStage(): DemoStage {
    return this.stage;
  }

  getMaterials(): readonly ForgeMaterial[] {
    return FORGE_MATERIALS;
  }

  getSnapshot(elapsedMs = 0): ForgeSnapshot {
    if (!this.app) throw new Error("No material selected yet.");
    return this.app.getSnapshot(elapsedMs);
  }

  selectMaterial(materialId: string): DemoStage {
    const material = FORGE_MATERIALS.find((candidate) => candidate.id === materialId);
    if (!material) throw new Error(`Unknown material: ${materialId}.`);
    this.app = new GameApplication(material);
    this.stage = "heat";
    return this.stage;
  }

  applyIntent(intent: ForgeIntent): ForgeSnapshot {
    if (!this.app) throw new Error("No material selected yet.");
    return this.app.applyIntent(intent);
  }

  // 离炉进入锻打时，把火炉里预览到的温度冻结为已提交状态。
  commitPreview(): void {
    this.app?.commitPreview();
  }

  advance(): DemoStage {
    switch (this.stage) {
      case "heat":
        this.commitPreview();
        this.stage = "forge";
        break;
      case "forge":
        this.stage = "quench";
        break;
      case "quench":
        this.stage = "grind";
        break;
      case "grind":
        this.finish();
        break;
      default:
        break;
    }
    return this.stage;
  }

  finish(): void {
    if (!this.app) throw new Error("No material selected yet.");
    this.weapon = evaluateWeapon(this.app.getState());
    this.story = tellStory(this.weapon, STORY_SEED);
    this.stage = "story";
  }

  getWeapon(): WeaponData | null {
    return this.weapon;
  }

  getStory(): StoryResult | null {
    return this.story;
  }

  restart(): void {
    this.app = null;
    this.stage = "select";
    this.weapon = null;
    this.story = null;
  }
}
