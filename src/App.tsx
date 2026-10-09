import { useCallback, useEffect, useRef, useState } from "react";
import { Excalidraw, MainMenu, restoreElements } from "@excalidraw/excalidraw";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { AppState, BinaryFiles, ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { checkpoint, createAttempt, deleteChapter, sceneAt, updateChapter, normalizeScene, type Scene, moveChapter, skippedChanges } from "./history";
import { loadProject, parseImport, saveProject, storageLocation, type Project, type Timing } from "./storage";
import { tutorContext, matchesSearch, type Focus } from "./tutorContext";
import { organizeProblems, nextAttemptNumber, renameProblem } from "./problems";
import { captureViewport, visibleRegions, screenToScene, sceneToScreen, type View } from "./viewport";
import { draftKey, draftsAfterDelete, rekeyDrafts } from "./drafts";

import { TutorPanel } from "./TutorPanel";

const prompt = "Untitled problem";
const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
function sceneFrom(elements: readonly ExcalidrawElement[], state: AppState): Scene {
  return normalizeScene({
    elements: elements.filter(element => !element.isDeleted).map(element => {
      const { version, versionNonce, updated, index, ...content } = element;
      return JSON.parse(JSON.stringify(content));
    }),
    backgroundColor: state.viewBackgroundColor,
  });
}
function freshProject(problemId: string = crypto.randomUUID(), title = prompt): Project {
  const attempt = createAttempt(title);
  return { schemaVersion: 2, problemId, problems: [{ id: problemId, title }], drawingId: crypto.randomUUID(), attemptNumber: 1, attempt, draft: { id: crypto.randomUUID(), index: null, scene: sceneAt(attempt, -1), title: "", notes: "" }, files: {} };
}
function timingOf(project: Project): Timing {
  return project.timing ?? { enabled: false, chaptersMs: project.attempt.chapters.map(() => 0), draftMs: 0 };
}
function canvasElements(scene: Scene): ExcalidrawElement[] {
  const ids = new Set(scene.elements.map(element => element.id));
  const elements = scene.elements.map(element => {
    const copy = structuredClone(element);
    // An earlier chapter can remove a box that later arrows or text were attached to.
    for (const field of ["containerId", "frameId"]) if (copy[field] && !ids.has(String(copy[field]))) copy[field] = null;
    for (const field of ["startBinding", "endBinding"]) {
      const binding = copy[field] as { elementId?: string } | undefined;
      if (binding?.elementId && !ids.has(binding.elementId)) copy[field] = null;
    }
    if (Array.isArray(copy.boundElements)) copy.boundElements = copy.boundElements.filter(item => ids.has(item.id));
    return copy;
  });
  return restoreElements(elements as unknown as ExcalidrawElement[], null, { repairBindings: true });
}

export function App(): React.JSX.Element {
  const [loaded, setLoaded] = useState<{ project: Project; revision: string | null }>();
  const [error, setError] = useState("");
  useEffect(() => { void loadProject().then(async value => {
    if (!value) { setLoaded({ project: freshProject(), revision: null }); return; }
    const project = organizeProblems(value.project);
    const revision = same(project, value.project) ? value.revision : await saveProject(project, value.revision);
    setLoaded({ project, revision });
  }).catch(error => setError(String(error))); }, []);
  if (error) return <main className="load-error"><h1>System Design Practice could not open</h1><p role="alert">{error}</p><p>Your stored attempt has not been replaced. Close other practice tabs and reload.</p></main>;
  if (!loaded) return <main className="load-error">Opening your practice problems…</main>;
  return <Practice initial={loaded.project} initialRevision={loaded.revision} />;
}

function Practice({ initial, initialRevision }: { initial: Project; initialRevision: string | null }): React.JSX.Element {
  const api = useRef<ExcalidrawImperativeAPI | null>(null);
  const [showLibrary, setShowLibrary] = useState(localStorage.getItem("practice-problems-pane") !== "hidden");
  const [showTutor, setShowTutor] = useState(localStorage.getItem("practice-tutor-pane") !== "hidden");
  const [search, setSearch] = useState("");
  const [undo, setUndo] = useState<{ project: Project; label: string } | null>(null);
  const [focuses, setFocuses] = useState<Focus[]>([]);
  const [view, setView] = useState<View>({ scrollX: 0, scrollY: 0, zoom: 1, width: 1, height: 1 });
  const [focusing, setFocusing] = useState(false);
  const focusStart = useRef<{ x: number; y: number } | null>(null);
  const [focusScreen, setFocusScreen] = useState<Focus | null>(null);
  const drawingBox = useRef<HTMLElement>(null);
  const [project, setProject] = useState(initial);
  const current = useRef(initial);
  const revision = useRef(initialRevision);
  const pending = useRef<Project | null>(null);
  const writer = useRef<Promise<void> | null>(null);
  const failure = useRef<Error | null>(null);
  const savedLabel = storageLocation() === "host" ? "Saved on the host Mac" : "Saved in this browser";
  const [saveStatus, setSaveStatus] = useState(savedLabel);
  const [saveError, setSaveError] = useState("");
  const [busy, setBusy] = useState(false);
  const [canvasKey, setCanvasKey] = useState(0);
  const [message, setMessage] = useState("");
  const loadingCanvas = useRef(false);


  useEffect(() => {
    const warn = (event: BeforeUnloadEvent): void => { if (writer.current || failure.current) { event.preventDefault(); event.returnValue = ""; } };
    window.addEventListener("beforeunload", warn); return () => window.removeEventListener("beforeunload", warn);
  }, []);

  const persist = useCallback((next: Project): Promise<void> => {
    pending.current = next;
    setSaveStatus("Saving…");
    if (writer.current) return writer.current;
    const write = async (): Promise<void> => {
      try {
        while (pending.current) {
          const snapshot = pending.current; pending.current = null;
          revision.current = await saveProject(snapshot, revision.current);
        }
        failure.current = null; setSaveError(""); setSaveStatus(savedLabel);
      } catch (error) {
        failure.current = error instanceof Error ? error : new Error(String(error));
        setSaveError(failure.current.message); setSaveStatus("Not saved");
        pending.current = null;
        throw failure.current;
      } finally { writer.current = null; }
    };
    writer.current = write(); return writer.current;
  }, []);
  const change = useCallback((next: Project): void => {
    current.current = next; setProject(next); setMessage(""); setUndo(null);
    void persist(next).catch(() => { /* The visible save error keeps the draft available. */ });
  }, [persist]);
  useEffect(() => { localStorage.setItem("practice-problems-pane", showLibrary ? "visible" : "hidden"); }, [showLibrary]);
  useEffect(() => { localStorage.setItem("practice-tutor-pane", showTutor ? "visible" : "hidden"); }, [showTutor]);
  useEffect(() => {
    const key = (e: KeyboardEvent): void => {
      if ((e.target as HTMLElement)?.closest('input,textarea,select,[contenteditable=true]')) return;
      if (e.key === "Escape") { focusStart.current = null; setFocusScreen(null); setFocusing(false); return; }
      setFocusing(e.altKey && e.shiftKey);
    };
    const blur = (): void => { focusStart.current = null; setFocusScreen(null); setFocusing(false); };
    window.addEventListener("keydown", key); window.addEventListener("keyup", key); window.addEventListener("blur", blur);
    return () => { window.removeEventListener("keydown", key); window.removeEventListener("keyup", key); window.removeEventListener("blur", blur); };
  }, []);
  const onCanvasChange = useCallback((elements: readonly ExcalidrawElement[], appState: AppState, files: BinaryFiles): void => {
    if (loadingCanvas.current) return;
    const nextView = { scrollX: appState.scrollX, scrollY: appState.scrollY, zoom: appState.zoom.value, width: appState.width, height: appState.height };
    setView(old => same(old, nextView) ? old : nextView);
    const old = current.current; const scene = sceneFrom(elements, appState);
    const allFiles = { ...old.files, ...files };
    if (same(scene, old.draft.scene) && same(allFiles, old.files)) return;
    change({ ...old, files: allFiles, draft: { ...old.draft, scene } });
  }, [change]);
  const loadCanvas = (next: Project): void => {
    setFocuses([]); setFocusScreen(null); setFocusing(false); setUndo(null);
    loadingCanvas.current = true; current.current = next; setProject(next); setCanvasKey(value => value + 1);
  };
  const onReady = useCallback((instance: ExcalidrawImperativeAPI): void => {
    api.current = instance;
    requestAnimationFrame(() => { loadingCanvas.current = false; if (instance.getSceneElements().length) instance.scrollToContent(undefined, { fitToViewport: true, maxZoom: 1 }); });
  }, []);
  const isDirty = (): boolean => {
    const { attempt, draft } = current.current;
    const saved = draft.index === null ? undefined : attempt.chapters[draft.index];
    const base = sceneAt(attempt, draft.index ?? attempt.chapters.length - 1);
    return Boolean(draft.cleanSlate) || !same(draft.scene, base) || draft.title !== (saved?.title ?? "") || draft.notes !== (saved?.notes ?? "");
  };
  const label = (index: number | null): string => index === null ? "the next checkpoint" : `checkpoint ${index + 1}`;
  const savedDraftOf = (project: Project, index: number | null): Project["draft"] => {
    const chapter = index === null ? undefined : project.attempt.chapters[index];
    return { id: index === null ? crypto.randomUUID() : project.attempt.chapters[index]?.id, index, scene: sceneAt(project.attempt, index ?? project.attempt.chapters.length - 1), title: chapter?.title ?? "", notes: chapter?.notes ?? "" };
  };
  // Switching keeps unsaved edits as a draft of the checkpoint you leave, and reopens any draft you return to.
  const switchChapter = async (index: number | null): Promise<void> => {
    if (busy || index === current.current.draft.index) return;
    const old = current.current; const dirty = isDirty();
    const drafts = { ...(old.drafts ?? {}) };
    const leaving = draftKey(old.draft.index);
    if (dirty) drafts[leaving] = { id: old.draft.id, cleanSlate: old.draft.cleanSlate, scene: old.draft.scene, title: old.draft.title, notes: old.draft.notes };
    else delete drafts[leaving];
    const kept = drafts[draftKey(index)]; delete drafts[draftKey(index)];
    const next = { ...old, drafts, draft: kept ? { index, ...kept } : savedDraftOf(old, index) };
    setBusy(true); loadingCanvas.current = true;
    try {
      await persist(next); loadCanvas(next);
      setMessage([dirty ? `Your edits to ${label(old.draft.index)} are kept as a draft.` : "", kept ? `Reopened your draft of ${label(index)}.` : ""].filter(Boolean).join(" "));
    } catch { loadingCanvas.current = false; }
    finally { setBusy(false); }
  };
  const discardDraft = async (): Promise<void> => {
    const index = current.current.draft.index;
    if (busy || !window.confirm(`Discard your unsaved edits to ${label(index)}?`)) return;
    const old = current.current; const timing = timingOf(old);
    const next = { ...old, timing: index === null ? { ...timing, draftMs: 0 } : timing, draft: savedDraftOf(old, index) };
    setBusy(true); loadingCanvas.current = true;
    try { await persist(next); loadCanvas(next); setMessage("Draft discarded; showing the saved version."); }
    catch { loadingCanvas.current = false; }
    finally { setBusy(false); }
  };
  const saveCheckpoint = async (): Promise<void> => {
    if (busy) return;
    const old = current.current; const { draft } = old;
    const title = draft.title.trim() || `Checkpoint ${(draft.index ?? old.attempt.chapters.length) + 1}`;
    const attempt = draft.index === null ? checkpoint(old.attempt, draft.scene, title, draft.notes) : updateChapter(old.attempt, draft.index, draft.scene, title, draft.notes);
    if (draft.index === null) {
      if (draft.cleanSlate) attempt.chapters[attempt.chapters.length - 1] = { ...checkpoint(createAttempt(""), draft.scene, title, draft.notes).chapters[0], reset: true };
      attempt.chapters[attempt.chapters.length - 1].id = draft.id ?? crypto.randomUUID();
    }
    const timing = timingOf(old);
    const next = { ...old, attempt, timing: draft.index === null
      ? { ...timing, chaptersMs: [...timing.chaptersMs, timing.draftMs], draftMs: 0 } : timing,
      draft: draft.index === null
      ? { id: crypto.randomUUID(), index: null, scene: sceneAt(attempt, attempt.chapters.length - 1), title: "", notes: "" }
      : { ...draft, title, scene: sceneAt(attempt, draft.index) } };
    setBusy(true); loadingCanvas.current = true;
    try {
      await persist(next); loadCanvas(next);
      setMessage(draft.index === null ? `Checkpoint ${attempt.chapters.length} saved. Keep drawing for the next one.` : `Checkpoint ${draft.index + 1} overwritten. Later checkpoints now include its changes.`);
    } catch { loadingCanvas.current = false; }
    finally { setBusy(false); }
  };
  const removeChapter = async (index: number): Promise<void> => {
    if (busy) return;
    const old = current.current;
    const attempt = deleteChapter(old.attempt, index);
    const timing = timingOf(old);
    const keptDrafts = { ...old.drafts };
    if (isDirty() && old.draft.index !== index) keptDrafts[draftKey(old.draft.index)] = { ...old.draft };
    const drafts = draftsAfterDelete(keptDrafts, index);
    const next: Project = { ...old, attempt, drafts, timing: { ...timing, chaptersMs: timing.chaptersMs.filter((_, i) => i !== index) },
      draft: { id: crypto.randomUUID(), index: null, scene: sceneAt(attempt), title: "", notes: "" } };
    setBusy(true);
    try { await persist(next); loadCanvas(next); setUndo({ project: old, label: `Checkpoint ${index + 1} deleted` }); }
    finally { setBusy(false); }
  };
  const undoDelete = async (): Promise<void> => {
    if (!undo || busy) return;
    setBusy(true);
    try { await persist(undo.project); loadCanvas(undo.project); setUndo(null); setMessage("Deletion undone."); }
    finally { setBusy(false); }
  };
  const deleteAttempt = async (position: number | null): Promise<void> => {
    if (busy) return;
    const old = current.current;
    let next: Project;
    if (position === null) {
      const [first, ...rest] = old.past ?? [];
      next = first ? { ...first, schemaVersion: 2, problems: old.problems, files: old.files, past: rest } : { ...freshProject(old.problemId, old.attempt.prompt), problems: old.problems, files: old.files };
    } else next = { ...old, past: old.past?.filter((_, i) => i !== position) };
    setBusy(true);
    try { await persist(next); loadCanvas(next); setUndo({ project: old, label: "Attempt deleted" }); }
    finally { setBusy(false); }
  };
  const createCheckpoint = async (cleanSlate: boolean): Promise<void> => {
    if (busy) return;
    const old = current.current;
    // Save the current draft first, then select a new independent or incremental draft.
    if (isDirty()) await saveCheckpoint();
    if (failure.current) return;
    if (current.current.draft.index !== null && current.current.drafts?.next) {
      await switchChapter(null);
      if (failure.current) return;
      await saveCheckpoint();
      if (failure.current) return;
    }
    const latest = current.current;
    const next: Project = { ...latest, draft: { id: crypto.randomUUID(), index: null, title: "", notes: "", cleanSlate,
      scene: cleanSlate ? { elements: [], backgroundColor: latest.draft.scene.backgroundColor } : sceneAt(latest.attempt) } };
    await persist(next); loadCanvas(next);
  };
  const renameCheckpoint = (index: number, title: string): void => {
    const old = current.current;
    change({ ...old, attempt: { ...old.attempt, chapters: old.attempt.chapters.map((c, i) => i === index ? { ...c, title } : c) },
      draft: old.draft.index === index ? { ...old.draft, title } : old.draft,
      drafts: Object.fromEntries(Object.entries(old.drafts ?? {}).map(([key, draft]) => [key, key === String(index) ? { ...draft, title } : draft])) });
  };
  const moveChapterTo = async (from: number, to: number): Promise<void> => {
    const old = current.current;
    if (busy || to < 0 || to >= old.attempt.chapters.length) return;
    if (isDirty()) { setMessage("Save or discard your current edits first. Switching to another checkpoint also keeps them as a draft."); return; }
    const attempt = moveChapter(old.attempt, from, to);
    const skipped = (value: typeof attempt): number => value.chapters.reduce((sum, _, i) => sum + skippedChanges(value, i), 0);
    const newlySkipped = skipped(attempt) - skipped(old.attempt);
    if (newlySkipped > 0 && !window.confirm(`${newlySkipped} edit${newlySkipped === 1 ? "" : "s"} would act on items that don’t exist yet at the new position, so ${newlySkipped === 1 ? "it is" : "they are"} skipped. Moving back restores ${newlySkipped === 1 ? "it" : "them"}. Move anyway?`)) return;
    // Indices between the two positions shift by one; the moved chapter lands at "to".
    const remap = (i: number): number => i === from ? to : from < i && i <= to ? i - 1 : to <= i && i < from ? i + 1 : i;
    const timing = timingOf(old);
    const chaptersMs = [...timing.chaptersMs]; chaptersMs.splice(to, 0, ...chaptersMs.splice(from, 1));
    const index = old.draft.index === null ? null : remap(old.draft.index);
    const next = { ...old, attempt, drafts: rekeyDrafts(old.drafts ?? {}, remap), timing: { ...timing, chaptersMs }, draft: { ...old.draft, index, scene: sceneAt(attempt, index ?? attempt.chapters.length - 1) } };
    setBusy(true); loadingCanvas.current = true;
    try { await persist(next); loadCanvas(next); setMessage(`Moved “${attempt.chapters[to]!.title}” to position ${to + 1}. Later checkpoints replay in the new order.`); }
    catch { loadingCanvas.current = false; }
    finally { setBusy(false); }
  };
  // A fresh attempt never deletes work: the current one moves to Practice Problems and can be reopened.
  const shelved = (project: Project): Project["past"] => {
    const { problemId, drawingId, attemptNumber, attempt, draft, timing, drafts } = project;
    const empty = !attempt.chapters.length && !draft.scene.elements.length && !draft.title && !draft.notes && (attempt.prompt === prompt || !attempt.prompt);
    return empty && !drawingId ? project.past ?? [] : [{ problemId, drawingId, attemptNumber, savedAt: Date.now(), attempt, draft, ...(timing ? { timing } : {}), ...(drafts ? { drafts } : {}) }, ...(project.past ?? [])];
  };
  const resetAttempt = async (newProblem = false): Promise<void> => {
    if (busy) return;
    const old = current.current;
    const fresh = newProblem ? freshProject() : freshProject(old.problemId, old.attempt.prompt);
    const next: Project = { ...fresh, problems: newProblem ? [...(old.problems ?? []), ...fresh.problems!] : old.problems,
      attemptNumber: newProblem ? 1 : nextAttemptNumber(old, old.problemId!), files: old.files, past: shelved(old), timing: { enabled: timingOf(old).enabled, chaptersMs: [], draftMs: 0 } };
    setBusy(true); loadingCanvas.current = true;
    try { await persist(next); loadCanvas(next); setMessage("New attempt ready. Your previous attempt is in Attempts."); }
    catch { loadingCanvas.current = false; }
    finally { setBusy(false); }
  };
  const openPast = async (position: number): Promise<void> => {
    const old = current.current; const chosen = old.past?.[position];
    if (busy || !chosen) return;
    const rest = (old.past ?? []).filter((_, i) => i !== position);
    const { savedAt: _savedAt, ...restored } = chosen;
    const past = shelved({ ...old, past: rest }) ?? [];
    const next: Project = { schemaVersion: 2, problems: old.problems, files: old.files, ...restored, past };
    setBusy(true); loadingCanvas.current = true;
    try { await persist(next); loadCanvas(next); setMessage(`Reopened the attempt from ${new Date(chosen.savedAt).toLocaleString()}.${past.length > rest.length ? " The one you were on is under Practice Problems." : ""}`); }
    catch { loadingCanvas.current = false; }
    finally { setBusy(false); }
  };
  const chapters = (count: number): string => `${count} checkpoint${count === 1 ? "" : "s"}`;
  const importAttempt = async (file: File): Promise<void> => {
    if (busy) return;
    let imported: Project;
    try { imported = parseImport(await file.text(), file.name.replace(/\.(excalidraw|json)$/i, "")); }
    catch (error) { setMessage(`Not imported: ${error instanceof Error ? error.message : String(error)}`); return; }
    imported = organizeProblems(imported);
    const problemIds = new Map(imported.problems!.map(p => [p.id, crypto.randomUUID()]));
    imported.problems = imported.problems!.map(p => ({ ...p, id: problemIds.get(p.id)! }));
    for (const entry of [imported, ...(imported.past ?? [])]) {
      entry.problemId = problemIds.get(entry.problemId!)!;
      entry.drawingId = crypto.randomUUID();
      entry.attempt.chapters = entry.attempt.chapters.map(c => ({ ...c, id: crypto.randomUUID() }));
      entry.draft.id = entry.draft.index === null ? crypto.randomUUID() : entry.attempt.chapters[entry.draft.index]?.id;
      for (const [key, draft] of Object.entries(entry.drafts ?? {})) draft.id = key === 'next' ? crypto.randomUUID() : entry.attempt.chapters[Number(key)]?.id;
    }
    const old = current.current;
    const next: Project = { ...imported, problems: [...(old.problems ?? []), ...imported.problems], files: { ...old.files, ...imported.files }, past: [...(shelved(old) ?? []), ...(imported.past ?? [])] };
    setBusy(true); loadingCanvas.current = true;
    try { await persist(next); loadCanvas(next); setMessage(`Imported ${chapters(next.attempt.chapters.length)} from ${file.name}. Your previous attempt is under Practice Problems.`); }
    catch { loadingCanvas.current = false; }
    finally { setBusy(false); }
  };
  const exportLibrary = (): void => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(current.current, null, 2)], { type: "application/json" }));
    const link = document.createElement("a"); link.href = url; link.download = "practice-problems.json"; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const capture = async () => {
    if (!api.current || !drawingBox.current) throw new Error("The canvas is not ready.");
    // Freeze the visible pixels and scene together, before waiting for network persistence.
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    const snapshot = current.current;
    const state = api.current.getAppState();
    const viewport = { scrollX: state.scrollX, scrollY: state.scrollY, zoom: state.zoom.value, width: state.width, height: state.height };
    const image = captureViewport(drawingBox.current, focuses, viewport);
    const context = { ...tutorContext(snapshot, visibleRegions(focuses, viewport)), problemId: snapshot.problemId, attemptNumber: snapshot.attemptNumber,
      captureMode: focuses.length ? "focus-regions" : "visible-viewport", viewport };
    await persist(snapshot);
    return { id: snapshot.drawingId!, image, context };
  };
  useEffect(() => {
    window.sketchbookFlushDraft = async () => { if (writer.current) await writer.current; if (failure.current) throw failure.current; };
    return () => { delete window.sketchbookFlushDraft; };
  }, [persist]);
  const { draft, attempt } = project;
  const dirtyNow = isDirty();
  const hasDraft = (index: number | null): boolean => Boolean(project.drafts?.[draftKey(index)]) || (draft.index === index && dirtyNow);
  const finishFocus = (event: React.PointerEvent<HTMLDivElement>): void => {
    const start = focusStart.current; if (!start || !api.current) return;
    const bounds = event.currentTarget.getBoundingClientRect(); const end = { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
    const box = { x: Math.min(start.x, end.x), y: Math.min(start.y, end.y), width: Math.abs(end.x - start.x), height: Math.abs(end.y - start.y) };
    const state = api.current.getAppState();
    if (box.width > 8 && box.height > 8) setFocuses(old => [...old, screenToScene(box, { ...view, scrollX: state.scrollX, scrollY: state.scrollY, zoom: state.zoom.value })]);
    focusStart.current = null; setFocusScreen(null); setFocusing(event.altKey && event.shiftKey);
  };
  const entries = [{ entry: project, position: null as number | null }, ...(project.past ?? []).map((entry, position) => ({ entry, position }))];
  const groups = (project.problems ?? []).map(problem => ({ problem, entries: entries.filter(({ entry }) => entry.problemId === problem.id && matchesSearch(entry, search)).sort((a, b) => (a.entry.attemptNumber ?? 1) - (b.entry.attemptNumber ?? 1)) })).filter(g => g.entries.length);
  return <div className="practice-app">
    <header className="practice-header">
      <div className="app-identity"><h1>System Design Practice</h1><input aria-label="Practice problem title" maxLength={2000} disabled={busy} value={attempt.prompt} placeholder="Untitled problem" onChange={e => change(renameProblem(current.current, e.target.value))} /></div>
      <div className="header-search"><span aria-hidden="true">⌕</span><input aria-label="Search practice problems" type="search" placeholder="Search problems or sketch text" value={search} onChange={e => { setSearch(e.target.value); if (e.target.value) setShowLibrary(true); }} /></div>
      <nav><button aria-pressed={showLibrary} onClick={() => setShowLibrary(!showLibrary)}>Problems</button><button aria-pressed={showTutor} onClick={() => setShowTutor(!showTutor)}>Tutor</button></nav>
    </header>
    <main className="workspace" style={{ gridTemplateColumns: `${showLibrary ? "clamp(200px,20vw,270px) " : ""}minmax(0,1fr)${showTutor ? " clamp(300px,27vw,370px)" : ""}` }}>
      {showLibrary && <aside className="chapter-panel navigator" aria-label="Practice problems and attempts">
        <div className="pane-heading"><h2>Practice Problems</h2><button aria-label="Hide problems pane" onClick={() => setShowLibrary(false)}>×</button></div>
        <button className="new-attempt" disabled={busy} onClick={() => void resetAttempt(true)}>＋ New Problem</button>
        <div className="problem-list">{groups.map(({ problem, entries }) => <details key={problem.id} open={problem.id === project.problemId || !!search}>
          <summary>{problem.title || "Untitled problem"}</summary>
          <ol className="attempt-list">{entries.map(({ entry, position }) => <li key={entry.drawingId} className={position === null ? "current-attempt" : ""}>
            <button className="attempt-open" aria-current={position === null ? "page" : undefined} disabled={busy || position === null} onClick={() => void openPast(position!)}>Attempt #{entry.attemptNumber ?? 1}</button>
            <button aria-label={`Delete attempt ${entry.attemptNumber ?? 1} of ${problem.title}`} disabled={busy} onClick={() => void deleteAttempt(position)}>×</button>
          </li>)}</ol>
        </details>)}{!groups.length && <p className="hint">No matching problems.</p>}</div>
        <div className="checkpoint-heading"><h3>Attempt #{project.attemptNumber ?? 1}</h3><button disabled={busy} onClick={() => void resetAttempt()}>＋ New Attempt</button></div>
        <ol className="chapters">{attempt.chapters.map((chapter, index) => <li key={chapter.id ?? index} className={draft.index === index ? "selected-checkpoint" : ""}>
          <button className="checkpoint-number" disabled={busy} aria-label={`Open checkpoint ${index + 1}`} aria-current={draft.index === index ? "step" : undefined} onClick={() => void switchChapter(index)}>{index + 1}</button>
          <input aria-label={`Checkpoint ${index + 1} title`} maxLength={200} value={chapter.title} onChange={e => renameCheckpoint(index, e.target.value)} />
          <button className="row-delete" aria-label={`Delete checkpoint ${index + 1}`} disabled={busy} onClick={() => void removeChapter(index)}>×</button>
          <span className="move"><button disabled={busy || index === 0} aria-label={`Move checkpoint ${index + 1} earlier`} onClick={() => void moveChapterTo(index, index - 1)}>↑</button><button disabled={busy || index === attempt.chapters.length - 1} aria-label={`Move checkpoint ${index + 1} later`} onClick={() => void moveChapterTo(index, index + 1)}>↓</button></span>
          {hasDraft(index) && <em className="draft-mark">draft</em>}
        </li>)}</ol>
        {draft.index === null && <div className="draft-row"><span>Checkpoint {attempt.chapters.length + 1} · {draft.cleanSlate ? "clean slate" : "draft"}</span><input aria-label="New checkpoint title" placeholder={`Checkpoint ${attempt.chapters.length + 1}`} maxLength={200} value={draft.title} onChange={e => change({ ...current.current, draft: { ...current.current.draft, title: e.target.value } })} /></div>}
        <button className="checkpoint" disabled={busy} onClick={() => void saveCheckpoint()}>{draft.index === null ? "Save checkpoint" : "Save changes"}</button>
        <details className="create-checkpoint"><summary>Create Checkpoint</summary><button disabled={busy} onClick={() => void createCheckpoint(false)}>Continue from latest</button><button disabled={busy} onClick={() => void createCheckpoint(true)}>Start with clean slate</button></details>
        {dirtyNow && <button className="discard-draft" disabled={busy} onClick={() => void discardDraft()}>Discard draft</button>}
        {undo && <div className="undo-delete" role="status">{undo.label}. <button onClick={() => void undoDelete()} disabled={busy}>Undo</button></div>}
        <label className="import-attempt">Import sketch or problems<input type="file" accept="application/json,.json,.excalidraw" disabled={busy} onChange={event => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void importAttempt(file); }} /></label><button disabled={busy} onClick={exportLibrary}>Export all problems</button>
      </aside>}
      <section ref={drawingBox} className="drawing" aria-label="Design canvas" aria-busy={busy}>
        <Excalidraw theme="dark" aiEnabled={false} key={canvasKey} excalidrawAPI={onReady} onChange={onCanvasChange} initialData={{ elements: canvasElements(draft.scene), appState: { viewBackgroundColor: draft.scene.backgroundColor }, files: project.files }} viewModeEnabled={busy}>
          <MainMenu><MainMenu.DefaultItems.LoadScene /><MainMenu.DefaultItems.SaveToActiveFile /><MainMenu.DefaultItems.Export /><MainMenu.DefaultItems.ClearCanvas /><MainMenu.Separator /><MainMenu.DefaultItems.ChangeCanvasBackground /></MainMenu>
        </Excalidraw>
        <div className="focus-overlays">{focuses.map((focus, i) => { const box = sceneToScreen(focus, view); return <div key={i} className="focus-box" style={{ left: box.x, top: box.y, width: box.width, height: box.height }}><span>Focus {i + 1} <button aria-label={`Remove focus ${i + 1}`} onClick={() => setFocuses(old => old.filter((_, n) => n !== i))}>×</button></span></div>; })}
        {focusScreen && <div className="focus-box selecting" style={{ left: focusScreen.x, top: focusScreen.y, width: focusScreen.width, height: focusScreen.height }} />}</div>
        {(focusing || focusStart.current) && <div className="focus-picker" aria-label="Drag tutor focus area" onPointerDown={e => { const box = e.currentTarget.getBoundingClientRect(); focusStart.current = { x: e.clientX - box.left, y: e.clientY - box.top }; e.currentTarget.setPointerCapture(e.pointerId); }} onPointerMove={e => { const start = focusStart.current; if (!start) return; const b = e.currentTarget.getBoundingClientRect(); const x = e.clientX - b.left, y = e.clientY - b.top; setFocusScreen({ x: Math.min(x, start.x), y: Math.min(y, start.y), width: Math.abs(x - start.x), height: Math.abs(y - start.y) }); }} onPointerUp={finishFocus} />}
      </section>
      {showTutor && <TutorPanel key={project.drawingId ?? "legacy"} drawingId={project.drawingId} capture={capture} onHide={() => setShowTutor(false)} startFocus={() => setFocusing(true)} clearFocus={() => setFocuses([])} hasFocus={!!focuses.length} contextLabel={`Checkpoint ${(draft.index ?? attempt.chapters.length) + 1} · ${focuses.length ? `${focuses.length} focus region${focuses.length === 1 ? "" : "s"}` : "Visible canvas"}`} />}
    </main>
    <footer className="workspace-status"><span>{saveStatus}</span>{message && <span>{message}</span>}{saveError && <span role="alert">{saveError} <button onClick={() => void persist(current.current).catch(() => {})}>Retry saving</button></span>}</footer>
  </div>;
}
