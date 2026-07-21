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
  const sectionIndex = view.pickSection(event.clientX - bounds.left, event.clientY - bounds.top);
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
window.addEventListener("resize", () => view.resize(browserViewport()));
window.addEventListener("beforeunload", () => view.dispose());

function browserViewport() {
  return {
    width: window.innerWidth,
    height: window.innerHeight,
    pixelRatio: window.devicePixelRatio,
  };
}
