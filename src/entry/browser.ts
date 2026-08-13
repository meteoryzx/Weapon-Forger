import { GameApplication } from "../app/game-application.ts";
import { FORGE_RULES } from "../forge/index.ts";
import { FurnaceView } from "../render/furnace-view.ts";

const canvas = document.querySelector<HTMLCanvasElement>("#game");
if (!canvas) throw new Error("Missing #game canvas.");

const application = new GameApplication();
const view = new FurnaceView(canvas, browserViewport());
let periodStartedAtMs = Date.now();
let animationFrame = 0;
let latestSnapshot = application.getSnapshot();
let lastThermalPreviewAtMs = -Infinity;

canvas.addEventListener("pointerdown", (event) => {
  const now = performance.now();
  if (view.isAnimating(now)) return;
  const bounds = canvas.getBoundingClientRect();
  if (!view.pickToggle(event.clientX - bounds.left, event.clientY - bounds.top)) return;
  const snapshot = latestSnapshot;
  const destination = snapshot.billetLocation === "inspection" ? "furnace" : "inspection";
  const elapsedMs = Math.min(Date.now() - periodStartedAtMs, FORGE_RULES.maximumThermalIntentMs);
  application.applyIntent({ kind: "move-billet", destination, elapsedMs });
  periodStartedAtMs = Date.now();
  const next = application.getSnapshot();
  latestSnapshot = next;
  canvas.dataset.billetLocation = next.billetLocation;
  view.update(next, now);
});

window.addEventListener("resize", () => view.resize(browserViewport()));
window.addEventListener("beforeunload", () => {
  window.cancelAnimationFrame(animationFrame);
  view.dispose();
});

const renderFrame = (nowMs: number) => {
  if (nowMs - lastThermalPreviewAtMs >= 100) {
    latestSnapshot = application.getSnapshot(Date.now() - periodStartedAtMs);
    canvas.dataset.billetLocation = latestSnapshot.billetLocation;
    lastThermalPreviewAtMs = nowMs;
  }
  view.update(latestSnapshot, nowMs);
  animationFrame = window.requestAnimationFrame(renderFrame);
};
animationFrame = window.requestAnimationFrame(renderFrame);

function browserViewport() {
  return {
    width: window.innerWidth,
    height: window.innerHeight,
    pixelRatio: window.devicePixelRatio,
  };
}
