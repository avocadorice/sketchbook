import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAttempt, checkpoint } from './history';
import { organizeProblems, nextAttemptNumber, renameProblem, companyTags, tagProblem, matchesCompany } from './problems';
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
test('company tags belong to the problem and survive export/import without changing attempts', () => {
  const original = organizeProblems({ ...entry('Payments', 'current'), past: [{ ...entry('Payments', 'first'), savedAt: 1 }, { ...entry('Queues', 'other'), savedAt: 2 }] });
  const tagged = tagProblem(original, ' Google, Meta, google, , Anduril ');
  const problem = tagged.problems!.find(p => p.id === tagged.problemId)!;
  assert.deepEqual(companyTags(' Google, Meta, google, , Anduril '), ['google', 'Meta', 'Anduril']);
  assert.deepEqual(problem.companies, ['google', 'Meta', 'Anduril']);
  assert.equal(matchesCompany(problem, 'GOOGLE'), true);
  assert.equal(matchesCompany(problem, 'Amazon'), false);
  assert.equal(matchesCompany({ id: 'legacy', title: 'Legacy' }, ''), true);
  assert.equal(matchesCompany({ id: 'legacy', title: 'Legacy' }, 'Google'), false);
  assert.equal(tagged.past, original.past);
  assert.equal(tagged.attempt, original.attempt);
  assert.equal(tagged.draft, original.draft);
  assert.equal(tagged.files, original.files);
  assert.equal(tagged.problems!.find(p => p.id !== tagged.problemId)?.companies, undefined);
  assert.deepEqual(parseImport(JSON.stringify(tagged)).problems, tagged.problems);
  assert.deepEqual(tagProblem(tagged, '').problems!.find(p => p.id === tagged.problemId)?.companies, []);
  for (const companies of ['Google', [42], ['x'.repeat(101)]]) {
    assert.throws(() => parseImport(JSON.stringify({ ...tagged, problems: [{ ...problem, companies }] })), /Invalid problem tags/);
  }
});

test('whole subject tags keep punctuation and legacy companies while sharing only problem metadata', () => {
  const original = tagProblem(organizeProblems(entry('Payments', 'current')), 'Google');
  const tagged = tagProblem(original, ['Google', ' WebRTC ', 'Networking', 'webrtc', 'Queues, streams', '']);
  const problem = tagged.problems!.find(p => p.id === tagged.problemId)!;
  assert.deepEqual(problem.companies, ['Google', 'webrtc', 'Networking', 'Queues, streams']);
  assert.equal(matchesCompany(problem, 'QUEUES, STREAMS'), true);
  assert.equal(tagged.attempt, original.attempt);
  assert.equal(tagged.draft, original.draft);
  assert.equal(tagged.drawingId, original.drawingId);
  assert.deepEqual(parseImport(JSON.stringify(tagged)).problems, tagged.problems);
  assert.deepEqual(tagProblem(tagged, []).problems!.find(p => p.id === tagged.problemId)?.companies, []);
});
