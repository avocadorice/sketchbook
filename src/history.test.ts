import assert from "node:assert/strict";
import test from "node:test";
import {
  checkpoint, createAttempt, deleteChapter, moveChapter, normalizeScene, parseAttempt, sceneAt,
  skippedChanges, updateChapter,
  type Attempt, type Element, type Scene,
} from "./history";

const scene = (...elements: Element[]): Scene => ({ elements, backgroundColor: "#ffffff" });
const box = (id: string, extra: Record<string, unknown> = {}): Element => ({ id, x: 0, y: 0,
  width: 100, height: 50, label: id, ...extra });
const first = (): Attempt => checkpoint(createAttempt("Design a chargeback system."),
  scene(box("api")), "Start with the API", "The customer files a chargeback.");
const at = (attempt: Attempt, id: string, index?: number) => sceneAt(attempt, index).elements
  .find(element => element.id === id);

test("an attempt begins with just the prompt and supports a notes-only checkpoint", () => {
  const attempt = createAttempt("Design something.");
  assert.equal(attempt.prompt, "Design something.");
  assert.deepEqual(sceneAt(attempt), scene());
  const saved = checkpoint(attempt, scene(), "Clarify requirements", "Ask about scale.");
  assert.deepEqual(saved.chapters[0].delta, { added: [], removed: [], changed: [] });
  assert.equal(saved.chapters[0].notes, "Ask about scale.");
  assert.deepEqual(sceneAt(saved), scene());
  assert.equal(attempt.chapters.length, 0);
});

test("earlier label edits flow through later moves and independent later additions", () => {
  const one = first();
  const two = checkpoint(one, scene(box("api", { x: 250 }), box("db")), "Persist", "Save the row.");
  const three = checkpoint(two, scene(box("api", { x: 250 }), box("db", { y: 150 }), box("worker")),
    "Build a batch", "Claim rows atomically.");
  const changed = updateChapter(three, 0, scene(box("api", { label: "Chargeback API" })),
    "Accept requests", "Name the public endpoint.");
  assert.equal(at(changed, "api", 0)?.label, "Chargeback API");
  assert.equal(at(changed, "api", 1)?.label, "Chargeback API");
  assert.equal(at(changed, "api", 2)?.label, "Chargeback API");
  assert.equal(at(changed, "api", 2)?.x, 250);
  assert.equal(at(changed, "db", 2)?.y, 150);
  assert.ok(at(changed, "worker", 2));
  assert.deepEqual(changed.chapters.slice(1), three.chapters.slice(1));
  assert.equal(three.chapters[0].title, "Start with the API");
  assert.equal(changed.chapters[1].notes, "Save the row.");
});

test("a later explicit override of the same field wins", () => {
  const two = checkpoint(first(), scene(box("api", { label: "Public gateway", x: 20 })),
    "Gateway", "Give this layer a new name.");
  const changed = updateChapter(two, 0, scene(box("api", { label: "Chargeback API", y: 99 })),
    "Start", "New label.");
  assert.equal(at(changed, "api", 0)?.label, "Chargeback API");
  assert.equal(at(changed, "api", 1)?.label, "Public gateway");
  assert.equal(at(changed, "api", 1)?.y, 99);
});

test("field removal propagates unless a later chapter explicitly sets it", () => {
  const one = checkpoint(createAttempt("Prompt"), scene(box("a", { link: "https://example.com" })),
    "One", "");
  const two = checkpoint(one, scene(box("a", { x: 2, link: "https://example.com" })), "Two", "");
  const without = updateChapter(two, 0, scene(box("a")), "One", "No link.");
  assert.equal(Object.hasOwn(at(without, "a")!, "link"), false);
  const override = checkpoint(two, scene(box("a", { x: 2, link: "https://example.org" })), "Three", "");
  assert.equal(at(updateChapter(override, 0, scene(box("a")), "One", ""), "a")?.link,
    "https://example.org");
});

test("deleting an earlier element does not resurrect it through a later field patch", () => {
  const two = checkpoint(first(), scene(box("api", { x: 100 }), box("db")), "Two", "");
  const changed = updateChapter(two, 0, scene(), "Start again", "Remove the API.");
  assert.deepEqual(sceneAt(changed, 0), scene());
  assert.deepEqual(sceneAt(changed).elements.map(item => item.id), ["db"]);
});

test("earlier new elements persist forward while explicit later deletions still win", () => {
  const one = checkpoint(createAttempt("Prompt"), scene(box("a"), box("b")), "One", "");
  const two = checkpoint(one, scene(box("a", { x: 100 })), "Two", "Delete B.");
  const changed = updateChapter(two, 0, scene(box("a"), box("new"), box("b", { label: "Changed" })),
    "One", "");
  assert.deepEqual(sceneAt(changed).elements.map(item => item.id), ["a", "new"]);
  assert.equal(at(changed, "a")?.x, 100);
});

test("an explicit later addition can restore an ID after its absence", () => {
  const two = checkpoint(first(), scene(), "Remove", "");
  const three = checkpoint(two, scene(box("api", { label: "Restored" })), "Undo removal", "");
  const changed = updateChapter(three, 0, scene(), "Start empty", "");
  assert.deepEqual(sceneAt(changed, 1), scene());
  assert.equal(at(changed, "api", 2)?.label, "Restored");
});

test("layer order propagates and later explicit order keeps newly inherited elements", () => {
  const one = checkpoint(createAttempt("Prompt"), scene(box("a"), box("b")), "One", "");
  const two = checkpoint(one, scene(box("b"), box("a")), "Reorder", "");
  assert.deepEqual(two.chapters[1].delta.order, ["b", "a"]);
  const changed = updateChapter(two, 0, scene(box("a"), box("new"), box("b")), "One", "");
  assert.deepEqual(sceneAt(changed).elements.map(item => item.id), ["b", "new", "a"]);
  const independent = checkpoint(one, scene(box("a", { x: 1 }), box("b")), "Move", "");
  assert.equal(independent.chapters[1].delta.order, undefined);
  const reordered = updateChapter(independent, 0, scene(box("b"), box("a")), "One", "");
  assert.deepEqual(sceneAt(reordered).elements.map(item => item.id), ["b", "a"]);
});

test("new element insertion records its layer placement but appending needs no order patch", () => {
  const one = first();
  const inserted = checkpoint(one, scene(box("db"), box("api")), "Behind", "");
  assert.deepEqual(inserted.chapters[1].delta.order, ["db", "api"]);
  assert.deepEqual(sceneAt(inserted).elements.map(item => item.id), ["db", "api"]);
  const appended = checkpoint(one, scene(box("api"), box("db")), "In front", "");
  assert.equal(appended.chapters[1].delta.order, undefined);
});

test("canvas backgrounds follow the same explicit override rule", () => {
  const one = checkpoint(createAttempt("Prompt"), { ...scene(box("a")), backgroundColor: "#eeeeee" },
    "One", "");
  const two = checkpoint(one, { ...scene(box("a", { x: 1 })), backgroundColor: "#eeeeee" }, "Two", "");
  const changed = updateChapter(two, 0, { ...scene(box("a")), backgroundColor: "#000000" }, "One", "");
  assert.equal(sceneAt(changed).backgroundColor, "#000000");
  const three = checkpoint(two, { ...scene(box("a", { x: 1 })), backgroundColor: "#123456" }, "Three", "");
  assert.equal(sceneAt(updateChapter(three, 0,
    { ...scene(box("a")), backgroundColor: "#000000" }, "One", "")).backgroundColor, "#123456");
});

test("deleting a chapter removes its contribution and preserves later chapter notes", () => {
  const one = first();
  const two = checkpoint(one, scene(box("api", { x: 100 }), box("db")), "Database", "Second notes.");
  const three = checkpoint(two, scene(box("api", { x: 100 }), box("db", { y: 99 }), box("worker")),
    "Worker", "Third notes.");
  const deleted = deleteChapter(three, 1);
  assert.equal(deleted.chapters.length, 2);
  assert.equal(deleted.chapters[1].title, "Worker");
  assert.equal(deleted.chapters[1].notes, "Third notes.");
  assert.equal(at(deleted, "api")?.x, 0);
  assert.equal(at(deleted, "db"), undefined);
  assert.ok(at(deleted, "worker"));
  assert.equal(deleteChapter(first(), 0).chapters.length, 0);
  assert.deepEqual(sceneAt(deleteChapter(first(), 0)), scene());
});

test("bookkeeping changes never create phantom drawing deltas, while seed changes do", () => {
  const one = checkpoint(createAttempt("Prompt"), scene(box("a", {
    version: 3, versionNonce: 9, updated: 500, index: "a0", seed: 10,
  })), "One", "");
  const two = checkpoint(one, scene(box("a", {
    version: 9, versionNonce: 30, updated: 999, index: "b1", seed: 10,
  })), "Two", "");
  assert.deepEqual(two.chapters[1].delta, { added: [], removed: [], changed: [] });
  assert.deepEqual(sceneAt(two), scene(box("a", { seed: 10 })));
  const three = checkpoint(two, scene(box("a", { seed: 100 })), "New stroke", "");
  assert.deepEqual(three.chapters[2].delta.changed, [{ id: "a", set: { seed: 100 }, unset: [] }]);
});

test("binding and geometry fields persist without accidental deep merges", () => {
  const a = box("a", { boundElements: [{ id: "text", type: "text" }], groupIds: ["g"] });
  const text = box("text", { containerId: "a", text: "Label", originalText: "Label" });
  const arrow = box("edge", { startBinding: { elementId: "a", focus: 0, gap: 1 },
    endBinding: null, points: [[0, 0], [100, 30]], frameId: null });
  const one = checkpoint(createAttempt("Prompt"), scene(a, text, arrow), "One", "");
  const two = checkpoint(one, scene(a, { ...text, x: 50 }, arrow), "Move", "");
  const edited = updateChapter(two, 0, scene(a,
    { ...text, text: "Chargeback", originalText: "Chargeback" }, arrow), "One", "");
  assert.equal(at(edited, "text")?.text, "Chargeback");
  assert.equal(at(edited, "text")?.x, 50);
  assert.deepEqual(at(edited, "edge"), arrow);
  assert.deepEqual(at(edited, "a")?.boundElements, a.boundElements);
});

test("restored empty binding lists do not mark an unchanged drawing dirty", () => {
  const saved = scene(box("a", { boundElements: null }));
  const restored = scene(box("a", { boundElements: [] }));
  assert.equal(JSON.stringify(normalizeScene(saved)), JSON.stringify(normalizeScene(restored)));
  const one = checkpoint(createAttempt("Prompt"), saved, "One", "");
  const two = checkpoint(one, restored, "Two", "");
  assert.deepEqual(two.chapters[1].delta, { added: [], removed: [], changed: [] });
  assert.deepEqual(sceneAt(two), normalizeScene(restored));
  assert.equal(Object.hasOwn(normalizeScene(scene(box("a"))).elements[0], "boundElements"), false);
});

test("reload preserves deltas, title and notes, including field removals", () => {
  const one = checkpoint(createAttempt("Prompt"), scene(box("a", { link: "source" })), "One", "First");
  const two = checkpoint(one, scene(box("a", { x: 8 })), "Two", "Second");
  const restored = parseAttempt(JSON.parse(JSON.stringify(two)));
  assert.deepEqual(restored, two);
  assert.deepEqual(sceneAt(restored), sceneAt(two));
  assert.deepEqual(restored.chapters[1].delta.changed[0].unset, ["link"]);
});

test("input scenes, prior attempts and materialized scenes never share mutable drawing data", () => {
  const input = scene(box("a", { points: [[1, 2]] }));
  const one = checkpoint(createAttempt("Prompt"), input, "One", "Notes");
  (input.elements[0].points as number[][])[0][0] = 999;
  assert.deepEqual(at(one, "a")?.points, [[1, 2]]);
  const view = sceneAt(one);
  (view.elements[0].points as number[][])[0][0] = 888;
  assert.deepEqual(at(one, "a")?.points, [[1, 2]]);
  const two = checkpoint(one, sceneAt(one), "Two", "");
  two.chapters[0].delta.added[0].x = 1000;
  assert.equal(at(one, "a")?.x, 0);
  const parsed = parseAttempt(one);
  parsed.chapters[0].delta.added[0].x = 2000;
  assert.equal(at(one, "a")?.x, 0);
});

test("field equality ignores object key insertion order and undefined optional fields", () => {
  const one = checkpoint(createAttempt("Prompt"), scene(box("a", { customData: { a: 1, b: 2 } })),
    "One", "");
  const two = checkpoint(one, scene(box("a", { customData: { b: 2, a: 1 }, optional: undefined })),
    "Two", "");
  assert.deepEqual(two.chapters[1].delta, { added: [], removed: [], changed: [] });
  assert.equal(JSON.stringify(normalizeScene(scene({ id: "a", x: 1, customData: { b: 2, a: 1 } }))),
    JSON.stringify(normalizeScene(scene({ customData: { a: 1, b: 2 }, x: 1, id: "a" }))));
});

test("invalid persisted formats and conflicting IDs are rejected without changing their input", () => {
  for (const value of [null, {}, { ...first(), version: 2 }, { ...first(), prompt: 1 },
    { ...first(), extra: true }, { ...first(), chapters: [{ title: "Missing delta", notes: "" }] }]) {
    assert.throws(() => parseAttempt(value));
  }
  for (const delta of [
    { added: [box("a"), box("a")], removed: [], changed: [] },
    { added: [box("a")], removed: ["a"], changed: [] },
    { added: [], removed: [], changed: [{ id: "a", set: { id: "b" }, unset: [] }] },
    { added: [], removed: [], changed: [{ id: "a", set: { x: 1 }, unset: ["x"] }] },
    { added: [], removed: [], changed: [], order: ["a", "a"] },
  ]) assert.throws(() => parseAttempt({ version: 1, prompt: "Prompt",
    chapters: [{ title: "One", notes: "", delta }] }));
  assert.throws(() => normalizeScene(scene(box("same"), box("same"))));
  assert.throws(() => checkpoint(first(), scene(), "x".repeat(201), ""));
  assert.throws(() => checkpoint(first(), scene(), "Title", "x".repeat(20001)));
});

test("invalid chapter selection cannot silently append, overwrite or delete", () => {
  const attempt = first();
  for (const index of [-2, 1, 0.5, NaN]) {
    assert.throws(() => sceneAt(attempt, index));
    assert.throws(() => updateChapter(attempt, index, scene(), "Title", ""));
    assert.throws(() => deleteChapter(attempt, index));
  }
  assert.deepEqual(sceneAt(attempt, -1), scene());
  assert.equal(attempt.chapters.length, 1);
});

test("moving a chapter moves when its additions appear and keeps later chapters' own changes", () => {
  const box = (id: string, x = 0) => ({ id, type: "rectangle", x });
  let attempt = createAttempt("Design.");
  attempt = checkpoint(attempt, { elements: [box("api")], backgroundColor: "#fff" }, "API", "a");
  attempt = checkpoint(attempt, { elements: [box("api"), box("kafka")], backgroundColor: "#fff" }, "Kafka", "k");
  attempt = checkpoint(attempt, { elements: [box("api"), box("kafka"), box("batch")], backgroundColor: "#fff" }, "Batch", "b");
  const moved = moveChapter(attempt, 2, 0);
  assert.deepEqual(moved.chapters.map(chapter => chapter.title), ["Batch", "API", "Kafka"]);
  assert.deepEqual(sceneAt(moved, 0).elements.map(item => item.id), ["batch"]);
  assert.deepEqual(sceneAt(moved).elements.map(item => item.id).sort(), ["api", "batch", "kafka"]);
  assert.deepEqual(attempt.chapters.map(chapter => chapter.title), ["API", "Kafka", "Batch"]);
  assert.throws(() => moveChapter(attempt, 0, 3));
});

test("edits to elements created later are skipped after a move but restored by moving back", () => {
  let attempt = createAttempt("Design.");
  attempt = checkpoint(attempt, { elements: [{ id: "api", type: "rectangle", x: 0 }], backgroundColor: "#fff" }, "API", "");
  attempt = checkpoint(attempt, { elements: [{ id: "api", type: "rectangle", x: 50 }, { id: "db", type: "rectangle", x: 9 }], backgroundColor: "#fff" }, "DB and move", "");
  const moved = moveChapter(attempt, 1, 0);
  assert.equal(skippedChanges(moved, 0), 1);
  assert.deepEqual(sceneAt(moved, 0).elements.map(item => item.id), ["db"]);
  assert.equal(sceneAt(moved).elements.find(item => item.id === "api")!.x, 0);
  const back = moveChapter(moved, 0, 1);
  assert.deepEqual(sceneAt(back), sceneAt(attempt));
  assert.equal(skippedChanges(attempt, 1), 0);
});
