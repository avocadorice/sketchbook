import assert from "node:assert/strict";
import test from "node:test";
import { draftKey, draftsAfterDelete, rekeyDrafts, type SavedDraft } from "./drafts.ts";

const draft = (title: string): SavedDraft => ({ scene: { elements: [], backgroundColor: "#fff" }, title, notes: "" });

test("drafts follow their checkpoint when positions change", () => {
  const drafts = { next: draft("n"), 0: draft("a"), 2: draft("c") };
  assert.equal(draftKey(null), "next");
  assert.equal(draftKey(2), "2");
  const swapped = rekeyDrafts(drafts, index => index === 0 ? 2 : index === 2 ? 0 : index);
  assert.deepEqual(Object.keys(swapped).sort(), ["0", "2", "next"]);
  assert.equal(swapped["2"]!.title, "a");
  assert.equal(swapped["0"]!.title, "c");
});

test("deleting a checkpoint drops its draft and shifts later ones", () => {
  const after = draftsAfterDelete({ next: draft("n"), 0: draft("a"), 1: draft("b"), 2: draft("c") }, 1);
  assert.deepEqual(Object.fromEntries(Object.entries(after).map(([key, value]) => [key, value.title])),
    { next: "n", 0: "a", 1: "c" });
});
