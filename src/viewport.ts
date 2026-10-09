export type Rect = { x: number; y: number; width: number; height: number };
export type View = { scrollX: number; scrollY: number; zoom: number; width: number; height: number };
export function screenToScene(rect: Rect, view: View): Rect {
  return { x: rect.x / view.zoom - view.scrollX, y: rect.y / view.zoom - view.scrollY, width: rect.width / view.zoom, height: rect.height / view.zoom };
}
export function sceneToScreen(rect: Rect, view: View): Rect {
  return { x: (rect.x + view.scrollX) * view.zoom, y: (rect.y + view.scrollY) * view.zoom, width: rect.width * view.zoom, height: rect.height * view.zoom };
}
export function intersection(a: Rect, b: Rect): Rect | null {
  const x = Math.max(a.x, b.x), y = Math.max(a.y, b.y), right = Math.min(a.x + a.width, b.x + b.width), bottom = Math.min(a.y + a.height, b.y + b.height);
  return right > x && bottom > y ? { x, y, width: right - x, height: bottom - y } : null;
}
export function visibleRegions(regions: Rect[], view: View): Rect[] {
  const viewport = screenToScene({ x: 0, y: 0, width: view.width, height: view.height }, view);
  return regions.length ? regions.map(r => intersection(r, viewport)).filter((r): r is Rect => !!r) : [viewport];
}
/** Copy rendered Excalidraw pixels, including zoom/pan/selection, rather than exporting the scene. */
export function captureViewport(root: HTMLElement, regions: Rect[], view: View): string {
  const staticCanvas = root.querySelector<HTMLCanvasElement>('canvas.excalidraw__canvas.static');
  if (!staticCanvas || !staticCanvas.width) throw new Error('The canvas is not ready. Please retry.');
  const surface = document.createElement('canvas'); surface.width = staticCanvas.width; surface.height = staticCanvas.height;
  const ctx = surface.getContext('2d')!;
  // Typed as always present, but missing on older WKWebView.
  const filterSupported = 'filter' in (ctx as object);
  for (const canvas of root.querySelectorAll<HTMLCanvasElement>('canvas.excalidraw__canvas.static, canvas.excalidraw__canvas.interactive')) {
    const filter = getComputedStyle(canvas).filter;
    if (filterSupported || filter === 'none') {
      ctx.filter = filter;
      ctx.drawImage(canvas, 0, 0, surface.width, surface.height);
    } else {
      // WKWebView versions without CanvasRenderingContext2D.filter still need the visible dark colors.
      const layer = document.createElement('canvas'); layer.width = canvas.width; layer.height = canvas.height;
      const layerContext = layer.getContext('2d')!; layerContext.drawImage(canvas, 0, 0);
      const pixels = layerContext.getImageData(0, 0, layer.width, layer.height);
      applyThemeFilter(pixels.data, filter); layerContext.putImageData(pixels, 0, 0);
      ctx.drawImage(layer, 0, 0, surface.width, surface.height);
    }
  }
  ctx.filter = 'none';
  if (!regions.length) return surface.toDataURL('image/png');
  const boxes = visibleRegions(regions, view).map(r => sceneToScreen(r, view));
  if (!boxes.length) throw new Error('Your focus regions are outside the visible canvas. Pan back or clear them.');
  const sx = surface.width / view.width, sy = surface.height / view.height;
  const gap = 20, label = boxes.length > 1 ? 30 : 0;
  const result = document.createElement('canvas');
  result.width = Math.ceil(Math.max(...boxes.map(b => b.width * sx)));
  result.height = Math.ceil(boxes.reduce((n, b) => n + b.height * sy + label, 0) + gap * (boxes.length - 1));
  const out = result.getContext('2d')!; out.fillStyle = '#15171c'; out.fillRect(0, 0, result.width, result.height);
  let y = 0;
  boxes.forEach((box, i) => {
    if (label) { out.fillStyle = '#ddd'; out.font = '18px system-ui'; out.fillText(`Focus ${i + 1}`, 8, y + 21); y += label; }
    out.drawImage(surface, box.x * sx, box.y * sy, box.width * sx, box.height * sy, 0, y, box.width * sx, box.height * sy);
    y += box.height * sy + gap;
  });
  return result.toDataURL('image/png');
}

/** Excalidraw's CSS dark theme, for WebKit without the 2D canvas filter property. */
export function applyThemeFilter(data: Uint8ClampedArray, filter: string): void {
  const match = /^invert\(([0-9.]+)\) hue-rotate\(([0-9.]+)deg\)$/.exec(filter);
  if (!match) throw new Error('This canvas theme cannot be captured by your browser. Update macOS or use Chrome.');
  const invert = Number(match[1]), angle = Number(match[2]) * Math.PI / 180, c = Math.cos(angle), s = Math.sin(angle);
  for (let i = 0; i < data.length; i += 4) {
    const r = 255 * invert + data[i] * (1 - 2 * invert), g = 255 * invert + data[i + 1] * (1 - 2 * invert), b = 255 * invert + data[i + 2] * (1 - 2 * invert);
    data[i] = (.213 + .787 * c - .213 * s) * r + (.715 - .715 * c - .715 * s) * g + (.072 - .072 * c + .928 * s) * b;
    data[i + 1] = (.213 - .213 * c + .143 * s) * r + (.715 + .285 * c + .140 * s) * g + (.072 - .072 * c - .283 * s) * b;
    data[i + 2] = (.213 - .213 * c - .787 * s) * r + (.715 - .715 * c + .715 * s) * g + (.072 + .928 * c + .072 * s) * b;
  }
}
