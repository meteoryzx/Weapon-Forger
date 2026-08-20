import {
  SPRING_STEEL,
  createHammerInfluencePreview,
  type ForgeSnapshot,
} from "../forge/index.ts";
import { GameApplication } from "../app/game-application.ts";
import { hammerEnergyForPressDuration } from "../platform/hammer-charge.ts";
import { ForgeBilletView, type ForgeMaterialPick, type ForgeStation } from "../render/forge-billet-view.ts";

const canvas = document.querySelector<HTMLCanvasElement>("#game")!;
const hudTitle = document.querySelector<HTMLElement>("#hud-title")!;
const hudHint = document.querySelector<HTMLElement>("#hud-hint")!;
const hudState = document.querySelector<HTMLElement>("#hud-state")!;

// The browser entry is an input adapter. All material facts still flow through ForgeIntent.
const application = new GameApplication(SPRING_STEEL);

let view: ForgeBilletView | null = null;
let latestSnapshot: ForgeSnapshot = application.getSnapshot();
let activeStation: ForgeStation = "anvil";
let pressStartedAtMs: number | null = null;
let pressTarget: { sectionIndex: number; faceBias: number } | null = null;
let gestureTarget: { sectionIndex: number; startedAtMs: number; startX: number; startY: number } | null = null;
let heatingStartedAtMs: number | null = null;
let heatingFrame: number | null = null;

const stationCopy: Record<ForgeStation, { readonly title: string; readonly hint: string }> = {
  materials: { title: "材料架 · 选料", hint: "点击一块材料，把它放到工作台上。" },
  furnace: { title: "火炉 · 加热", hint: "按住炉膛，让工件升温；松开后取出。" },
  anvil: { title: "铁砧 · 锤击", hint: "点击钢坯落锤；A/D 转面，W/S 送料。" },
  cut: { title: "切割台 · 切割", hint: "在钢坯上拖过要切开的截面。" },
  weld: { title: "焊合台 · 焊合", hint: "先用切割或选料得到第二块工件，再点击焊合台。" },
  "quench-water": { title: "水槽 · 淬火", hint: "把红热工件送入水槽，点击水槽完成淬火。" },
  "quench-oil": { title: "油槽 · 淬火", hint: "把红热工件送入油槽，点击油槽完成淬火。" },
  temper: { title: "回火炉 · 回火", hint: "点击回火炉，以当前工件状态记录回火温度。" },
  grind: { title: "磨石 · 研磨", hint: "沿钢坯长度拖动，拖动越长，研磨量越大。" },
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
  const copy = stationCopy[activeStation];
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
  hudTitle.textContent = copy.title;
  hudHint.textContent = copy.hint;
  hudState.textContent = [
    `${materialLabels[latestSnapshot.materialId] ?? latestSnapshot.materialId} · 当前工件 ${latestSnapshot.workpieceId}`,
    `温度 ${latestSnapshot.averageTemperatureC.toFixed(0)}℃`,
    `层数 ${latestSnapshot.layerCount} · 碳 ${latestSnapshot.carbon.toFixed(2)}`,
    `工作台 ${latestSnapshot.benchCount} 块 · 操作 ${state.operations.length}`,
    `锤击 ${operationCounts.hammer ?? 0} · 切割 ${operationCounts.cut ?? 0} · 焊合 ${operationCounts.weld ?? 0}`,
    `淬火 ${latestSnapshot.quenchMedium ?? "未做"} · 回火 ${latestSnapshot.temperTemperatureC ?? "未做"} · 研磨 ${Math.round(latestSnapshot.edgeCoverage * 100)}%`,
    `损伤 ${Math.round(damage * 100)}% · 规则 ${latestSnapshot.parameterVersion}`,
  ].join(" · ");
  document.body.dataset.stage = "forge-mvp";
  document.body.dataset.activeStation = activeStation;
  document.body.dataset.operationCount = String(state.operations.length);
  document.body.dataset.completedVerbs = completedVerbs.join(",");
  document.body.dataset.verbCount = String(completedVerbs.length);
  document.body.dataset.temperatureC = latestSnapshot.averageTemperatureC.toFixed(2);
  document.body.dataset.benchCount = String(latestSnapshot.benchCount);
}

function updateView(hammerPreview = null): void {
  latestSnapshot = application.getSnapshot();
  view?.update(latestSnapshot, hammerPreview, activeStation);
  renderState();
}

function setStation(station: ForgeStation): void {
  activeStation = station;
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
    const elapsedMs = performance.now() - heatingStartedAtMs;
    latestSnapshot = application.getSnapshot(elapsedMs);
    view?.update(latestSnapshot, null, activeStation);
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
  latestSnapshot = application.applyIntent({ kind: "move-billet", destination: "inspection", elapsedMs });
  updateView();
}

function releaseHammer(): void {
  if (pressStartedAtMs === null || pressTarget === null) return;
  const energy = hammerEnergyForPressDuration(performance.now() - pressStartedAtMs);
  application.applyIntent({
    kind: "hammer",
    sectionIndex: pressTarget.sectionIndex,
    faceBias: pressTarget.faceBias,
    energy,
  });
  pressStartedAtMs = null;
  pressTarget = null;
  updateView();
}

function releaseGesture(endX: number, endY: number): void {
  if (gestureTarget === null) return;
  const elapsedMs = performance.now() - gestureTarget.startedAtMs;
  if (activeStation === "cut") {
    if (gestureTarget.sectionIndex > 0 && gestureTarget.sectionIndex < latestSnapshot.sections.length) {
      application.applyIntent({ kind: "cut", sectionIndex: gestureTarget.sectionIndex });
    }
  } else if (activeStation === "grind") {
    const dragDistance = Math.hypot(endX - gestureTarget.startX, endY - gestureTarget.startY);
    const amount = Math.min(1, Math.max(0.08, (dragDistance + elapsedMs * 0.08) / 260));
    application.applyIntent({ kind: "grind", sectionIndex: gestureTarget.sectionIndex, amount });
  }
  gestureTarget = null;
  updateView();
}

function applyStationClick(station: ForgeStation): void {
  activeStation = station;
  switch (station) {
    case "furnace":
      updateView();
      startHeating();
      return;
    case "weld":
      if (latestSnapshot.benchCount > 0) application.applyIntent({ kind: "weld", benchIndex: 0 });
      updateView();
      return;
    case "quench-water":
      application.applyIntent({ kind: "quench", medium: "water" });
      updateView();
      return;
    case "quench-oil":
      application.applyIntent({ kind: "quench", medium: "oil" });
      updateView();
      return;
    case "temper":
      application.applyIntent({ kind: "temper", temperatureC: 220 });
      updateView();
      return;
    default:
      updateView();
  }
}

view = new ForgeBilletView(canvas, viewport());
updateView();

canvas.addEventListener("pointerdown", (event) => {
  if (!view) return;
  canvas.setPointerCapture(event.pointerId);
  const bounds = canvas.getBoundingClientRect();
  const x = event.clientX - bounds.left;
  const y = event.clientY - bounds.top;
  const material = view.pickMaterial(x, y);
  if (material) {
    materialToStation(material);
    return;
  }
  const station = view.pickStation(x, y);
  if (station) {
    applyStationClick(station);
    return;
  }

  const billetTarget = view.pickHammerTarget(x, y);
  if (billetTarget && activeStation !== "anvil" && activeStation !== "cut" && activeStation !== "grind") {
    setStation("anvil");
    return;
  }

  if (activeStation === "anvil") {
    const target = billetTarget;
    if (!target) return;
    pressStartedAtMs = performance.now();
    pressTarget = target;
    view.update(latestSnapshot, createHammerInfluencePreview(latestSnapshot, {
      sectionIndex: target.sectionIndex,
      faceBias: target.faceBias,
      energy: 1,
    }), activeStation);
    return;
  }

  if (activeStation === "cut" || activeStation === "grind") {
    const target = billetTarget;
    if (target) gestureTarget = { sectionIndex: target.sectionIndex, startedAtMs: performance.now(), startX: x, startY: y };
  }
});

canvas.addEventListener("pointerup", (event) => {
  if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
  if (heatingStartedAtMs !== null) stopHeating();
  else if (pressStartedAtMs !== null) releaseHammer();
  else if (gestureTarget !== null) {
    const bounds = canvas.getBoundingClientRect();
    releaseGesture(event.clientX - bounds.left, event.clientY - bounds.top);
  }
});

canvas.addEventListener("pointercancel", () => {
  stopHeating();
  pressStartedAtMs = null;
  pressTarget = null;
  gestureTarget = null;
  updateView();
});

window.addEventListener("keydown", (event) => {
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

window.addEventListener("resize", () => view?.resize(viewport()));
window.addEventListener("beforeunload", () => {
  stopHeating();
  view?.dispose();
});
