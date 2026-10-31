export const focusPresets = {
  'sketch-only': { label: 'Sketch only', library: false, tutor: false },
  'sketch-tutor': { label: 'Sketch + Tutor', library: false, tutor: true },
  'problems-sketch': { label: 'Problems + Sketch', library: true, tutor: false },
  'problems-sketch-tutor': { label: 'Problems + Sketch + Tutor', library: true, tutor: true },
} as const;
export type FocusPreset = keyof typeof focusPresets;
export const focusModeKey = 'practice-focus-mode';
export const focusPresetKey = 'practice-focus-preset';

export function readFocusPreset(raw: string | null): FocusPreset {
  return raw && Object.hasOwn(focusPresets, raw) ? raw as FocusPreset : 'sketch-tutor';
}

export function visibleFocusPanes(enabled: boolean, preset: FocusPreset, normal: { library: boolean; tutor: boolean }): { library: boolean; tutor: boolean } {
  return enabled ? { library: focusPresets[preset].library, tutor: focusPresets[preset].tutor } : normal;
}

export function hideFocusPane(preset: FocusPreset, pane: 'library' | 'tutor'): FocusPreset {
  const visible = { ...focusPresets[preset], [pane]: false };
  return visible.library ? 'problems-sketch' : visible.tutor ? 'sketch-tutor' : 'sketch-only';
}
