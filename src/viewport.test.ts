import { test } from 'node:test';
import assert from 'node:assert/strict';
import { screenToScene, sceneToScreen, visibleRegions, applyThemeFilter, type View } from './viewport';
import { inFocus } from './tutorContext';
const view: View = { scrollX: -300, scrollY: 125, zoom: .5, width: 900, height: 600 };
test('focus boxes retain scene coordinates across zoom and pan', () => {
  const box = { x: 50, y: 60, width: 200, height: 150 };
  const scene = screenToScene(box, view);
  assert.deepEqual(scene, { x: 400, y: -5, width: 400, height: 300 });
  assert.deepEqual(sceneToScreen(scene, view), box);
  assert.deepEqual(sceneToScreen(scene, { ...view, zoom: 2, scrollX: -350 }), { x: 100, y: 240, width: 800, height: 600 });
});
test('default context is the visible viewport and multiple regions clip to it', () => {
  assert.deepEqual(visibleRegions([], view), [{ x: 300, y: -125, width: 1800, height: 1200 }]);
  const regions = visibleRegions([{ x: 200, y: -200, width: 200, height: 200 }, { x: 800, y: 100, width: 100, height: 100 }, { x: 5000, y: 0, width: 10, height: 10 }], view);
  assert.deepEqual(regions, [{ x: 300, y: -125, width: 100, height: 125 }, { x: 800, y: 100, width: 100, height: 100 }]);
  const scene = { backgroundColor: '#fff', elements: [{ id: 'a', x: 310, y: -100, width: 20, height: 20 }, { id: 'b', x: 820, y: 120, width: 20, height: 20 }, { id: 'outside', x: 500, y: 500, width: 20, height: 20 }] };
  assert.deepEqual(inFocus(scene, regions).elements.map(e => e.id), ['a', 'b']);
});

test('WebKit theme fallback preserves alpha and matches dark canvas colors', () => {
  const pixels = new Uint8ClampedArray([255,255,255,255,0,0,0,128]);
  applyThemeFilter(pixels, 'invert(0.93) hue-rotate(180deg)');
  assert.deepEqual([...pixels], [18,18,18,255,237,237,237,128]);
});
