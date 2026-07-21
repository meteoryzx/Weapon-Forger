import { GameApplication } from "../app/game-application.ts";
import { ForgeBilletView } from "../render/forge-billet-view.ts";

const canvas = document.querySelector<HTMLCanvasElement>("#game");
if (!canvas) {
  throw new Error("Missing #game canvas.");
}

const application = new GameApplication();
const view = new ForgeBilletView(canvas, browserViewport());

view.update(application.getSnapshot());
canvas.addEventListener("pointerdown", (event) => {
  const bounds = canvas.getBoundingClientRect();
  const sectionIndex = view.pickSection(event.clientX - bounds.left, event.clientY - bounds.top);
  if (sectionIndex === null) {
    return;
  }
  view.update(application.applyIntent({ kind: "hammer", sectionIndex, energy: 0.85, lateralBias: 0 }), sectionIndex);
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
