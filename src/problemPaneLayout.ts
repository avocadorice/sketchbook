export const problemWidthKey = "practice-problems-width";
export const defaultProblemWidth = 340;
export const problemDividerWidth = 8;

export function readProblemWidth(raw: string | null): number {
  const width = Number(raw);
  return raw?.trim() && Number.isFinite(width) && width >= 260 && width <= 560 ? width : defaultProblemWidth;
}

export function problemPaneBounds(workspaceWidth: number): { min: number; max: number } {
  // The tutor adapts to the remaining space; always leave most of the workspace for drawing and tutoring.
  const max = Math.max(0, Math.min(560, Math.floor(workspaceWidth * .4)));
  return { min: Math.min(260, max), max };
}

export function clampProblemWidth(width: number, bounds: { min: number; max: number }): number {
  return Math.max(bounds.min, Math.min(bounds.max, width));
}

export function problemWidthForKey(key: string, width: number, bounds: { min: number; max: number }, shift = false): number | undefined {
  const step = shift ? 64 : 24;
  if (key === "ArrowRight") return clampProblemWidth(width + step, bounds);
  if (key === "ArrowLeft") return clampProblemWidth(width - step, bounds);
  if (key === "Home") return bounds.min;
  if (key === "End") return bounds.max;
}
