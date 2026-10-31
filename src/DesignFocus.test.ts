import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement, createRef } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { FocusToolbar } from './DesignFocus';
import { focusPresets, type FocusPreset } from './focusMode';

test('every Focus layout keeps layout selection and exit accessible without checkpoint controls', () => {
  for (const preset of Object.keys(focusPresets) as FocusPreset[]) {
    const markup = renderToStaticMarkup(createElement(FocusToolbar, {
      preset, onPresetChange() {}, onExit() {}, exitButton: createRef<HTMLButtonElement>(),
      context: 'URL shortener',
    }));
    assert.match(markup, /aria-label="Focus controls"/);
    assert.match(markup, /aria-label="Focus layout"/);
    assert.match(markup, new RegExp(`value="${preset}" selected=""`));
    assert.equal((markup.match(/<option /g) ?? []).length, 4);
    assert.match(markup, /URL shortener/);
    assert.doesNotMatch(markup, /Save checkpoint|Save changes/);
    assert.match(markup, /aria-label="Exit Focus mode">Exit Focus<\/button>/);
  }
});

test('archived checkpoints remain read only in Focus mode', () => {
  const markup = renderToStaticMarkup(createElement(FocusToolbar, {
    preset: 'sketch-only', onPresetChange() {}, onExit() {}, exitButton: createRef<HTMLButtonElement>(),
    context: 'Read only · Checkpoint 2',
  }));
  assert.match(markup, /Read only · Checkpoint 2/);
  assert.doesNotMatch(markup, /Save changes|Save checkpoint/);
  assert.match(markup, /<button aria-label="Exit Focus mode">Exit Focus<\/button>/);
});
