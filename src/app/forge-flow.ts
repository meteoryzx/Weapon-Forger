import {
  FORGE_MATERIALS,
  type ForgeIntent,
  type ForgeMaterial,
  type ForgeSnapshot,
  type ForgeState,
} from "../forge/index.ts";
import { GameApplication } from "./game-application.ts";

export type DemoStage = "select" | "heat" | "forge" | "quench" | "grind" | "done";

// R1 线性流程编排：选料 -> 加热 -> 锻打 -> 淬火 -> 研磨 -> 完成。
// R1 只产出「原始状态」（外观 + 原始数值），不产出六维、不产出故事。
// 六维是 R2、故事是 R3，属后续阶段，不得在这里引入。
export class DemoFlow {
  private app: GameApplication | null = null;
  private stage: DemoStage = "select";

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

  getState(): ForgeState | null {
    return this.app?.getState() ?? null;
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
        this.stage = "done";
        break;
      default:
        break;
    }
    return this.stage;
  }

  restart(): void {
    this.app = null;
    this.stage = "select";
  }
}
