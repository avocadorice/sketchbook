import { useEffect, useRef, useState } from "react";
import { clampTutorSize, defaultTutorWidth, readTutorWidth, shouldStackTutor, tutorDividerWidth, tutorPaneBounds, tutorPaneHeightBounds, tutorSizeForKey, tutorWidthKey } from "./tutorPaneLayout";

export function useTutorPaneLayout(showLibrary: boolean, libraryDividerWidth = 0, showTutor = true) {
  const workspaceRef = useRef<HTMLElement>(null);
  const libraryRef = useRef<HTMLElement>(null);
  const [preferredWidth, setPreferredWidth] = useState(() => {
    try { return readTutorWidth(localStorage.getItem(tutorWidthKey)); }
    catch { return defaultTutorWidth; }
  });
  const [space, setSpace] = useState({ width: 0, height: 0, libraryWidth: 0 });
  // Keep vertical sizing separate so rotating the window preserves the saved sidebar width.
  const [heightRatio, setHeightRatio] = useState(.4);

  useEffect(() => {
    const workspace = workspaceRef.current;
    if (!workspace) return;
    const measure = () => {
      const next = { width: workspace.clientWidth, height: workspace.clientHeight,
        libraryWidth: showLibrary ? (libraryRef.current?.getBoundingClientRect().width ?? 0) + libraryDividerWidth : 0 };
      setSpace(old => old.width === next.width && old.height === next.height && old.libraryWidth === next.libraryWidth ? old : next);
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

  const stacked = shouldStackTutor(showTutor, space.width, space.height, space.libraryWidth);
  const widthBounds = tutorPaneBounds(space.width, space.libraryWidth);
  const heightBounds = tutorPaneHeightBounds(space.height);
  const availableHeight = Math.max(0, space.height - tutorDividerWidth);
  const bounds = stacked ? heightBounds : widthBounds;
  const resize = (size: number) => {
    if (stacked) {
      if (availableHeight) setHeightRatio(clampTutorSize(size, heightBounds) / availableHeight);
    } else setPreferredWidth(clampTutorSize(size, widthBounds));
  };
  return {
    workspaceRef, libraryRef, bounds, stacked,
    size: stacked ? clampTutorSize(availableHeight * heightRatio, heightBounds) : clampTutorSize(preferredWidth, widthBounds), resize,
  };
}

export function TutorPaneResizer({ size, bounds, onResize, stacked = false }: {
  size: number; bounds: { min: number; max: number }; onResize: (size: number) => void; stacked?: boolean;
}): React.JSX.Element {
  const drag = useRef<{ pointerId: number; position: number; size: number } | null>(null);
  useEffect(() => { drag.current = null; }, [stacked]);
  return <div className="tutor-pane-resizer" role="separator" tabIndex={0}
    aria-label="Resize tutor pane" aria-orientation={stacked ? "horizontal" : "vertical"} aria-controls="design-tutor-pane"
    aria-valuemin={bounds.min} aria-valuemax={bounds.max} aria-valuenow={size} aria-valuetext={`${Math.round(size)} pixels ${stacked ? "high" : "wide"}`}
    title={`Drag to resize tutor. Use ${stacked ? "Up/Down" : "Left/Right"} arrows, Home or End.`}
    onKeyDown={event => {
      const next = tutorSizeForKey(event.key, size, bounds, event.shiftKey, stacked);
      if (next === undefined) return;
      event.preventDefault(); event.stopPropagation(); onResize(next);
    }}
    onPointerDown={event => {
      if (event.button !== 0 || drag.current) return;
      event.preventDefault(); event.currentTarget.focus();
      drag.current = { pointerId: event.pointerId, position: stacked ? event.clientY : event.clientX, size };
      event.currentTarget.setPointerCapture(event.pointerId);
    }}
    onPointerMove={event => {
      const start = drag.current;
      if (start?.pointerId === event.pointerId) onResize(start.size + start.position - (stacked ? event.clientY : event.clientX));
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
