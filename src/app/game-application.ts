import {
  applyForgeIntent,
  createForgeFacts,
  createForgeSnapshot,
  createForgeState,
  FORGE_RULES,
  type ForgeFacts,
  previewThermalState,
  type ForgeIntent,
  type ForgeMaterial,
  type ForgeSnapshot,
  type ForgeState,
  type CutOperation,
} from "../forge/index.ts";

export class GameApplication {
  private state: ForgeState;
  private previewState: ForgeState;
  private previewElapsedMs = 0;
  private preparedCut: { source: ForgeState; result: ForgeState; operation: CutOperation } | null = null;
  private cutGeneration = 0;

  async prepareCut(operation: CutOperation, evaluate: (state: ForgeState, operation: CutOperation) => Promise<ForgeState>): Promise<boolean> {
    this.preparedCut = null;
    const generation=++this.cutGeneration;
    const source = this.state;
    const result = await evaluate(source, operation);
    if (source !== this.state || generation!==this.cutGeneration) return false;
    this.preparedCut = { source, result, operation };
    return true;
  }

  cancelPreparedCut(): void { this.preparedCut = null; this.cutGeneration++; }

  commitPreparedCut(operation: CutOperation): ForgeSnapshot {
    const prepared = this.preparedCut;
    if (!prepared || prepared.source !== this.state || JSON.stringify(operation) !== JSON.stringify(prepared.operation)) {
      throw new Error("Cut preview is stale. Position the workpiece again.");
    }
    this.state = prepared.result;
    this.previewState = this.state;
    this.previewElapsedMs = 0;
    this.preparedCut = null;
    return this.getSnapshot();
  }

  constructor(material?: ForgeMaterial) {
    this.state = createForgeState(material ? { material } : {});
    this.previewState = this.state;
  }

  getState(): ForgeState {
    return this.state;
  }

  getFacts(): ForgeFacts {
    return createForgeFacts(this.state);
  }

  getSnapshot(elapsedMs = 0): ForgeSnapshot {
    const boundedElapsed = Math.min(Math.max(elapsedMs, 0), FORGE_RULES.maximumThermalIntentMs);
    if (boundedElapsed < this.previewElapsedMs) {
      this.previewState = this.state;
      this.previewElapsedMs = 0;
    }
    const delta = boundedElapsed - this.previewElapsedMs;
    if (delta > 0) {
      this.previewState = previewThermalState(this.previewState, delta);
      this.previewElapsedMs = boundedElapsed;
    }
    return createForgeSnapshot(this.previewState);
  }

  applyIntent(intent: ForgeIntent): ForgeSnapshot {
    this.state = applyForgeIntent(this.state, intent);
    this.previewState = this.state;
    this.previewElapsedMs = 0;
    return this.getSnapshot();
  }

  // Freezes the currently previewed thermal state into the committed state,
  // used when the player leaves the furnace stage so forging starts hot.
  commitPreview(): void {
    this.state = this.previewState;
    this.previewElapsedMs = 0;
  }
}
