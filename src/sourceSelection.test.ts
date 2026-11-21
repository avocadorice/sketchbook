import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkpoint, createAttempt } from './history';
import { organizeProblems } from './problems';
import { checkpointFromSource } from './sourceSelection';
import { tutorContext } from './tutorContext';
import { legacyView } from './workspace';
import type { Project } from './storage';

const scene = (text: string) => ({ elements: [{ id: 'label', type: 'text', text, x: 0, y: 0, width: 20, height: 20 }], backgroundColor: '#ffffff' });
function project(): Project {
  let attempt = createAttempt('Room pooling');
  for (let i = 0; i < 2; i++) {
    attempt = checkpoint(attempt, scene(`checkpoint-${i}`), `Step ${i}`, `notes-${i}`);
    attempt.chapters[i].id = `shared-${i}`;
  }
  return organizeProblems({ drawingId: 'room-pooling', attempt,
    draft: { id: 'shared-0', index: 0, scene: scene('active draft'), title: 'Expanded draft', notes: 'active notes' },
    drafts: {
      '0': { id: 'shared-0', scene: scene('older saved draft'), title: 'Older draft', notes: 'older notes' },
      '1': { id: 'shared-1', scene: scene('second saved draft'), title: 'Second draft', notes: 'second notes' },
      next: { id: 'unfinished', scene: scene('unfinished draft'), title: 'Next', notes: 'next notes' },
    }, files: {} });
}

test('explicit deep links distinguish a checkpoint, active draft and stored draft sharing the same ID', () => {
  const stored = project();
  const before = structuredClone(stored);
  const view = (kind: string) => legacyView(stored, checkpointFromSource(stored, 'shared-0', kind));
  assert.deepEqual(view('checkpoint').draft.scene, scene('checkpoint-0'));
  assert.equal(view('checkpoint').draft.notes, 'notes-0');
  assert.deepEqual(view('draft').draft.scene, scene('active draft'));
  assert.deepEqual(view('saved-draft').draft.scene, scene('older saved draft'));
  assert.equal(view('saved-draft').draft.notes, 'older notes');
  assert.deepEqual(stored, before);
  assert.doesNotMatch(JSON.stringify(tutorContext(view('saved-draft'), null)), /checkpoint-1|second saved draft|unfinished draft/);
});

test('explicit saved-draft links select stored checkpoint drafts and the unfinished draft', () => {
  const stored = project();
  assert.deepEqual(legacyView(stored, checkpointFromSource(stored, 'shared-1', 'checkpoint')).draft.scene, scene('checkpoint-1'));
  assert.deepEqual(legacyView(stored, checkpointFromSource(stored, 'shared-1', 'saved-draft')).draft.scene, scene('second saved draft'));
  assert.deepEqual(legacyView(stored, checkpointFromSource(stored, 'unfinished', 'saved-draft')).draft.scene, scene('unfinished draft'));
});

test('existing deep links keep their prior precedence and missing targets keep the active view', () => {
  const stored = project();
  assert.equal(checkpointFromSource(stored, 'shared-0'), null);
  assert.deepEqual(checkpointFromSource(stored, 'shared-1'), { index: 1 });
  assert.deepEqual(checkpointFromSource(stored, 'unfinished'), { index: null, draft: true });
  assert.equal(checkpointFromSource(stored, null, 'checkpoint'), null);
  assert.equal(checkpointFromSource(stored, 'missing', 'checkpoint'), null);
  assert.equal(checkpointFromSource(stored, 'missing', 'saved-draft'), null);
});
