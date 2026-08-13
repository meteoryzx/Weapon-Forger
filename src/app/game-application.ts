import {
  applyForgeIntent,
  createForgeSnapshot,
  createForgeState,
  FORGE_RULES,
  previewThermalState,
  type ForgeIntent,
  type ForgeSnapshot,
  type ForgeState,
} from "../forge/index.ts";

export class GameApplication {
  private state: ForgeState;
  private previewState: ForgeState;
  private previewElapsedMs = 0;

  constructor() {
    this.state = createForgeState();
    this.previewState = this.state;
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
}
