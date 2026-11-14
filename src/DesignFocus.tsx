import { useEffect, useRef, useState, type RefObject } from 'react';
import { systemDesignFocusRequestType, systemDesignFocusType, systemDesignReviewStatusType, systemDesignOpenReviewType } from '../../shared/systemDesignFocus';
import { focusModeKey, focusPresetKey, focusPresets, readFocusPreset, type FocusPreset } from './focusMode';

function preference(key: string): string | null {
  try { return localStorage.getItem(key); }
  catch { return null; }
}

export function useFocusMode() {
  const [enabled, setEnabled] = useState(() => preference(focusModeKey) === 'true');
  const [preset, setPreset] = useState(() => readFocusPreset(preference(focusPresetKey)));
  const enterButton = useRef<HTMLButtonElement>(null);
  const exitButton = useRef<HTMLButtonElement>(null);
  const previous = useRef(enabled);
  const [reviewDue, setReviewDue] = useState(0);
  useEffect(() => {
    if (window.parent === window) return;
    const status = (event: MessageEvent) => {
      if (event.origin === location.origin && event.source === window.parent && event.data?.type === systemDesignReviewStatusType
        && Number.isSafeInteger(event.data.due) && event.data.due >= 0) setReviewDue(event.data.due);
    };
    window.addEventListener('message', status);
    return () => window.removeEventListener('message', status);
  }, []);
  const openReview = () => window.parent.postMessage({ type: systemDesignOpenReviewType }, location.origin);
  useEffect(() => {
    try {
      localStorage.setItem(focusModeKey, String(enabled));
      localStorage.setItem(focusPresetKey, preset);
    } catch { /* Focus still works when browser preferences cannot be saved. */ }
  }, [enabled, preset]);
  useEffect(() => {
    if (window.parent === window) return;
    const notify = () => window.parent.postMessage({ type: systemDesignFocusType, enabled }, location.origin);
    const request = (event: MessageEvent) => {
      if (event.source === window.parent && event.origin === location.origin && event.data?.type === systemDesignFocusRequestType) notify();
    };
    window.addEventListener('message', request);
    notify();
    return () => window.removeEventListener('message', request);
  }, [enabled]);
  useEffect(() => {
    if (previous.current !== enabled) (enabled ? exitButton : enterButton).current?.focus();
    previous.current = enabled;
  }, [enabled]);
  return { enabled, setEnabled, preset, setPreset, enterButton, exitButton, reviewDue, openReview };
}

export function FocusToolbar({ preset, onPresetChange, onExit, exitButton, context, reviewDue = 0, onReview }: {
  preset: FocusPreset; onPresetChange: (preset: FocusPreset) => void; onExit: () => void;
  exitButton: RefObject<HTMLButtonElement>; context: string; reviewDue?: number; onReview?: () => void;
}) {
  return <nav className="design-focus-toolbar" aria-label="Focus controls">
    <label>Focus<select aria-label="Focus layout" value={preset} onChange={event => onPresetChange(readFocusPreset(event.target.value))}>
      {(Object.keys(focusPresets) as FocusPreset[]).map(id => <option key={id} value={id}>{focusPresets[id].label}</option>)}
    </select></label>
    <span className="design-focus-context" title={context}>{context}</span>
    <div className="design-focus-actions">
      {reviewDue > 0 && <button onClick={onReview} aria-label={`Review ${reviewDue} due ${reviewDue === 1 ? 'card' : 'cards'}`}>Review · {reviewDue}</button>}
      <button ref={exitButton} onClick={onExit} aria-label="Exit Focus mode">Exit Focus</button>
    </div>
  </nav>;
}
