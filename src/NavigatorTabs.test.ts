import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { NavigatorTabs, navigatorSectionForKey, type NavigatorSection } from './NavigatorTabs';
import { ProblemPaneResizer } from './ProblemPaneResizer';

test('navigation tabs identify their panels and keep only the selected tab in the tab order', () => {
  for (const section of ['problems', 'attempt'] as NavigatorSection[]) {
    const markup = renderToStaticMarkup(createElement(NavigatorTabs, { section, onChange() {} }));
    assert.match(markup, /role="tablist" aria-label="Problem navigation"/);
    assert.match(markup, new RegExp(`id="navigator-tab-${section}" role="tab" aria-selected="true" aria-controls="navigator-panel-${section}" tabindex="0"`));
    assert.equal((markup.match(/aria-selected="false"/g) ?? []).length, 1);
    assert.equal((markup.match(/tabindex="-1"/g) ?? []).length, 1);
    assert.match(markup, /Problems/);
    assert.match(markup, /Current problem/);
  }
});

test('navigation supports arrow wrapping and Home/End without intercepting other keys', () => {
  assert.equal(navigatorSectionForKey('ArrowRight', 'problems'), 'attempt');
  assert.equal(navigatorSectionForKey('ArrowLeft', 'problems'), 'attempt');
  assert.equal(navigatorSectionForKey('ArrowRight', 'attempt'), 'problems');
  assert.equal(navigatorSectionForKey('ArrowLeft', 'attempt'), 'problems');
  assert.equal(navigatorSectionForKey('Home', 'attempt'), 'problems');
  assert.equal(navigatorSectionForKey('End', 'problems'), 'attempt');
  assert.equal(navigatorSectionForKey('Tab', 'problems'), undefined);
});

test('the problems divider exposes its controlled pane and resizing bounds to the keyboard', () => {
  const markup = renderToStaticMarkup(createElement(ProblemPaneResizer, { width: 340, bounds: { min: 260, max: 560 }, onResize() {} }));
  assert.match(markup, /role="separator" tabindex="0"/);
  assert.match(markup, /aria-controls="design-problems-pane"/);
  assert.match(markup, /aria-valuemin="260" aria-valuemax="560" aria-valuenow="340"/);
});
