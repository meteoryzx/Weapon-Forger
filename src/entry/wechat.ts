import { GameApplication } from "../app/game-application.ts";
import { FORGE_RULES } from "../forge/index.ts";
import type { WechatApi } from "../platform/wechat-types.ts";
import { FurnaceView } from "../render/furnace-view.ts";

const wxApi = (globalThis as { readonly wx?: WechatApi }).wx;
if (!wxApi) throw new Error("Wechat entry requires the wx Mini Game API.");

const systemInfo = wxApi.getSystemInfoSync();
const canvas = wxApi.createCanvas();
canvas.width = systemInfo.windowWidth * systemInfo.pixelRatio;
canvas.height = systemInfo.windowHeight * systemInfo.pixelRatio;
const viewport = {
  width: systemInfo.windowWidth,
  height: systemInfo.windowHeight,
  pixelRatio: systemInfo.pixelRatio,
};

const application = new GameApplication();
const view = new FurnaceView(canvas, viewport);
let periodStartedAtMs = Date.now();
let latestSnapshot = application.getSnapshot();
let lastThermalPreviewAtMs = -Infinity;

wxApi.onTouchStart((event) => {
  const touch = event.touches[0];
  const now = performance.now();
  if (!touch || view.isAnimating(now) || !view.pickToggle(touch.clientX, touch.clientY)) return;
  const snapshot = latestSnapshot;
  const destination = snapshot.billetLocation === "inspection" ? "furnace" : "inspection";
  const elapsedMs = Math.min(Date.now() - periodStartedAtMs, FORGE_RULES.maximumThermalIntentMs);
  application.applyIntent({ kind: "move-billet", destination, elapsedMs });
  periodStartedAtMs = Date.now();
  latestSnapshot = application.getSnapshot();
  view.update(latestSnapshot, now);
});

const renderFrame = (nowMs: number) => {
  if (nowMs - lastThermalPreviewAtMs >= 100) {
    latestSnapshot = application.getSnapshot(Date.now() - periodStartedAtMs);
    lastThermalPreviewAtMs = nowMs;
  }
  view.update(latestSnapshot, nowMs);
  globalThis.requestAnimationFrame(renderFrame);
};
globalThis.requestAnimationFrame(renderFrame);
