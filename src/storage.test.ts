import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { IDBFactory, IDBObjectStore } from "fake-indexeddb";
import type { BinaryFiles } from "@excalidraw/excalidraw/types";
import { checkpoint, createAttempt, sceneAt } from "./history.ts";
import { loadProject, parseImport, saveProject, storageLocation, StorageConflictError, type Project } from "./storage.ts";

beforeEach(() => { globalThis.indexedDB = new IDBFactory(); });

function project(): Project {
  const scene = { elements: [{ id: "api", type: "rectangle", x: 10, y: 20 }], backgroundColor: "#fff" };
  const attempt = checkpoint(createAttempt("Design a chargeback system."), scene, "Intake", "Accept a request.");
  return { attempt, draft: { index: null, scene: { ...sceneAt(attempt), elements: [...scene.elements,
    { id: "db", type: "rectangle", x: 200, y: 20 }] }, title: "Storage", notes: "Still drawing." },
  files: { photo: { id: "photo" as BinaryFiles[string]["id"], mimeType: "image/png",
    dataURL: "data:image/png;base64,AA==" as BinaryFiles[string]["dataURL"], created: 123 } } };
}

test("reload preserves checkpoints, unfinished draft and image files", async () => {
  assert.equal(await loadProject(), null);
  const original = project();
  const revision = await saveProject(original, null);
  assert.deepEqual(await loadProject(), { project: original, revision });
  original.draft.notes = "Unsaved change.";
  assert.equal((await loadProject())!.project.draft.notes, "Still drawing.");
});

test("competing tabs cannot overwrite the same revision", async () => {
  const base = project();
  const revision = await saveProject(base, null);
  const left = structuredClone(base); left.draft.notes = "First tab.";
  const right = structuredClone(base); right.draft.notes = "Second tab.";
  const results = await Promise.allSettled([saveProject(left, revision), saveProject(right, revision)]);
  assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
  const rejected = results.find(result => result.status === "rejected") as PromiseRejectedResult;
  assert.ok(rejected.reason instanceof StorageConflictError);
  const winner = results[0].status === "fulfilled" ? left : right;
  const saved = (await loadProject())!;
  assert.deepEqual(saved.project, winner);
  await assert.rejects(saveProject(base, revision), StorageConflictError);
  assert.deepEqual(await loadProject(), saved);
});

test("write failure leaves the prior project and revision intact", async context => {
  const base = project();
  const revision = await saveProject(base, null);
  const put = context.mock.method(IDBObjectStore.prototype, "put", () => {
    throw new DOMException("Storage quota reached.", "QuotaExceededError");
  });
  const changed = structuredClone(base); changed.draft.notes = "Not saved.";
  await assert.rejects(saveProject(changed, revision), { name: "QuotaExceededError" });
  put.mock.restore();
  assert.deepEqual(await loadProject(), { project: base, revision });
});

test("a successful put is not reported saved when its transaction later aborts", async context => {
  const base = project();
  const revision = await saveProject(base, null);
  const originalPut = IDBObjectStore.prototype.put;
  const put = context.mock.method(IDBObjectStore.prototype, "put", function (this: IDBObjectStore, ...args: Parameters<IDBObjectStore["put"]>) {
    const request = originalPut.apply(this, args);
    request.onsuccess = () => this.transaction.abort();
    return request;
  });
  const changed = structuredClone(base); changed.draft.notes = "Rolled back.";
  await assert.rejects(saveProject(changed, revision), /previous saved attempt is kept/);
  put.mock.restore();
  assert.deepEqual(await loadProject(), { project: base, revision });
});

test("invalid draft chapter is rejected without replacing saved work", async () => {
  const base = project();
  const revision = await saveProject(base, null);
  const invalid = structuredClone(base); invalid.draft.index = 1;
  await assert.rejects(saveProject(invalid, revision), /existing checkpoint/);
  assert.deepEqual(await loadProject(), { project: base, revision });
});

test("reload preserves optional timing without inventing it for older projects", async () => {
  const original = project();
  const oldRevision = await saveProject(original, null);
  assert.equal(Object.hasOwn((await loadProject())!.project, "timing"), false);
  original.timing = { enabled: true, chaptersMs: [1234.5], draftMs: 5678 };
  const revision = await saveProject(original, oldRevision);
  assert.deepEqual(await loadProject(), { project: original, revision });
  original.timing.chaptersMs[0] = 9999;
  assert.equal((await loadProject())!.project.timing!.chaptersMs[0], 1234.5);
});

test("disabled timing keeps recorded durations across reloads", async () => {
  const original = project();
  original.timing = { enabled: false, chaptersMs: [8000], draftMs: 0 };
  const revision = await saveProject(original, null);
  assert.deepEqual(await loadProject(), { project: original, revision });
});

test("invalid timing cannot replace a saved project", async () => {
  const original = project();
  const revision = await saveProject(original, null);
  for (const timing of [
    null,
    { enabled: "yes", chaptersMs: [0], draftMs: 0 },
    { enabled: true, chaptersMs: [], draftMs: 0 },
    { enabled: true, chaptersMs: [0, 0], draftMs: 0 },
    { enabled: true, chaptersMs: [-1], draftMs: 0 },
    { enabled: true, chaptersMs: [Infinity], draftMs: 0 },
    { enabled: true, chaptersMs: [0], draftMs: -1 },
    { enabled: true, chaptersMs: [0], draftMs: NaN },
  ]) {
    await assert.rejects(saveProject({ ...original, timing } as Project, revision), /Saved timing/);
    assert.deepEqual(await loadProject(), { project: original, revision });
  }
});

test("the host server, when present, stores the shared attempt with the same revision check", async t => {
  const calls: { method: string; body?: { expected_revision: string | null; project: Project } }[] = [];
  let saved: { revision: string; project: Project } | null = null;
  const host = { "X-Nexo-Practice-Store": "host" };
  globalThis.window = { location: { href: "http://mac.local:8090/static/practice/index.html" } } as never;
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    assert.equal(url, "http://mac.local:8090/static/practice/api/project");
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method, body });
    if (method === "GET") return saved ? Response.json(saved, { headers: host }) : new Response(null, { status: 204, headers: host });
    if ((saved?.revision ?? null) !== body.expected_revision) return Response.json({ error: "stale" }, { status: 409, headers: host });
    saved = { revision: `r${calls.length}`, project: body.project };
    return Response.json({ revision: saved.revision }, { headers: host });
  }) as typeof fetch;
  t.after(() => { delete (globalThis as { window?: unknown }).window; });

  assert.equal(await loadProject(), null);
  assert.equal(storageLocation(), "host");
  const first = await saveProject(project(), null);
  assert.deepEqual(await loadProject(), { project: project(), revision: first });
  await assert.rejects(saveProject(project(), null), StorageConflictError);
  assert.deepEqual(calls.map(call => call.method), ["GET", "PUT", "GET", "PUT"]);
  assert.deepEqual(await indexedDB.databases(), []);
});

test("without the host server, the attempt stays in browser storage", async t => {
  globalThis.window = { location: { href: "http://localhost:8080/static/practice/index.html" } } as never;
  globalThis.fetch = (async () => new Response("not found", { status: 404 })) as typeof fetch;
  t.after(() => { delete (globalThis as { window?: unknown }).window; });
  assert.equal(await loadProject(), null);
  assert.equal(storageLocation(), "browser");
  const revision = await saveProject(project(), null);
  assert.deepEqual(await loadProject(), { project: project(), revision });
});

test("an exported browser attempt imports with or without its revision wrapper", () => {
  const original = project();
  assert.deepEqual(parseImport(JSON.stringify({ revision: "abc", project: original })), original);
  assert.deepEqual(parseImport(JSON.stringify(original)), original);
  assert.throws(() => parseImport("{}"));
});

test("per-checkpoint drafts survive reload and must point at an existing checkpoint", async () => {
  const saved = project();
  saved.drafts = { next: { scene: saved.draft.scene, title: "Later", notes: "" },
    0: { scene: { elements: [], backgroundColor: "#fff" }, title: "Intake v2", notes: "unsaved" } };
  const revision = await saveProject(saved, null);
  assert.deepEqual((await loadProject())!.project.drafts, saved.drafts);
  const bad = structuredClone(saved); bad.drafts = { 5: saved.drafts[0]! };
  await assert.rejects(saveProject(bad, revision), /existing checkpoint/);
});

test("past attempts round-trip and reject nesting", async () => {
  const saved = project();
  const { attempt, draft } = project();
  saved.past = [{ savedAt: 1_700_000_000_000, attempt, draft, timing: { enabled: true, chaptersMs: [5000], draftMs: 0 } }];
  const revision = await saveProject(saved, null);
  assert.deepEqual((await loadProject())!.project.past, saved.past);
  const nested = structuredClone(saved) as unknown as { past: Record<string, unknown>[] };
  nested.past[0]!.past = [];
  await assert.rejects(saveProject(nested as unknown as Project, revision), /past attempt is invalid/);
});
