import assert from 'node:assert/strict';
import { test } from 'node:test';
import { focusPresets, hideFocusPane, readFocusPreset, visibleFocusPanes, type FocusPreset } from './focusMode';

test('Focus layouts show exactly the selected panes and restore every normal pane combination', () => {
  const expected = {
    'sketch-only': { library: false, tutor: false },
    'sketch-tutor': { library: false, tutor: true },
    'problems-sketch': { library: true, tutor: false },
    'problems-sketch-tutor': { library: true, tutor: true },
  };
  for (const library of [false, true]) for (const tutor of [false, true]) {
    const normal = Object.freeze({ library, tutor });
    for (const preset of Object.keys(focusPresets) as FocusPreset[]) {
      assert.deepEqual(visibleFocusPanes(true, preset, normal), expected[preset]);
      assert.deepEqual(visibleFocusPanes(false, preset, normal), { library, tutor });
    }
  }
});

test('hiding a Focus pane selects the remaining layout without affecting normal preferences', () => {
  assert.equal(hideFocusPane('problems-sketch-tutor', 'library'), 'sketch-tutor');
  assert.equal(hideFocusPane('problems-sketch-tutor', 'tutor'), 'problems-sketch');
  assert.equal(hideFocusPane('sketch-tutor', 'tutor'), 'sketch-only');
  assert.equal(hideFocusPane('problems-sketch', 'library'), 'sketch-only');
});

test('Focus restores valid presets and safely defaults invalid preferences', () => {
  for (const preset of Object.keys(focusPresets)) assert.equal(readFocusPreset(preset), preset);
  for (const raw of [null, '', 'unknown', 'constructor', '__proto__', 'code-only']) assert.equal(readFocusPreset(raw), 'sketch-tutor');
});
