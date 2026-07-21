import { GameApplication } from "../app/game-application.ts";
import { hammerEnergyForPressDuration } from "../platform/hammer-charge.ts";
import { ForgeBilletView } from "../render/forge-billet-view.ts";

const canvas = document.querySelector<HTMLCanvasElement>("#game");
if (!canvas) {
  throw new Error("Missing #game canvas.");
}

const application = new GameApplication();
const view = new ForgeBilletView(canvas, browserViewport());

view.update(application.getSnapshot());
let activePress: { readonly sectionIndex: number; readonly startedAtMs: number } | null = null;

canvas.addEventListener("pointerdown", (event) => {
  const bounds = canvas.getBoundingClientRect();
  const viewportX = event.clientX - bounds.left;
  const viewportY = event.clientY - bounds.top;
  const quarterTurns = view.pickRotateControl(viewportX, viewportY);
  if (quarterTurns !== null) {
    activePress = null;
    view.update(application.applyIntent({ kind: "rotate", quarterTurns }));
    return;
  }

  const sectionIndex = view.pickSection(viewportX, viewportY);
  if (sectionIndex === null) {
    return;
  }
  activePress = { sectionIndex, startedAtMs: Date.now() };
  canvas.setPointerCapture(event.pointerId);
});
canvas.addEventListener("pointerup", (event) => {
  if (!activePress) {
    return;
  }
  const { sectionIndex, startedAtMs } = activePress;
  activePress = null;
  if (canvas.hasPointerCapture(event.pointerId)) {
    canvas.releasePointerCapture(event.pointerId);
  }
  const energy = hammerEnergyForPressDuration(Date.now() - startedAtMs);
  view.update(application.applyIntent({ kind: "hammer", sectionIndex, energy, lateralBias: 0 }), sectionIndex);
});
canvas.addEventListener("pointercancel", () => {
  activePress = null;
});
window.addEventListener("keydown", (event) => {
  if (event.repeat) {
    return;
  }
  const key = event.key.toLowerCase();
  const quarterTurns = key === "a" ? -1 : key === "d" ? 1 : null;
  if (quarterTurns !== null) {
    event.preventDefault();
    view.update(application.applyIntent({ kind: "rotate", quarterTurns }));
    return;
  }

  const step = key === "w" ? -1 : key === "s" ? 1 : null;
  if (step === null) {
    return;
  }

  event.preventDefault();
  activePress = null;
  view.update(application.applyIntent({ kind: "feed", step }));
});
window.addEventListener("resize", () => view.resize(browserViewport()));
window.addEventListener("beforeunload", () => view.dispose());

function browserViewport() {
  return {
    width: window.innerWidth,
    height: window.innerHeight,
    pixelRatio: window.devicePixelRatio,
  };
}
