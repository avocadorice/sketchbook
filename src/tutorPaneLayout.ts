export const tutorWidthKey = "practice-tutor-width";
export const defaultTutorWidth = 370;
export const tutorDividerWidth = 8;

export function readTutorWidth(raw: string | null): number {
  const width = Number(raw);
  return raw?.trim() && Number.isFinite(width) && width >= 300 ? width : defaultTutorWidth;
}

export function tutorPaneBounds(workspaceWidth: number, libraryWidth: number): { min: number; max: number } {
  const available = Math.max(0, workspaceWidth - libraryWidth - tutorDividerWidth);
  // Keep room for the canvas, including on compact desktop layouts.
  const max = Math.floor(available - Math.min(320, available * .4));
  return { min: Math.min(300, max), max };
}

export function clampTutorWidth(width: number, bounds: { min: number; max: number }): number {
  return Math.max(bounds.min, Math.min(bounds.max, width));
}

export function tutorWidthForKey(key: string, width: number, bounds: { min: number; max: number }, shift = false): number | undefined {
  const step = shift ? 64 : 24;
  if (key === "ArrowLeft") return clampTutorWidth(width + step, bounds);
  if (key === "ArrowRight") return clampTutorWidth(width - step, bounds);
  if (key === "Home") return bounds.min;
  if (key === "End") return bounds.max;
}
