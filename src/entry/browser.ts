import {
  SPRING_STEEL,
  createHammerInfluencePreview,
  type ForgeSnapshot,
} from "../forge/index.ts";
import { GameApplication } from "../app/game-application.ts";
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

// The browser entry translates continuous pointer input into the public forge intents.
const application = new GameApplication(SPRING_STEEL);

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
  readonly startedAtMs: number;
  readonly startX: number;
  readonly startY: number;
} | null = null;

const stationCopy: Record<ForgeStation, { readonly title: string; readonly hint: string }> = {
  overview: { title: "铁匠铺 · 总览", hint: "点击材料、工位或铁砧进入第一人称近景；Esc 返回总览。" },
  materials: { title: "材料架 · 选料", hint: "在材料堆中点击一块原料，带回当前工位。" },
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

function viewport() {
  return { width: window.innerWidth, height: window.innerHeight, pixelRatio: window.devicePixelRatio };
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
    state.operations.some((operation) => operation.kind === "select-material") ? "materials" : null,
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

  hudTitle.textContent = copy.title;
  hudHint.textContent = copy.hint;
  hudState.textContent = [
    `${materialLabels[latestSnapshot.materialId] ?? latestSnapshot.materialId} · 当前工件 ${latestSnapshot.workpieceId}`,
    `温度 ${latestSnapshot.averageTemperatureC.toFixed(0)}℃`,
    `层数 ${latestSnapshot.layerCount} · 碳 ${latestSnapshot.carbon.toFixed(2)}`,
    `工作台 ${latestSnapshot.benchCount} 块 · 操作 ${state.operations.length}`,
    `锤击 ${operationCounts.hammer ?? 0} · 切割 ${operationCounts.cut ?? 0} · 焊合 ${operationCounts.weld ?? 0}`,
    `淬火 ${latestSnapshot.quenchMedium ?? "未做"} · 回火 ${displayedTemper ?? "未做"} · 研磨 ${Math.round(latestSnapshot.edgeCoverage * 100)}%`,
    `损伤 ${Math.round(damage * 100)}% · 规则 ${latestSnapshot.parameterVersion}`,
  ].join(" · ");
  document.body.dataset.stage = "forge-mvp";
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
  document.body.dataset.carbon = latestSnapshot.carbon.toFixed(6);
  document.body.dataset.cameraState = view?.isCameraTransitioning() ? "moving" : "settled";
}

function updateView(hammerPreview = null): void {
  latestSnapshot = application.getSnapshot();
  view?.update(latestSnapshot, hammerPreview, activeStation, temperPreviewC);
  renderState();
}

function setStation(station: ForgeStation): void {
  activeStation = station;
  view?.setStation(station);
  updateView();
}

function materialToStation(materialId: ForgeMaterialPick): void {
  application.applyIntent({ kind: "select-material", materialId });
  application.applyIntent({ kind: "select-workpiece", benchIndex: application.getState().bench.length - 1 });
  setStation("materials");
}

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
    const benchIndex = pickedBenchIndex ?? (latestSnapshot.benchCount === 1 && distance > 110 ? 0 : null);
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
view.setStation("overview");
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
    gesture = { kind: activeStation, target, startedAtMs: performance.now(), startX: x, startY: y };
    return;
  }
  if (activeStation === "weld" && target) {
    gesture = { kind: "weld", target, startedAtMs: performance.now(), startX: x, startY: y };
    return;
  }
  if ((activeStation === "quench-water" || activeStation === "quench-oil") && target) {
    gesture = { kind: "quench", target, startedAtMs: performance.now(), startX: x, startY: y };
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
  if (event.key === "Escape" && activeStation !== "overview") {
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
