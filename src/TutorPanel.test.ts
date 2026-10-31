import assert from 'node:assert/strict';
import { register } from 'node:module';
import { setImmediate } from 'node:timers/promises';
import { test, type TestContext } from 'node:test';
import { Children, createElement, isValidElement, type ComponentProps, type ReactNode, type ReactElement, type FormEvent, type ChangeEvent } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { TutorResponseSelection } from './TutorQuoteActions';

register('../tests/component_loader.mjs', import.meta.url);
const { TutorPanel } = await import('./TutorPanel');
type PanelProps = ComponentProps<typeof TutorPanel>;
type SelectionProps = ComponentProps<typeof TutorResponseSelection>;
const quote = { turnId: 'visible-turn', text: 'Retry safely.\n  Keep the same key.' };
const snapshot = { id: 'drawing-one', image: null, context: { checkpointId: 'cp3', priorCheckpointIds: ['cp1', 'cp2'], futureExcluded: true } };

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(yes => { resolve = yes; });
  return { promise, resolve };
}

function findElement<P>(root: ReactNode, type: string): ReactElement<P> | undefined {
  for (const child of Children.toArray(root)) {
    if (!isValidElement<{ children?: ReactNode }>(child)) continue;
    if (child.type === type) return child as ReactElement<P>;
    const found = findElement<P>(child.props.children, type);
    if (found) return found;
  }
}

type Controls = { select: SelectionProps['onSelect']; submit: () => void; includeCanvas: boolean; setCanvas: (include: boolean) => void };
function fixture(t: TestContext, capture: PanelProps['capture'], props: Partial<PanelProps> = {}, duringRender?: (controls: Controls) => void) {
  const draft = 'My unfinished question';
  const stored = new Map([['sketchbook-question-new', draft]]);
  for (const [name, value] of Object.entries({
    localStorage: { getItem: (key: string) => stored.get(key) ?? null,
      setItem: (key: string, value: string) => stored.set(key, value), removeItem: (key: string) => stored.delete(key) },
    location: { href: 'https://practice.example/static/practice/index.html' },
  })) {
    const original = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { configurable: true, value });
    t.after(() => { if (original) Object.defineProperty(globalThis, name, original); else Reflect.deleteProperty(globalThis, name); });
  }
  const requests: { url: string; body: Record<string, unknown> }[] = [];
  t.mock.method(globalThis, 'fetch', async (url: URL, init: RequestInit) => {
    requests.push({ url: url.href, body: JSON.parse(String(init.body)) });
    return new Response(JSON.stringify({ id: snapshot.id, revision: 1, turns: [] }));
  });
  let controls!: Controls;
  // Capture the actual event callback under React's server renderer. Effects and
  // polling stay inactive; only synthetic storage, capture and requests are used.
  function Harness() {
    const panel = TutorPanel({ attachmentScope: 'drawing-one:cp3', capture, contextLabel: 'Visible canvas',
      onHide() {}, clearFocus() {}, startFocus() {}, hasFocus: false, ...props });
    const selection = Children.toArray(panel.props.children).find(child => isValidElement(child) && child.type === TutorResponseSelection);
    assert.ok(isValidElement<SelectionProps>(selection));
    const form = findElement<ComponentProps<'form'>>(panel, 'form');
    const checkbox = findElement<ComponentProps<'input'>>(panel, 'input');
    controls = { select: selection.props.onSelect,
      submit: () => form?.props.onSubmit?.({ preventDefault() {} } as FormEvent<HTMLFormElement>),
      includeCanvas: !!checkbox?.props.checked,
      setCanvas: checked => checkbox?.props.onChange?.({ target: { checked } } as ChangeEvent<HTMLInputElement>) };
    duringRender?.(controls);
    return null;
  }
  renderToStaticMarkup(createElement(Harness));
  return { ...controls, requests, stored, draft };
}

test('ordinary questions include fresh canvas by default', async t => {
  const image = 'data:image/png;base64,canvas';
  const f = fixture(t, async includeCanvas => { assert.equal(includeCanvas, true); return { ...snapshot, image }; });
  assert.equal(f.includeCanvas, true);
  f.submit();
  await setImmediate();
  assert.equal(f.requests.length, 1);
  assert.equal(f.requests[0].body.image, image);
});

test('Add to chat defaults to omitting canvas and waits for the composed question', async t => {
  let selected = false;
  let captures = 0;
  const f = fixture(t, async includeCanvas => { assert.equal(includeCanvas, false); captures++; return snapshot; }, {}, controls => {
    if (!selected) { selected = true; controls.select(quote, 'add-to-chat'); }
  });
  assert.equal(f.includeCanvas, false);
  assert.equal(captures, 0);
  assert.equal(f.requests.length, 0);
  f.submit();
  await setImmediate();
  assert.equal(captures, 1);
  assert.equal(f.requests.length, 1);
  assert.equal(f.requests[0].body.image, null);
  assert.match(String(f.requests[0].body.question), /Quoted tutor response:[\s\S]+My unfinished question$/);
});

for (const quoted of [false, true]) {
  test(`canvas can be explicitly ${quoted ? 'included with a quote' : 'omitted from an ordinary question'}`, async t => {
    let step = 0;
    const f = fixture(t, async includeCanvas => { assert.equal(includeCanvas, quoted); return snapshot; }, {}, controls => {
      if (step === 0) {
        step++;
        if (quoted) controls.select(quote, 'add-to-chat');
        else controls.setCanvas(false);
      } else if (quoted && step === 1) {
        step++;
        assert.equal(controls.includeCanvas, false);
        controls.setCanvas(true);
      }
    });
    assert.equal(f.includeCanvas, quoted);
    f.submit();
    await setImmediate();
    assert.equal(f.requests.length, 1);
  });
}

for (const action of ['clarify', 'example'] as const) {
  test(`${action} starts sending on click, submits only its selected quote, and preserves the saved draft`, async t => {
    const context = deferred<typeof snapshot>();
    let captures = 0;
    const f = fixture(t, includeCanvas => { assert.equal(includeCanvas, false); captures++; return context.promise; });
    f.select(quote, action);
    assert.equal(captures, 1, 'capture begins before the click handler returns');
    assert.equal(f.requests.length, 0, 'submission still waits for safe context persistence');
    f.select(quote, action);
    assert.equal(captures, 1, 'a second click cannot submit another turn while context is saving');
    context.resolve(snapshot);
    await setImmediate();
    assert.equal(f.requests.length, 1);
    assert.equal(f.requests[0].url, 'https://practice.example/static/practice/api/tutor/ask');
    assert.equal(f.requests[0].body.question, `Quoted tutor response:\n> Retry safely.\n>   Keep the same key.\n\n${action === 'clarify' ? 'Clarify' : 'Example'}`);
    assert.deepEqual(f.requests[0].body.context, snapshot.context);
    assert.equal(f.requests[0].body.image, null);
    assert.equal(f.requests[0].body.revision, 0);
    assert.deepEqual([...f.stored], [['sketchbook-question-new', f.draft]]);
  });
}

test('a context save failure sends nothing, preserves the draft, and releases the send lock for another click', async t => {
  let captures = 0;
  const f = fixture(t, async () => {
    if (++captures === 1) throw new Error('Context could not be saved');
    return snapshot;
  });
  f.select(quote, 'clarify');
  await setImmediate();
  assert.equal(f.requests.length, 0);
  assert.equal(f.stored.get('sketchbook-question-new'), f.draft);
  f.select(quote, 'example');
  await setImmediate();
  assert.equal(captures, 2);
  assert.equal(f.requests.length, 1);
  assert.match(String(f.requests[0].body.question), /\n\nExample$/);
  assert.equal(f.stored.get('sketchbook-question-new'), f.draft);
});

test('oversized follow-ups cannot start a request', t => {
  let captures = 0;
  const capture = async () => { captures++; return snapshot; };
  const f = fixture(t, capture);
  f.select({ ...quote, text: 'x'.repeat(12000) }, 'clarify');
  assert.equal(captures, 0);
  assert.equal(f.requests.length, 0);
});

test('archived conversations cannot start a follow-up request', t => {
  let captures = 0;
  const archived = fixture(t, async () => { captures++; return snapshot; }, { readOnly: true });
  archived.select(quote, 'example');
  assert.equal(captures, 0);
  assert.equal(archived.requests.length, 0);
});
