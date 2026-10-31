import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { LegacyHistory } from './LegacyHistory';
import { ProblemList } from './ProblemList';
import { createSketchProject, shelveProject } from './workspace';
import { checkpoint } from './history';

test('a new sketch is a single top-level problem button with no attempt or checkpoint hierarchy', () => {
  const project = createSketchProject('Payments');
  project.problems![0].companies = ['Queues'];
  const markup = renderToStaticMarkup(createElement(ProblemList, { groups: [{ problem: project.problems![0], entries: [{ entry: project, position: null }] }],
    activeId: project.drawingId, disabled: false, onOpen() {}, onDelete() {} }));
  assert.match(markup, /class="problem-open" aria-current="page"/);
  assert.match(markup, /Payments/);
  assert.match(markup, /Queues/);
  assert.doesNotMatch(markup, /<details|<ol|Attempt|Checkpoint/);
  assert.equal((markup.match(/<button/g) ?? []).length, 2);
  assert.match(markup, /aria-label="Delete problem: Payments"/);
});

test('legacy attempts stay read only with one separate action to delete the whole problem', () => {
  const project = createSketchProject('Legacy payments');
  delete project.problems![0].workspace;
  const past = { ...shelveProject(project)[0], drawingId: 'earlier-conversation', attemptNumber: 2 };
  const markup = renderToStaticMarkup(createElement(ProblemList, { groups: [{ problem: project.problems![0], entries: [{ entry: project, position: null }, { entry: past, position: 0 }] }],
    activeId: project.drawingId, disabled: false, onOpen() {}, onDelete() {} }));
  assert.match(markup, /Archive · Read only/);
  assert.match(markup, /Attempt #1/);
  assert.match(markup, /Attempt #2/);
  assert.match(markup, /<\/details><button class="problem-delete"/);
  assert.equal((markup.match(/Delete problem:/g) ?? []).length, 1);
  assert.doesNotMatch(markup, /Delete attempt|New Attempt/);
});

test('legacy checkpoint and draft browsing contains no editing or checkpoint creation controls', () => {
  const project = createSketchProject('Legacy');
  delete project.problems![0].workspace;
  project.attempt = checkpoint(project.attempt, project.draft.scene, 'Requirements', 'Old notes');
  project.drafts = { '0': { ...project.draft, title: 'Unsaved requirements' } };
  const markup = renderToStaticMarkup(createElement(LegacyHistory, { project, selection: { index: 0 }, disabled: false, onSelect() {} }));
  assert.match(markup, /Archived problem · Read only/);
  assert.match(markup, /aria-current="step">1\. Requirements/);
  assert.match(markup, /View saved draft/);
  assert.match(markup, /Unfinished sketch/);
  assert.doesNotMatch(markup, /<input|<textarea|Delete|Move checkpoint|Save checkpoint|Continue from latest|clean slate/);
});
