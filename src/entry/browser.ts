import { DemoFlow, type DemoStage } from "../app/forge-flow.ts";
import { FORGE_RULES, createHammerInfluencePreview, type ForgeSnapshot } from "../forge/index.ts";
import { hammerEnergyForPressDuration } from "../platform/hammer-charge.ts";
import { FurnaceView } from "../render/furnace-view.ts";
import { ForgeBilletView } from "../render/forge-billet-view.ts";

const canvas = document.querySelector<HTMLCanvasElement>("#game")!;
const hudTitle = document.querySelector<HTMLElement>("#hud-title")!;
const hudActions = document.querySelector<HTMLElement>("#hud-actions")!;
const hudHint = document.querySelector<HTMLElement>("#hud-hint")!;
const storyOverlay = document.querySelector<HTMLElement>("#story")!;
const storyText = document.querySelector<HTMLElement>("#story-text")!;
const storyRestart = document.querySelector<HTMLButtonElement>("#story-restart")!;
if (!canvas || !hudTitle || !hudActions || !hudHint || !storyOverlay || !storyText || !storyRestart) {
  throw new Error("Missing a HUD element.");
}

const DEBUG = new URLSearchParams(window.location.search).has("debug");
const flow = new DemoFlow();
let view: FurnaceView | ForgeBilletView | null = null;
let latestSnapshot: ForgeSnapshot | null = null;
let animationFrame = 0;
let periodStartedAtMs = Date.now();
let pressStartedAtMs: number | null = null;
let pressTarget: { sectionIndex: number; faceBias: number } | null = null;

function viewport() {
  return { width: window.innerWidth, height: window.innerHeight, pixelRatio: window.devicePixelRatio };
}

function stageTitle(stage: DemoStage): string {
  switch (stage) {
    case "select": return "选料";
    case "heat": return "加热";
    case "forge": return "锻打";
    case "quench": return "淬火";
    case "grind": return "研磨";
    case "story": return "冒险故事";
  }
}

function stageHint(stage: DemoStage): string {
  switch (stage) {
    case "select": return "选择一种钢坯开始锻造。";
    case "heat": return "点击钢坯送入/取出火炉；入炉越久越亮，取出后越久越暗。完成后点「完成加热」。";
    case "forge": return "点击钢坯落锤，长按蓄力重击；A/D 转面，W/S 送料。完成后点「完成锻打」。";
    case "quench": return "选择淬火介质：水淬更硬但更脆，油淬温和。";
    case "grind": return "点击钢坯刃口研磨，磨出锋利均匀的刃。完成后点「完成研磨」。";
    case "story": return "";
  }
}

function materialLabel(materialId: string): string {
  return materialId === "high-carbon-steel" ? "高碳钢 · 可淬硬但脆" : "低碳钢 · 韧性好";
}

function syncView(): void {
  const needed: "furnace" | "billet" | null = flow.getStage() === "heat" ? "furnace"
    : flow.getStage() === "forge" || flow.getStage() === "quench" || flow.getStage() === "grind" ? "billet"
      : null;
  const current: "furnace" | "billet" | null = view instanceof FurnaceView ? "furnace"
    : view instanceof ForgeBilletView ? "billet" : null;
  if (needed === current) return;
  view?.dispose();
  view = needed === "furnace" ? new FurnaceView(canvas, viewport())
    : needed === "billet" ? new ForgeBilletView(canvas, viewport())
      : null;
}

function renderHud(): void {
  const stage = flow.getStage();
  hudTitle.textContent = stageTitle(stage);
  hudHint.textContent = stageHint(stage);
  hudActions.innerHTML = "";
  const add = (label: string, handler: () => void) => {
    const button = document.createElement("button");
    button.textContent = label;
    button.addEventListener("click", handler);
    hudActions.appendChild(button);
  };
  switch (stage) {
    case "select":
      for (const material of flow.getMaterials()) {
        add(materialLabel(material.id), () => {
          flow.selectMaterial(material.id);
          enterStage();
        });
      }
      break;
    case "heat":
      add("完成加热", () => { flow.advance(); enterStage(); });
      break;
    case "forge":
      add("完成锻打", () => { flow.advance(); enterStage(); });
      break;
    case "quench":
      add("水淬", () => { flow.applyIntent({ kind: "quench", medium: "water" }); flow.advance(); enterStage(); });
      add("油淬", () => { flow.applyIntent({ kind: "quench", medium: "oil" }); flow.advance(); enterStage(); });
      break;
    case "grind":
      add("完成研磨", () => { flow.advance(); enterStage(); });
      break;
    case "story":
      break;
  }
}

function renderStory(): void {
  const story = flow.getStory();
  const weapon = flow.getWeapon();
  if (!story || !weapon) return;
  const lines = [
    `【${story.npcName} 的冒险】`,
    "",
    ...story.events.map((event) => `${event.title}：${event.text}`),
    "",
    `结局：${story.ending.title}——${story.ending.text}`,
  ];
  if (DEBUG) {
    const dims = weapon.dimensions;
    lines.push(
      "",
      `（调试）六维：锋利 ${dims.sharpness.toFixed(2)} · 硬度 ${dims.hardness.toFixed(2)} · 韧性 ${dims.toughness.toFixed(2)} · 重量 ${dims.weight.toFixed(2)} · 平衡 ${dims.balance.toFixed(2)} · 外观 ${dims.appearance.toFixed(2)}`,
      `（调试）特性：${weapon.traits.map((trait) => trait.label).join("、") || "无"}`,
      `（调试）缺陷：${weapon.flaws.map((flaw) => flaw.label).join("、") || "无"}`,
    );
  }
  storyText.textContent = lines.join("\n");
}

function enterStage(): void {
  const stage = flow.getStage();
  syncView();
  latestSnapshot = stage === "heat" || stage === "forge" || stage === "quench" || stage === "grind"
    ? flow.getSnapshot()
    : null;
  if (stage === "heat") periodStartedAtMs = Date.now();
  if (latestSnapshot) {
    canvas.dataset.billetLocation = latestSnapshot.billetLocation;
    if (view instanceof ForgeBilletView) view.update(latestSnapshot);
    if (view instanceof FurnaceView) view.update(latestSnapshot, performance.now());
  }
  renderHud();
  document.body.dataset.stage = stage;
  storyOverlay.style.display = stage === "story" ? "flex" : "none";
  if (stage === "story") renderStory();
}

canvas.addEventListener("pointerdown", (event) => {
  const stage = flow.getStage();
  if (!view || !latestSnapshot) return;
  const bounds = canvas.getBoundingClientRect();
  const x = event.clientX - bounds.left;
  const y = event.clientY - bounds.top;

  if (stage === "heat" && view instanceof FurnaceView) {
    const now = performance.now();
    if (view.isAnimating(now)) return;
    if (!view.pickToggle(x, y)) return;
    const destination = latestSnapshot.billetLocation === "inspection" ? "furnace" : "inspection";
    const elapsedMs = Math.min(Date.now() - periodStartedAtMs, FORGE_RULES.maximumThermalIntentMs);
    latestSnapshot = flow.applyIntent({ kind: "move-billet", destination, elapsedMs });
    canvas.dataset.billetLocation = latestSnapshot.billetLocation;
    periodStartedAtMs = Date.now();
    view.update(latestSnapshot, now);
  } else if (stage === "forge" && view instanceof ForgeBilletView) {
    const target = view.pickHammerTarget(x, y);
    if (!target) return;
    pressStartedAtMs = performance.now();
    pressTarget = target;
    const preview = createHammerInfluencePreview(latestSnapshot, {
      sectionIndex: target.sectionIndex,
      faceBias: target.faceBias,
      energy: 1,
    });
    view.update(latestSnapshot, preview);
  } else if (stage === "grind" && view instanceof ForgeBilletView) {
    const sectionIndex = view.pickSection(x, y);
    if (sectionIndex === null) return;
    latestSnapshot = flow.applyIntent({ kind: "grind", sectionIndex, amount: 0.2 });
    hudHint.textContent = `刃口研磨进度 ${Math.round(latestSnapshot.edgeCoverage * 100)}%（均匀度 ${Math.round(latestSnapshot.edgeEvenness * 100)}%）`;
    view.update(latestSnapshot);
  }
});

function releaseHammer(): void {
  if (pressStartedAtMs === null || pressTarget === null || flow.getStage() !== "forge") {
    pressStartedAtMs = null;
    pressTarget = null;
    return;
  }
  const energy = hammerEnergyForPressDuration(performance.now() - pressStartedAtMs);
  latestSnapshot = flow.applyIntent({
    kind: "hammer",
    sectionIndex: pressTarget.sectionIndex,
    faceBias: pressTarget.faceBias,
    energy,
    lateralBias: 0,
  });
  pressStartedAtMs = null;
  pressTarget = null;
  if (view instanceof ForgeBilletView && latestSnapshot) view.update(latestSnapshot);
}

canvas.addEventListener("pointerup", releaseHammer);
canvas.addEventListener("pointercancel", releaseHammer);

window.addEventListener("keydown", (event) => {
  if (flow.getStage() !== "forge" || !view) return;
  let intent: { kind: "rotate"; quarterTurns: 1 | -1 } | { kind: "feed"; step: 1 | -1 } | null = null;
  switch (event.key.toLowerCase()) {
    case "a": intent = { kind: "rotate", quarterTurns: -1 }; break;
    case "d": intent = { kind: "rotate", quarterTurns: 1 }; break;
    case "w": intent = { kind: "feed", step: -1 }; break;
    case "s": intent = { kind: "feed", step: 1 }; break;
    default: return;
  }
  latestSnapshot = flow.applyIntent(intent);
  if (view instanceof ForgeBilletView && latestSnapshot) view.update(latestSnapshot);
});

storyRestart.addEventListener("click", () => {
  flow.restart();
  enterStage();
});

window.addEventListener("resize", () => view?.resize(viewport()));
window.addEventListener("beforeunload", () => {
  window.cancelAnimationFrame(animationFrame);
  view?.dispose();
});

const renderFrame = (nowMs: number) => {
  if (flow.getStage() === "heat" && view instanceof FurnaceView) {
    view.update(flow.getSnapshot(Date.now() - periodStartedAtMs), nowMs);
  }
  animationFrame = window.requestAnimationFrame(renderFrame);
};
animationFrame = window.requestAnimationFrame(renderFrame);

enterStage();
