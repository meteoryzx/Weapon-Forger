import { GameApplication } from "../app/game-application.ts";
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

const application = new GameApplication();
const view = new ForgeBilletView(canvas, {
  width: systemInfo.windowWidth,
  height: systemInfo.windowHeight,
  pixelRatio: systemInfo.pixelRatio,
});

view.update(application.getSnapshot());
wxApi.onTouchStart((event) => {
  const touch = event.touches[0];
  if (!touch) {
    return;
  }
  const sectionIndex = view.pickSection(touch.clientX, touch.clientY);
  if (sectionIndex === null) {
    return;
  }
  view.update(application.applyIntent({ kind: "hammer", sectionIndex, energy: 0.85, lateralBias: 0 }), sectionIndex);
});
