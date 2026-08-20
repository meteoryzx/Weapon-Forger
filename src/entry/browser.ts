import {
  SPRING_STEEL,
  createHammerInfluencePreview,
  type ForgeSnapshot,
} from "../forge/index.ts";
import { GameApplication } from "../app/game-application.ts";
import { hammerEnergyForPressDuration } from "../platform/hammer-charge.ts";
import { ForgeBilletView } from "../render/forge-billet-view.ts";

const canvas = document.querySelector<HTMLCanvasElement>("#game")!;
const hudTitle = document.querySelector<HTMLElement>("#hud-title")!;
const hudHint = document.querySelector<HTMLElement>("#hud-hint")!;
const hudState = document.querySelector<HTMLElement>("#hud-state")!;

// This page is one independent operation station, not a button-driven process flow.
const application = new GameApplication(SPRING_STEEL);
application.applyIntent({ kind: "move-billet", destination: "furnace", elapsedMs: 0 });
application.getSnapshot(25_000);
application.commitPreview();
let view: ForgeBilletView | null = null;
let latestSnapshot: ForgeSnapshot = application.getSnapshot();
let pressStartedAtMs: number | null = null;
let pressTarget: { sectionIndex: number; faceBias: number } | null = null;

function viewport() {
  return { width: window.innerWidth, height: window.innerHeight, pixelRatio: window.devicePixelRatio };
}

function renderState(): void {
  const state = application.getState();
  const hammerCount = state.operations.filter((operation) => operation.kind === "hammer").length;
  const damage = state.workpiece.sections.reduce((sum, section) => sum + section.damage, 0)
    / state.workpiece.sections.length;
  hudState.textContent = [
    `弹簧钢 · 当前工件 ${latestSnapshot.workpieceId}`,
    `温度 ${latestSnapshot.averageTemperatureC.toFixed(0)}℃`,
    `锤击 ${hammerCount} 次`,
    `损伤 ${Math.round(damage * 100)}%`,
  ].join(" · ");
  document.body.dataset.stage = "forge";
  document.body.dataset.operationCount = String(state.operations.length);
}

function updateView(hammerPreview = null): void {
  latestSnapshot = application.getSnapshot();
  view?.update(latestSnapshot, hammerPreview);
  renderState();
}

hudTitle.textContent = "铁砧 · 锤击";
hudHint.textContent = "高温钢坯 · 砧面工作站";
view = new ForgeBilletView(canvas, viewport());
updateView();

canvas.addEventListener("pointerdown", (event) => {
  if (!view) return;
  const bounds = canvas.getBoundingClientRect();
  const target = view.pickHammerTarget(event.clientX - bounds.left, event.clientY - bounds.top);
  if (!target) return;
  pressStartedAtMs = performance.now();
  pressTarget = target;
  view.update(latestSnapshot, createHammerInfluencePreview(latestSnapshot, {
    sectionIndex: target.sectionIndex,
    faceBias: target.faceBias,
    energy: 1,
  }));
});

function releaseHammer(): void {
  if (pressStartedAtMs === null || pressTarget === null) return;
  const energy = hammerEnergyForPressDuration(performance.now() - pressStartedAtMs);
  latestSnapshot = application.applyIntent({
    kind: "hammer",
    sectionIndex: pressTarget.sectionIndex,
    faceBias: pressTarget.faceBias,
    energy,
  });
  pressStartedAtMs = null;
  pressTarget = null;
  updateView();
}

canvas.addEventListener("pointerup", releaseHammer);
canvas.addEventListener("pointercancel", releaseHammer);

window.addEventListener("keydown", (event) => {
  let intent: { kind: "rotate"; quarterTurns: 1 | -1 } | { kind: "feed"; step: 1 | -1 } | null = null;
  switch (event.key.toLowerCase()) {
    case "a": intent = { kind: "rotate", quarterTurns: -1 }; break;
    case "d": intent = { kind: "rotate", quarterTurns: 1 }; break;
    case "w": intent = { kind: "feed", step: 1 }; break;
    case "s": intent = { kind: "feed", step: -1 }; break;
    default: return;
  }
  latestSnapshot = application.applyIntent(intent);
  updateView();
});

window.addEventListener("resize", () => view?.resize(viewport()));
window.addEventListener("beforeunload", () => view?.dispose());
