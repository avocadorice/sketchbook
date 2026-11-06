import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement, type ComponentProps, type ReactElement, type PointerEvent } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { TutorPaneResizer } from './TutorPaneResizer';

for (const stacked of [false, true]) {
  test(`the ${stacked ? 'stacked' : 'sidebar'} tutor divider uses the correct drag axis and accessible orientation`, () => {
    let divider!: ReactElement<ComponentProps<'div'>>;
    const sizes: number[] = [];
    function Harness() {
      divider = TutorPaneResizer({ size: 400, bounds: { min: 300, max: 900 }, stacked, onResize: size => sizes.push(size) });
      return divider;
    }
    const markup = renderToStaticMarkup(createElement(Harness));
    assert.match(markup, new RegExp(`aria-orientation="${stacked ? 'horizontal' : 'vertical'}"`));
    assert.match(markup, /aria-controls="design-tutor-pane"/);
    assert.match(markup, /aria-valuemin="300" aria-valuemax="900" aria-valuenow="400"/);
    assert.match(markup, new RegExp(`aria-valuetext="400 pixels ${stacked ? 'high' : 'wide'}"`));
    assert.match(markup, new RegExp(`Use ${stacked ? 'Up/Down' : 'Left/Right'} arrows`));

    const captures: number[] = [];
    const releases: number[] = [];
    const currentTarget = { focus() {}, setPointerCapture(id: number) { captures.push(id); }, releasePointerCapture(id: number) { releases.push(id); } };
    const pointer = (clientX: number, clientY: number, pointerId = 1) => ({ button: 0, pointerId, clientX, clientY, currentTarget, preventDefault() {} }) as unknown as PointerEvent<HTMLDivElement>;
    divider.props.onPointerDown?.(pointer(500, 800));
    divider.props.onPointerMove?.(pointer(420, 650, 2));
    assert.deepEqual(sizes, [], 'other pointers do not resize the pane');
    divider.props.onPointerMove?.(pointer(420, 650));
    assert.deepEqual(sizes, [stacked ? 550 : 480]);
    divider.props.onPointerUp?.(pointer(420, 650));
    divider.props.onPointerMove?.(pointer(400, 600));
    assert.equal(sizes.length, 1, 'releasing the divider ends resizing');
    assert.deepEqual(captures, [1]);
    assert.deepEqual(releases, [1]);

    divider.props.onPointerDown?.(pointer(500, 800));
    divider.props.onPointerCancel?.(pointer(500, 800));
    divider.props.onPointerMove?.(pointer(400, 600));
    assert.equal(sizes.length, 1, 'cancelled gestures do not resize the pane');
  });
}
