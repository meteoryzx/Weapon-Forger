export const PRESS_OPEN_GAP_MM = 120;
export const PRESS_DWELL_LIMIT_MS = 4000;
const CLOSE_SPEED = 180;
const RETURN_SPEED = 240;

/** Time describes one continuous load, never a series of impact events. */
export class ForgePressCycle {
  phase: "idle" | "closing" | "loading" | "settling" | "opening" = "idle";
  private started = 0;
  private height = 0;
  private contactAt = 0;
  private releasedDwell = 0;
  private returnGap = 0;
  get busy(): boolean { return this.phase !== "idle"; }
  begin(now: number, height: number): boolean {
    if (this.busy || !Number.isFinite(height) || height < 0 || height > PRESS_OPEN_GAP_MM) return false;
    this.started = now;
    this.height = height;
    this.contactAt = now + (PRESS_OPEN_GAP_MM - height) / CLOSE_SPEED * 1000;
    this.releasedDwell = 0;
    this.phase = "closing";
    return true;
  }
  tick(now: number): void {
    if (this.phase === "closing" && now >= this.contactAt) this.phase = "loading";
    if (this.phase === "opening" && now - this.started >= (PRESS_OPEN_GAP_MM - this.returnGap) / RETURN_SPEED * 1000) this.phase = "idle";
  }
  dwell(now: number): number {
    return this.phase === "loading" ? Math.min(PRESS_DWELL_LIMIT_MS, Math.max(0, now - this.contactAt)) : this.releasedDwell;
  }
  release(now: number): void {
    this.tick(now);
    if (this.phase === "closing") this.retract(now, this.gap(now));
    else if (this.phase === "loading") {
      this.releasedDwell = this.dwell(now);
      this.phase = "settling";
    }
  }
  retract(now: number, gap: number): void {
    this.returnGap = Math.max(0, Math.min(PRESS_OPEN_GAP_MM, gap));
    this.started = now;
    this.phase = "opening";
  }
  gap(now: number, loadedHeight = this.height): number {
    if (this.phase === "idle") return PRESS_OPEN_GAP_MM;
    if (this.phase === "closing") return Math.max(this.height, PRESS_OPEN_GAP_MM - (now - this.started) / 1000 * CLOSE_SPEED);
    if (this.phase === "opening") return Math.min(PRESS_OPEN_GAP_MM, this.returnGap + (now - this.started) / 1000 * RETURN_SPEED);
    return Math.max(0, Math.min(this.height, loadedHeight));
  }
}
