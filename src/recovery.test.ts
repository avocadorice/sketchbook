import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAttempt, sceneAt } from './history';
import { recoverProject } from './recovery';
import { loadProject, saveProject, StorageConflictError, parseImport, type Project } from './storage';
import { IDBFactory } from 'fake-indexeddb';
import { createSketchProject, isSketchProject, openProblem } from './workspace';
function project(): Project {
  const attempt = createAttempt('Payments');
  return { schemaVersion: 2, problemId: 'payments', problems: [{ id: 'payments', title: 'Payments' }], drawingId: 'drawing', attemptNumber: 1, attempt,
    draft: { id: 'next', index: null, scene: sceneAt(attempt), title: '', notes: '' }, files: {} };
}
test('stale retry recovers the latest revision and preserves both concurrent drafts', async () => {
  globalThis.indexedDB = new IDBFactory();
  const base = project(); const revision = await saveProject(base, null);
  const remote = structuredClone(base); remote.draft.notes = 'Other window';
  await saveProject(remote, revision);
  const local = structuredClone(base); local.draft.notes = 'This window';
  await assert.rejects(saveProject(local, revision), StorageConflictError);
  const latest = (await loadProject())!;
  const recovered = recoverProject(local, latest.project, base);
  assert.equal(recovered.draft.notes, 'This window');
  assert.notEqual(recovered.drawingId, base.drawingId);
  assert.equal(recovered.attemptNumber, 2);
  assert.equal(recovered.past?.[0].draft.notes, 'Other window');
  assert.equal(recovered.past?.[0].drawingId, base.drawingId);
  const savedRevision = await saveProject(recovered, latest.revision);
  assert.deepEqual((await loadProject())?.project, parseImport(JSON.stringify(recovered)));
  assert.ok(savedRevision);
  assert.deepEqual(base, project());
});
test('unchanged stale window uses the saved attempt without creating duplicates', () => {
  const base = project(); const remote = structuredClone(base);
  remote.draft.notes = 'Latest sketch'; remote.problems![0].companies = ['Google'];
  const recovered = recoverProject(base, remote, base);
  assert.equal(recovered.draft.notes, 'Latest sketch');
  assert.equal(recovered.drawingId, remote.drawingId);
  assert.deepEqual(recovered.problems, remote.problems);
  assert.equal(recovered.past?.length, 0);
});
test('independent attempt changes retain their original IDs and new library entries', () => {
  const base = project();
  const remote = project(); remote.problems!.push({ id: 'queues', title: 'Queues' });
  remote.past = [{ problemId: 'queues', drawingId: 'other', attemptNumber: 1, savedAt: 1, attempt: createAttempt('Queues'), draft: structuredClone(base.draft) }];
  const local = project(); local.draft.notes = 'Local drawing';
  const recovered = recoverProject(local, remote, base);
  assert.equal(recovered.drawingId, base.drawingId);
  assert.equal(recovered.draft.notes, 'Local drawing');
  assert.equal(recovered.past?.[0].drawingId, 'other');
  assert.equal(recovered.problems?.length, 2);
});
test('conflicting problem metadata keeps each version attached to its attempts', () => {
  const base = project(); const local = project(); const remote = project();
  local.problems![0].intuition = 'Local intuition';
  remote.problems![0].intuition = 'Remote intuition';
  const recovered = recoverProject(local, remote, base);
  assert.equal(recovered.problems?.find(p => p.id === recovered.problemId)?.intuition, 'Local intuition');
  assert.equal(recovered.problems?.find(p => p.id === 'payments')?.intuition, 'Remote intuition');
  assert.equal(recovered.past?.[0].problemId, 'payments');
  assert.equal(recovered.past?.[0].drawingId, 'drawing');
});
test('image ID collisions keep both images and remap recovered scene references', () => {
  const base = project(); const local = project(); const remote = project();
  const file = { id: 'photo', mimeType: 'image/png', dataURL: 'data:image/png;base64,AA==', created: 1 } as Project['files'][string];
  local.files.photo = file; remote.files.photo = { ...file, dataURL: 'data:image/png;base64,BB==' as typeof file.dataURL };
  local.draft.scene.elements = [{ id: 'image', type: 'image', fileId: 'photo' }];
  remote.draft.scene.elements = [{ id: 'image', type: 'image', fileId: 'photo' }];
  const recovered = recoverProject(local, remote, base);
  assert.equal(Object.keys(recovered.files).length, 2);
  const localId = recovered.draft.scene.elements[0].fileId as string;
  assert.notEqual(localId, 'photo');
  assert.equal(recovered.files[localId].dataURL, file.dataURL);
  assert.equal(recovered.files.photo.dataURL, remote.files.photo.dataURL);
  assert.equal(recovered.past?.[0].draft.scene.elements[0].fileId, 'photo');
  assert.deepEqual(parseImport(JSON.stringify(recovered)), recovered);
});

test('concurrent single-canvas edits recover as separate top-level problems across save and reload', async () => {
  globalThis.indexedDB = new IDBFactory();
  const base = createSketchProject('Payments');
  const revision = await saveProject(base, null);
  const local = structuredClone(base); const remote = structuredClone(base);
  local.draft.scene.elements = [{ id: 'local', text: 'Local sketch' }];
  remote.draft.scene.elements = [{ id: 'remote', text: 'Remote sketch' }];
  await saveProject(remote, revision);
  await assert.rejects(saveProject(local, revision), StorageConflictError);
  const latest = (await loadProject())!;
  const recovered = recoverProject(local, latest.project, base);
  assert.equal(isSketchProject(recovered), true);
  assert.equal(recovered.problems?.length, 2);
  assert.notEqual(recovered.problemId, base.problemId);
  assert.notEqual(recovered.drawingId, base.drawingId);
  assert.equal(recovered.attemptNumber, 1);
  assert.equal(recovered.attempt.chapters.length, 0);
  assert.deepEqual(recovered.draft.scene, local.draft.scene);
  const original = openProblem(recovered, 0);
  assert.equal(isSketchProject(original), true);
  assert.equal(original.problemId, base.problemId);
  assert.equal(original.drawingId, base.drawingId);
  assert.deepEqual(original.draft.scene, remote.draft.scene);
  await saveProject(recovered, latest.revision);
  assert.deepEqual((await loadProject())?.project, parseImport(JSON.stringify(recovered)));
});

test('concurrent sketch metadata edits also preserve one canvas per recovered problem', () => {
  const base = createSketchProject('Payments');
  const local = structuredClone(base); const remote = structuredClone(base);
  local.problems![0].companies = ['Queues'];
  remote.problems![0].companies = ['Storage'];
  const recovered = recoverProject(local, remote, base);
  assert.equal(isSketchProject(recovered), true);
  assert.equal(recovered.attemptNumber, 1);
  assert.deepEqual(recovered.problems?.find(p => p.id === recovered.problemId)?.companies, ['Queues']);
  assert.equal(recovered.past?.[0].drawingId, base.drawingId);
  assert.deepEqual(recovered.problems?.find(p => p.id === base.problemId)?.companies, ['Storage']);
  assert.equal(isSketchProject(openProblem(recovered, 0)), true);
});
