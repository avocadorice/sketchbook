import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import { ChapterClock, formatElapsed } from "./timer";

export type ChapterTimerHandle = { pause(): void };
export type ChapterTimerProps = {
  enabled: boolean;
  elapsedMs: number;
  disabled: boolean;
  onEnabled: (enabled: boolean) => void;
  onElapsed: (elapsedMs: number) => void;
};

export const ChapterTimer = forwardRef<ChapterTimerHandle, ChapterTimerProps>(function ChapterTimer(
  { enabled, elapsedMs, disabled, onEnabled, onElapsed }, ref,
) {
  const clock = useRef(new ChapterClock(elapsedMs));
  const report = useRef(onElapsed);
  report.current = onElapsed;
  const [running, setRunning] = useState(false);
  const [displayMs, setDisplayMs] = useState(elapsedMs);

  const pause = useCallback((): void => {
    const elapsed = clock.current.pause(performance.now());
    // Navigation/checkpoint callers receive the measured duration before pause() returns.
    report.current(elapsed);
    setDisplayMs(elapsed);
    setRunning(false);
  }, []);
  useImperativeHandle(ref, () => ({ pause }), [pause]);

  useEffect(() => {
    if (!clock.current.running) {
      clock.current = new ChapterClock(elapsedMs);
      setDisplayMs(elapsedMs);
    }
  }, [elapsedMs]);

  useEffect(() => {
    if ((!enabled || disabled) && clock.current.running) pause();
  }, [enabled, disabled, pause]);

  useEffect(() => {
    const visibility = (): void => { if (document.hidden && clock.current.running) pause(); };
    document.addEventListener("visibilitychange", visibility);
    return () => document.removeEventListener("visibilitychange", visibility);
  }, [pause]);

  useEffect(() => {
    if (!running) return;
    let lastSaved = performance.now();
    const interval = window.setInterval(() => {
      if (!clock.current.running) return;
      const now = performance.now();
      const elapsed = clock.current.elapsed(now);
      setDisplayMs(elapsed);
      if (now - lastSaved >= 5000) {
        report.current(elapsed);
        lastSaved = now;
      }
    }, 250);
    return () => window.clearInterval(interval);
  }, [running]);

  const start = (): void => {
    if (!enabled || disabled || document.hidden) return;
    clock.current.start(performance.now());
    setRunning(true);
  };

  return <section className="chapter-timer" aria-label="Checkpoint timer">
    <label className="timer-toggle"><input type="checkbox" checked={enabled} disabled={disabled}
      onChange={event => {
        if (!event.target.checked) pause();
        onEnabled(event.target.checked);
      }} /> Show checkpoint timer</label>
    {enabled && <div className="timer-controls">
      <output aria-label="Time on this checkpoint" aria-live="off">{formatElapsed(displayMs)}</output>
      <button type="button" disabled={disabled} onClick={running ? pause : start}>
        {running ? "Pause" : "Start"}
      </button>
    </div>}
  </section>;
});
