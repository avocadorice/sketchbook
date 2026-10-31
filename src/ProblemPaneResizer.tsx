import { useEffect, useRef, useState, type RefObject } from "react";
import { clampProblemWidth, defaultProblemWidth, problemPaneBounds, problemWidthForKey, problemWidthKey, readProblemWidth } from "./problemPaneLayout";

export function useProblemPaneLayout(workspaceRef: RefObject<HTMLElement>) {
  const [preferredWidth, setPreferredWidth] = useState(() => {
    try { return readProblemWidth(localStorage.getItem(problemWidthKey)); }
    catch { return defaultProblemWidth; }
  });
  const [bounds, setBounds] = useState({ min: 260, max: defaultProblemWidth });
  useEffect(() => {
    const workspace = workspaceRef.current;
    if (!workspace) return;
    const measure = () => {
      const next = problemPaneBounds(workspace.clientWidth);
      setBounds(old => old.min === next.min && old.max === next.max ? old : next);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(workspace);
    return () => observer.disconnect();
  }, [workspaceRef]);
  useEffect(() => {
    try { localStorage.setItem(problemWidthKey, String(preferredWidth)); }
    catch { /* Layout remains usable without saved browser preferences. */ }
  }, [preferredWidth]);
  return { bounds, width: clampProblemWidth(preferredWidth, bounds), resize: (width: number) => setPreferredWidth(clampProblemWidth(width, bounds)) };
}

export function ProblemPaneResizer({ width, bounds, onResize }: {
  width: number; bounds: { min: number; max: number }; onResize: (width: number) => void;
}): React.JSX.Element {
  const drag = useRef<{ pointerId: number; x: number; width: number } | null>(null);
  return <div className="problem-pane-resizer" role="separator" tabIndex={0}
    aria-label="Resize problems pane" aria-orientation="vertical" aria-controls="design-problems-pane"
    aria-valuemin={bounds.min} aria-valuemax={bounds.max} aria-valuenow={width} aria-valuetext={`${Math.round(width)} pixels wide`}
    title="Drag to resize problems. Use Left/Right arrows, Home or End."
    onKeyDown={event => {
      const next = problemWidthForKey(event.key, width, bounds, event.shiftKey);
      if (next === undefined) return;
      event.preventDefault(); event.stopPropagation(); onResize(next);
    }}
    onPointerDown={event => {
      if (event.button !== 0 || drag.current) return;
      event.preventDefault(); event.currentTarget.focus();
      drag.current = { pointerId: event.pointerId, x: event.clientX, width };
      event.currentTarget.setPointerCapture(event.pointerId);
    }}
    onPointerMove={event => {
      const start = drag.current;
      if (start?.pointerId === event.pointerId) onResize(start.width + event.clientX - start.x);
    }}
    onPointerUp={event => {
      if (drag.current?.pointerId !== event.pointerId) return;
      drag.current = null; event.currentTarget.releasePointerCapture(event.pointerId);
    }}
    onPointerCancel={() => { drag.current = null; }} onLostPointerCapture={() => { drag.current = null; }}
  />;
}
