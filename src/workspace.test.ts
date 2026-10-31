import assert from 'node:assert/strict';
import { test } from 'node:test';
import { IDBFactory } from 'fake-indexeddb';
import { checkpoint, createAttempt, sceneAt } from './history';
import { newestProblems, organizeProblems, renameProblem } from './problems';
import { loadProject, parseImport, saveProject, type Project } from './storage';
import { tutorContext } from './tutorContext';
import { createSketchProject, deleteProblem, isSketchProject, legacyView, openProblem, shelveProject } from './workspace';

const scene = (text: string) => ({ elements: [{ id: 'label', type: 'text', text, x: 10, y: 10, width: 20, height: 20 }], backgroundColor: '#123456' });
function legacyProject(): Project {
  let attempt = createAttempt('Legacy payments');
  for (let i = 0; i < 3; i++) {
    attempt = checkpoint(attempt, scene(`saved-${i}`), `Step ${i + 1}`, `note-${i}`);
    attempt.chapters[i].id = `checkpoint-${i}`;
  }
  return organizeProblems({ drawingId: 'legacy-conversation', attempt, draft: { id: 'checkpoint-1', index: 1, scene: scene('active draft'), title: 'Draft title', notes: 'Draft notes' },
    drafts: { '0': { id: 'checkpoint-0', scene: scene('earlier draft'), title: 'Earlier', notes: 'Earlier notes' }, next: { id: 'unfinished', scene: scene('future unfinished'), title: 'Unfinished', notes: 'Unfinished notes' } },
    timing: { enabled: false, chaptersMs: [20, 40, 60], draftMs: 80 },
    files: { image: { id: 'image', mimeType: 'image/png', dataURL: 'data:image/png;base64,AA==', created: 1 } as Project['files'][string] } });
}

test('new problems have one independent autosaved canvas and retain it across reloads and navigation', async () => {
  globalThis.indexedDB = new IDBFactory();
  const first = createSketchProject('Payments');
  first.draft.scene = scene('first sketch');
  first.problems![0].companies = ['Queues'];
  const revision = await saveProject(first, null);
  const second = createSketchProject('Payments');
  const next = { ...second, problems: [...first.problems!, ...second.problems!], past: shelveProject(first) };
  assert.notEqual(first.problemId, next.problemId);
  assert.notEqual(first.drawingId, next.drawingId);
  assert.notEqual(first.draft.id, next.draft.id);
  assert.equal(isSketchProject(next), true);
  await saveProject(next, revision);
  const loaded = (await loadProject())!.project;
  const reopened = openProblem(loaded, 0);
  assert.equal(isSketchProject(reopened), true);
  assert.equal(reopened.problemId, first.problemId);
  assert.equal(reopened.drawingId, first.drawingId);
  assert.equal(reopened.draft.id, first.draft.id);
  assert.deepEqual(reopened.draft.scene, first.draft.scene);
  assert.deepEqual(reopened.problems, loaded.problems);
  assert.equal(reopened.past?.[0].drawingId, second.drawingId);
  assert.equal(new Set([reopened, ...reopened.past!].map(entry => entry.problemId)).size, 2);
  for (const entry of [reopened, ...reopened.past!]) {
    assert.equal(entry.attemptNumber, 1);
    assert.equal(entry.attempt.chapters.length, 0);
    assert.equal(entry.draft.index, null);
  }
  const context = tutorContext(reopened, null);
  assert.deepEqual(context.priorCheckpoints, []);
  assert.equal(context.checkpointId, first.draft.id);
  assert.deepEqual(parseImport(JSON.stringify(reopened)), reopened);
});

test('legacy content stays read only without losing images, timing, drafts, notes or conversation IDs', async () => {
  globalThis.indexedDB = new IDBFactory();
  const legacy = legacyProject();
  legacy.problems![0].intuition = 'Keep hidden legacy notes';
  const before = structuredClone(legacy);
  const fresh = createSketchProject();
  const next = { ...fresh, problems: [...legacy.problems!, ...fresh.problems!], files: legacy.files, past: shelveProject(legacy) };
  const reopened = openProblem(next, 0);
  assert.equal(isSketchProject(reopened), false);
  assert.equal(reopened.drawingId, legacy.drawingId);
  for (const key of ['attempt', 'draft', 'drafts', 'timing', 'files'] as const) assert.deepEqual(reopened[key], legacy[key]);
  assert.equal(reopened.problems?.find(p => p.id === legacy.problemId)?.intuition, 'Keep hidden legacy notes');
  await saveProject(reopened, null);
  const loaded = (await loadProject())!.project;
  assert.deepEqual(loaded, parseImport(JSON.stringify(reopened)));
  assert.equal(isSketchProject(loaded), false);
  assert.deepEqual(legacy, before);
});

test('archive navigation materializes saved checkpoints and drafts without modifying the stored entry', () => {
  const project = legacyProject(); const before = structuredClone(project);
  const saved = legacyView(project, { index: 0 });
  assert.deepEqual(saved.draft.scene, sceneAt(project.attempt, 0));
  assert.equal(saved.draft.notes, 'note-0');
  const earlierDraft = legacyView(project, { index: 0, draft: true });
  assert.deepEqual(earlierDraft.draft.scene, project.drafts!['0'].scene);
  assert.equal(earlierDraft.draft.id, 'checkpoint-0');
  const activeDraft = legacyView(project, { index: 1, draft: true });
  assert.deepEqual(activeDraft.draft, project.draft);
  const unfinished = legacyView(project, { index: null, draft: true });
  assert.deepEqual(unfinished.draft.scene, project.drafts!.next.scene);
  assert.equal(unfinished.draft.id, 'unfinished');
  assert.equal(legacyView(project, null), project);
  assert.equal(legacyView(project, { index: 50 }), project);
  assert.deepEqual(project, before);
  const context = tutorContext(earlierDraft, null);
  assert.deepEqual(context.priorCheckpointIds, []);
  assert.equal(context.checkpointId, 'checkpoint-0');
  assert.doesNotMatch(JSON.stringify(context), /saved-1|saved-2|active draft|future unfinished/);
  assert.deepEqual(tutorContext(saved, { x: 100, y: 100, width: 10, height: 10 }).scene.elements, []);
});

test('imports cannot make legacy history editable by adding a sketch marker', () => {
  const project = legacyProject();
  project.problems![0].workspace = 'sketch';
  assert.equal(isSketchProject(project), false);
  const fresh = createSketchProject();
  assert.equal(legacyView(fresh, { index: 0 }), fresh);
  const duplicate = { ...fresh, past: [{ ...shelveProject(fresh)[0], drawingId: 'other-drawing' }] };
  assert.equal(isSketchProject(duplicate), false);
  assert.throws(() => parseImport(JSON.stringify({ ...fresh, problems: [{ ...fresh.problems![0], workspace: 'unknown' }] })), /Invalid problem workspace/);
});

test('newest problems stay first across opening, renaming and export/import without changing saved order', () => {
  const first = createSketchProject('First');
  const second = createSketchProject('Second');
  const third = createSketchProject('Third');
  const library = { ...third, problems: [...first.problems!, ...second.problems!, ...third.problems!],
    past: [...shelveProject(second), ...shelveProject(first)] };
  const order = [third.problemId, second.problemId, first.problemId];
  assert.deepEqual(newestProblems(library).map(p => p.id), order);
  const opened = openProblem(library, 1);
  const renamed = renameProblem(opened, 'Renamed first');
  assert.deepEqual(newestProblems(parseImport(JSON.stringify(renamed))).map(p => p.id), order);
  assert.deepEqual(library.problems!.map(p => p.id), [...order].reverse());
});

test('deleting an archived problem removes all its attempts and preserves the active canvas and shared images', async () => {
  globalThis.indexedDB = new IDBFactory();
  const legacy = legacyProject();
  const current = createSketchProject('Current');
  current.draft.scene = scene('latest unsaved drawing');
  const library = { ...current, files: legacy.files, problems: [...legacy.problems!, ...current.problems!],
    past: [...shelveProject(legacy), { ...shelveProject(legacy)[0], drawingId: 'another-conversation' }] };
  const before = structuredClone(library);
  const deleted = deleteProblem(library, legacy.problemId!);
  assert.equal(deleted.draft, library.draft);
  assert.equal(deleted.drawingId, current.drawingId);
  assert.equal(deleted.files, library.files);
  assert.deepEqual(deleted.past ?? [], []);
  assert.deepEqual(deleted.problems, current.problems);
  await saveProject(deleted, null);
  assert.deepEqual((await loadProject())!.project, parseImport(JSON.stringify(deleted)));
  assert.deepEqual(library, before);
  assert.equal(deleteProblem(library, 'unknown'), library);
});

test('deleting the active problem opens the newest remaining one without changing legacy checkpoints or conversation IDs', () => {
  const oldest = createSketchProject('Oldest');
  const legacy = legacyProject();
  const current = createSketchProject('Current');
  const library = { ...current, files: legacy.files, problems: [...oldest.problems!, ...legacy.problems!, ...current.problems!],
    past: [...shelveProject(oldest), ...shelveProject(legacy)] };
  const before = structuredClone(library);
  const deleted = deleteProblem(library, current.problemId!);
  assert.equal(deleted.problemId, legacy.problemId);
  assert.equal(deleted.drawingId, legacy.drawingId);
  assert.equal(isSketchProject(deleted), false);
  for (const key of ['attempt', 'draft', 'drafts', 'timing', 'files'] as const) assert.deepEqual(deleted[key], legacy[key]);
  assert.equal(deleted.past?.length, 1);
  assert.equal(deleted.past![0].drawingId, oldest.drawingId);
  assert.deepEqual(parseImport(JSON.stringify(deleted)), deleted);
  assert.deepEqual(library, before);
});

test('deleting the last problem creates an independent empty canvas that can be saved and reloaded', () => {
  const only = legacyProject();
  const deleted = deleteProblem(only, only.problemId!);
  assert.notEqual(deleted.problemId, only.problemId);
  assert.notEqual(deleted.drawingId, only.drawingId);
  assert.equal(isSketchProject(deleted), true);
  assert.equal(deleted.problems?.length, 1);
  assert.deepEqual(deleted.draft.scene.elements, []);
  assert.equal(deleted.files, only.files);
  assert.deepEqual(parseImport(JSON.stringify(deleted)), deleted);
});
