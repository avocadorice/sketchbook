import assert from "node:assert/strict";
import { test } from "node:test";
import { clampTutorWidth, defaultTutorWidth, readTutorWidth, tutorPaneBounds, tutorWidthForKey } from "./tutorPaneLayout";

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
