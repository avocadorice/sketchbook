export const tutorWidthKey = "practice-tutor-width";
export const defaultTutorWidth = 370;
export const tutorDividerWidth = 8;

export function shouldStackTutor(showTutor: boolean, workspaceWidth: number, workspaceHeight: number, libraryWidth: number): boolean {
  const availableWidth = Math.max(0, workspaceWidth - libraryWidth);
  // Use the space shared by Sketch and Tutor, including in the embedded workspace.
  return showTutor && availableWidth > 0 && workspaceHeight > 0 && (availableWidth < 900 || availableWidth < workspaceHeight);
}

export function tutorPaneHeightBounds(workspaceHeight: number): { min: number; max: number } {
  const available = Math.max(0, workspaceHeight - tutorDividerWidth);
  return { min: Math.floor(Math.min(320, available * .5)), max: Math.floor(available - Math.min(320, available * .4)) };
}

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

export function clampTutorSize(size: number, bounds: { min: number; max: number }): number {
  return Math.max(bounds.min, Math.min(bounds.max, size));
}

export const clampTutorWidth = clampTutorSize;

export function tutorSizeForKey(key: string, size: number, bounds: { min: number; max: number }, shift = false, stacked = false): number | undefined {
  const step = shift ? 64 : 24;
  if (key === (stacked ? "ArrowUp" : "ArrowLeft")) return clampTutorSize(size + step, bounds);
  if (key === (stacked ? "ArrowDown" : "ArrowRight")) return clampTutorSize(size - step, bounds);
  if (key === "Home") return bounds.min;
  if (key === "End") return bounds.max;
}

export const tutorWidthForKey = tutorSizeForKey;
