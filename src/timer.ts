/** Measure running spans; display ticks never determine how much time passed. */
export class ChapterClock {
  private startedAt: number | null = null;

  constructor(private total: number) {
    if (!Number.isFinite(total) || total < 0) throw new Error("Elapsed time must be nonnegative.");
  }

  get running(): boolean { return this.startedAt !== null; }

  start(now: number): void {
    if (this.startedAt === null) this.startedAt = now;
  }

  elapsed(now: number): number {
    return this.total + (this.startedAt === null ? 0 : Math.max(0, now - this.startedAt));
  }

  pause(now: number): number {
    this.total = this.elapsed(now);
    this.startedAt = null;
    return this.total;
  }
}

export function formatElapsed(elapsedMs: number): string {
  const seconds = Math.max(0, Math.floor(elapsedMs / 1000));
  const hours = Math.floor(seconds / 3600);
  const parts = [Math.floor(seconds / 60) % 60, seconds % 60];
  if (hours) parts.unshift(hours);
  return parts.map(part => String(part).padStart(2, "0")).join(":");
}
