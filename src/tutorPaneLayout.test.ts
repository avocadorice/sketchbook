import assert from "node:assert/strict";
import { test } from "node:test";
import { clampTutorSize, clampTutorWidth, defaultTutorWidth, readTutorWidth, shouldStackTutor, tutorDividerWidth, tutorPaneBounds, tutorPaneHeightBounds, tutorSizeForKey, tutorWidthForKey } from "./tutorPaneLayout";
import { focusPresets, visibleFocusPanes, type FocusPreset } from "./focusMode";
import { clampProblemWidth, defaultProblemWidth, problemDividerWidth, problemPaneBounds } from "./problemPaneLayout";

test("visible tutors stack in tall and narrow workspaces and return to columns on wide windows", () => {
  for (const [width, height, libraryWidth, expected] of [
    [1745, 875, 0, false], [1080, 1850, 0, true], [925, 1695, 0, true],
    [800, 600, 0, true], [390, 750, 0, true], [1280, 950, 348, true],
    [1745, 875, 348, false], [900, 700, 0, false],
  ] as const) {
    assert.equal(shouldStackTutor(true, width, height, libraryWidth), expected);
    assert.equal(shouldStackTutor(false, width, height, libraryWidth), false, 'hidden tutors never reserve a bottom row');
  }
  for (const [width, height] of [[0, 1000], [1080, 0], [0, 0]]) {
    assert.equal(shouldStackTutor(true, width, height, 0), false);
  }
});

test("normal and Focus pane combinations adapt to the space left by the problems pane", () => {
  for (const focus of [false, true]) for (const library of [false, true]) for (const tutor of [false, true]) {
    for (const preset of Object.keys(focusPresets) as FocusPreset[]) {
      const visible = visibleFocusPanes(focus, preset, { library, tutor });
      const libraryWidth = visible.library ? 348 : 0;
      // Showing Problems can turn a wide workspace into a sketch/tutor stack.
      assert.equal(shouldStackTutor(visible.tutor, 1200, 800, libraryWidth), visible.tutor && visible.library);
      assert.equal(shouldStackTutor(visible.tutor, 800, 600, libraryWidth), visible.tutor);
      assert.equal(shouldStackTutor(visible.tutor, 1080, 1850, libraryWidth), visible.tutor);
      assert.equal(shouldStackTutor(visible.tutor, 1745, 800, libraryWidth), false);
      const phoneLibraryWidth = visible.library ? clampProblemWidth(defaultProblemWidth, problemPaneBounds(390)) + problemDividerWidth : 0;
      assert.equal(shouldStackTutor(visible.tutor, 390, 650, phoneLibraryWidth), visible.tutor);
    }
  }
});

test("vertical tutor resizing leaves usable canvas space at portrait and compact heights", () => {
  for (const height of [0, 400, 600, 750, 1000, 1850]) {
    const bounds = tutorPaneHeightBounds(height);
    const available = Math.max(0, height - tutorDividerWidth);
    assert.ok(bounds.min >= 0 && bounds.min <= bounds.max);
    assert.ok(available - bounds.max >= Math.min(320, available * .4));
    assert.equal(clampTutorSize(-100, bounds), bounds.min);
    assert.equal(clampTutorSize(3000, bounds), bounds.max);
    assert.ok(clampTutorSize(available * .4, bounds) <= available);
  }
});

test("stacked keyboard resizing follows Up/Down and ignores horizontal arrows", () => {
  const bounds = tutorPaneHeightBounds(1800);
  assert.equal(tutorSizeForKey('ArrowUp', 600, bounds, false, true), 624);
  assert.equal(tutorSizeForKey('ArrowDown', 600, bounds, false, true), 576);
  assert.equal(tutorSizeForKey('ArrowUp', 600, bounds, true, true), 664);
  assert.equal(tutorSizeForKey('ArrowUp', bounds.max, bounds, false, true), bounds.max);
  assert.equal(tutorSizeForKey('ArrowDown', bounds.min, bounds, false, true), bounds.min);
  assert.equal(tutorSizeForKey('Home', 600, bounds, false, true), bounds.min);
  assert.equal(tutorSizeForKey('End', 600, bounds, false, true), bounds.max);
  for (const key of ['ArrowLeft', 'ArrowRight', 'Tab']) assert.equal(tutorSizeForKey(key, 600, bounds, false, true), undefined);
});

test("the tutor can expand beyond its old cap while preserving canvas space", () => {
  const bounds = tutorPaneBounds(1694, 270);
  assert.equal(clampTutorWidth(650, bounds), 650);
  assert.equal(bounds.max, 1096);
  assert.equal(clampTutorWidth(2000, bounds), bounds.max);
  assert.equal(clampTutorWidth(50, bounds), 300);
  assert.equal(tutorPaneBounds(1694, 0).max, bounds.max + 270);
});

test("a saved wide tutor fits smaller windows and remains available when space returns", () => {
  const preferred = readTutorWidth("900");
  const compact = tutorPaneBounds(701, 200);
  assert.equal(clampTutorWidth(preferred, compact), compact.max);
  assert.ok(701 - 200 - 8 - compact.max >= (701 - 200 - 8) * .4);
  assert.equal(clampTutorWidth(preferred, tutorPaneBounds(1694, 270)), preferred);
  assert.deepEqual(tutorPaneBounds(0, 270), { min: 0, max: 0 });
});

test("missing or invalid width preferences fall back without affecting saved projects", () => {
  for (const raw of [null, "", " ", "abc", "NaN", "Infinity", "-1", "0", "299"]) {
    assert.equal(readTutorWidth(raw), defaultTutorWidth);
  }
  assert.equal(readTutorWidth("650"), 650);
});

test("keyboard resizing widens to the left and respects both limits", () => {
  const bounds = tutorPaneBounds(1694, 270);
  assert.equal(tutorWidthForKey("ArrowLeft", 500, bounds), 524);
  assert.equal(tutorWidthForKey("ArrowRight", 500, bounds), 476);
  assert.equal(tutorWidthForKey("ArrowLeft", 500, bounds, true), 564);
  assert.equal(tutorWidthForKey("ArrowLeft", bounds.max, bounds), bounds.max);
  assert.equal(tutorWidthForKey("ArrowRight", bounds.min, bounds), bounds.min);
  assert.equal(tutorWidthForKey("Home", 500, bounds), bounds.min);
  assert.equal(tutorWidthForKey("End", 500, bounds), bounds.max);
  assert.equal(tutorWidthForKey("Tab", 500, bounds), undefined);
});
