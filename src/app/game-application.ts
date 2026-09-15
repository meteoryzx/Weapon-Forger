import {
  applyForgeIntent,
  createForgeFacts,
  createForgeSnapshot,
  createForgeState,
  FORGE_RULES,
  type ForgeFacts,
  previewThermalState,
  type ForgeIntent,
  type ForgeMaterial,
  type ForgeSnapshot,
  type ForgeState,
  type CutOperation,
  type SurfaceHammerOperation,
} from "../forge/index.ts";
import { solidEnvelope, workpieceGrindingSolids, workpieceSolids } from "../forge/solid-geometry.ts";
import type { AbrasiveUpdate } from "./grind-update.ts";

export class GameApplication {
  private state: ForgeState;
  private previewState: ForgeState;
  private previewElapsedMs = 0;
  private preparedCut: { source: ForgeState; result: ForgeState; operation: CutOperation } | null = null;
  private cutGeneration = 0;
  private furnaceTemperatureC: number = FORGE_RULES.furnaceGasTemperatureC;

  async prepareCut(operation: CutOperation, evaluate: (state: ForgeState, operation: CutOperation) => Promise<ForgeState>): Promise<boolean> {
    this.preparedCut = null;
    const generation=++this.cutGeneration;
    const source = this.state;
    const result = await evaluate(source, operation);
    if (source !== this.state || generation!==this.cutGeneration) return false;
    this.preparedCut = { source, result, operation };
    return true;
  }

  cancelPreparedCut(): void { this.preparedCut = null; this.cutGeneration++; }

  async applySurfaceHammer(operation:SurfaceHammerOperation,evaluate:(state:ForgeState,op:SurfaceHammerOperation)=>Promise<ForgeState>):Promise<ForgeSnapshot> {
    const source=this.state,result=await evaluate(source,operation);
    if(this.state!==source)throw new Error("工件已经改变，请重新瞄准。");
    this.state=result;this.previewState=result;this.previewElapsedMs=0;
    this.cancelPreparedCut();return this.getSnapshot();
  }

  commitPreparedCut(operation: CutOperation): ForgeSnapshot {
    const prepared = this.preparedCut;
    if (!prepared || prepared.source !== this.state || JSON.stringify(operation) !== JSON.stringify(prepared.operation)) {
      throw new Error("Cut preview is stale. Position the workpiece again.");
    }
    this.state = prepared.result;
    this.previewState = this.state;
    this.previewElapsedMs = 0;
    this.preparedCut = null;
    return this.getSnapshot();
  }

  constructor(material?: ForgeMaterial) {
    this.state = createForgeState(material ? { material } : {});
    this.previewState = this.state;
  }

  getState(): ForgeState {
    return this.state;
  }

  prepareGrinding(): void {
    const piece=this.state.workpiece;
    if(piece.geometry.solids)return;
    const solids=piece.sections.some(s=>s.plasticStrain>0)?workpieceSolids(piece):workpieceGrindingSolids(piece);
    const geometry={...piece.geometry,solids};
    this.state={...this.state,workpiece:{...piece,geometry:{...geometry,outline:solidEnvelope(geometry)}}};
    this.previewState=this.state;this.previewElapsedMs=0;
  }

  commitGrinding(source: ForgeState, update: AbrasiveUpdate): boolean {
    if(this.state!==source || !update.changed)return false;
    const solids=Array.from(update.order,i=>i<0?update.solids[-i-1]!:source.workpiece.geometry.solids![i]!);
    const sections=source.workpiece.sections.map((s,i)=>update.sections.find(c=>c.index===i)?.section??s);
    this.state={...source,workpiece:{...source.workpiece,sections,geometry:{...source.workpiece.geometry,solids,outline:update.outline}},operations:[...source.operations,update.operation]};
    this.previewState=this.state;this.previewElapsedMs=0;this.cancelPreparedCut();return true;
  }

  getFacts(): ForgeFacts {
    return createForgeFacts(this.state);
  }

  getSnapshot(elapsedMs = 0): ForgeSnapshot {
    const boundedElapsed = Math.min(Math.max(elapsedMs, 0), FORGE_RULES.maximumThermalIntentMs);
    if (boundedElapsed < this.previewElapsedMs) {
      this.previewState = this.state;
      this.previewElapsedMs = 0;
    }
    const delta = boundedElapsed - this.previewElapsedMs;
    if (delta > 0) {
      this.previewState = previewThermalState(this.previewState, delta, this.furnaceTemperatureC);
      this.previewElapsedMs = boundedElapsed;
    }
    return createForgeSnapshot(this.previewState);
  }

  applyIntent(intent: ForgeIntent): ForgeSnapshot {
    this.state = applyForgeIntent(this.state, intent);
    this.previewState = this.state;
    this.previewElapsedMs = 0;
    return this.getSnapshot();
  }

  // Freezes the currently previewed thermal state into the committed state,
  // used when the player leaves the furnace stage so forging starts hot.
  commitPreview(): void {
    this.state = this.previewState;
    this.previewElapsedMs = 0;
  }

  setFurnaceTemperature(temperatureC: number): void {
    this.furnaceTemperatureC = Math.max(80, Math.min(FORGE_RULES.furnaceGasTemperatureC, temperatureC));
  }
}
