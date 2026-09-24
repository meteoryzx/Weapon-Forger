import {
  HIGH_CARBON_STEEL,
  SPRING_STEEL,
  FORGE_RULES,
  type ForgeSnapshot,
  type ForgeState,
  type CutOperation,
  type GrindOperation,
  totalVolume,
  createForgeSnapshot,
} from "../forge/index.ts";
import { GameApplication } from "../app/game-application.ts";
import { PowerHammerCycle, POWER_CADENCE_MS } from "../app/power-hammer-cycle.ts";
import { ForgePressCycle } from "../app/forge-press-cycle.ts";
import type { AbrasiveUpdate } from "../app/grind-update.ts";
import { MaterialSelection, MATERIAL_RACK_PAGE_SIZE } from "../app/material-selection.ts";
import { HAMMER_HOME, HAMMER_RULES, hammerFrame, rotateHammerPoint, type ForgePressOperation, type HammerPose, type PowerHammerOperation, type SurfaceHammerOperation } from "../forge/index.ts";
import { CUT_HOME, cutBounds, cutOperationFor, tablePoint, validCutPose, type CutPose } from "../app/cut-placement.ts";
import { solidBounds } from "../forge/solid-geometry.ts";
import { workshopUnits } from "../app/workshop-scale.ts";
import {
  ForgeBilletView,
  type ForgeMaterialPick,
  type ForgeStation,
  type InspectionView,
  type HammerPickTarget,
  type QuenchStation,
} from "../render/forge-billet-view.ts";

const canvas = document.querySelector<HTMLCanvasElement>("#game")!;
const hudTitle = document.querySelector<HTMLElement>("#hud-title")!;
const hudHint = document.querySelector<HTMLElement>("#hud-hint")!;
const hudState = document.querySelector<HTMLElement>("#hud-state")!;
const acceptanceConsole = document.querySelector<HTMLElement>("#acceptance-console")!;
const acceptanceButtons = [...document.querySelectorAll<HTMLButtonElement>("[data-acceptance-target]")];
const acceptanceQuenchMedium = document.querySelector<HTMLSelectElement>("#acceptance-quench-medium")!;
const acceptanceReset = document.querySelector<HTMLButtonElement>("#acceptance-reset")!;
const inspectionButtons = [...document.querySelectorAll<HTMLButtonElement>("[data-inspection-view]")];

// The browser entry translates continuous pointer input into the public forge intents.
const ACCEPTANCE_VERBS = ["materials", "cut", "weld", "heat", "hammer", "power", "press", "quench", "temper", "grind"] as const;
type AcceptanceVerb = typeof ACCEPTANCE_VERBS[number];
const searchParams = new URLSearchParams(window.location.search);
const requestedAcceptanceVerb = searchParams.get("accept");
const acceptanceVerb: AcceptanceVerb | null = ACCEPTANCE_VERBS.find(
  (verb) => verb === requestedAcceptanceVerb,
) ?? null;
const acceptanceMedium = searchParams.get("medium") === "oil" ? "oil" : "water";
const acceptanceStation: ForgeStation | null = acceptanceVerb === "materials" ? "materials"
  : acceptanceVerb === "cut" ? "cut"
  : acceptanceVerb === "weld" ? "weld"
  : acceptanceVerb === "heat" ? "furnace"
  : acceptanceVerb === "hammer" ? "anvil"
  : acceptanceVerb === "power" ? "power"
  : acceptanceVerb === "press" ? "press"
  : acceptanceVerb === "quench" ? `quench-${acceptanceMedium}` as ForgeStation
  : acceptanceVerb === "temper" ? "temper"
  : acceptanceVerb === "grind" ? "grind"
  : null;

function prepareHotWorkpiece(target: GameApplication, elapsedMs=20_000): void {
  target.applyIntent({ kind: "move-billet", destination: "furnace", elapsedMs: 0 });
  target.getSnapshot(elapsedMs);
  target.commitPreview();
  target.applyIntent({ kind: "move-billet", destination: "inspection", elapsedMs: 0 });
}

function createApplication(): GameApplication {
  const next = new GameApplication(SPRING_STEEL);
  if (acceptanceVerb === "weld") {
    next.applyIntent({ kind: "select-material", materialId: HIGH_CARBON_STEEL.id });
    prepareHotWorkpiece(next);
    next.applyIntent({ kind: "select-workpiece", benchIndex: 0 });
    prepareHotWorkpiece(next);
  } else if (acceptanceVerb === "hammer" || acceptanceVerb === "power" || acceptanceVerb === "press" || acceptanceVerb === "quench") {
    prepareHotWorkpiece(next,acceptanceVerb==="hammer"||acceptanceVerb==="power"||acceptanceVerb==="press"?30_000:20_000);
  } else if (acceptanceVerb === "temper") {
    prepareHotWorkpiece(next);
    next.applyIntent({ kind: "quench", medium: "water" });
  }
  return next;
}

let application = createApplication();
const materialSelection = new MaterialSelection(acceptanceVerb === "materials" ? null : application);
let rackPage = 0;
let rackNotice = "";
const materialSession = acceptanceVerb === "materials";
const materialControls = document.querySelector<HTMLElement>("#materials-controls")!;
const materialName = document.querySelector<HTMLElement>("#material-name")!;
const materialDetails = document.querySelector<HTMLElement>("#material-details")!;
const materialActions = document.querySelector<HTMLElement>("#material-actions")!;
const materialReturn = document.querySelector<HTMLButtonElement>("#material-return")!;
const rackNavigation = document.querySelector<HTMLElement>("#rack-navigation")!;
const rackPageLabel = document.querySelector<HTMLElement>("#rack-page")!;
const previousRackPage = document.querySelector<HTMLButtonElement>("#rack-previous")!;
const nextRackPage = document.querySelector<HTMLButtonElement>("#rack-next")!;
const workpieceLabel = document.querySelector<HTMLElement>("#workpiece-label")!;
const workpieceStation = document.querySelector<HTMLSelectElement>("#workpiece-station")!;
const workpieceTravel = document.querySelector<HTMLButtonElement>("#workpiece-travel")!;
if (materialSession) document.body.classList.add("material-session");
const acceptanceSetupOperationCount = acceptanceStation ? application.getState().operations.length : 0;

let view: ForgeBilletView | null = null;
let latestSnapshot: ForgeSnapshot = application.getSnapshot();
let activeStation: ForgeStation = "overview";
let hammerPose:HammerPose={...HAMMER_HOME},hammerEnergy:number=HAMMER_RULES.defaultEnergy;
let hammerAim:{x:number;z:number}|null=null;
let hammerDrag:{point:{x:number;z:number};pose:HammerPose}|null=null;
let hammerPieceId=latestSnapshot.workpieceId;
let hammerPending=false;
let hammerWorker:Worker|null=null;
function evaluateHammer(state:ForgeState,operation:SurfaceHammerOperation):Promise<ForgeState> {
  return new Promise((resolve,reject)=>{
    hammerWorker??=new Worker(new URL("../platform/hammer.worker.ts",import.meta.url),{type:"module"});
    const timer=setTimeout(()=>{hammerWorker?.terminate();hammerWorker=null;reject(new Error("锤击计算超时，请重试。"));},30000);
    hammerWorker.onmessage=(event:MessageEvent<{state?:ForgeState;error?:string}>)=>{
      clearTimeout(timer);if(event.data.state)resolve(event.data.state);else reject(new Error(event.data.error??"锤击计算失败。"));
    };
    hammerWorker.onerror=()=>{clearTimeout(timer);hammerWorker?.terminate();hammerWorker=null;reject(new Error("锤击计算失败，请重试。"));};
    hammerWorker.postMessage({state,operation});
  });
}
const hammerPoses=new Map<string,HammerPose>();
const hammerControls=document.querySelector<HTMLElement>("#hammer-controls")!;
const hammerStatus=document.querySelector<HTMLElement>("#hammer-status")!;
const hammerForce=document.querySelector<HTMLInputElement>("#hammer-force")!;
const hammerPieces=document.querySelector<HTMLSelectElement>("#hammer-piece")!;
function placeHammer(pose:HammerPose):void {
  if(hammerPending||view?.hammerView.busy)return;
  hammerPose=pose;hammerPoses.set(latestSnapshot.workpieceId,pose);hammerAim=null;
  view?.updateHammerPose(pose);view?.aimHammer(null,hammerEnergy);refreshHammerInterface();
}
function refreshHammerInterface():void {
  hammerControls.hidden=activeStation!=="anvil";if(hammerControls.hidden)return;
  for(const control of hammerControls.querySelectorAll<HTMLInputElement|HTMLButtonElement|HTMLSelectElement>("input,button,select"))control.disabled=hammerPending;
  document.body.dataset.hammerPending=String(hammerPending);
  if(hammerPieceId!==latestSnapshot.workpieceId){hammerPoses.set(hammerPieceId,hammerPose);hammerPieceId=latestSnapshot.workpieceId;hammerPose=hammerPoses.get(hammerPieceId)??{...HAMMER_HOME};view?.updateHammerPose(hammerPose);}
  hammerForce.value=String(Math.round(hammerEnergy*100));
  document.querySelector("#hammer-force-label")!.textContent=`${hammerForce.value}%`;
  const pieces=[latestSnapshot,...latestSnapshot.bench];
  hammerPieces.replaceChildren(...pieces.map(piece=>new Option(piece.workpieceId,piece.workpieceId)));
  hammerPieces.value=latestSnapshot.workpieceId;
  document.body.dataset.hammerEnergy=String(hammerEnergy);document.body.dataset.hammerYaw=String(hammerPose.yaw);
  document.body.dataset.hammerRoll=String(hammerPose.roll);document.body.dataset.hammerX=String(hammerPose.x);document.body.dataset.hammerZ=String(hammerPose.z);
}
function hammerDimensions():string {
  const {nodes,grid}=latestSnapshot.geometry;
  if(latestSnapshot.geometry.solids){
    const b=solidBounds(latestSnapshot.geometry.solids,latestSnapshot.geometry);
    const length=b.maxX-b.minX,width=b.maxZ-b.minZ,height=b.maxY-b.minY;
    delete document.body.dataset.hammerMinimumThickness;
    document.body.dataset.hammerWidth=String(width);document.body.dataset.hammerLength=String(length);
    return `外廓 长 ${length.toFixed(1)} · 宽 ${width.toFixed(1)} · 厚 ${height.toFixed(2)} mm`;
  }
  let min=Infinity;
  const stride=grid.widthBlocks+1,ring=stride*(grid.heightBlocks+1);
  for(let i=0;i<nodes.length;i+=ring)for(let w=0;w<=grid.widthBlocks;w++){
    const a=nodes[i+w]!,b=nodes[i+grid.heightBlocks*stride+w]!;
    min=Math.min(min,Math.hypot(a.axialPosition-b.axialPosition,a.verticalOffset-b.verticalOffset,a.lateralOffset-b.lateralOffset));
  }
  const length=Math.max(...nodes.map(n=>n.axialPosition))-Math.min(...nodes.map(n=>n.axialPosition));
  const width=Math.max(...nodes.map(n=>n.lateralOffset))-Math.min(...nodes.map(n=>n.lateralOffset));
  document.body.dataset.hammerMinimumThickness=String(min);
  document.body.dataset.hammerWidth=String(width);document.body.dataset.hammerLength=String(length);
  return `长 ${length.toFixed(1)} · 宽 ${width.toFixed(1)} · 局部最薄 ${min.toFixed(2)} mm`;
}
function aimHammer(point:{x:number;z:number}|null):void {
  hammerAim=point;const hit=view?.aimHammer(point,hammerEnergy);
  hammerStatus.textContent=hit ? hit.supported?`有效接触 · 力度 ${Math.round(hammerEnergy*100)}% · 砧面支撑 ${Math.round(hit.supportRatio*100)}%`:
      "该落点缺少砧面支撑，请移动工件。":"瞄准金属表面 · 单击落锤 · 滚轮调力度";
}
async function strikeHammer(point:{x:number;z:number}):Promise<void> {
  if(!view || hammerPending || view.hammerView.busy)return;
  const contact=view.aimHammer(point,hammerEnergy);
  if(!contact?.supported){aimHammer(point);return;}
  const pose={...hammerPose},energy=hammerEnergy;
  const before=hammerFrame(latestSnapshot.geometry,hammerPose);
  hammerPending=true;view.hammerView.strike(performance.now());
  refreshHammerInterface();
  try{
    await application.applySurfaceHammer({kind:"surface-hammer",pose,target:point,energy},evaluateHammer);
    const after=hammerFrame(application.getState().workpiece.geometry,hammerPose);
    const shift=rotateHammerPoint({x:after.center.x-before.center.x,y:0,z:after.center.z-before.center.z},hammerPose);
    hammerPose={...hammerPose,x:hammerPose.x+shift.x,z:hammerPose.z+shift.z};hammerPoses.set(latestSnapshot.workpieceId,hammerPose);
    updateView();view?.updateHammerPose(hammerPose);aimHammer(point);
  }catch(error){hammerStatus.textContent=error instanceof Error?error.message:"落锤未完成，请重新瞄准。";}
  finally{hammerPending=false;view?.hammerView.finishStrike(performance.now());refreshHammerInterface();}
}
hammerForce.addEventListener("input",()=>{hammerEnergy=Number(hammerForce.value)/100;refreshHammerInterface();aimHammer(hammerAim);});
document.querySelector("#hammer-center")!.addEventListener("click",()=>placeHammer({...HAMMER_HOME}));
document.querySelector("#hammer-overview")!.addEventListener("click",()=>setStation("overview"));
hammerPieces.addEventListener("change",()=>{const index=latestSnapshot.bench.findIndex(p=>p.workpieceId===hammerPieces.value);if(index>=0){application.applyIntent({kind:"select-workpiece",benchIndex:index});updateView();}});

const poweredControls=document.querySelector<HTMLElement>("#powered-controls")!;
const poweredStatus=document.querySelector<HTMLElement>("#powered-status")!;
const poweredForce=document.querySelector<HTMLInputElement>("#powered-force")!;
const poweredRun=document.querySelector<HTMLButtonElement>("#powered-run")!;
let poweredPending=false,poweredWorker:Worker|null=null;
let poweredWorkerSource:ForgeState|null=null;
const powerCycle=new PowerHammerCycle();
const pressCycle=new ForgePressCycle();
let pressPoseCurrent:HammerPose={...HAMMER_HOME};
let pressDisplayPose:HammerPose|null=null;
let pressHeld=false;
let pressSession:{source:ForgeState;pose:HammerPose;pressure:number;contact:boolean;dwell:number;result:ForgeState|null;operation:ForgePressOperation|null}|null=null;
let powerHeld=false,powerPoseCurrent:HammerPose={...HAMMER_HOME};
let poweredDrag:{point:{x:number;z:number};pose:HammerPose;rotate:boolean;startX:number}|null=null;
let powerStroke:{pose:HammerPose;energy:number;contact:boolean}|null=null;
// The press needs to start in the hot-yielding range so a normal hold produces
// a readable silhouette change; the player can still tune it from the slider.
const poweredLoads={power:45,press:65};
let poweredLoadStation:"power"|"press"|null=null;
let powerNotice="";

function poweredPose():HammerPose {
  return activeStation==="power"?powerPoseCurrent:pressDisplayPose??pressPoseCurrent;
}
function feedVector(): { x:number; z:number } {
  return activeStation==="power"||activeStation==="press" ? view?.operationFeedVector() ?? {x:0,z:-1} : {x:0,z:-1};
}
function alignPoweredPoseToFeed(pose: HammerPose): HammerPose {
  const forward=feedVector();
  // hammerFrame's local +X is the billet's long axis. Rotate it onto the
  // operator-facing feed vector so W/S moves along the visible long edge.
  return {...pose,yaw:Math.atan2(-forward.z,forward.x)};
}
function evaluatePowered(state:ForgeState,operation:PowerHammerOperation|ForgePressOperation):Promise<ForgeState> {
  return new Promise((resolve,reject)=>{
    poweredWorker??=new Worker(new URL("../platform/hammer.worker.ts",import.meta.url),{type:"module"});
    const timer=setTimeout(()=>{poweredWorker?.terminate();poweredWorker=null;poweredWorkerSource=null;reject(new Error("动力设备计算超时，请重试。"));},30000);
    poweredWorker.onmessage=(event:MessageEvent<{state?:ForgeState;error?:string}>)=>{
      clearTimeout(timer);if(event.data.state)resolve(event.data.state);else reject(new Error(event.data.error??"动力设备计算失败。"));
    };
    poweredWorker.onerror=()=>{clearTimeout(timer);poweredWorker?.terminate();poweredWorker=null;poweredWorkerSource=null;reject(new Error("动力设备计算失败，请重试。"));};
    poweredWorker.postMessage(poweredWorkerSource===state?{reuseBaseline:true,operation}:{state,operation});
    poweredWorkerSource=state;
  });
}
function refreshPoweredInterface():void {
  const active=activeStation==="power"||activeStation==="press";
  document.getElementById("power-machine-view")!.hidden=!active;
  poweredControls.hidden=!active;if(!active)return;
  const press=activeStation==="press";
  const station=press?"press":"power";
  if(poweredLoadStation!==station){
    if(poweredLoadStation)poweredLoads[poweredLoadStation]=Number(poweredForce.value);
    poweredForce.value=String(poweredLoads[station]);poweredLoadStation=station;
  }
  const pose=poweredPose(),busy=poweredPending||powerCycle.busy||pressCycle.busy;
  document.querySelector("#powered-force-label")!.textContent=`${poweredForce.value}%`;
  poweredRun.textContent=press?"下压":"锻打";
  poweredRun.title=press?"按住持续下压，松开回程":"按住锻打，松开停止后续冲击";
  poweredRun.disabled=false;
  poweredForce.disabled=press&&busy;
  (document.querySelector("#powered-center") as HTMLButtonElement).disabled=busy;
  document.body.dataset.poweredPending=String(poweredPending);
  document.body.dataset.poweredLoad=String(Number(poweredForce.value)/100);
  // Placement input is applied on the next render tick so repeated W/S/A/D
  // events do not synchronously rebuild and render the powered workpiece.
  view?.setPoweredPose(poweredPose(), false);
  if(!poweredPending)poweredStatus.textContent=press
    ? powerNotice || ({idle:view?.pressWorkpiece.contact?.supported?"平压头 · 接触有效":"平压头 · 无支撑接触",closing:"接近工件",loading:"持续受压",settling:"释放载荷",opening:"回程"}[pressCycle.phase])
    : powerNotice || (view?.powerWorkpiece.contact?.supported?"接触有效":"空击");
}
function placePower(pose:HammerPose):void {
  if(poweredPending||powerCycle.busy||pressCycle.busy||!view)return;
  const placed=view.placePowerWorkpiece(pose);
  if(placed){
    if(activeStation==="press")pressPoseCurrent={...pose};else powerPoseCurrent={...pose};
    powerNotice="";
  }
  else powerNotice="空间不足";
  refreshPoweredInterface();
}
function stopPower():void {
  powerHeld=false;pressHeld=false;poweredDrag=null;
  if(pressCycle.busy)pressCycle.release(performance.now());
}

async function commitPowerImpact():Promise<void> {
  const stroke=powerStroke;
  if(!stroke)return;
  if(!stroke.contact){powerCycle.release(performance.now(),0);return;}
  poweredPending=true;
  refreshPoweredInterface();
  const before=hammerFrame(latestSnapshot.geometry,stroke.pose);
  try {
    await application.applyPoweredForge({kind:"power-hammer",pose:stroke.pose,target:{x:0,z:0},
      energy:stroke.energy,blows:1,cadenceMs:POWER_CADENCE_MS},evaluatePowered);
    const after=hammerFrame(application.getState().workpiece.geometry,stroke.pose);
    const shift=rotateHammerPoint({x:after.center.x-before.center.x,y:0,z:after.center.z-before.center.z},stroke.pose);
    powerPoseCurrent={...stroke.pose,x:stroke.pose.x+shift.x,z:stroke.pose.z+shift.z};
    powerNotice="";view?.setPoweredPose(powerPoseCurrent,false);updateView();
  } catch(error) {
    stopPower();powerNotice=error instanceof Error?error.message:"冲击未完成";
  } finally {
    poweredPending=false;
    powerCycle.release(performance.now(),view?.powerWorkpiece.contactHeight??0);
    refreshPoweredInterface();
  }
}
function tickPower(now:number):void {
  const wasBusy=powerCycle.busy;
  if(activeStation==="power"&&powerHeld&&!view?.isCameraTransitioning()&&!view?.isInspectionActive()&&!powerCycle.busy){
    const contact=view?.powerWorkpiece.contact;
    const height=view?.powerWorkpiece.contactHeight??0;
    if(height>120){stopPower();powerNotice="开口不足";refreshPoweredInterface();}
    else if(powerCycle.begin(now,height)){
      powerStroke={pose:{...powerPoseCurrent},energy:Number(poweredForce.value)/100,contact:!!contact?.supported};
      refreshPoweredInterface();
    }
  }
  if(powerCycle.tick(now))void commitPowerImpact();
  if(wasBusy||powerCycle.busy)view?.setPowerGap(powerCycle.gap(now));
  if(wasBusy&&!powerCycle.busy)refreshPoweredInterface();
  document.body.dataset.powerPhase=powerCycle.phase;
  document.body.dataset.powerHeld=String(powerHeld);
}
function startPress():void {
  if(activeStation!=="press"||!view||poweredPending||pressCycle.busy||view.isInspectionActive()||view.isCameraTransitioning())return;
  if(!pressCycle.begin(performance.now(),view.pressWorkpiece.contactHeight)){powerNotice="开口不足";refreshPoweredInterface();return;}
  pressHeld=true;powerNotice="";
  pressSession={source:application.getState(),pose:{...pressPoseCurrent},pressure:Number(poweredForce.value)/100,
    contact:!!view.pressWorkpiece.contact?.supported,dwell:0,result:null,operation:null};
  refreshPoweredInterface();
}

function compensatedPressPose(source:ForgeState,result:ForgeState,pose:HammerPose):HammerPose {
  const before=hammerFrame(source.workpiece.geometry,pose),after=hammerFrame(result.workpiece.geometry,pose);
  const shift=rotateHammerPoint({x:after.center.x-before.center.x,y:0,z:after.center.z-before.center.z},pose);
  return {...pose,x:pose.x+shift.x,z:pose.z+shift.z};
}

async function solvePress(dwell:number):Promise<void> {
  const session=pressSession;if(!session||poweredPending)return;
  poweredPending=true;refreshPoweredInterface();
  try {
    // Every preview solves from this cycle's original state, not its last preview.
    if(session.contact&&dwell>session.dwell){
      const operation:ForgePressOperation={kind:"forge-press",pose:session.pose,target:{x:0,z:0},
        pressure:session.pressure,strokeMm:24,dwellMs:dwell};
      const result=await evaluatePowered(session.source,operation);
      if(application.getState()!==session.source)throw new Error("工件已改变，本次压力预览已取消。");
      session.result=result;session.operation=operation;session.dwell=dwell;
      const changed=result.workpiece.geometry.nodes.some((n,i)=>{
        const old=session.source.workpiece.geometry.nodes[i]!;
        return Math.abs(n.verticalOffset-old.verticalOffset)+Math.abs(n.lateralOffset-old.lateralOffset)+Math.abs(n.axialPosition-old.axialPosition)>1e-8;
      });
      powerNotice=changed?"": "未发生塑性变形 · 载荷或支撑受限";
      pressDisplayPose=compensatedPressPose(session.source,result,session.pose);
      latestSnapshot=createForgeSnapshot(result);
      view?.setPoweredPose(pressDisplayPose,false);
      view?.update(latestSnapshot,null,"press");
    }
    if(pressCycle.phase==="settling"&&(!session.contact||session.dwell>=pressCycle.dwell(performance.now()))){
      if(session.result&&session.operation){
        await application.applyPoweredForge(session.operation,async source=>{
          if(source!==session.source)throw new Error("压力预览已过期。");
          return session.result!;
        });
        pressPoseCurrent=pressDisplayPose??session.pose;
      }
      pressDisplayPose=null;pressSession=null;
      view?.setPoweredPose(pressPoseCurrent,false);updateView();
      pressCycle.retract(performance.now(),view?.pressWorkpiece.contactHeight??0);
    }
  } catch(error) {
    pressHeld=false;pressSession=null;pressDisplayPose=null;
    powerNotice=error instanceof Error?error.message:"压力计算未完成";
    view?.setPoweredPose(pressPoseCurrent,false);updateView();
    pressCycle.retract(performance.now(),view?.pressWorkpiece.contactHeight??0);
  } finally {poweredPending=false;refreshPoweredInterface();}
}

function tickPress(now:number):void {
  const before=pressCycle.phase;
  pressCycle.tick(now);
  if(pressSession&&!poweredPending){
    const dwell=pressCycle.dwell(now);
    if(pressCycle.phase==="settling"||(pressCycle.phase==="loading"&&pressSession.contact&&
      (dwell-pressSession.dwell>=160||(dwell===4000&&pressSession.dwell<4000))))void solvePress(dwell);
  }
  if(pressCycle.busy||before!==pressCycle.phase)view?.setPressGap(pressCycle.gap(now,view.pressWorkpiece.contactHeight));
  if(before!==pressCycle.phase)refreshPoweredInterface();
  if(!pressCycle.busy)pressSession=null;
  document.body.dataset.pressPhase=pressCycle.phase;
  document.body.dataset.pressHeld=String(pressHeld);
  document.body.dataset.pressDwell=String(pressSession?.dwell??0);
}

poweredForce.addEventListener("input",refreshPoweredInterface);
poweredRun.addEventListener("pointerdown",event=>{
  if(event.button!==0||view?.isInspectionActive()||view?.isCameraTransitioning())return;
  event.preventDefault();poweredRun.setPointerCapture(event.pointerId);
  if(activeStation==="power")powerHeld=true;else startPress();
});
poweredRun.addEventListener("pointerup",stopPower);
poweredRun.addEventListener("pointercancel",stopPower);
poweredRun.addEventListener("lostpointercapture",stopPower);
document.querySelector("#powered-center")!.addEventListener("click",()=>placePower(alignPoweredPoseToFeed({...HAMMER_HOME})));
document.querySelector("#powered-overview")!.addEventListener("click",()=>setStation("overview"));
const cutControls=document.querySelector<HTMLElement>("#cut-controls")!;
const cutStatus=document.querySelector<HTMLElement>("#cut-status")!;
const cutConfirm=document.querySelector<HTMLButtonElement>("#cut-confirm")!;
const cutPieces=document.querySelector<HTMLSelectElement>("#cut-piece")!;
let cutPose:CutPose={...CUT_HOME};
let cutReady=false, cutting=false, cutPage=0, cutGeneration=0;
let cutValidity:boolean|null=null;
let cutWorker:Worker|null=null, cutTimer:ReturnType<typeof setTimeout>|null=null;
let cutOperation:CutOperation|null=null;
let cutDrag:{point:{x:number;z:number};pose:CutPose}|null=null;

function cancelCutPreview():void {
  cutGeneration++;cutReady=false;cutValidity=null;cutOperation=null;
  application.cancelPreparedCut();cutWorker?.terminate();cutWorker=null;
  if(cutTimer!==null)clearTimeout(cutTimer);
  cutConfirm.disabled=true;
}

function refreshCutInterface():void {
  cutControls.hidden=activeStation!=="cut";
  if(cutControls.hidden)return;
  cutPieces.disabled=cutting;
  cutConfirm.disabled=!cutReady||cutting||view?.isCameraTransitioning()===true;
  const all=[latestSnapshot,...latestSnapshot.bench];
  cutPieces.replaceChildren(...all.map((piece,index)=>{
    const option=document.createElement("option");option.value=piece.workpieceId;
    const volume=piece.sections.reduce((sum,s)=>sum+s.blocks.reduce((v,b)=>v+b.volume,0),0);
    option.textContent=`${index===0?"当前":"暂存 "+index} · ${materialLabels[piece.materialId]??piece.materialId} · ${(volume/1000).toFixed(1)} cm³`;
    return option;
  }));
  cutPieces.value=latestSnapshot.workpieceId;
  const pages=Math.max(1,latestSnapshot.bench.length);cutPage=Math.min(cutPage,pages-1);
  document.querySelector("#cut-page")!.textContent=`暂存区 ${cutPage+1} / ${pages}`;
  (document.querySelector("#cut-prev") as HTMLButtonElement).disabled=cutPage===0||cutting;
  (document.querySelector("#cut-next") as HTMLButtonElement).disabled=cutPage===pages-1||cutting;
  document.body.dataset.cutReady=String(cutReady);
  document.body.dataset.cutting=String(cutting);
  document.body.dataset.cutAngle=String(Math.round(cutPose.angle*180/Math.PI));
  document.body.dataset.cutPose=JSON.stringify(cutPose);
  view?.updateCut(cutPose,cutValidity,cutPage);
}

function scheduleCutPreview():void {
  cancelCutPreview();
  if(activeStation!=="cut"||cutting)return;
  const generation=cutGeneration;
  cutStatus.textContent="正在检查切割范围…";
  refreshCutInterface();
  cutTimer=setTimeout(async()=>{
    const operation=cutOperationFor(latestSnapshot,cutPose,application.getState().operations.length);
    cutOperation=operation;
    const worker=new Worker(new URL("./cut-preview.worker.ts",import.meta.url),{type:"module"});cutWorker=worker;
    try {
      let result:ForgeState|null=null;
      const ready=await application.prepareCut(operation,(state,op)=>new Promise<ForgeState>((resolve,reject)=>{
        worker.onmessage=(event:MessageEvent<{result?:ForgeState;error?:string}>)=>{
          if(event.data.error)reject(new Error(event.data.error));
          else if(event.data.result){result=event.data.result;resolve(event.data.result);}
        };
        worker.onerror=()=>reject(new Error("preview-worker"));
        worker.postMessage({id:generation,state,operation:op});
      }));
      if(generation!==cutGeneration||activeStation!=="cut")return;
      cutReady=ready;
      cutValidity=ready;
      const evaluated=result as ForgeState|null;
      const loss=evaluated?.cutLosses?.at(-1)?.volume??0;
      const extra=(evaluated?.bench.length??latestSnapshot.bench.length)-latestSnapshot.bench.length;
      cutStatus.textContent=ready?`可以切割 · ${extra>0?`将分成 ${extra+1} 块`:"形成切口，仍为一块"} · 预计损耗 ${(loss/1000).toFixed(2)} cm³` : "工件已改变，请重新摆放。";
      refreshCutInterface();
    }catch(error){
      if(generation!==cutGeneration)return;
      cutValidity=false;
      const message=String(error);
      cutStatus.textContent=message.includes("does not intersect")?"刀路没有接触剩余金属，请移动或旋转后重试。"
        :message.includes("remove all")?"该刀路会磨掉整块剩余金属，请调整摆放。":"切割检查未完成，请重新摆放后再试。";
      refreshCutInterface();view?.updateCut(cutPose,false,cutPage);
    }finally{worker.terminate();if(cutWorker===worker)cutWorker=null;}
  },180);
}

function placeCut(pose:CutPose):void {
  if(cutting)return;
  pose={...pose,angle:Math.atan2(Math.sin(pose.angle),Math.cos(pose.angle)),pitch:Math.atan2(Math.sin(pose.pitch??0),Math.cos(pose.pitch??0)),roll:Math.atan2(Math.sin(pose.roll??0),Math.cos(pose.roll??0))};
  if(!validCutPose(pose))return;
  cutPose=pose;scheduleCutPreview();
}

function chooseCutPiece(id:string):void {
  if(cutting||id===latestSnapshot.workpieceId)return;
  const index=application.getState().bench.findIndex(piece=>piece.id===id);
  if(index<0)return;
  cancelCutPreview();application.applyIntent({kind:"select-workpiece",benchIndex:index});
  cutPose={...CUT_HOME};updateView();scheduleCutPreview();
}

document.querySelector("#cut-center")!.addEventListener("click",()=>placeCut({...CUT_HOME}));
cutPieces.addEventListener("change",()=>chooseCutPiece(cutPieces.value));
document.querySelector("#cut-prev")!.addEventListener("click",()=>{cutPage--;refreshCutInterface();});
document.querySelector("#cut-next")!.addEventListener("click",()=>{cutPage++;refreshCutInterface();});
document.querySelector("#cut-overview")!.addEventListener("click",()=>{if(!cutting)setStation("overview");});
cutConfirm.addEventListener("click",()=>{
  if(!cutReady||!cutOperation||cutting||view?.isCameraTransitioning())return;
  cutting=true;cutReady=false;const operation=cutOperation;
  cutStatus.textContent="切割中…";refreshCutInterface();view?.animateCut();
  setTimeout(()=>{
    try{
      const previous=latestSnapshot;
      application.commitPreparedCut(operation);
      const next=application.getSnapshot(), extra=next.bench.length-previous.bench.length;
      if(extra===0){
        const b=cutBounds(next);
        const center=tablePoint(previous,cutPose,(b.minX+b.maxX)/2,(b.minZ+b.maxZ)/2);
        cutPose={...cutPose,...center};
        cutStatus.textContent="切口已形成，材料仍连接。可以继续移动、旋转并切断剩余连接。";
      }else{
        cutPose={...CUT_HOME};
        cutStatus.textContent=`切割完成，分成 ${extra+1} 块。新工件已放入后沿暂存区，可选择后继续切割。`;
      }
    }
    catch{cutStatus.textContent="工件已改变，本次未执行切割，请重新摆放。";}
    cutting=false;cutOperation=null;cutValidity=null;updateView();
    // Keep the result visible; preparing the next cut requires a deliberate reposition.
  },1150);
});
let furnaceLastTick: number | null = null;
let furnaceElapsedMs = 0;
let furnaceHudLastTick = 0;
let temperating = false;
let temperElapsedMs = 0;
const heatControls = document.querySelector<HTMLElement>("#heat-controls")!;
const heatToggle = document.querySelector<HTMLButtonElement>("#heat-toggle")!;
const furnaceModes=[...document.querySelectorAll<HTMLButtonElement>("[data-furnace-mode]")];
const heatStatus = document.querySelector<HTMLElement>("#heat-status")!;
let temperPreviewC: number | null = null;
let temperDrag: { readonly startedAtMs: number; readonly startY: number } | null = null;
let temperInsertionDrag: { readonly startX: number; readonly startY: number; readonly startOffset: number; moved: boolean } | null = null;
let furnaceInsertionDrag: { readonly startX: number; readonly startOffset: number; moved: boolean } | null = null;
let quenchContacted = false;
let quenchStarted = false;
let quenchPhase: "ready" | "immersed" | "checked" = "ready";
let quenchDrag: { readonly startX: number; readonly startY: number; readonly pose: ReturnType<ForgeBilletView["quenchPose"]>; readonly point: { x: number; z: number } | null; moved: boolean } | null = null;
let grindDrag: { readonly point: { x: number; z: number }; readonly pose: ReturnType<ForgeBilletView["grindPose"]>; readonly mode: "move" | "rotate" | "grind"; readonly startX: number; readonly startY: number } | null = null;
let grindHolding = false;
let grindLastTick: number | null = null;
let grindWorker:Worker|null=null,grindPending=false,grindWorkerSource:ForgeState|null=null;
function grindStep(operation:GrindOperation):void {
  if(grindPending)return;
  const source=application.getState();
  grindPending=true;
  grindWorker??=new Worker(new URL("../platform/grind.worker.ts",import.meta.url),{type:"module"});
  const timer=setTimeout(()=>fail("研磨计算超时，请重试。"),15000);
  const fail=(message:string)=>{
    clearTimeout(timer);grindPending=false;grindWorker?.terminate();grindWorker=null;grindWorkerSource=null;
    grindHolding=false;hudState.textContent=message;
  };
  grindWorker.onerror=()=>fail("研磨计算失败，请重试。");
  grindWorker.onmessage=(event:MessageEvent<AbrasiveUpdate|{error:string}>)=>{
    clearTimeout(timer);grindPending=false;
    if("error" in event.data){fail(event.data.error);return;}
    if(activeStation!=="grind"||application.getState()!==source){grindWorkerSource=null;return;}
    if(application.commitGrinding(source,event.data)&&event.data.changed){
      view?.prepareGrindMesh(event.data.positions,event.data.colors);
      document.body.dataset.grindComputeMs=event.data.computeMs.toFixed(2);
      updateView();
    }
    grindWorkerSource=application.getState();
  };
  grindWorker.postMessage({...(grindWorkerSource===source?{}:{state:source}),operation});
}
let gesture: {
  readonly kind: "grind" | "weld" | "quench";
  readonly target: HammerPickTarget;
  readonly weldBenchIndex: number | null;
  readonly startedAtMs: number;
  readonly startX: number;
  readonly startY: number;
} | null = null;

const stationCopy: Record<ForgeStation, { readonly title: string; readonly hint: string }> = {
  overview: { title: "铁匠铺 · 总览", hint: "点击材料、工位或铁砧进入第一人称近景；Esc 返回总览。" },
  materials: { title: "选料桌 · 选料", hint: "" },
  furnace: { title: "火炉 · 加热", hint: "拖动钢坯自由调整方向；整体进入炉腔后开始加热，完全拖出后停止。" },
  anvil: { title: "铁砧 · 锤击", hint: "瞄准金属单击落锤，滚轮调力度；W/S 沿夹持方向送料，A/D 绕工件长轴翻转。" },
  power: { title: "动力锤", hint: "空格持续锻打；W/S 前后送料，A/D 左右平移，Q/E 绕工件长轴翻转。" },
  press: { title: "锻造压力机 · 压下延展", hint: "平压头 · 持续载荷；W/S 前后送料，A/D 左右平移，Q/E 绕工件长轴翻转。" },
  cut: { title: "切割台 · 切割", hint: "普通左键选择与确认；Shift＋左键平面移动，Q/E 绕 Y、A/D 绕 Z、W/S 绕 X。" },
  weld: { title: "焊合台 · 焊合", hint: "从当前钢坯拖向旁边的第二块工件，贴合后松开。" },
  "quench-water": { title: "水槽 · 淬火", hint: "点击工件或槽体放入整块刀坯；再次点击取出并查看淬火检查结果。" },
  "quench-oil": { title: "油槽 · 淬火", hint: "点击工件或槽体放入整块刀坯；再次点击取出并查看淬火检查结果。" },
  temper: { title: "火炉 · 回火", hint: "滚轮调整目标温度；拖动钢坯整体进入炉腔后回火，完全拖出后完成。" },
  grind: { title: "砂带 · 研磨", hint: "Shift＋左键平面移动；右键拖动改变接触角，W/S 进退，A/D 绕工件长轴翻转；普通左键按住研磨。" },
};

const materialLabels: Record<string, string> = {
  "mild-steel": "低碳钢",
  "high-carbon-steel": "高碳钢",
  "spring-steel": "弹簧钢",
};

function openAcceptanceSlice(verb: AcceptanceVerb, medium = acceptanceMedium): void {
  const parameters = new URLSearchParams({ accept: verb });
  if (verb === "quench") parameters.set("medium", medium);
  window.location.search = parameters.toString();
}

document.body.classList.add("acceptance-mode");
acceptanceConsole.hidden = false;
acceptanceButtons.forEach((button) => {
  const target = button.dataset.acceptanceTarget as AcceptanceVerb | undefined;
  if (!target) return;
  if (target === acceptanceVerb) button.setAttribute("aria-current", "step");
  button.addEventListener("click", () => openAcceptanceSlice(target));
});
acceptanceQuenchMedium.value = acceptanceMedium;
acceptanceQuenchMedium.disabled = acceptanceVerb !== "quench";
acceptanceQuenchMedium.addEventListener("change", () => {
  openAcceptanceSlice("quench", acceptanceQuenchMedium.value === "oil" ? "oil" : "water");
});
acceptanceReset.disabled = acceptanceStation === null;
acceptanceReset.addEventListener("click", () => window.location.reload());

function viewport() {
  return { width: canvas.clientWidth, height: canvas.clientHeight, pixelRatio: window.devicePixelRatio };
}

function average(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
}

function acceptanceOperationCount(state: ForgeState): number {
  if (acceptanceVerb === "materials") return materialSelection.getAcquiredCount();
  if (!acceptanceVerb) return state.operations.length;
  return state.operations.filter((operation) => (
    acceptanceVerb === "heat" ? operation.kind === "move-billet" && operation.destination === "furnace" && operation.elapsedMs === 0
    : acceptanceVerb === "hammer" ? operation.kind === "surface-hammer" || operation.kind === "hammer"
    : acceptanceVerb === "power" ? operation.kind === "power-hammer"
    : acceptanceVerb === "press" ? operation.kind === "forge-press"
    : operation.kind === acceptanceVerb
  )).length;
}

function toggleQuench(): void {
  if (!view || (activeStation !== "quench-water" && activeStation !== "quench-oil")) return;
  if (quenchPhase === "ready") {
    view.setQuenchPose({ vertical: -60, tilt: 0, yaw: 0 });
    latestSnapshot = application.applyIntent({
      kind: "quench",
      medium: activeStation === "quench-water" ? "water" : "oil",
      immersion: 1,
      movement: 0,
      dwellMs: 1_000,
      exitTemperatureC: 20,
    });
    quenchPhase = "immersed";
    quenchStarted = true;
    quenchContacted = true;
    view.refreshQuenchThermal(latestSnapshot);
  } else if (quenchPhase === "immersed") {
    view.setQuenchPose({ vertical: 0, tilt: 0, yaw: 0 });
    quenchPhase = "checked";
    quenchContacted = false;
  }
  updateView();
  updateThermalHud();
}

function acceptanceState(state: ForgeState): readonly string[] {
  const sections = state.workpiece.sections;
  const joint = state.workpiece.joints[state.workpiece.joints.length - 1];
  const displayedTemper = temperPreviewC ?? latestSnapshot.temperTemperatureC;
  const shared = `本次操作 ${acceptanceOperationCount(state)} · 按 R 重置`;
  switch (acceptanceVerb) {
    case "materials":
      if (materialSelection.getAcquiredCount() === 0) return ["当前无工件 · 料架为空"];
      return [
        `${materialLabels[latestSnapshot.materialId] ?? latestSnapshot.materialId} · 碳 ${latestSnapshot.carbon.toFixed(2)}% · ${latestSnapshot.averageTemperatureC.toFixed(0)}℃`,
        `当前 ${latestSnapshot.workpieceId} · 已有 ${latestSnapshot.benchCount + 1} 件 · 领取 ${materialSelection.getAcquiredCount()} 次`,
      ];
    case "cut":
      return [
        `当前材料 ${(totalVolume(state)/1000).toFixed(1)} cm³ · 暂存 ${latestSnapshot.benchCount} 块`,
        `累计锯缝损耗 ${((state.cutLosses??[]).reduce((sum,loss)=>sum+loss.volume,0)/1000).toFixed(2)} cm³`,
        shared,
      ];
    case "weld":
      return [
        `待焊工件 ${latestSnapshot.benchCount} 块 · 材料 ${state.bench.map((piece) => materialLabels[piece.material.id] ?? piece.material.id).join("、") || "无"}`,
        `层数 ${latestSnapshot.layerCount} · 碳 ${latestSnapshot.carbon.toFixed(2)} · 接头 ${state.workpiece.joints.length}`,
        `最近接头完整性 ${joint ? `${Math.round(joint.integrity * 100)}%` : "未焊合"} · ${shared}`,
      ];
    case "heat":
      return [
        `当前温度 ${latestSnapshot.averageTemperatureC.toFixed(0)}℃ · 峰值 ${latestSnapshot.peakTemperatureC.toFixed(0)}℃`,
        `高温暴露 ${latestSnapshot.hotExposureSeconds.toFixed(1)}s · 氧化剂量 ${latestSnapshot.oxidationDose.toFixed(2)}`,
        `热损伤 ${Math.round(average(sections.map((section) => section.thermalDamage)) * 100)}% · ${shared}`,
      ];
    case "hammer":
      return [
        `温度 ${latestSnapshot.averageTemperatureC.toFixed(0)}℃（本轮冻结） · ${hammerDimensions()}`,
        `塑性应变 ${average(sections.map((section) => section.plasticStrain)).toFixed(3)} · 应力 ${average(sections.map((section) => section.stress)).toFixed(3)}`,
        `损伤 ${Math.round(average(sections.map((section) => section.damage)) * 100)}% · ${shared}`,
      ];
    case "power":
      return [
        `动力锤 · 温度 ${latestSnapshot.averageTemperatureC.toFixed(0)}℃ · 载荷 ${poweredForce.value}%`,
        `累计动力锤循环 ${state.operations.filter(operation=>operation.kind==="power-hammer").length} · 塑性应变 ${average(sections.map(section=>section.plasticStrain)).toFixed(3)}`,
        `机械功 ${sections.reduce((sum,section)=>sum+section.mechanicalWorkJ,0).toFixed(1)} J · ${shared}`,
      ];
    case "press":
      return [
        `压力机 · 温度 ${latestSnapshot.averageTemperatureC.toFixed(0)}℃ · 压力 ${poweredForce.value}% · 平压头`,
        `累计压力循环 ${state.operations.filter(operation=>operation.kind==="forge-press").length} · 塑性应变 ${average(sections.map(section=>section.plasticStrain)).toFixed(3)}`,
        `应力 ${average(sections.map(section=>section.stress)).toFixed(3)} · 损伤 ${Math.round(average(sections.map(section=>section.damage))*100)}% · ${shared}`,
      ];
    case "quench":
      const quenchState = quenchPhase === "ready" ? "等待放入" : quenchPhase === "immersed" ? "工件已浸入" : "淬火检查";
      const stress = average(sections.map((section) => section.stress));
      const damage = average(sections.map((section) => section.damage));
      const risk = latestSnapshot.hasCracks ? "已开裂" : stress >= 0.42 || damage >= 0.3 ? "高风险" : stress >= 0.2 || damage >= 0.12 ? "需回火" : "状态稳定";
      return [
        `样本介质 ${acceptanceMedium === "water" ? "水" : "油"} · 当前温度 ${latestSnapshot.averageTemperatureC.toFixed(0)}℃`,
        `淬火记录 ${latestSnapshot.quenchMedium ?? "未淬火"} · 起始温度 ${latestSnapshot.quenchStartTemperatureC?.toFixed(0) ?? "未记录"}℃`,
        `应力 ${stress.toFixed(3)} · 热损伤 ${Math.round(average(sections.map((section) => section.thermalDamage)) * 100)}% · 完整度 ${Math.round((1 - damage) * 100)}%`,
        `检查结论：${risk} · 裂纹 ${latestSnapshot.hasCracks ? "已产生" : "未产生"}`,
        `${quenchState} · 点击槽体或工件切换状态`,
        shared,
      ];
    case "temper":
      return [
        `目标 ${displayedTemper ?? "未设定"}℃ · 保温 ${(temperElapsedMs / 1000).toFixed(1)}s · 已记录 ${latestSnapshot.temperTemperatureC ?? "未回火"}℃`,
        `残余应力 ${average(sections.map((section) => section.stress)).toFixed(3)} · 裂纹 ${latestSnapshot.hasCracks ? "保留" : "无"}`,
        shared,
      ];
    case "grind":
      return [
        `刃角 ${latestSnapshot.grindMetrics.bladeAngleDeg.toFixed(1)}° · 刃口厚度 ${latestSnapshot.grindMetrics.edgeThicknessMm.toFixed(2)}mm`,
        `粗糙度 ${(latestSnapshot.grindMetrics.roughness * 100).toFixed(1)}% · 对称性 ${(latestSnapshot.grindMetrics.symmetry * 100).toFixed(1)}%`,
        `去料 ${latestSnapshot.removedVolume.toFixed(2)}mm³ · 接触覆盖 ${Math.round(latestSnapshot.edgeCoverage * 100)}%`,
      ];
    default:
      return [];
  }
}

function renderState(): void {
  const state = application.getState();
  document.body.dataset.cameraState = view?.isCameraTransitioning() ? "moving" : "settled";
  const operationCounts = state.operations.reduce<Record<string, number>>((counts, operation) => ({
    ...counts,
    [operation.kind]: (counts[operation.kind] ?? 0) + 1,
  }), {});
  const damage = state.workpiece.sections.reduce((sum, section) => sum + section.damage, 0)
    / Math.max(1, state.workpiece.sections.length);
  const completedVerbs = [
    materialSelection.getAcquiredCount() > 0 || state.operations.some((operation) => operation.kind === "select-material") ? "materials" : null,
    state.operations.some((operation) => operation.kind === "cut") ? "cut" : null,
    state.operations.some((operation) => operation.kind === "weld") ? "weld" : null,
    state.operations.some((operation) => operation.kind === "move-billet" && operation.destination === "furnace" && operation.elapsedMs > 0) ? "heat" : null,
    state.operations.some((operation) => operation.kind === "hammer" || operation.kind === "surface-hammer") ? "hammer" : null,
    state.operations.some((operation) => operation.kind === "power-hammer") ? "power" : null,
    state.operations.some((operation) => operation.kind === "forge-press") ? "press" : null,
    state.operations.some((operation) => operation.kind === "quench") ? "quench" : null,
    state.operations.some((operation) => operation.kind === "temper") ? "temper" : null,
    state.operations.some((operation) => operation.kind === "grind") ? "grind" : null,
  ].filter((verb): verb is string => verb !== null);
  const displayedTemper = temperPreviewC ?? latestSnapshot.temperTemperatureC;
  const copy = stationCopy[activeStation];

  hudTitle.textContent = acceptanceStation
    ? `R1 单项验收 · ${copy.title}`
    : copy.title;
  hudHint.textContent = acceptanceStation
    ? `${copy.hint} 按 R 重置当前固定样本。`
    : copy.hint;
  const overviewState = [
    `${materialLabels[latestSnapshot.materialId] ?? latestSnapshot.materialId} · 当前工件 ${latestSnapshot.workpieceId}`,
    `温度 ${latestSnapshot.averageTemperatureC.toFixed(0)}℃`,
    `层数 ${latestSnapshot.layerCount} · 碳 ${latestSnapshot.carbon.toFixed(2)}`,
    acceptanceStation
      ? `工作台 ${latestSnapshot.benchCount} 块 · 本次操作 ${state.operations.length - acceptanceSetupOperationCount}`
      : `工作台 ${latestSnapshot.benchCount} 块 · 操作 ${state.operations.length}`,
    `锤击 ${(operationCounts.hammer ?? 0)+(operationCounts["surface-hammer"]??0)} · 切割 ${operationCounts.cut ?? 0} · 焊合 ${operationCounts.weld ?? 0}`,
    `动力锤 ${operationCounts["power-hammer"]??0} · 压力循环 ${operationCounts["forge-press"]??0}`,
    `淬火 ${latestSnapshot.quenchMedium ?? "未做"} · 回火 ${displayedTemper ?? "未做"} · 研磨 ${Math.round(latestSnapshot.edgeCoverage * 100)}%`,
    `损伤 ${Math.round(damage * 100)}% · 规则 ${latestSnapshot.parameterVersion}`,
  ];
  hudState.textContent = (acceptanceStation ? acceptanceState(state) : activeStation==="anvil" ? [hammerDimensions(),...overviewState] : overviewState).join(" · ");
  document.body.dataset.stage = acceptanceStation ? "forge-acceptance" : "forge-mvp";
  document.body.dataset.acceptanceVerb = acceptanceVerb ?? "none";
  document.body.dataset.acceptanceSetupOperations = String(acceptanceSetupOperationCount);
  document.body.dataset.acceptanceOperationCount = String(acceptanceOperationCount(state));
  document.body.dataset.activeStation = activeStation;
  document.body.dataset.operationCount = String(state.operations.length);
  document.body.dataset.completedVerbs = completedVerbs.join(",");
  document.body.dataset.verbCount = String(completedVerbs.length);
  document.body.dataset.temperatureC = latestSnapshot.averageTemperatureC.toFixed(2);
  document.body.dataset.billetLocation = latestSnapshot.billetLocation;
  heatControls.hidden = activeStation !== "furnace" && activeStation !== "temper";
  heatToggle.hidden=false;
  furnaceModes.forEach(button=>button.setAttribute("aria-pressed",String(button.dataset.furnaceMode===activeStation)));
  heatToggle.textContent = activeStation === "temper"
    ? latestSnapshot.billetLocation === "furnace" ? "取出并完成回火" : "送入回火"
    : latestSnapshot.billetLocation === "furnace" ? "取出查看" : "送入加热";
  const overheating = latestSnapshot.averageTemperatureC >= state.workpiece.material.overheatTemperatureC;
  heatStatus.textContent = `${latestSnapshot.billetLocation === "furnace" ? "炉内 · 整体加热中" : "炉外 · 查看火色 / 自然冷却"} · ${latestSnapshot.averageTemperatureC.toFixed(0)}℃${overheating ? " · 过热，继续加热会增加氧化与损伤" : ""}`;
  if(activeStation==="temper")heatStatus.textContent=`回火目标 ${displayedTemper??"未设定"}℃ · 保温 ${(temperElapsedMs / 1000).toFixed(1)}s · ${temperating ? "炉内回火中" : "炉外待命"}`;
  document.body.dataset.benchCount = String(latestSnapshot.benchCount);
  document.body.dataset.benchMaterialIds = state.bench.map((piece) => piece.material.id).join(",");
  document.body.dataset.benchWorkpieceIds = state.bench.map((piece) => piece.id).join(",");
  document.body.dataset.workpieceId = latestSnapshot.workpieceId;
  document.body.dataset.layerCount = String(latestSnapshot.layerCount);
  document.body.dataset.materialRegionCount = String(latestSnapshot.materialRegionCount);
  document.body.dataset.jointCount = String(state.workpiece.joints.length);
  document.body.dataset.removedVolume = latestSnapshot.removedVolume.toFixed(6);
  document.body.dataset.carbon = latestSnapshot.carbon.toFixed(6);
  document.body.dataset.totalMaterialVolume=String([state.workpiece,...state.bench].reduce((sum,workpiece)=>sum+totalVolume({...state,workpiece}),0));
  document.body.dataset.cutLossVolume=String((state.cutLosses??[]).reduce((sum,loss)=>sum+loss.volume,0));
  document.body.dataset.quenchMedium = latestSnapshot.quenchMedium ?? "none";
  const thermalBlocks = latestSnapshot.sections.flatMap((section) => section.blocks);
  const bottomTemperature = thermalBlocks.filter((block) => block.heightIndex === 0).map((block) => block.temperatureC);
  const topTemperature = thermalBlocks.filter((block) => block.heightIndex === latestSnapshot.geometry.grid.heightBlocks - 1).map((block) => block.temperatureC);
  const mean = (values: readonly number[]) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : latestSnapshot.averageTemperatureC;
  document.body.dataset.quenchTemperatureBottom = mean(bottomTemperature).toFixed(2);
  document.body.dataset.quenchTemperatureTop = mean(topTemperature).toFixed(2);
  document.body.dataset.cameraState = view?.isCameraTransitioning() ? "moving" : "settled";
  if (materialSession && materialSelection.getAcquiredCount() === 0) {
    document.body.dataset.workpieceId = "none";
    document.body.dataset.temperatureC = "none";
    document.body.dataset.carbon = "none";
    document.body.dataset.layerCount = "0";
  }
}

function updateView(hammerPreview = null): void {
  latestSnapshot = activeStation==="press"&&pressSession?.result?createForgeSnapshot(pressSession.result):application.getSnapshot();
  view?.update(latestSnapshot, hammerPreview, activeStation, temperPreviewC);
  updateMaterialsInterface();
  refreshCutInterface();
  refreshHammerInterface();
  refreshPoweredInterface();
  renderState();
}

function updateThermalHud(): void {
  renderState();
}

function setStation(station: ForgeStation): void {
  stopPower();
  if(cutting||hammerPending||poweredPending||powerCycle.busy||pressCycle.busy)return;
  const furnaceModeSwitch=(activeStation==="furnace"||activeStation==="temper")&&(station==="furnace"||station==="temper");
  if (!furnaceModeSwitch && acceptanceStation && acceptanceVerb!=="cut" && acceptanceVerb!=="heat" && acceptanceVerb!=="hammer" && acceptanceVerb!=="power" && acceptanceVerb!=="press" && !materialSession && station !== acceptanceStation) return;
  if (materialSession && station !== "materials" && materialSelection.getAcquiredCount() === 0) return;
  if (activeStation === "materials" && station !== "materials"
    && materialSelection.getPieces().length > 0
    && !materialSelection.isOnTable(latestSnapshot.workpieceId)) {
    rackNotice = "当前工件仍在料架，请先点击取回到桌面";
    updateView();
    return;
  }
  if (activeStation === "furnace") {
    if (application.getState().workpiece.thermal.location === "furnace") stopHeating();
  }
  furnaceLastTick = null;
  gesture = null;
  temperDrag = null;
  temperPreviewC = null;
  materialSelection.cancel();
  activeStation = station;
  powerNotice="";
  if (station === "quench-water" || station === "quench-oil") {
    quenchPhase = "ready";
    quenchContacted = false;
    quenchStarted = false;
  }
  grindHolding=false;grindDrag=null;grindLastTick=null;
  if(station==="grind")application.prepareGrinding();
  cancelCutPreview();cutDrag=null;
  document.body.classList.toggle("cut-view",station==="cut");
  document.body.classList.toggle("heat-view",station==="furnace"||station==="temper");
  document.body.classList.toggle("hammer-view",station==="anvil");
document.body.classList.toggle("powered-view",station==="power"||station==="press");
  document.body.classList.toggle("grind-view",station==="grind");
  document.body.classList.toggle("material-session",station==="materials");
  hammerAim=null;
  view?.setStation(station);
  document.body.dataset.cameraState=view?.isCameraTransitioning()?"moving":"settled";
  view?.resize(viewport());
  if(station==="power"||station==="press"){
    const current=station==="power"?powerPoseCurrent:pressPoseCurrent;
    if(current.x===HAMMER_HOME.x&&current.z===HAMMER_HOME.z&&current.yaw===HAMMER_HOME.yaw&&current.roll===HAMMER_HOME.roll){
      const aligned=alignPoweredPoseToFeed(current);
      if(station==="power")powerPoseCurrent=aligned;else pressPoseCurrent=aligned;
      view?.setPoweredPose(aligned);
    }
  }
  updateView();
  if(station==="cut"){cutPose={...CUT_HOME};scheduleCutPreview();}
}

function materialToStation(materialId: ForgeMaterialPick): void {
  focusMaterials();
  materialSelection.inspect(materialId);
  rackNotice = "";
  updateView();
}

function updateMaterialsInterface(): void {
  materialControls.hidden = !(materialSession || activeStation === "materials");
  if (materialControls.hidden) return;
  const pieces = materialSelection.getPieces();
  const pages = Math.max(1, Math.ceil(pieces.length / MATERIAL_RACK_PAGE_SIZE));
  rackPage = Math.min(rackPage, pages - 1);
  if (activeStation === "materials") {
    view?.updateMaterials(materialSelection.getCandidate()?.id ?? null,
      pieces.slice(rackPage * MATERIAL_RACK_PAGE_SIZE, (rackPage + 1) * MATERIAL_RACK_PAGE_SIZE),
      latestSnapshot.workpieceId, materialSelection.getTableWorkpieceIds());
  }
  const candidate = materialSelection.getCandidate();
  const tableWorkpieceIds = materialSelection.getTableWorkpieceIds();
  const tableWorkpieceCount = tableWorkpieceIds.length;
  const currentOnTable = materialSelection.isOnTable(latestSnapshot.workpieceId);
  const atMaterials = activeStation === "materials";
  materialName.textContent = candidate ? materialLabels[candidate.id]! : "材料与暂存桌";
  const mass = candidate ? FORGE_RULES.workpieceLength * FORGE_RULES.initialSectionWidth
    * FORGE_RULES.initialSectionThickness * 1e-9 * candidate.densityKgPerM3 : 0;
  materialDetails.textContent = candidate
    ? `碳含量 ${candidate.carbon.toFixed(2)}% · ${FORGE_RULES.workpieceLength} × ${FORGE_RULES.initialSectionWidth} × ${FORGE_RULES.initialSectionThickness} mm · ${mass.toFixed(2)} kg`
    : rackNotice || (pieces.length
      ? `暂存桌 ${tableWorkpieceCount} 件 · 已放回料架 ${pieces.length - tableWorkpieceCount} 件`
      : "尚未领取材料");
  materialActions.hidden = !atMaterials || candidate === null;
  materialReturn.hidden = !atMaterials || candidate !== null || !materialSelection.isOnTable(latestSnapshot.workpieceId);
  rackNavigation.hidden = activeStation !== "materials" || pages === 1;
  rackPageLabel.textContent = `桌面 ${rackPage + 1} / ${pages}`;
  previousRackPage.disabled = rackPage === 0;
  nextRackPage.disabled = rackPage === pages - 1;
  workpieceLabel.textContent = pieces.length
    ? `当前：${materialLabels[latestSnapshot.materialId] ?? latestSnapshot.materialId} · ${latestSnapshot.workpieceId} · ${currentOnTable ? "桌面" : "料架"}`
    : "当前：未领取";
  workpieceTravel.disabled = pieces.length === 0 || !currentOnTable;
  workpieceStation.disabled = pieces.length === 0 || !currentOnTable;
  document.body.dataset.materialCandidate = candidate?.id ?? "none";
  document.body.dataset.materialsFocus = "fixed";
  document.body.dataset.ownedWorkpieceCount = String(pieces.length);
  document.body.dataset.currentWorkpieceLocation = pieces.length === 0 ? "none" : currentOnTable ? "table" : "rack";
  document.body.dataset.rackPage = String(rackPage);
}

function focusMaterials(): void {
  setStation("materials");
  rackNotice = "";
  updateView();
}

document.querySelector("#material-confirm")!.addEventListener("click", () => {
  const next = materialSelection.confirm();
  if (!next) return;
  application = next;
  const pieces = materialSelection.getPieces();
  rackPage = Math.floor((pieces.length - 1) / MATERIAL_RACK_PAGE_SIZE);
  focusMaterials();
  rackNotice = "已领取，放到暂存桌";
  updateView();
});
document.querySelector("#material-cancel")!.addEventListener("click", () => {
  materialSelection.cancel();
  updateView();
});
materialReturn.addEventListener("click", () => {
  if (!materialSelection.returnCurrentToRack()) return;
  rackNotice = `已放回 ${latestSnapshot.workpieceId}`;
  updateView();
});
previousRackPage.addEventListener("click", () => { rackPage = Math.max(0, rackPage - 1); updateView(); });
nextRackPage.addEventListener("click", () => { rackPage += 1; updateView(); });
workpieceTravel.addEventListener("click", () => setStation(workpieceStation.value as ForgeStation));

function tickFurnace(now: number, flush = false): void {
  if ((activeStation !== "furnace" && activeStation !== "temper") || document.hidden || !document.hasFocus()) { furnaceLastTick = null; return; }
  if (furnaceLastTick === null) { furnaceLastTick = now; return; }
  const elapsedMs = now - furnaceLastTick;
  if (elapsedMs <= 0) return;
  furnaceElapsedMs = Math.min(furnaceElapsedMs + elapsedMs, FORGE_RULES.maximumThermalIntentMs);
  if (activeStation === "temper" && temperating) temperElapsedMs = Math.min(temperElapsedMs + elapsedMs, 300_000);
  furnaceLastTick = now;
  if (flush) {
    if (furnaceElapsedMs > 0) {
      // The displayed preview already contains this interval. Commit it
      // instead of applying the same heating duration a second time.
      application.getSnapshot(furnaceElapsedMs);
      application.commitPreview();
    }
    latestSnapshot = application.getSnapshot();
    return;
  }
  // Keep the physical simulation on its fixed substeps, but expose the
  // intermediate state frequently enough that heating reads as continuous.
  if (now - furnaceHudLastTick < 100) return;
  furnaceHudLastTick = now;
  latestSnapshot = application.getSnapshot(furnaceElapsedMs);
  updateThermalHud();
}

function startHeating(): void {
  if (application.getState().workpiece.thermal.location === "furnace") return;
  furnaceElapsedMs = 0;
  application.setFurnaceTemperature(FORGE_RULES.furnaceGasTemperatureC);
  furnaceLastTick = null;
  furnaceHudLastTick = performance.now();
  application.applyIntent({ kind: "move-billet", destination: "furnace", elapsedMs: 0 });
  updateView();
}

function startTempering(): void {
  if (application.getState().workpiece.thermal.location === "furnace") return;
  temperating = true;
  temperElapsedMs = 0;
  furnaceElapsedMs = 0;
  application.setFurnaceTemperature(temperPreviewC ?? 220);
  furnaceLastTick = null;
  furnaceHudLastTick = performance.now();
  application.applyIntent({ kind: "move-billet", destination: "furnace", elapsedMs: 0 });
  updateView();
}

function stopTempering(): void {
  if (application.getState().workpiece.thermal.location !== "furnace") return;
  tickFurnace(performance.now(), true);
  application.applyIntent({
    kind: "temper",
    temperatureC: Math.round(temperPreviewC ?? latestSnapshot.temperTemperatureC ?? 220),
    durationMs: Math.round(temperElapsedMs),
  });
  application.applyIntent({ kind: "move-billet", destination: "inspection", elapsedMs: 0 });
  temperating = false;
  temperElapsedMs = 0;
  furnaceElapsedMs = 0;
  furnaceLastTick = null;
  updateView();
}

function stopHeating(): void {
  if (application.getState().workpiece.thermal.location !== "furnace") return;
  tickFurnace(performance.now(), true);
  application.applyIntent({ kind: "move-billet", destination: "inspection", elapsedMs: 0 });
  furnaceElapsedMs = 0;
  furnaceHudLastTick = 0;
  updateView();
}

function toggleHeating(): void {
  if (activeStation === "temper") {
    if (application.getState().workpiece.thermal.location === "furnace") stopTempering();
    return;
  }
  if (activeStation !== "furnace") return;
  if (application.getState().workpiece.thermal.location === "furnace") stopHeating();
}
heatToggle.addEventListener("click", toggleHeating);
furnaceModes.forEach(button=>button.addEventListener("click",()=>setStation(button.dataset.furnaceMode as ForgeStation)));
document.querySelector("#heat-overview")!.addEventListener("click", () => setStation("overview"));
window.addEventListener("blur", () => { furnaceLastTick = null; });
document.addEventListener("visibilitychange", () => { furnaceLastTick = null; });

function finishGesture(endX: number, endY: number): void {
  if (gesture === null) return;
  const distance = Math.hypot(endX - gesture.startX, endY - gesture.startY);
  const elapsedMs = performance.now() - gesture.startedAtMs;
  if (distance < 10) {
    gesture = null;
    return;
  }
  if (gesture.kind === "grind") {
    // Grinding is committed by the fixed-timestep contact loop while held.
    // Releasing only stops material removal; it never adds a hidden stroke.
  } else if (gesture.kind === "weld" && latestSnapshot.benchCount > 0) {
    const pickedBenchIndex = view?.pickWeldBench(endX, endY) ?? null;
    const benchIndex = gesture.weldBenchIndex
      ?? pickedBenchIndex
      ?? (latestSnapshot.benchCount === 1 && distance > 110 ? 0 : null);
    if (benchIndex !== null) application.applyIntent({ kind: "weld", benchIndex });
  }
  gesture = null;
  updateView();
}

function updateTemperPreview(clientY: number): void {
  if (temperDrag === null) return;
  temperPreviewC = Math.min(450, Math.max(80, 220 + (temperDrag.startY - clientY) * 2));
  application.setFurnaceTemperature(temperPreviewC);
  view?.setTemperPreview(temperPreviewC);
  if (temperating) latestSnapshot = application.getSnapshot(furnaceElapsedMs);
  renderState();
}

function finishTemper(): void {
  if (temperDrag === null || temperPreviewC === null) return;
  temperDrag = null;
  if (activeStation !== "temper") temperPreviewC = null;
  updateView();
}

document.body.classList.toggle("cut-view",acceptanceStation==="cut");
view = new ForgeBilletView(canvas, viewport());
view.setStation(acceptanceStation ?? "overview");
inspectionButtons.forEach(button => button.addEventListener("click", () => {
  stopPower();
  const mode = button.dataset.inspectionView as InspectionView;
  view?.setInspectionView(mode);
  inspectionButtons.forEach(candidate => candidate.setAttribute("aria-pressed", candidate === button ? "true" : "false"));
}));
if (["127.0.0.1","localhost","::1"].includes(window.location.hostname)) {
  (window as unknown as {__forgeInspect:(motionOnly?:boolean)=>unknown}).__forgeInspect=(motionOnly=false)=>view?.inspectScene(motionOnly);
  Object.defineProperty(window,"__THREE_GAME_DIAGNOSTICS__",{get:()=>view?.inspectScene()});
}
activeStation = acceptanceStation ?? "overview";
if(activeStation==="grind")application.prepareGrinding();
document.body.classList.toggle("heat-view", activeStation === "furnace" || activeStation === "temper");
document.body.classList.toggle("hammer-view", activeStation === "anvil");
document.body.classList.toggle("powered-view", activeStation === "power" || activeStation === "press");
document.body.classList.toggle("grind-view", activeStation === "grind");
document.body.classList.toggle("material-session",activeStation==="materials");
view?.resize(viewport());
if(activeStation==="power"||activeStation==="press"){
  const current=activeStation==="power"?powerPoseCurrent:pressPoseCurrent;
  const aligned=alignPoweredPoseToFeed(current);
  if(activeStation==="power")powerPoseCurrent=aligned;else pressPoseCurrent=aligned;
  view?.setPoweredPose(aligned,false);
}
updateView();
if(activeStation==="cut")scheduleCutPreview();

canvas.addEventListener("pointerdown", (event) => {
  if (!view) return;
  if (view.isCameraTransitioning()) return;
  if (view.isInspectionActive()) return;
  canvas.setPointerCapture(event.pointerId);
  const bounds = canvas.getBoundingClientRect();
  const x = event.clientX - bounds.left;
  const y = event.clientY - bounds.top;

  if(activeStation==="power"||activeStation==="press"){
    if(poweredPending||powerCycle.busy||pressCycle.busy)return;
    const point=view.powerTablePoint(x,y);
    if(point && view.pickPowerWorkpiece(x,y)) poweredDrag={point,pose:{...poweredPose()},rotate:event.button===2,startX:x};
    return;
  }

  if(activeStation==="cut"){
    if(cutting)return;
    const id=view.pickCutPiece(x,y);
    if(id && id!==latestSnapshot.workpieceId){chooseCutPiece(id);return;}
    if(id&&event.button===0&&event.shiftKey){const point=view.cutTablePoint(x,y);if(point)cutDrag={point,pose:{...cutPose}};}
    return;
  }

  if (activeStation === "materials") {
    const material = view.pickMaterial(x, y);
    if (material) materialToStation(material);
    else {
      const tableWorkpieceId = view.pickMaterialsTableWorkpiece(x, y);
      const rackWorkpieceId = view.pickRackWorkpiece(x, y);
      const workpieceId = tableWorkpieceId ?? rackWorkpieceId;
      if (workpieceId && materialSelection.take(workpieceId)) {
        materialSelection.cancel();
        rackNotice = rackWorkpieceId ? `已取回 ${workpieceId}` : `当前工件 ${workpieceId}`;
        updateView();
      }
    }
    return;
  }

  if (activeStation === "overview") {
    const material = view.pickMaterial(x, y);
    if (material) {
      materialToStation(material);
      return;
    }
    const station = view.pickStation(x, y);
    if (station) {
      setStation(station);
      return;
    }
    if (view.pickHammerTarget(x, y)) setStation("anvil");
    return;
  }

  if (activeStation === "furnace") {
    if (view.pickFurnace(x, y)) furnaceInsertionDrag = { startX: x, startOffset: view.furnaceInsertionOffset(), moved: false };
    return;
  }
  if(activeStation==="anvil"){
    const point=view.pickHammerSurface(x,y);
    if(!point)return;
    if(event.shiftKey){hammerDrag={point,pose:{...hammerPose}};aimHammer(point);return;}
    strikeHammer(point);
    return;
  }
  const target = view.pickHammerTarget(x, y);
  if (activeStation === "grind" && target) {
    const point = view.grindTablePoint(x, y);
    const mode=event.button===2?"rotate":event.shiftKey?"move":"grind";
    if (point) grindDrag = { point, pose: view.grindPose(), mode, startX:x, startY:y };
    grindHolding = mode === "grind";
    grindLastTick = performance.now();
    gesture = {
      kind: activeStation,
      target,
      weldBenchIndex: null,
      startedAtMs: performance.now(),
      startX: x,
      startY: y,
    };
    return;
  }
  if (activeStation === "weld") {
    const weldBenchIndex = view.pickWeldBench(x, y);
    if (!target && weldBenchIndex === null) return;
    gesture = {
      kind: "weld",
      target: target ?? { sectionIndex: 0, faceBias: 0.5 },
      weldBenchIndex,
      startedAtMs: performance.now(),
      startX: x,
      startY: y,
    };
    return;
  }
  if ((activeStation === "quench-water" || activeStation === "quench-oil") && target) {
    toggleQuench();
    return;
  }
  if ((activeStation === "quench-water" || activeStation === "quench-oil") && view.pickQuenchBasin(x, y, activeStation)) {
    toggleQuench();
    return;
  }
  if (activeStation === "temper" && view.pickTemperControl(x, y)) {
    temperDrag = { startedAtMs: performance.now(), startY: y };
    temperPreviewC = 220;
    view.setTemperPreview(temperPreviewC);
    renderState();
    return;
  }
  if (activeStation === "temper" && view.pickFurnace(x, y)) {
    temperInsertionDrag = { startX: x, startY: y, startOffset: view.temperInsertionOffset(), moved: false };
  }
});

canvas.addEventListener("pointermove", (event) => {
  if((activeStation==="power"||activeStation==="press"||activeStation==="anvil")&&view){
    if((activeStation==="power"||activeStation==="press")&&poweredDrag&&!poweredPending&&!powerCycle.busy&&!pressCycle.busy){
      const bounds=canvas.getBoundingClientRect(),x=event.clientX-bounds.left,y=event.clientY-bounds.top;
      if(poweredDrag.rotate) placePower({...poweredDrag.pose,roll:poweredDrag.pose.roll+(x-poweredDrag.startX)*0.012});
      else {
        const point=view.powerTablePoint(x,y);
        if(point) placePower({...poweredDrag.pose,x:poweredDrag.pose.x+point.x-poweredDrag.point.x,z:poweredDrag.pose.z+point.z-poweredDrag.point.z});
      }
    }
    if(activeStation==="anvil"&&!view.hammerView.busy){
      const bounds=canvas.getBoundingClientRect(),point=view.pickHammerSurface(event.clientX-bounds.left,event.clientY-bounds.top);
      if(hammerDrag&&point&&!hammerPending){
        placeHammer({...hammerDrag.pose,x:hammerDrag.pose.x+point.x-hammerDrag.point.x,z:hammerDrag.pose.z+point.z-hammerDrag.point.z});
      } else aimHammer(point);
    }
    return;
  }
  if(cutDrag && !cutting){
    const bounds=canvas.getBoundingClientRect(),point=view?.cutTablePoint(event.clientX-bounds.left,event.clientY-bounds.top);
    if(point){
      const start=cutDrag;
      placeCut({...start.pose,x:start.pose.x+point.x-start.point.x,z:start.pose.z+point.z-start.point.z});
    }
    return;
  }
  if (grindDrag && view) {
    const bounds = canvas.getBoundingClientRect();
    const point = view.grindTablePoint(event.clientX - bounds.left, event.clientY - bounds.top);
    if (point) {
      if (grindDrag.mode === "rotate") {
        const delta=(event.clientX-bounds.left-grindDrag.startX)*0.012;
        const vertical=(event.clientY-bounds.top-grindDrag.startY)*0.008;
        view.setGrindPose({yaw:grindDrag.pose.yaw+delta,angle:grindDrag.pose.angle+vertical});
      } else if (grindDrag.mode === "move") {
        view.setGrindPose({ x: grindDrag.pose.x + point.x - grindDrag.point.x, z:grindDrag.pose.z+point.z-grindDrag.point.z });
      }
    }
    return;
  }
  if (quenchDrag && view) {
    const bounds = canvas.getBoundingClientRect();
    const x = event.clientX - bounds.left, y = event.clientY - bounds.top;
    const dx = x - quenchDrag.startX, dy = y - quenchDrag.startY;
    if (Math.hypot(dx, dy) > 4) quenchDrag.moved = true;
    if (quenchDrag.moved) {
      const point = view.quenchTablePoint(x, y);
      if (point) view.updateQuenchPosition(point, activeStation as "quench-water" | "quench-oil");
      view.setQuenchPose({ vertical: quenchDrag.pose.vertical - dy * 0.45, yaw: quenchDrag.pose.yaw + dx * 0.006 });
    }
    return;
  }
  if (temperInsertionDrag && view) {
    const bounds = canvas.getBoundingClientRect();
    const x = event.clientX - bounds.left, y = event.clientY - bounds.top;
    const dx = x - temperInsertionDrag.startX, dy = y - temperInsertionDrag.startY;
    if (Math.hypot(dx, dy) > 4) temperInsertionDrag.moved = true;
    if (temperInsertionDrag.moved) view.dragTemperInsertion(temperInsertionDrag.startOffset, dx);
    return;
  }
  if (furnaceInsertionDrag && view) {
    const bounds = canvas.getBoundingClientRect();
    const x = event.clientX - bounds.left;
    const dx = x - furnaceInsertionDrag.startX;
    if (Math.abs(dx) > 4) furnaceInsertionDrag.moved = true;
    if (furnaceInsertionDrag.moved) view.setFurnaceInsertionOffset(furnaceInsertionDrag.startOffset - dx * 0.35);
    return;
  }
  if (temperDrag === null) return;
  const bounds = canvas.getBoundingClientRect();
  updateTemperPreview(event.clientY - bounds.top);
});

canvas.addEventListener("pointerup", (event) => {
  poweredDrag=null;
  hammerDrag=null;
  cutDrag=null;
  if (grindDrag && grindDrag.mode === "move") gesture = null;
  grindDrag=null;
  grindHolding = false;
  grindLastTick = null;
  if (quenchDrag) {
    const shouldToggle = !quenchDrag.moved;
    quenchDrag = null;
    if (shouldToggle) toggleQuench();
  }
  if (temperInsertionDrag) {
    const moved = temperInsertionDrag.moved;
    temperInsertionDrag = null;
    if (moved && view?.temperInsertionComplete() && application.getState().workpiece.thermal.location !== "furnace") startTempering();
    else if (moved && view?.temperInsertionOutside() && application.getState().workpiece.thermal.location === "furnace") stopTempering();
  }
  if (furnaceInsertionDrag) {
    const moved = furnaceInsertionDrag.moved;
    furnaceInsertionDrag = null;
    if (moved && view?.furnaceInsertionComplete() && application.getState().workpiece.thermal.location !== "furnace") startHeating();
    else if (moved && view?.furnaceInsertionOutside() && application.getState().workpiece.thermal.location === "furnace") stopHeating();
    else if (moved) heatStatus.textContent = "工件尚未完全进入炉腔，请继续拖动至炉内。";
  }
  if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
  const bounds = canvas.getBoundingClientRect();
  const x = event.clientX - bounds.left;
  const y = event.clientY - bounds.top;
  if (temperDrag !== null) finishTemper();
  else if (gesture !== null) finishGesture(x, y);
});

canvas.addEventListener("pointercancel", () => {
  stopPower();
  poweredDrag=null;
  cutDrag=null;
  grindDrag=null;
  grindHolding = false;
  grindLastTick = null;
  temperDrag = null;
  temperInsertionDrag = null;
  furnaceInsertionDrag = null;
  quenchDrag = null;
  temperPreviewC = null;
  gesture = null;
  updateView();
});

window.addEventListener("keydown", (event) => {
  if((activeStation==="power"||activeStation==="press")&&event.code==="Space"){
    const target=event.target;
    if(target instanceof HTMLElement&&(target.isContentEditable||target instanceof HTMLTextAreaElement
      ||target instanceof HTMLSelectElement||(target instanceof HTMLInputElement&&target.type!=="range")))return;
    event.preventDefault();
    if(!event.repeat&&!view?.isInspectionActive()&&!view?.isCameraTransitioning()){
      if(activeStation==="power")powerHeld=true;else startPress();
    }
    return;
  }
  if (event.key !== "Escape" && (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement || event.target instanceof HTMLButtonElement)) return;
  if (view?.isInspectionActive()) return;
  if(activeStation==="power"||activeStation==="press"){
    const key=event.key.toLowerCase(),step=8,delta=Math.PI/36;
    const pose=poweredPose();
    if(key==="w"||key==="s") { event.preventDefault(); const forward=feedVector(); placePower({...pose,x:pose.x+forward.x*(key==="w"?step:-step),z:pose.z+forward.z*(key==="w"?step:-step)}); return; }
    if(key==="a"||key==="d") {
      event.preventDefault();
      const forward=feedVector();
      const side={x:-forward.z,z:forward.x};
      const sign=key==="a"?-1:1;
      placePower({...pose,x:pose.x+side.x*step*sign,z:pose.z+side.z*step*sign});
      return;
    }
    if(key==="q"||key==="e") { event.preventDefault(); placePower({...pose,roll:pose.roll+(key==="q"?-delta:delta)}); return; }
  }
  if(activeStation==="cut" && ["q","e","ArrowLeft","ArrowRight","ArrowUp","ArrowDown","Enter"].includes(event.key.length===1?event.key.toLowerCase():event.key)){
    event.preventDefault();if(cutting)return;
    const key=event.key.toLowerCase();
    if(key==="enter")cutConfirm.click();
    else if(key==="q"||key==="e")placeCut({...cutPose,angle:cutPose.angle+(key==="q"?-1:1)*Math.PI/36});
    else if(key==="a"||key==="d")placeCut({...cutPose,roll:(cutPose.roll??0)+(key==="a"?-1:1)*Math.PI/36});
    else if(key==="w"||key==="s")placeCut({...cutPose,pitch:(cutPose.pitch??0)+(key==="w"?-1:1)*Math.PI/36});
    else {
      const nudge=workshopUnits(event.shiftKey?50:5);
      placeCut({...cutPose,x:cutPose.x+(key==="arrowleft"?-nudge:key==="arrowright"?nudge:0),z:cutPose.z+(key==="arrowup"?-nudge:key==="arrowdown"?nudge:0)});
    }
    return;
  }
  if (activeStation === "grind" && ["q", "e", "a", "d", "w", "s", "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key.length === 1 ? event.key.toLowerCase() : event.key)) {
    event.preventDefault();
    const key = event.key.toLowerCase();
    const pose = view?.grindPose();
    if (!pose || !view) return;
    const step = workshopUnits(event.shiftKey ? 25 : 5);
    if (key === "q" || key === "e") view.setGrindPose({yaw:pose.yaw+(key === "q" ? -1 : 1)*Math.PI/72});
    else if (key === "a" || key === "d") view.setGrindPose({roll:pose.roll+(key === "a" ? -1 : 1)*Math.PI/72});
    else if (key === "w" || key === "s") view.setGrindPose({ feed: pose.feed + (key === "w" ? -1 : 1) * step });
    else view.setGrindPose({
      x: pose.x + (key === "arrowup" ? step : key === "arrowdown" ? -step : 0),
      z: pose.z + (key === "arrowleft" ? -step : key === "arrowright" ? step : 0),
    });
    return;
  }
  if ((activeStation === "quench-water" || activeStation === "quench-oil")
    && (event.key.toLowerCase() === "s" || event.key.toLowerCase() === "w")) {
    event.preventDefault();
    // Preserve the compact keyboard path used by the acceptance slice while
    // keeping the basin/workpiece click path as the primary interaction.
    if (event.key.toLowerCase() === "s" && quenchPhase === "ready") toggleQuench();
    if (event.key.toLowerCase() === "w" && quenchPhase === "immersed") toggleQuench();
    return;
  }
  if (event.key === "Escape" && activeStation === "materials") {
    if (materialSelection.getCandidate()) {
      materialSelection.cancel();
      updateView();
    } else if (!acceptanceStation) setStation("overview");
    return;
  }
  if (event.key.toLowerCase() === "r" && acceptanceStation) {
    event.preventDefault();
    window.location.reload();
    return;
  }
  if (event.key === "Escape" && activeStation !== "overview") {
    if (acceptanceStation && acceptanceVerb!=="cut" && acceptanceVerb!=="heat" && acceptanceVerb!=="hammer" && acceptanceVerb!=="power" && acceptanceVerb!=="press") return;
    event.preventDefault();
    setStation("overview");
    return;
  }
  if (activeStation !== "anvil") return;
  const step=Math.PI/36,feedStep=4,wrap=(n:number)=>Math.atan2(Math.sin(n),Math.cos(n));
  const feed=view?.hammerFeedVector() ?? {x:1,z:0};
  switch (event.key.toLowerCase()) {
    case "a": placeHammer({...hammerPose,roll:wrap(hammerPose.roll-step)}); break;
    case "d": placeHammer({...hammerPose,roll:wrap(hammerPose.roll+step)}); break;
    case "q": placeHammer({...hammerPose,yaw:wrap(hammerPose.yaw-step)}); break;
    case "e": placeHammer({...hammerPose,yaw:wrap(hammerPose.yaw+step)}); break;
    case "w": placeHammer({...hammerPose,x:hammerPose.x+feed.x*feedStep,z:hammerPose.z+feed.z*feedStep}); break;
    case "s": placeHammer({...hammerPose,x:hammerPose.x-feed.x*feedStep,z:hammerPose.z-feed.z*feedStep}); break;
    case "arrowleft": placeHammer({...hammerPose,x:hammerPose.x-4}); break;
    case "arrowright": placeHammer({...hammerPose,x:hammerPose.x+4}); break;
    case "arrowup": placeHammer({...hammerPose,z:hammerPose.z-4}); break;
    case "arrowdown": placeHammer({...hammerPose,z:hammerPose.z+4}); break;
    default: return;
  }
  event.preventDefault();
});

canvas.addEventListener("wheel",event=>{
  if(activeStation==="power"||activeStation==="press"){
    event.preventDefault();
    if(activeStation==="press"&&pressCycle.busy)return;
    poweredForce.value=String(Math.max(15,Math.min(90,Number(poweredForce.value)+(event.deltaY<0?5:-5))));
    refreshPoweredInterface();return;
  }
  if (activeStation === "temper") {
    event.preventDefault();
    const current = temperPreviewC ?? latestSnapshot.temperTemperatureC ?? 220;
    const next = Math.min(450, Math.max(80, current + (event.deltaY < 0 ? 5 : -5)));
    temperPreviewC = next;
    application.setFurnaceTemperature(next);
    view?.setTemperPreview(next);
    if (temperating) latestSnapshot = application.getSnapshot(furnaceElapsedMs);
    renderState();
    return;
  }
  if (activeStation === "grind") {
    event.preventDefault();
    const pose = view?.grindPose();
    if (pose) view?.setGrindPose({ angle: pose.angle + (event.deltaY < 0 ? 1 : -1) * Math.PI / 72 });
    return;
  }
  if(activeStation!=="anvil")return;event.preventDefault();
  hammerEnergy=Math.round(Math.max(0.1,Math.min(1,hammerEnergy+(event.deltaY<0?0.05:-0.05)))*100)/100;
  refreshHammerInterface();aimHammer(hammerAim);
},{passive:false});

const renderFrame = (nowMs: number): void => {
  tickPower(nowMs);
  tickPress(nowMs);
  tickFurnace(nowMs);
  if (activeStation === "grind" && grindHolding && grindDrag?.mode === "grind" && view && document.hasFocus()) {
    if (grindLastTick === null) grindLastTick = nowMs;
    const elapsedMs = Math.min(160, Math.max(0, nowMs - grindLastTick));
    if (elapsedMs >= 160) {
      grindLastTick = nowMs;
      const contact = view.grindContactTarget();
      const patch = view.grindContactPatch();
      if (contact && patch) {
        grindStep({ kind: "grind", sectionIndex: contact.sectionIndex, amount: Math.min(0.2, elapsedMs / 3500), angle: view.grindPose().angle, contact: patch });
      }
    }
  } else if (!grindHolding) grindLastTick = null;
  view?.tick(nowMs);
  if (view) document.body.dataset.cameraState = view.isCameraTransitioning() ? "moving" : "settled";
  if(activeStation==="cut" && cutReady && !cutting)cutConfirm.disabled=view?.isCameraTransitioning()??true;
  requestAnimationFrame(renderFrame);
};
requestAnimationFrame(renderFrame);

window.addEventListener("keyup",event=>{if(event.code==="Space"){stopPower();event.preventDefault();}});
window.addEventListener("blur",stopPower);
document.addEventListener("visibilitychange",()=>{if(document.hidden)stopPower();});
canvas.addEventListener("contextmenu",event=>{if(["anvil","power","press","cut","grind"].includes(activeStation))event.preventDefault();});

window.addEventListener("resize", () => view?.resize(viewport()));
window.addEventListener("beforeunload", () => {
  hammerWorker?.terminate();
  poweredWorker?.terminate();
  cutWorker?.terminate();
  grindWorker?.terminate();
  view?.dispose();
});
