import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { TutorQuoteAttachments, TutorQuoteButtons } from './TutorQuoteActions';
import { tutorFollowupQuestions, observeTutorResponseSelection, questionWithQuotes, quotesForScope, selectedTutorResponse, type TutorQuoteAction, type TutorResponseHighlight } from './tutorResponseSelection';

function fixture() {
  class Element {
    nodeType = 1;
    constructor(public selector = '', public parentElement: Element | null = null, public attributes: Record<string, string> = {}) {}
    closest(selector: string): Element | null { return this.selector === selector ? this : this.parentElement?.closest(selector) ?? null; }
    contains(element: Element | null): boolean { return !!element && (element === this || this.contains(element.parentElement)); }
    getAttribute(name: string) { return this.attributes[name] ?? null; }
  }
  const root = new Element('conversation');
  const answer = new Element('[data-tutor-turn-id]', root, { 'data-tutor-turn-id': 'turn-1' });
  const body = new Element('.tutor-reply-body', answer);
  const inline = new Element('code', body);
  const textNode = { nodeType: 3, parentElement: inline };
  const range = { commonAncestorContainer: textNode as Element | typeof textNode };
  let text = '  Retry safely.\n    Keep the key.';
  const selection = { isCollapsed: false, rangeCount: 1, getRangeAt: () => range, toString: () => text };
  const read = () => selectedTutorResponse(root as unknown as HTMLElement, selection as unknown as Selection);
  return { Element, root, answer, body, range, selection, read, setText: (next: string) => { text = next; } };
}

test('selection attaches only highlighted rendered reply text, preserving code indentation', () => {
  const f = fixture();
  assert.deepEqual(f.read(), { turnId: 'turn-1', text: '  Retry safely.\n    Keep the key.' });
  f.range.commonAncestorContainer = f.body;
  assert.equal(f.read()?.turnId, 'turn-1', 'a highlight may span paragraphs within one reply');
  f.setText('New highlight');
  assert.equal(f.read()?.text, 'New highlight');
});

test('questions, composer text, reply controls, cross-reply and other-pane selections are excluded', () => {
  const f = fixture();
  for (const ancestor of [f.root, f.answer, new f.Element('question', f.root), new f.Element('textarea', f.root), new f.Element('button', f.answer), new f.Element('.tutor-reply-body')]) {
    f.range.commonAncestorContainer = ancestor;
    assert.equal(f.read(), undefined);
  }
});

test('empty, collapsed and multiple-range selections cannot attach text', () => {
  const f = fixture();
  f.selection.isCollapsed = true;
  assert.equal(f.read(), undefined);
  f.selection.isCollapsed = false;
  f.selection.rangeCount = 0;
  assert.equal(f.read(), undefined);
  f.selection.rangeCount = 2;
  assert.equal(f.read(), undefined);
  f.selection.rangeCount = 1;
  f.setText('  \n ');
  assert.equal(f.read(), undefined);
  assert.equal(selectedTutorResponse(f.root as unknown as HTMLElement, null), undefined);
});

test('follow-ups use the existing question format and quote only explicitly selected text', () => {
  const quotes = [{ turnId: 'first', text: 'Retry safely.\n  Use a key.' }, { turnId: 'second', text: 'Keep a queue.' }];
  const original = structuredClone(quotes);
  assert.equal(questionWithQuotes('How long?', []), 'How long?');
  assert.equal(questionWithQuotes('How long?', quotes), 'Quoted tutor response:\n> Retry safely.\n>   Use a key.\n\nQuoted tutor response:\n> Keep a queue.\n\nHow long?');
  assert.equal(questionWithQuotes(tutorFollowupQuestions.clarify, quotes.slice(0, 1)), 'Quoted tutor response:\n> Retry safely.\n>   Use a key.\n\nClarify');
  assert.equal(questionWithQuotes(tutorFollowupQuestions.example, quotes.slice(0, 1)), 'Quoted tutor response:\n> Retry safely.\n>   Use a key.\n\nExample');
  assert.deepEqual(quotes, original);
});

test('selection actions dispatch Clarify and Example directly, with Add to chat kept separate', () => {
  const selected: TutorQuoteAction[] = [];
  const actions = TutorQuoteButtons({ followupDisabled: false, onSelect: action => selected.push(action) });
  const markup = renderToStaticMarkup(actions);
  assert.match(markup, />Add to chat<\/button>/);
  assert.match(markup, />Clarify<\/button>/);
  assert.match(markup, />Example<\/button>/);
  assert.doesNotMatch(markup, /disabled|simpler terms/);
  for (const button of actions.props.children) button.props.onClick();
  assert.deepEqual(selected, ['add-to-chat', 'clarify', 'example'], 'each click synchronously dispatches its own action');
});

test('both direct follow-ups are disabled while context is unavailable, but quoting stays available', () => {
  const markup = renderToStaticMarkup(createElement(TutorQuoteButtons, { followupDisabled: true, onSelect() {} }));
  assert.match(markup, /<button type="button">Add to chat<\/button>/);
  assert.match(markup, /<button[^>]*disabled=""[^>]*>Clarify<\/button>/);
  assert.match(markup, /<button[^>]*disabled=""[^>]*>Example<\/button>/);
});

test('quote context is isolated to its drawing and checkpoint scope', () => {
  const draft = { scope: 'drawing-1:checkpoint-3', quotes: [{ turnId: 'turn-1', text: 'Checkpoint three only.' }] };
  assert.deepEqual(quotesForScope(draft, draft.scope), draft.quotes);
  for (const scope of ['drawing-1:checkpoint-2', 'drawing-2:checkpoint-3']) {
    assert.deepEqual(quotesForScope(draft, scope), []);
    assert.equal(questionWithQuotes('Earlier question', quotesForScope(draft, scope)), 'Earlier question');
  }
});

test('quote previews are removable, escape markup, and lock removal during a send', () => {
  const props = { quotes: [{ turnId: 'turn-1', text: '<script>hello</script>\n  code' }], onRemove() {}, disabled: false };
  const markup = renderToStaticMarkup(createElement(TutorQuoteAttachments, props));
  assert.match(markup, /aria-label="Quoted tutor text"/);
  assert.match(markup, /&lt;script&gt;hello&lt;\/script&gt;\n  code/);
  assert.doesNotMatch(markup, /<script|disabled/);
  assert.match(markup, /aria-label="Remove tutor quote 1"/);
  assert.match(renderToStaticMarkup(createElement(TutorQuoteAttachments, { ...props, disabled: true })), /disabled=""/);
  assert.equal(renderToStaticMarkup(createElement(TutorQuoteAttachments, { ...props, quotes: [] })), '');
});

function observerFixture(t: { after: (fn: () => void) => void }) {
  const f = fixture();
  class Events {
    listeners = new Map<string, Map<(event: any) => void, boolean>>();
    addEventListener(type: string, listener: (event: any) => void, capture = false) {
      if (!this.listeners.has(type)) this.listeners.set(type, new Map());
      this.listeners.get(type)!.set(listener, capture);
    }
    removeEventListener(type: string, listener: (event: any) => void) { this.listeners.get(type)?.delete(listener); }
    emit(type: string, target: unknown = f.root, properties = {}, stoppedAtTarget = false) {
      const event = { target, button: 0, defaultPrevented: false, propagationStopped: false,
        preventDefault() { this.defaultPrevented = true; }, stopPropagation() { this.propagationStopped = true; }, ...properties };
      for (const [listener, capture] of this.listeners.get(type) ?? []) {
        if (!stoppedAtTarget || capture) listener(event);
      }
      return event;
    }
  }
  let frameId = 0;
  const frames = new Map<number, FrameRequestCallback>();
  const view = Object.assign(new Events(), {
    innerWidth: 1600, innerHeight: 924,
    requestAnimationFrame(callback: FrameRequestCallback) { frames.set(++frameId, callback); return frameId; },
    cancelAnimationFrame(id: number) { frames.delete(id); },
  });
  const doc = Object.assign(new Events(), {
    defaultView: view, activeElement: null as unknown,
    getSelection: () => f.selection,
  });
  const bounds = { left: 1100, right: 1400, top: 150, bottom: 200 };
  const root = Object.assign(f.root, {
    ownerDocument: doc,
    getBoundingClientRect: () => ({ left: 1000, right: 1500, top: 100, bottom: 800 }),
    focus() { doc.activeElement = root; },
  });
  Object.assign(f.range, { getBoundingClientRect: () => ({ ...bounds }) });
  let shown: TutorResponseHighlight | undefined;
  const button = Object.assign(new f.Element('button'), { focus() { doc.activeElement = button; } });
  const toolbar = Object.assign(new f.Element('toolbar'), { querySelector: () => button });
  button.parentElement = toolbar;
  const cleanup = observeTutorResponseSelection(root as unknown as HTMLElement,
    () => shown ? toolbar as unknown as HTMLElement : null, highlight => { shown = highlight; });
  t.after(cleanup);
  return { ...f, root, doc, view, bounds, frames, toolbar, button, cleanup, shown: () => shown,
    flush() { const pending = [...frames.values()]; frames.clear(); pending.forEach(callback => callback(0)); } };
}

test('fast drag reads the final highlight after release, even when release propagation is stopped', t => {
  const f = observerFixture(t);
  f.selection.isCollapsed = true;
  f.doc.emit('pointerdown');
  f.doc.emit('selectionchange');
  assert.equal(f.frames.size, 0, 'the actions stay hidden during the drag');
  f.doc.emit('pointerup', f.root, {}, true);
  assert.equal(f.shown(), undefined);
  f.selection.isCollapsed = false;
  f.setText('Final native selection');
  f.doc.emit('mouseup', f.root, {}, true);
  f.doc.emit('selectionchange');
  assert.equal(f.frames.size, 1);
  f.flush();
  assert.equal(f.shown()?.quote.text, 'Final native selection');
});

test('late native selection changes and mouseup recover a missed pointer release', t => {
  const f = observerFixture(t);
  f.doc.emit('pointerdown');
  f.doc.emit('mouseup');
  f.selection.isCollapsed = true;
  f.flush();
  assert.equal(f.shown(), undefined);
  f.selection.isCollapsed = false;
  f.doc.emit('selectionchange');
  f.flush();
  assert.equal(f.shown()?.quote.turnId, 'turn-1');
  f.setText('Keyboard selection');
  f.doc.emit('selectionchange');
  f.flush();
  assert.equal(f.shown()?.quote.text, 'Keyboard selection');
});

test('a second quick drag replaces the first selection and clicking actions keeps them mounted', t => {
  const f = observerFixture(t);
  f.doc.emit('pointerup');
  f.doc.emit('pointerdown');
  assert.equal(f.frames.size, 0, 'starting another drag cancels the previous read');
  f.setText('Second highlight');
  f.doc.emit('pointerup');
  f.flush();
  assert.equal(f.shown()?.quote.text, 'Second highlight');
  f.doc.emit('pointerdown', f.button);
  f.doc.emit('pointerup', f.button);
  f.doc.emit('mouseup', f.button);
  assert.equal(f.frames.size, 0);
  assert.equal(f.shown()?.quote.text, 'Second highlight', 'release on an action must not unmount it before click');
});

test('scroll and resize reposition selection actions, while offscreen and collapsed selections hide them', t => {
  const f = observerFixture(t);
  f.doc.emit('pointerup');
  f.doc.emit('scroll');
  f.flush();
  assert.equal(f.shown()?.quote.turnId, 'turn-1', 'a late scroll after release must not lose the actions');
  f.bounds.top = 300; f.bounds.bottom = 350;
  f.doc.emit('scroll');
  f.flush();
  assert.equal(f.shown()?.bounds.top, 300);
  f.bounds.top = 950; f.bounds.bottom = 1000;
  f.view.emit('resize');
  f.flush();
  assert.equal(f.shown(), undefined);
  f.bounds.top = 300; f.bounds.bottom = 350;
  f.doc.emit('scroll');
  f.flush();
  assert.ok(f.shown());
  f.selection.isCollapsed = true;
  f.doc.emit('selectionchange');
  f.flush();
  assert.equal(f.shown(), undefined);
});

test('keyboard access preserves the selected quote and Escape dismisses without a queued reopening', t => {
  const f = observerFixture(t);
  f.doc.emit('selectionchange');
  f.flush();
  assert.equal(f.doc.emit('keydown', f.root, { key: 'Tab' }).defaultPrevented, true);
  assert.equal(f.doc.activeElement, f.button);
  f.selection.isCollapsed = true;
  f.doc.emit('selectionchange');
  f.flush();
  assert.ok(f.shown(), 'keyboard focus in the actions preserves the captured selection');
  f.doc.emit('selectionchange');
  const escape = f.doc.emit('keydown', f.button, { key: 'Escape' });
  assert.equal(escape.defaultPrevented, true);
  assert.equal(escape.propagationStopped, true);
  assert.equal(f.doc.activeElement, f.root);
  assert.equal(f.frames.size, 0);
  assert.equal(f.shown(), undefined);
});

test('blur and pointer cancellation reset dragging; scope cleanup cancels all queued work and listeners', t => {
  const f = observerFixture(t);
  for (const cancel of [() => f.view.emit('blur'), () => f.doc.emit('pointercancel')]) {
    f.doc.emit('pointerdown');
    cancel();
    f.doc.emit('selectionchange');
    f.flush();
    assert.ok(f.shown(), 'the next selection must not remain stuck in a drag');
  }
  f.doc.emit('selectionchange');
  f.cleanup();
  assert.equal(f.frames.size, 0);
  assert.ok([...f.doc.listeners.values(), ...f.view.listeners.values()].every(listeners => listeners.size === 0));
});
