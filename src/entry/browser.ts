import { GameApplication } from "../app/game-application.ts";
import { createHammerInfluencePreview, type HammerInfluencePreview } from "../forge/index.ts";
import { HAMMER_INPUT_RULES, hammerEnergyForPressDuration } from "../platform/hammer-charge.ts";
import { ForgeBilletView } from "../render/forge-billet-view.ts";

const canvas = document.querySelector<HTMLCanvasElement>("#game");
if (!canvas) {
  throw new Error("Missing #game canvas.");
}

const application = new GameApplication();
const view = new ForgeBilletView(canvas, browserViewport());

view.update(application.getSnapshot());
let activePress: { readonly sectionIndex: number; readonly faceBias: number; readonly startedAtMs: number } | null = null;
let hoverTarget: { readonly sectionIndex: number; readonly faceBias: number } | null = null;
let activePreview: HammerInfluencePreview | null = null;
let chargeFrame: number | null = null;

canvas.addEventListener("pointerdown", (event) => {
  const bounds = canvas.getBoundingClientRect();
  const viewportX = event.clientX - bounds.left;
  const viewportY = event.clientY - bounds.top;
  const quarterTurns = view.pickRotateControl(viewportX, viewportY);
  if (quarterTurns !== null) {
    activePress = null;
    hoverTarget = null;
    stopChargePreview();
    updateView(application.applyIntent({ kind: "rotate", quarterTurns }), null);
    return;
  }

  const target = view.pickHammerTarget(viewportX, viewportY);
  if (!target) {
    return;
  }
  activePress = { ...target, startedAtMs: Date.now() };
  hoverTarget = target;
  updatePreview(target, HAMMER_INPUT_RULES.lightHammerEnergy);
  startChargePreview();
  canvas.setPointerCapture(event.pointerId);
});
canvas.addEventListener("pointermove", (event) => {
  const bounds = canvas.getBoundingClientRect();
  const viewportX = event.clientX - bounds.left;
  const viewportY = event.clientY - bounds.top;
  const target = view.pickHammerTarget(viewportX, viewportY);
  if (activePress) {
    return;
  }
  hoverTarget = target;
  updatePreview(target, HAMMER_INPUT_RULES.lightHammerEnergy);
});
canvas.addEventListener("pointerup", (event) => {
  if (!activePress) {
    return;
  }
  const { sectionIndex, faceBias, startedAtMs } = activePress;
  activePress = null;
  stopChargePreview();
  if (canvas.hasPointerCapture(event.pointerId)) {
    canvas.releasePointerCapture(event.pointerId);
  }
  const energy = hammerEnergyForPressDuration(Date.now() - startedAtMs);
  updateView(application.applyIntent({ kind: "hammer", sectionIndex, faceBias, energy, lateralBias: 0 }), null);
  const bounds = canvas.getBoundingClientRect();
  const nextTarget = view.pickHammerTarget(event.clientX - bounds.left, event.clientY - bounds.top);
  hoverTarget = nextTarget;
  updatePreview(nextTarget, HAMMER_INPUT_RULES.lightHammerEnergy);
});
canvas.addEventListener("pointercancel", () => {
  activePress = null;
  hoverTarget = null;
  stopChargePreview();
  updateView(application.getSnapshot(), null);
});
canvas.addEventListener("pointerleave", () => {
  if (activePress) {
    return;
  }
  hoverTarget = null;
  updatePreview(null, HAMMER_INPUT_RULES.lightHammerEnergy);
});
window.addEventListener("keydown", (event) => {
  if (event.repeat) {
    return;
  }
  const key = event.key.toLowerCase();
  const quarterTurns = key === "a" ? -1 : key === "d" ? 1 : null;
  if (quarterTurns !== null) {
    event.preventDefault();
    hoverTarget = null;
    stopChargePreview();
    updateView(application.applyIntent({ kind: "rotate", quarterTurns }), null);
    return;
  }

  const step = key === "w" ? 1 : key === "s" ? -1 : null;
  if (step === null) {
    return;
  }

  event.preventDefault();
  activePress = null;
  hoverTarget = null;
  stopChargePreview();
  updateView(application.applyIntent({ kind: "feed", step }), null);
});
window.addEventListener("resize", () => view.resize(browserViewport()));
window.addEventListener("beforeunload", () => view.dispose());

function updatePreview(target: { readonly sectionIndex: number; readonly faceBias: number } | null, energy: number): void {
  const preview = target
    ? createHammerInfluencePreview(application.getSnapshot(), { ...target, energy })
    : null;
  updateView(application.getSnapshot(), preview);
}

function updateView(snapshot = application.getSnapshot(), preview = activePreview): void {
  activePreview = preview;
  view.update(snapshot, preview);
}

function startChargePreview(): void {
  if (chargeFrame !== null) {
    return;
  }
  const tick = () => {
    if (!activePress) {
      chargeFrame = null;
      return;
    }
    updatePreview(activePress, hammerEnergyForPressDuration(Date.now() - activePress.startedAtMs));
    chargeFrame = window.requestAnimationFrame(tick);
  };
  chargeFrame = window.requestAnimationFrame(tick);
}

function stopChargePreview(): void {
  if (chargeFrame === null) {
    return;
  }
  window.cancelAnimationFrame(chargeFrame);
  chargeFrame = null;
}

function browserViewport() {
  return {
    width: window.innerWidth,
    height: window.innerHeight,
    pixelRatio: window.devicePixelRatio,
  };
}
