import assert from 'node:assert/strict';
import { test } from 'node:test';
import { clampProblemWidth, defaultProblemWidth, problemDividerWidth, problemPaneBounds, problemWidthForKey, readProblemWidth } from './problemPaneLayout';
import { tutorDividerWidth, tutorPaneBounds } from './tutorPaneLayout';

test('a wider problem browser fits desktop and shrinks without losing its preferred width', () => {
  const preferred = readProblemWidth('480');
  assert.equal(defaultProblemWidth, 340);
  assert.equal(clampProblemWidth(preferred, problemPaneBounds(2133)), 480);
  const compact = problemPaneBounds(701);
  assert.equal(clampProblemWidth(preferred, compact), 280);
  assert.equal(clampProblemWidth(preferred, problemPaneBounds(2133)), preferred);
  assert.equal(clampProblemWidth(900, problemPaneBounds(2133)), 560);
  assert.deepEqual(problemPaneBounds(0), { min: 0, max: 0 });
});

test('both sidebar dividers leave canvas space on compact and wide desktops', () => {
  for (const workspaceWidth of [701, 900, 1280, 2133]) {
    const libraryWidth = problemPaneBounds(workspaceWidth).max + problemDividerWidth;
    const tutor = tutorPaneBounds(workspaceWidth, libraryWidth);
    const remaining = workspaceWidth - libraryWidth - tutorDividerWidth;
    assert.ok(remaining - tutor.max >= Math.min(320, remaining * .4));
    assert.ok(tutor.min >= 0);
  }
});

test('invalid browser width preferences use the default and valid widths remain intact', () => {
  for (const raw of [null, '', ' ', 'abc', 'NaN', 'Infinity', '-1', '0', '259', '561']) {
    assert.equal(readProblemWidth(raw), defaultProblemWidth);
  }
  for (const width of [260, 340, 480, 560]) assert.equal(readProblemWidth(String(width)), width);
});

test('keyboard resizing follows the left pane direction and clamps to available space', () => {
  const bounds = problemPaneBounds(1280);
  assert.equal(problemWidthForKey('ArrowRight', 340, bounds), 364);
  assert.equal(problemWidthForKey('ArrowLeft', 340, bounds), 316);
  assert.equal(problemWidthForKey('ArrowRight', 340, bounds, true), 404);
  assert.equal(problemWidthForKey('ArrowLeft', bounds.min, bounds), bounds.min);
  assert.equal(problemWidthForKey('ArrowRight', bounds.max, bounds), bounds.max);
  assert.equal(problemWidthForKey('Home', 340, bounds), bounds.min);
  assert.equal(problemWidthForKey('End', 340, bounds), bounds.max);
  assert.equal(problemWidthForKey('Tab', 340, bounds), undefined);
});
