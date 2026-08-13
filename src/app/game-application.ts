import {
  applyForgeIntent,
  applyForgeOperation,
  createForgeSnapshot,
  createForgeState,
  type ForgeIntent,
  type ForgeSnapshot,
  type ForgeState,
} from "../forge/index.ts";

export class GameApplication {
  private state: ForgeState;

  constructor() {
    const initial = createForgeState();
    // R0 keeps the billet in a visible forging state so click-to-deform can be verified.
    this.state = applyForgeOperation(initial, { kind: "heat", temperatureC: 950 });
  }

  getSnapshot(): ForgeSnapshot {
    return createForgeSnapshot(this.state);
  }

  applyIntent(intent: ForgeIntent): ForgeSnapshot {
    this.state = applyForgeIntent(this.state, intent);
    return this.getSnapshot();
  }
}
