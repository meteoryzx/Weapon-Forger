export const POWER_CADENCE_MS = 300;
export const POWER_OPEN_GAP_MM = 120;
const DOWN_MS = 100;
const RETURN_MS = 100;

/** One stroke owns one contact event; slow calculations never queue catch-up blows. */
export class PowerHammerCycle {
  phase: "idle" | "down" | "contact" | "up" = "idle";
  private started = 0;
  private nextStart = 0;
  private contactHeight = 0;

  get busy(): boolean { return this.phase !== "idle"; }
  begin(now: number, height: number): boolean {
    if (this.busy || now < this.nextStart) return false;
    this.started = now;
    this.nextStart = now + POWER_CADENCE_MS;
    this.contactHeight = Math.max(0, Math.min(POWER_OPEN_GAP_MM, height));
    this.phase = "down";
    return true;
  }
  tick(now: number): boolean {
    if (this.phase === "down" && now - this.started >= DOWN_MS) {
      this.phase = "contact";
      return true;
    }
    if (this.phase === "up" && now - this.started >= RETURN_MS) this.phase = "idle";
    return false;
  }
  release(now: number, height = this.contactHeight): void {
    if (this.phase !== "contact") return;
    this.contactHeight = Math.max(0, Math.min(POWER_OPEN_GAP_MM, height));
    this.started = now;
    this.phase = "up";
  }
  gap(now: number): number {
    if (this.phase === "idle") return POWER_OPEN_GAP_MM;
    if (this.phase === "contact") return this.contactHeight;
    if (this.phase === "down") {
      const t = Math.max(0, Math.min(1, (now - this.started) / DOWN_MS));
      return POWER_OPEN_GAP_MM + (this.contactHeight - POWER_OPEN_GAP_MM) * t * t;
    }
    const t = Math.max(0, Math.min(1, (now - this.started) / RETURN_MS));
    return this.contactHeight + (POWER_OPEN_GAP_MM - this.contactHeight) * t;
  }
}
