import assert from "node:assert/strict";
import test from "node:test";
import { ChapterClock, formatElapsed } from "./timer";

test("a restored chapter starts paused and keeps its saved elapsed time", () => {
  const clock = new ChapterClock(12345);
  assert.equal(clock.running, false);
  assert.equal(clock.elapsed(900000), 12345);
  assert.equal(clock.pause(910000), 12345);
});

test("a delayed display tick still measures the full running duration", () => {
  const clock = new ChapterClock(2000);
  clock.start(100);
  assert.equal(clock.elapsed(100), 2000);
  assert.equal(clock.elapsed(61789), 63689);
  assert.equal(clock.pause(62100), 64000);
  assert.equal(clock.running, false);
});

test("pausing and resuming excludes the paused wall-clock gap", () => {
  const clock = new ChapterClock(0);
  clock.start(500);
  assert.equal(clock.pause(1750), 1250);
  assert.equal(clock.elapsed(20000), 1250);
  clock.start(30000);
  assert.equal(clock.pause(32000), 3250);
  assert.equal(clock.pause(99000), 3250);
});

test("starting an already running timer does not reset its running span", () => {
  const clock = new ChapterClock(1000);
  clock.start(100);
  clock.start(900);
  assert.equal(clock.pause(1100), 2000);
});

test("display formatting floors partial seconds and includes hours when needed", () => {
  assert.equal(formatElapsed(0), "00:00");
  assert.equal(formatElapsed(59999), "00:59");
  assert.equal(formatElapsed(61000), "01:01");
  assert.equal(formatElapsed(3599999), "59:59");
  assert.equal(formatElapsed(3600000), "01:00:00");
  assert.equal(formatElapsed(3661000), "01:01:01");
});

test("invalid saved elapsed times cannot create an unusable timer", () => {
  for (const elapsed of [-1, NaN, Infinity]) assert.throws(() => new ChapterClock(elapsed));
});
