import {
  applyForgeIntent,
  createForgeSnapshot,
  createForgeState,
  deriveForgeData,
  FORGE_RULES,
  type ForgeDerivationProfile,
  type ForgeDerivedData,
  previewThermalState,
  type ForgeIntent,
  type ForgeMaterial,
  type ForgeSnapshot,
  type ForgeState,
} from "../forge/index.ts";

export class GameApplication {
  private state: ForgeState;
  private previewState: ForgeState;
  private previewElapsedMs = 0;

  constructor(material?: ForgeMaterial) {
    this.state = createForgeState(material ? { material } : {});
    this.previewState = this.state;
  }

  getState(): ForgeState {
    return this.state;
  }

  getDerivedData(profile?: ForgeDerivationProfile): ForgeDerivedData {
    return deriveForgeData(this.state, profile);
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
