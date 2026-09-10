import {
  HIGH_CARBON_STEEL,
  SPRING_STEEL,
  FORGE_RULES,
  createHammerInfluencePreview,
  type ForgeSnapshot,
  type ForgeState,
} from "../forge/index.ts";
import { GameApplication } from "../app/game-application.ts";
import { MaterialSelection, MATERIAL_RACK_PAGE_SIZE } from "../app/material-selection.ts";
import { hammerEnergyForPressDuration } from "../platform/hammer-charge.ts";
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

function prepareHotWorkpiece(target: GameApplication): void {
  target.applyIntent({ kind: "move-billet", destination: "furnace", elapsedMs: 0 });
  target.getSnapshot(20_000);
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
    prepareHotWorkpiece(next);
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
let pressStartedAtMs: number | null = null;
let pressTarget: HammerPickTarget | null = null;
let heatingStartedAtMs: number | null = null;
let heatingFrame: number | null = null;
let temperPreviewC: number | null = null;
let temperDrag: { readonly startedAtMs: number; readonly startY: number } | null = null;
let gesture: {
  readonly kind: "cut" | "grind" | "weld" | "quench";
  readonly target: HammerPickTarget;
  readonly weldBenchIndex: number | null;
  readonly startedAtMs: number;
  readonly startX: number;
  readonly startY: number;
} | null = null;

const stationCopy: Record<ForgeStation, { readonly title: string; readonly hint: string }> = {
  overview: { title: "铁匠铺 · 总览", hint: "点击材料、工位或铁砧进入第一人称近景；Esc 返回总览。" },
  materials: { title: "选料桌 · 选料", hint: "" },
  furnace: { title: "火炉 · 加热", hint: "按住炉口中的钢坯，观察热色和温度；松开取出。" },
  anvil: { title: "铁砧 · 锤击", hint: "按住钢坯落锤；A/D 转面，W/S 送料。" },
  cut: { title: "切割台 · 切割", hint: "从钢坯表面拖过切口，松开完成一次切割。" },
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
    acceptanceVerb === "heat" ? operation.kind === "move-billet" && operation.elapsedMs > 0
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
        `当前截面 ${latestSnapshot.sections.length} · 当前节点 ${latestSnapshot.nodes.length}`,
        `工作台 ${latestSnapshot.benchCount} 块 · 工件 ${latestSnapshot.workpieceId}`,
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
        `转面 ${latestSnapshot.orientationQuarterTurns}/4 · 送料 ${latestSnapshot.feedOffset.toFixed(0)}`,
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
    state.operations.some((operation) => operation.kind === "move-billet" && operation.elapsedMs > 0) ? "heat" : null,
    state.operations.some((operation) => operation.kind === "hammer") ? "hammer" : null,
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
    `锤击 ${operationCounts.hammer ?? 0} · 切割 ${operationCounts.cut ?? 0} · 焊合 ${operationCounts.weld ?? 0}`,
    `淬火 ${latestSnapshot.quenchMedium ?? "未做"} · 回火 ${displayedTemper ?? "未做"} · 研磨 ${Math.round(latestSnapshot.edgeCoverage * 100)}%`,
    `损伤 ${Math.round(damage * 100)}% · 规则 ${latestSnapshot.parameterVersion}`,
  ];
  hudState.textContent = (acceptanceStation ? acceptanceState(state) : overviewState).join(" · ");
  document.body.dataset.stage = acceptanceStation ? "forge-acceptance" : "forge-mvp";
  document.body.dataset.acceptanceVerb = acceptanceVerb ?? "none";
  document.body.dataset.acceptanceSetupOperations = String(acceptanceSetupOperationCount);
  document.body.dataset.acceptanceOperationCount = String(acceptanceOperationCount(state));
  document.body.dataset.activeStation = activeStation;
  document.body.dataset.operationCount = String(state.operations.length);
  document.body.dataset.completedVerbs = completedVerbs.join(",");
  document.body.dataset.verbCount = String(completedVerbs.length);
  document.body.dataset.temperatureC = latestSnapshot.averageTemperatureC.toFixed(2);
  document.body.dataset.benchCount = String(latestSnapshot.benchCount);
  document.body.dataset.benchMaterialIds = state.bench.map((piece) => piece.material.id).join(",");
  document.body.dataset.benchWorkpieceIds = state.bench.map((piece) => piece.id).join(",");
  document.body.dataset.workpieceId = latestSnapshot.workpieceId;
  document.body.dataset.layerCount = String(latestSnapshot.layerCount);
  document.body.dataset.materialRegionCount = String(latestSnapshot.materialRegionCount);
  document.body.dataset.jointCount = String(state.workpiece.joints.length);
  document.body.dataset.removedVolume = latestSnapshot.removedVolume.toFixed(6);
  document.body.dataset.carbon = latestSnapshot.carbon.toFixed(6);
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
  renderState();
}

function setStation(station: ForgeStation): void {
  if (acceptanceStation && !materialSession && station !== acceptanceStation) return;
  if (materialSession && station !== "materials" && materialSelection.getAcquiredCount() === 0) return;
  if (activeStation === "materials" && station !== "materials"
    && materialSelection.getPieces().length > 0
    && !materialSelection.isOnTable(latestSnapshot.workpieceId)) {
    rackNotice = "当前工件仍在料架，请先点击取回到桌面";
    updateView();
    return;
  }
  if (heatingStartedAtMs !== null) stopHeating();
  pressStartedAtMs = null;
  pressTarget = null;
  gesture = null;
  temperDrag = null;
  temperPreviewC = null;
  materialSelection.cancel();
  activeStation = station;
  view?.setStation(station);
  updateView();
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

function startHeating(): void {
  if (heatingStartedAtMs !== null) return;
  if (latestSnapshot.billetLocation === "inspection") {
    application.applyIntent({ kind: "move-billet", destination: "furnace", elapsedMs: 0 });
  }
  heatingStartedAtMs = performance.now();
  const tick = (): void => {
    if (heatingStartedAtMs === null) return;
    latestSnapshot = application.getSnapshot(Math.min(performance.now() - heatingStartedAtMs, 120_000));
    view?.update(latestSnapshot, null, activeStation, temperPreviewC);
    renderState();
    heatingFrame = requestAnimationFrame(tick);
  };
  heatingFrame = requestAnimationFrame(tick);
}

function stopHeating(): void {
  if (heatingStartedAtMs === null) return;
  const elapsedMs = Math.min(performance.now() - heatingStartedAtMs, 120_000);
  if (heatingFrame !== null) cancelAnimationFrame(heatingFrame);
  heatingFrame = null;
  heatingStartedAtMs = null;
  application.applyIntent({ kind: "move-billet", destination: "inspection", elapsedMs });
  updateView();
}

function releaseHammer(): void {
  if (pressStartedAtMs === null || pressTarget === null) return;
  application.applyIntent({
    kind: "hammer",
    sectionIndex: pressTarget.sectionIndex,
    faceBias: pressTarget.faceBias,
    energy: hammerEnergyForPressDuration(performance.now() - pressStartedAtMs),
  });
  pressStartedAtMs = null;
  pressTarget = null;
  updateView();
}

function finishGesture(endX: number, endY: number): void {
  if (gesture === null) return;
  const distance = Math.hypot(endX - gesture.startX, endY - gesture.startY);
  const elapsedMs = performance.now() - gesture.startedAtMs;
  if (distance < 10) {
    gesture = null;
    return;
  }

  if (gesture.kind === "cut") {
    if (gesture.target.sectionIndex > 0 && gesture.target.sectionIndex < latestSnapshot.sections.length) {
      application.applyIntent({ kind: "cut", sectionIndex: gesture.target.sectionIndex });
    }
  } else if (gesture.kind === "grind") {
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

view = new ForgeBilletView(canvas, viewport());
view.setStation(acceptanceStation ?? "overview");
activeStation = acceptanceStation ?? "overview";
updateView();

canvas.addEventListener("pointerdown", (event) => {
  if (!view) return;
  if (view.isCameraTransitioning()) return;
  canvas.setPointerCapture(event.pointerId);
  const bounds = canvas.getBoundingClientRect();
  const x = event.clientX - bounds.left;
  const y = event.clientY - bounds.top;

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

  const target = view.pickHammerTarget(x, y);
  if (activeStation === "furnace" && target) {
    startHeating();
    return;
  }
  if (activeStation === "anvil" && target) {
    pressStartedAtMs = performance.now();
    pressTarget = target;
    view.update(latestSnapshot, createHammerInfluencePreview(latestSnapshot, {
      sectionIndex: target.sectionIndex,
      faceBias: target.faceBias,
      energy: 1,
    }), activeStation, temperPreviewC);
    return;
  }
  if ((activeStation === "cut" || activeStation === "grind") && target) {
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
  if (temperDrag === null) return;
  const bounds = canvas.getBoundingClientRect();
  updateTemperPreview(event.clientY - bounds.top);
});

canvas.addEventListener("pointerup", (event) => {
  if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
  const bounds = canvas.getBoundingClientRect();
  const x = event.clientX - bounds.left;
  const y = event.clientY - bounds.top;
  if (heatingStartedAtMs !== null) stopHeating();
  else if (pressStartedAtMs !== null) releaseHammer();
  else if (temperDrag !== null) finishTemper();
  else if (gesture !== null) finishGesture(x, y);
});

canvas.addEventListener("pointercancel", () => {
  if (heatingStartedAtMs !== null) stopHeating();
  pressStartedAtMs = null;
  pressTarget = null;
  temperDrag = null;
  temperPreviewC = null;
  gesture = null;
  updateView();
});

window.addEventListener("keydown", (event) => {
  if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement || event.target instanceof HTMLButtonElement) return;
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
    if (acceptanceStation) return;
    event.preventDefault();
    setStation("overview");
    return;
  }
  if (activeStation !== "anvil") return;
  let intent: { kind: "rotate"; quarterTurns: 1 | -1 } | { kind: "feed"; step: 1 | -1 } | null = null;
  switch (event.key.toLowerCase()) {
    case "a": intent = { kind: "rotate", quarterTurns: -1 }; break;
    case "d": intent = { kind: "rotate", quarterTurns: 1 }; break;
    case "w": intent = { kind: "feed", step: 1 }; break;
    case "s": intent = { kind: "feed", step: -1 }; break;
    default: return;
  }
  event.preventDefault();
  application.applyIntent(intent);
  updateView();
});

const renderFrame = (nowMs: number): void => {
  view?.tick(nowMs);
  if (view) document.body.dataset.cameraState = view.isCameraTransitioning() ? "moving" : "settled";
  requestAnimationFrame(renderFrame);
};
requestAnimationFrame(renderFrame);

window.addEventListener("resize", () => view?.resize(viewport()));
window.addEventListener("beforeunload", () => {
  if (heatingStartedAtMs !== null) stopHeating();
  view?.dispose();
});
