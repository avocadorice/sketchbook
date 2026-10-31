import { useEffect, useRef, useState } from "react";
import { clampTutorWidth, defaultTutorWidth, readTutorWidth, tutorPaneBounds, tutorWidthForKey, tutorWidthKey } from "./tutorPaneLayout";

export function useTutorPaneLayout(showLibrary: boolean, libraryDividerWidth = 0) {
  const workspaceRef = useRef<HTMLElement>(null);
  const libraryRef = useRef<HTMLElement>(null);
  const [preferredWidth, setPreferredWidth] = useState(() => {
    try { return readTutorWidth(localStorage.getItem(tutorWidthKey)); }
    catch { return defaultTutorWidth; }
  });
  const [bounds, setBounds] = useState({ min: 300, max: defaultTutorWidth });

  useEffect(() => {
    const workspace = workspaceRef.current;
    if (!workspace) return;
    const measure = () => {
      const next = tutorPaneBounds(workspace.clientWidth, showLibrary ? (libraryRef.current?.getBoundingClientRect().width ?? 0) + libraryDividerWidth : 0);
      setBounds(old => old.min === next.min && old.max === next.max ? old : next);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(workspace);
    if (libraryRef.current) observer.observe(libraryRef.current);
    return () => observer.disconnect();
  }, [showLibrary, libraryDividerWidth]);

  useEffect(() => {
    try { localStorage.setItem(tutorWidthKey, String(preferredWidth)); }
    catch { /* Resizing still works when browser preferences cannot be saved. */ }
  }, [preferredWidth]);

  const resize = (width: number) => {
    setPreferredWidth(clampTutorWidth(width, bounds));
  };
  return {
    workspaceRef, libraryRef, bounds,
    width: clampTutorWidth(preferredWidth, bounds), resize,
  };
}

export function TutorPaneResizer({ width, bounds, onResize }: {
  width: number; bounds: { min: number; max: number }; onResize: (width: number) => void;
}): React.JSX.Element {
  const drag = useRef<{ pointerId: number; x: number; width: number } | null>(null);
  return <div className="tutor-pane-resizer" role="separator" tabIndex={0}
    aria-label="Resize tutor pane" aria-orientation="vertical" aria-controls="design-tutor-pane"
    aria-valuemin={bounds.min} aria-valuemax={bounds.max} aria-valuenow={width} aria-valuetext={`${Math.round(width)} pixels wide`}
    title="Drag to resize tutor. Use Left/Right arrows, Home or End."
    onKeyDown={event => {
      const next = tutorWidthForKey(event.key, width, bounds, event.shiftKey);
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
      if (start?.pointerId === event.pointerId) onResize(start.width + start.x - event.clientX);
    }}
    onPointerUp={event => {
      if (drag.current?.pointerId !== event.pointerId) return;
      drag.current = null;
      event.currentTarget.releasePointerCapture(event.pointerId);
    }}
    onPointerCancel={() => { drag.current = null; }}
    onLostPointerCapture={() => { drag.current = null; }}
  />;
}
