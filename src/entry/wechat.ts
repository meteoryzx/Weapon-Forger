import { GameApplication } from "../app/game-application.ts";
import { hammerEnergyForPressDuration } from "../platform/hammer-charge.ts";
import type { WechatApi } from "../platform/wechat-types.ts";
import { ForgeBilletView } from "../render/forge-billet-view.ts";

const wxApi = (globalThis as { readonly wx?: WechatApi }).wx;
if (!wxApi) {
  throw new Error("Wechat entry requires the wx Mini Game API.");
}

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
const view = new ForgeBilletView(canvas, viewport);

view.update(application.getSnapshot());
let activePress: { readonly sectionIndex: number; readonly startedAtMs: number } | null = null;

wxApi.onTouchStart((event) => {
  const touch = event.touches[0];
  if (!touch) {
    return;
  }
  const quarterTurns = view.pickRotateControl(touch.clientX, touch.clientY);
  if (quarterTurns !== null) {
    activePress = null;
    view.update(application.applyIntent({ kind: "rotate", quarterTurns }));
    return;
  }

  const sectionIndex = view.pickSection(touch.clientX, touch.clientY);
  if (sectionIndex === null) {
    return;
  }
  activePress = { sectionIndex, startedAtMs: Date.now() };
});
wxApi.onTouchEnd(() => {
  if (!activePress) {
    return;
  }
  const { sectionIndex, startedAtMs } = activePress;
  activePress = null;
  const energy = hammerEnergyForPressDuration(Date.now() - startedAtMs);
  view.update(application.applyIntent({ kind: "hammer", sectionIndex, energy, lateralBias: 0 }), sectionIndex);
});
wxApi.onTouchCancel(() => {
  activePress = null;
});
