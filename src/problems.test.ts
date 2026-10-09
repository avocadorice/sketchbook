import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAttempt, checkpoint } from './history';
import { organizeProblems, nextAttemptNumber, renameProblem } from './problems';
import { parseImport, type Project } from './storage';
function entry(title: string, id: string): Project {
  const scene = { elements: [{ id: 'box', text: 'retained', x: 0, y: 0 }], backgroundColor: '#ffffff' };
  return { drawingId: id, attemptNumber: 20, attempt: checkpoint(createAttempt(title), scene, 'Step', 'legacy note'), draft: { index: 0, scene, title: 'Step', notes: 'draft note' }, files: {}, timing: { enabled: false, chaptersMs: [12], draftMs: 3 } };
}
test('legacy problems group by title and renumber locally without changing sketch or tutor IDs', () => {
  const original = { ...entry('Payments', 'current'), past: [{ ...entry('Payments', 'first'), savedAt: 1 }, { ...entry('Queues', 'other'), savedAt: 2 }] };
  const migrated = organizeProblems(original);
  assert.equal(migrated.problems?.length, 2);
  assert.equal(migrated.attemptNumber, 2);
  assert.equal(migrated.past?.[0].attemptNumber, 1);
  assert.equal(migrated.problemId, migrated.past?.[0].problemId);
  assert.notEqual(migrated.problemId, migrated.past?.[1].problemId);
  assert.equal(nextAttemptNumber(migrated, migrated.problemId!), 3);
  for (const [i, after] of [migrated, ...migrated.past!].entries()) {
    const before = [original, ...original.past][i];
    assert.equal(after.drawingId, before.drawingId);
    assert.deepEqual(after.attempt, before.attempt);
    assert.deepEqual(after.draft, before.draft);
    assert.deepEqual(after.timing, before.timing);
  }
  assert.equal(organizeProblems(migrated), migrated);
  assert.deepEqual(parseImport(JSON.stringify(migrated)), { ...migrated, past: migrated.past?.map(({ files: _files, ...entry }: any) => entry) });
});
test('renaming a problem updates only its own attempts and survives export/import', () => {
  const p = organizeProblems({ ...entry('Payments', 'current'), past: [{ ...entry('Payments', 'first'), savedAt: 1 }, { ...entry('Queues', 'other'), savedAt: 2 }] });
  const next = renameProblem(p, 'Ledger');
  assert.equal(next.attempt.prompt, 'Ledger');
  assert.equal(next.past?.[0].attempt.prompt, 'Ledger');
  assert.equal(next.past?.[1].attempt.prompt, 'Queues');
  assert.equal(parseImport(JSON.stringify(next)).problems?.find(x => x.id === next.problemId)?.title, 'Ledger');
});
