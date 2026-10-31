import { useEffect, useRef, useState, type RefObject } from 'react';
import { systemDesignFocusRequestType, systemDesignFocusType } from '../../shared/systemDesignFocus';
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
  return { enabled, setEnabled, preset, setPreset, enterButton, exitButton };
}

export function FocusToolbar({ preset, onPresetChange, onExit, exitButton, context }: {
  preset: FocusPreset; onPresetChange: (preset: FocusPreset) => void; onExit: () => void;
  exitButton: RefObject<HTMLButtonElement>; context: string;
}) {
  return <nav className="design-focus-toolbar" aria-label="Focus controls">
    <label>Focus<select aria-label="Focus layout" value={preset} onChange={event => onPresetChange(readFocusPreset(event.target.value))}>
      {(Object.keys(focusPresets) as FocusPreset[]).map(id => <option key={id} value={id}>{focusPresets[id].label}</option>)}
    </select></label>
    <span className="design-focus-context" title={context}>{context}</span>
    <div className="design-focus-actions">
      <button ref={exitButton} onClick={onExit} aria-label="Exit Focus mode">Exit Focus</button>
    </div>
  </nav>;
}
