import { FORGE_MATERIALS, type ForgeMaterial, type ForgeSnapshotWorkpiece } from "../forge/index.ts";
import { GameApplication } from "./game-application.ts";

export const MATERIAL_RACK_PAGE_SIZE = 4;

// Browsing is UI state. Only confirmation or taking an owned piece changes forge state.
export class MaterialSelection {
  private candidate: ForgeMaterial | null = null;
  private acquiredCount = 0;
  private readonly rackWorkpieceIds = new Set<string>();

  constructor(private application: GameApplication | null = null) {}

  getCandidate(): ForgeMaterial | null {
    return this.candidate;
  }

  getAcquiredCount(): number {
    return this.acquiredCount;
  }

  getTableWorkpieceIds(): readonly string[] {
    return this.getPieces()
      .map((piece) => piece.workpieceId)
      .filter((workpieceId) => !this.rackWorkpieceIds.has(workpieceId));
  }

  isOnTable(workpieceId: string): boolean {
    return this.getPieces().some((piece) => piece.workpieceId === workpieceId)
      && !this.rackWorkpieceIds.has(workpieceId);
  }

  inspect(materialId: string): void {
    const material = FORGE_MATERIALS.find((entry) => entry.id === materialId);
    if (!material) throw new Error(`Unknown material: ${materialId}.`);
    this.candidate = material;
  }

  cancel(): void {
    this.candidate = null;
  }

  confirm(): GameApplication | null {
    if (!this.candidate) return null;
    if (!this.application) {
      this.application = new GameApplication(this.candidate);
    } else {
      this.application.applyIntent({ kind: "select-material", materialId: this.candidate.id });
    }
    this.candidate = null;
    this.acquiredCount += 1;
    return this.application;
  }

  getPieces(): readonly ForgeSnapshotWorkpiece[] {
    if (!this.application) return [];
    const snapshot = this.application.getSnapshot();
    return [snapshot, ...snapshot.bench].sort((a, b) => a.workpieceId.localeCompare(b.workpieceId, "en", { numeric: true }));
  }

  take(workpieceId: string): boolean {
    if (!this.application) return false;
    const state = this.application.getState();
    if (state.workpiece.id === workpieceId) {
      this.rackWorkpieceIds.delete(workpieceId);
      return true;
    }
    const benchIndex = state.bench.findIndex((piece) => piece.id === workpieceId);
    if (benchIndex < 0) return false;
    this.application.applyIntent({ kind: "select-workpiece", benchIndex });
    this.rackWorkpieceIds.delete(workpieceId);
    return true;
  }

  returnCurrentToRack(): boolean {
    if (!this.application) return false;
    const workpieceId = this.application.getState().workpiece.id;
    if (this.rackWorkpieceIds.has(workpieceId)) return false;
    this.rackWorkpieceIds.add(workpieceId);
    return true;
  }
}
