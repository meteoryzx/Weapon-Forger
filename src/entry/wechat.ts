import { GameApplication } from "../app/game-application.ts";
import { HAMMER_HOME, HAMMER_RULES, hammerFrame, rotateHammerPoint } from "../forge/index.ts";
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

application.applyIntent({ kind: "move-billet", destination: "furnace", elapsedMs: 0 });
application.getSnapshot(20_000);
application.commitPreview();
application.applyIntent({ kind: "move-billet", destination: "inspection", elapsedMs: 0 });
view.enableRotateControls();
view.setStation("anvil");
let pose={...HAMMER_HOME};

function updateView(): void {
  view.update(application.getSnapshot(), null, "anvil");
  view.updateHammerPose(pose);
}

updateView();
function tick(now:number):void {view.tick(now);requestAnimationFrame(tick);}
requestAnimationFrame(tick);

wxApi.onTouchStart((event) => {
  const touch = event.touches[0];
  if (!touch) {
    return;
  }
  const quarterTurns = view.pickRotateControl(touch.clientX, touch.clientY);
  if (view.hammerView.busy) return;
  if (quarterTurns !== null) {
    pose={...pose,roll:pose.roll+quarterTurns*Math.PI/12};
    updateView();
    return;
  }

  const target = view.pickHammerSurface(touch.clientX, touch.clientY);
  if (!target) {
    return;
  }
  try{
    const before=hammerFrame(application.getState().workpiece.geometry,pose);
    application.applyIntent({ kind:"surface-hammer",pose,target,energy:HAMMER_RULES.defaultEnergy });
    const after=hammerFrame(application.getState().workpiece.geometry,pose);
    const shift=rotateHammerPoint({x:after.center.x-before.center.x,y:0,z:after.center.z-before.center.z},pose);
    pose={...pose,x:pose.x+shift.x,z:pose.z+shift.z};
    updateView();view.aimHammer(target,HAMMER_RULES.defaultEnergy);view.hammerView.strike(performance.now());view.hammerView.finishStrike(performance.now()+96);
  }catch{/* Unsupported surface touches do not mutate the workpiece. */}
});
