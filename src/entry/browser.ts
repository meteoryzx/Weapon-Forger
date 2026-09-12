import {
  HIGH_CARBON_STEEL,
  SPRING_STEEL,
  FORGE_RULES,
  type ForgeSnapshot,
  type ForgeState,
  type CutOperation,
  totalVolume,
} from "../forge/index.ts";
import { GameApplication } from "../app/game-application.ts";
import { MaterialSelection, MATERIAL_RACK_PAGE_SIZE } from "../app/material-selection.ts";
import { HAMMER_HOME, HAMMER_RULES, hammerFrame, rotateHammerPoint, type HammerPose, type SurfaceHammerOperation } from "../forge/index.ts";
import { CUT_HOME, cutBounds, cutOperationFor, tablePoint, validCutPose, type CutPose } from "../app/cut-placement.ts";
import { solidBounds } from "../forge/solid-geometry.ts";
import {
  ForgeBilletView,
  type ForgeMaterialPick,
  type ForgeStation,
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

// The browser entry translates continuous pointer input into the public forge intents.
const ACCEPTANCE_VERBS = ["materials", "cut", "weld", "heat", "hammer", "quench", "temper", "grind"] as const;
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
  } else if (acceptanceVerb === "hammer" || acceptanceVerb === "quench") {
    prepareHotWorkpiece(next,acceptanceVerb==="hammer"?30_000:20_000);
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
let hammerPlacing=false,hammerAim:{x:number;z:number}|null=null;
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
const hammerYaw=document.querySelector<HTMLInputElement>("#hammer-yaw")!;
const hammerRoll=document.querySelector<HTMLInputElement>("#hammer-roll")!;
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
  hammerYaw.value=String(Math.round(hammerPose.yaw*180/Math.PI));hammerRoll.value=String(Math.round(hammerPose.roll*180/Math.PI));
  document.querySelector("#hammer-force-label")!.textContent=`${hammerForce.value}%`;
  document.querySelector("#hammer-yaw-label")!.textContent=`${hammerYaw.value}°`;
  document.querySelector("#hammer-roll-label")!.textContent=`${hammerRoll.value}°`;
  document.querySelector("#hammer-mode")!.setAttribute("aria-pressed",String(hammerPlacing));
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
  hammerStatus.textContent=hammerPlacing?"摆放模式：拖动金属，完成后再次点击“拖动摆放”返回落锤。":
    hit ? hit.supported?`${hammerShapeHint(point!)} · 力度 ${Math.round(hammerEnergy*100)}% · 支撑 ${Math.round(hit.supportRatio*100)}%`:
      "该落点缺少砧面支撑，请移动工件。":"瞄准金属表面 · 单击落锤 · 滚轮调力度";
}
function hammerShapeHint(point:{x:number;z:number}):string {
  const values=latestSnapshot.geometry.nodes.map(n=>n.axialPosition);
  const length=Math.max(...values)-Math.min(...values);
  return Math.abs(point.x)>length*0.28?"端部落点：压薄并向端部延展":"中心落点：压薄并向两侧展宽";
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
hammerYaw.addEventListener("input",()=>placeHammer({...hammerPose,yaw:Number(hammerYaw.value)*Math.PI/180}));
hammerRoll.addEventListener("input",()=>placeHammer({...hammerPose,roll:Number(hammerRoll.value)*Math.PI/180}));
document.querySelector("#hammer-mode")!.addEventListener("click",()=>{hammerPlacing=!hammerPlacing;refreshHammerInterface();aimHammer(null);});
document.querySelector("#hammer-center")!.addEventListener("click",()=>placeHammer({...HAMMER_HOME}));
document.querySelector("#hammer-overview")!.addEventListener("click",()=>setStation("overview"));
hammerPieces.addEventListener("change",()=>{const index=latestSnapshot.bench.findIndex(p=>p.workpieceId===hammerPieces.value);if(index>=0){application.applyIntent({kind:"select-workpiece",benchIndex:index});updateView();}});
const cutControls=document.querySelector<HTMLElement>("#cut-controls")!;
const cutStatus=document.querySelector<HTMLElement>("#cut-status")!;
const cutConfirm=document.querySelector<HTMLButtonElement>("#cut-confirm")!;
const cutAngle=document.querySelector<HTMLInputElement>("#cut-angle")!;
const cutAngleLabel=document.querySelector<HTMLOutputElement>("#cut-angle-label")!;
const cutPieces=document.querySelector<HTMLSelectElement>("#cut-piece")!;
let cutPose:CutPose={...CUT_HOME};
let cutReady=false, cutting=false, cutPage=0, cutGeneration=0;
let cutValidity:boolean|null=null;
let cutWorker:Worker|null=null, cutTimer:ReturnType<typeof setTimeout>|null=null;
let cutOperation:CutOperation|null=null;
let cutDrag:{point:{x:number;z:number};pose:CutPose;rotate:boolean}|null=null;

function cancelCutPreview():void {
  cutGeneration++;cutReady=false;cutValidity=null;cutOperation=null;
  application.cancelPreparedCut();cutWorker?.terminate();cutWorker=null;
  if(cutTimer!==null)clearTimeout(cutTimer);
  cutConfirm.disabled=true;
}

function refreshCutInterface():void {
  cutControls.hidden=activeStation!=="cut";
  if(cutControls.hidden)return;
  cutAngle.value=String(Math.round(cutPose.angle*180/Math.PI));
  cutAngleLabel.value=`${cutAngle.value}°`;
  cutAngle.disabled=cutting;cutPieces.disabled=cutting;
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
  document.body.dataset.cutAngle=cutAngle.value;
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
  pose={...pose,angle:Math.atan2(Math.sin(pose.angle),Math.cos(pose.angle))};
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

cutAngle.addEventListener("input",()=>placeCut({...cutPose,angle:Number(cutAngle.value)*Math.PI/180}));
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
const heatControls = document.querySelector<HTMLElement>("#heat-controls")!;
const heatToggle = document.querySelector<HTMLButtonElement>("#heat-toggle")!;
const heatStatus = document.querySelector<HTMLElement>("#heat-status")!;
let temperPreviewC: number | null = null;
let temperDrag: { readonly startedAtMs: number; readonly startY: number } | null = null;
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
  furnace: { title: "火炉 · 加热", hint: "点击炉口把钢坯送入加热；再次点击取出，根据颜色和温度判断火候。" },
  anvil: { title: "铁砧 · 锤击", hint: "瞄准金属单击落锤，滚轮调力度；Shift＋拖动摆放。Q/E 旋转，A/D 连续翻滚。" },
  cut: { title: "切割台 · 切割", hint: "拖动金属摆放；滑杆或 Q/E 旋转，Shift＋拖动也可旋转。绿虚线可切，红虚线需调整；确认后才切割。" },
  weld: { title: "焊合台 · 焊合", hint: "从当前钢坯拖向旁边的第二块工件，贴合后松开。" },
  "quench-water": { title: "水槽 · 淬火", hint: "把钢坯拖进水面，松开完成水淬。" },
  "quench-oil": { title: "油槽 · 淬火", hint: "把钢坯拖进油面，松开完成油淬。" },
  temper: { title: "回火炉 · 回火", hint: "拖动温度控制，松开把当前温度写入工件。" },
  grind: { title: "磨石 · 研磨", hint: "沿刃口连续拖动，拖动长度决定这一道研磨量。" },
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
    : operation.kind === acceptanceVerb
  )).length;
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
    case "quench":
      return [
        `样本介质 ${acceptanceMedium === "water" ? "水" : "油"} · 当前温度 ${latestSnapshot.averageTemperatureC.toFixed(0)}℃`,
        `淬火记录 ${latestSnapshot.quenchMedium ?? "未淬火"} · 起始温度 ${latestSnapshot.quenchStartTemperatureC?.toFixed(0) ?? "未记录"}℃`,
        shared,
      ];
    case "temper":
      return [
        `当前调节 ${displayedTemper ?? "未设定"}℃ · 已记录 ${latestSnapshot.temperTemperatureC ?? "未回火"}℃`,
        shared,
      ];
    case "grind":
      return [
        `刃口覆盖 ${Math.round(latestSnapshot.edgeCoverage * 100)}% · 均匀度 ${Math.round(latestSnapshot.edgeEvenness * 100)}%`,
        `平均研磨 ${Math.round(average(sections.map((section) => section.groundAmount)) * 100)}% · ${shared}`,
      ];
    default:
      return [];
  }
}

function renderState(): void {
  const state = application.getState();
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
  heatControls.hidden = activeStation !== "furnace";
  heatToggle.textContent = latestSnapshot.billetLocation === "furnace" ? "取出查看" : "送入加热";
  const overheating = latestSnapshot.averageTemperatureC >= state.workpiece.material.overheatTemperatureC;
  heatStatus.textContent = `${latestSnapshot.billetLocation === "furnace" ? "炉内 · 整体加热中" : "炉外 · 查看火色 / 自然冷却"} · ${latestSnapshot.averageTemperatureC.toFixed(0)}℃${overheating ? " · 过热，继续加热会增加氧化与损伤" : ""}`;
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
  document.body.dataset.cameraState = view?.isCameraTransitioning() ? "moving" : "settled";
  if (materialSession && materialSelection.getAcquiredCount() === 0) {
    document.body.dataset.workpieceId = "none";
    document.body.dataset.temperatureC = "none";
    document.body.dataset.carbon = "none";
    document.body.dataset.layerCount = "0";
  }
}

function updateView(hammerPreview = null): void {
  latestSnapshot = application.getSnapshot();
  view?.update(latestSnapshot, hammerPreview, activeStation, temperPreviewC);
  updateMaterialsInterface();
  refreshCutInterface();
  refreshHammerInterface();
  renderState();
}

function setStation(station: ForgeStation): void {
  if(cutting||hammerPending)return;
  if (acceptanceStation && acceptanceVerb!=="cut" && acceptanceVerb!=="heat" && acceptanceVerb!=="hammer" && !materialSession && station !== acceptanceStation) return;
  if (materialSession && station !== "materials" && materialSelection.getAcquiredCount() === 0) return;
  if (activeStation === "materials" && station !== "materials"
    && materialSelection.getPieces().length > 0
    && !materialSelection.isOnTable(latestSnapshot.workpieceId)) {
    rackNotice = "当前工件仍在料架，请先点击取回到桌面";
    updateView();
    return;
  }
  if (activeStation === "furnace") {
    tickFurnace(performance.now(), true);
    if (latestSnapshot.billetLocation === "furnace") stopHeating();
  }
  furnaceLastTick = null;
  gesture = null;
  temperDrag = null;
  temperPreviewC = null;
  materialSelection.cancel();
  activeStation = station;
  cancelCutPreview();cutDrag=null;
  document.body.classList.toggle("cut-view",station==="cut");
  document.body.classList.toggle("heat-view",station==="furnace");
  document.body.classList.toggle("hammer-view",station==="anvil");
  hammerDrag=null;hammerAim=null;
  view?.setStation(station);
  view?.resize(viewport());
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
  if (activeStation !== "furnace" || document.hidden || !document.hasFocus()) { furnaceLastTick = null; return; }
  if (furnaceLastTick === null) { furnaceLastTick = now; return; }
  const elapsedMs = now - furnaceLastTick;
  if (elapsedMs <= 0 || (!flush && elapsedMs < 250)) return;
  furnaceLastTick = now;
  application.applyIntent({ kind: "move-billet", destination: latestSnapshot.billetLocation, elapsedMs: Math.min(elapsedMs, FORGE_RULES.maximumThermalIntentMs) });
  updateView();
}

function startHeating(): void {
  tickFurnace(performance.now(), true);
  application.applyIntent({ kind: "move-billet", destination: "furnace", elapsedMs: 0 });
  updateView();
}

function stopHeating(): void {
  tickFurnace(performance.now(), true);
  application.applyIntent({ kind: "move-billet", destination: "inspection", elapsedMs: 0 });
  updateView();
}

function toggleHeating(): void {
  if (activeStation !== "furnace") return;
  if (latestSnapshot.billetLocation === "furnace") stopHeating(); else startHeating();
}
heatToggle.addEventListener("click", toggleHeating);
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
    application.applyIntent({
      kind: "grind",
      sectionIndex: gesture.target.sectionIndex,
      amount: Math.min(1, Math.max(0.08, (distance + elapsedMs * 0.08) / 260)),
    });
  } else if (gesture.kind === "weld" && latestSnapshot.benchCount > 0) {
    const pickedBenchIndex = view?.pickWeldBench(endX, endY) ?? null;
    const benchIndex = gesture.weldBenchIndex
      ?? pickedBenchIndex
      ?? (latestSnapshot.benchCount === 1 && distance > 110 ? 0 : null);
    if (benchIndex !== null) application.applyIntent({ kind: "weld", benchIndex });
  } else if (gesture.kind === "quench") {
    const station = activeStation as QuenchStation;
    if (view?.pickQuenchBasin(endX, endY, station) || distance > 110) {
      application.applyIntent({ kind: "quench", medium: station === "quench-water" ? "water" : "oil" });
    }
  }
  gesture = null;
  updateView();
}

function updateTemperPreview(clientY: number): void {
  if (temperDrag === null) return;
  temperPreviewC = Math.min(450, Math.max(80, 220 + (temperDrag.startY - clientY) * 2));
  view?.setTemperPreview(temperPreviewC);
  renderState();
}

function finishTemper(): void {
  if (temperDrag === null || temperPreviewC === null) return;
  application.applyIntent({ kind: "temper", temperatureC: Math.round(temperPreviewC) });
  temperDrag = null;
  temperPreviewC = null;
  updateView();
}

document.body.classList.toggle("cut-view",acceptanceStation==="cut");
view = new ForgeBilletView(canvas, viewport());
view.setStation(acceptanceStation ?? "overview");
activeStation = acceptanceStation ?? "overview";
document.body.classList.toggle("heat-view", activeStation === "furnace");
document.body.classList.toggle("hammer-view", activeStation === "anvil");
view?.resize(viewport());
updateView();
if(activeStation==="cut")scheduleCutPreview();

canvas.addEventListener("pointerdown", (event) => {
  if (!view) return;
  if (view.isCameraTransitioning()) return;
  canvas.setPointerCapture(event.pointerId);
  const bounds = canvas.getBoundingClientRect();
  const x = event.clientX - bounds.left;
  const y = event.clientY - bounds.top;

  if(activeStation==="cut"){
    if(cutting)return;
    const id=view.pickCutPiece(x,y);
    if(id && id!==latestSnapshot.workpieceId){chooseCutPiece(id);return;}
    if(id){const point=view.cutTablePoint(x,y);if(point)cutDrag={point,pose:{...cutPose},rotate:event.shiftKey};}
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
    if (view.pickFurnace(x, y)) toggleHeating();
    return;
  }
  if(activeStation==="anvil"){
    const point=view.pickHammerSurface(x,y);
    if(!point)return;
    if(hammerPlacing||event.shiftKey){const plane=view.hammerTablePoint(x,y);if(plane)hammerDrag={point:plane,pose:{...hammerPose}};}
    else strikeHammer(point);
    return;
  }
  const target = view.pickHammerTarget(x, y);
  if (activeStation === "grind" && target) {
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
    gesture = {
      kind: "quench",
      target,
      weldBenchIndex: null,
      startedAtMs: performance.now(),
      startX: x,
      startY: y,
    };
    return;
  }
  if (activeStation === "temper" && view.pickTemperControl(x, y)) {
    temperDrag = { startedAtMs: performance.now(), startY: y };
    temperPreviewC = 220;
    view.setTemperPreview(temperPreviewC);
    renderState();
  }
});

canvas.addEventListener("pointermove", (event) => {
  if(activeStation==="anvil"&&view){
    const bounds=canvas.getBoundingClientRect(),x=event.clientX-bounds.left,y=event.clientY-bounds.top;
    if(hammerDrag){const p=view.hammerTablePoint(x,y);if(p)placeHammer({...hammerDrag.pose,x:hammerDrag.pose.x+p.x-hammerDrag.point.x,z:hammerDrag.pose.z+p.z-hammerDrag.point.z});}
    else if(!view.hammerView.busy)aimHammer(view.pickHammerSurface(x,y));
    return;
  }
  if(cutDrag && !cutting){
    const bounds=canvas.getBoundingClientRect(),point=view?.cutTablePoint(event.clientX-bounds.left,event.clientY-bounds.top);
    if(point){
      const start=cutDrag;
      if(start.rotate){
        const angle=start.pose.angle-Math.atan2(point.z-start.pose.z,point.x-start.pose.x)+Math.atan2(start.point.z-start.pose.z,start.point.x-start.pose.x);
        placeCut({...start.pose,angle:Math.atan2(Math.sin(angle),Math.cos(angle))});
      }else placeCut({...start.pose,x:start.pose.x+point.x-start.point.x,z:start.pose.z+point.z-start.point.z});
    }
    return;
  }
  if (temperDrag === null) return;
  const bounds = canvas.getBoundingClientRect();
  updateTemperPreview(event.clientY - bounds.top);
});

canvas.addEventListener("pointerup", (event) => {
  hammerDrag=null;
  cutDrag=null;
  if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
  const bounds = canvas.getBoundingClientRect();
  const x = event.clientX - bounds.left;
  const y = event.clientY - bounds.top;
  if (temperDrag !== null) finishTemper();
  else if (gesture !== null) finishGesture(x, y);
});

canvas.addEventListener("pointercancel", () => {
  hammerDrag=null;
  cutDrag=null;
  temperDrag = null;
  temperPreviewC = null;
  gesture = null;
  updateView();
});

window.addEventListener("keydown", (event) => {
  if (event.key !== "Escape" && (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement || event.target instanceof HTMLButtonElement)) return;
  if(activeStation==="cut" && ["q","e","ArrowLeft","ArrowRight","ArrowUp","ArrowDown","Enter"].includes(event.key.length===1?event.key.toLowerCase():event.key)){
    event.preventDefault();if(cutting)return;
    const key=event.key.toLowerCase();
    if(key==="enter")cutConfirm.click();
    else if(key==="q"||key==="e")placeCut({...cutPose,angle:cutPose.angle+(key==="q"?-1:1)*Math.PI/36});
    else placeCut({...cutPose,x:cutPose.x+(key==="arrowleft"?-4:key==="arrowright"?4:0),z:cutPose.z+(key==="arrowup"?-4:key==="arrowdown"?4:0)});
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
    if (acceptanceStation && acceptanceVerb!=="cut" && acceptanceVerb!=="heat" && acceptanceVerb!=="hammer") return;
    event.preventDefault();
    setStation("overview");
    return;
  }
  if (activeStation !== "anvil") return;
  const step=Math.PI/36,wrap=(n:number)=>Math.atan2(Math.sin(n),Math.cos(n));
  switch (event.key.toLowerCase()) {
    case "a": placeHammer({...hammerPose,roll:wrap(hammerPose.roll-step)}); break;
    case "d": placeHammer({...hammerPose,roll:wrap(hammerPose.roll+step)}); break;
    case "q": placeHammer({...hammerPose,yaw:wrap(hammerPose.yaw-step)}); break;
    case "e": placeHammer({...hammerPose,yaw:wrap(hammerPose.yaw+step)}); break;
    case "arrowleft": placeHammer({...hammerPose,x:hammerPose.x-4}); break;
    case "arrowright": placeHammer({...hammerPose,x:hammerPose.x+4}); break;
    case "arrowup": placeHammer({...hammerPose,z:hammerPose.z-4}); break;
    case "arrowdown": placeHammer({...hammerPose,z:hammerPose.z+4}); break;
    default: return;
  }
  event.preventDefault();
});

canvas.addEventListener("wheel",event=>{
  if(activeStation!=="anvil")return;event.preventDefault();
  hammerEnergy=Math.round(Math.max(0.1,Math.min(1,hammerEnergy+(event.deltaY<0?0.05:-0.05)))*100)/100;
  refreshHammerInterface();aimHammer(hammerAim);
},{passive:false});

const renderFrame = (nowMs: number): void => {
  tickFurnace(nowMs);
  view?.tick(nowMs);
  if (view) document.body.dataset.cameraState = view.isCameraTransitioning() ? "moving" : "settled";
  if(activeStation==="cut" && cutReady && !cutting)cutConfirm.disabled=view?.isCameraTransitioning()??true;
  requestAnimationFrame(renderFrame);
};
requestAnimationFrame(renderFrame);

window.addEventListener("resize", () => view?.resize(viewport()));
window.addEventListener("beforeunload", () => {
  hammerWorker?.terminate();
  cutWorker?.terminate();
  view?.dispose();
});
