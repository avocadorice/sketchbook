import { useCallback, useEffect, useRef, useState } from "react";
import { Excalidraw, MainMenu, restoreElements, exportToBlob, exportToCanvas, getCommonBounds } from "@excalidraw/excalidraw";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { AppState, BinaryFiles, ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { checkpoint, createAttempt, deleteChapter, sceneAt, updateChapter, normalizeScene, type Scene, moveChapter, skippedChanges } from "./history";
import { loadProject, parseImport, saveProject, storageLocation, type Project, type Timing } from "./storage";
import { tutorContext, matchesSearch, type Focus } from "./tutorContext";
import { draftKey, draftsAfterDelete, rekeyDrafts } from "./drafts";

import { TutorPanel } from "./TutorPanel";

const prompt = "Untitled drawing";
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
function freshProject(): Project {
  const attempt = createAttempt(prompt);
  return { drawingId: crypto.randomUUID(), attemptNumber: 1, attempt, draft: { id: crypto.randomUUID(), index: null, scene: sceneAt(attempt, -1), title: "", notes: "" }, files: {} };
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
  useEffect(() => { void loadProject().then(value => setLoaded(value ?? { project: freshProject(), revision: null })).catch(error => setError(String(error))); }, []);
  if (error) return <main className="load-error"><h1>Sketchbook could not open</h1><p role="alert">{error}</p><p>Your stored attempt has not been replaced. Close other practice tabs and reload.</p></main>;
  if (!loaded) return <main className="load-error">Opening your sketchbook…</main>;
  return <Practice initial={loaded.project} initialRevision={loaded.revision} />;
}

function Practice({ initial, initialRevision }: { initial: Project; initialRevision: string | null }): React.JSX.Element {
  const api = useRef<ExcalidrawImperativeAPI | null>(null);
  const [showLibrary, setShowLibrary] = useState(true);
  const [showTutor, setShowTutor] = useState(true);
  const [search, setSearch] = useState("");
  const [undo, setUndo] = useState<{ project: Project; label: string } | null>(null);
  const [focus, setFocus] = useState<Focus | null>(null);
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
  const onCanvasChange = useCallback((elements: readonly ExcalidrawElement[], appState: AppState, files: BinaryFiles): void => {
    if (loadingCanvas.current) return;
    if (focus && drawingBox.current) {
      const nextBox = { x: (focus.x + appState.scrollX) * appState.zoom.value, y: (focus.y + appState.scrollY) * appState.zoom.value,
        width: focus.width * appState.zoom.value, height: focus.height * appState.zoom.value };
      setFocusScreen(old => same(old, nextBox) ? old : nextBox);
    }
    const old = current.current; const scene = sceneFrom(elements, appState);
    const allFiles = { ...old.files, ...files };
    if (same(scene, old.draft.scene) && same(allFiles, old.files)) return;
    change({ ...old, files: allFiles, draft: { ...old.draft, scene } });
  }, [change, focus]);
  const loadCanvas = (next: Project): void => {
    setFocus(null); setFocusScreen(null); setFocusing(false); setUndo(null);
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
      next = first ? { ...first, files: old.files, past: rest } : { ...freshProject(), attemptNumber: (old.attemptNumber ?? 1) + 1, files: old.files };
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
  // A fresh attempt never deletes work: the current one moves to Drawing library and can be reopened.
  const shelved = (project: Project): Project["past"] => {
    const { drawingId, attemptNumber, attempt, draft, timing, drafts } = project;
    const empty = !attempt.chapters.length && !draft.scene.elements.length && !draft.title && !draft.notes && (attempt.prompt === prompt || !attempt.prompt);
    return empty && !drawingId ? project.past ?? [] : [{ drawingId, attemptNumber, savedAt: Date.now(), attempt, draft, ...(timing ? { timing } : {}), ...(drafts ? { drafts } : {}) }, ...(project.past ?? [])];
  };
  const resetAttempt = async (): Promise<void> => {
    if (busy) return;
    const old = current.current;
    const next: Project = { ...freshProject(), attemptNumber: Math.max(old.attemptNumber ?? 1, ...(old.past ?? []).map(p => p.attemptNumber ?? 0)) + 1, files: old.files, past: shelved(old), timing: { enabled: timingOf(old).enabled, chaptersMs: [], draftMs: 0 } };
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
    const next: Project = { files: old.files, ...restored, past };
    setBusy(true); loadingCanvas.current = true;
    try { await persist(next); loadCanvas(next); setMessage(`Reopened the attempt from ${new Date(chosen.savedAt).toLocaleString()}.${past.length > rest.length ? " The one you were on is under Drawing library." : ""}`); }
    catch { loadingCanvas.current = false; }
    finally { setBusy(false); }
  };
  const chapters = (count: number): string => `${count} checkpoint${count === 1 ? "" : "s"}`;
  const importAttempt = async (file: File): Promise<void> => {
    if (busy) return;
    let imported: Project;
    try { imported = parseImport(await file.text(), file.name.replace(/\.(excalidraw|json)$/i, "")); }
    catch (error) { setMessage(`Not imported: ${error instanceof Error ? error.message : String(error)}`); return; }
    imported.drawingId = crypto.randomUUID();
    imported.attempt.chapters = imported.attempt.chapters.map(c => ({ ...c, id: crypto.randomUUID() }));
    imported.attemptNumber = Math.max(current.current.attemptNumber ?? 0, ...(current.current.past ?? []).map(p => p.attemptNumber ?? 0)) + 1;
    imported.past = imported.past?.map((entry, i) => ({ ...entry, drawingId: crypto.randomUUID(), attemptNumber: imported.attemptNumber! + i + 1, attempt: { ...entry.attempt, chapters: entry.attempt.chapters.map(c => ({ ...c, id: crypto.randomUUID() })) } }));
    const old = current.current;
    // The current attempt is kept under Drawing library, alongside any the file brought.
    const next: Project = { ...imported, files: { ...old.files, ...imported.files }, past: [...(shelved(old) ?? []), ...(imported.past ?? [])] };
    setBusy(true); loadingCanvas.current = true;
    try { await persist(next); loadCanvas(next); setMessage(`Imported ${chapters(next.attempt.chapters.length)} from ${file.name}. Your previous attempt is under Drawing library.`); }
    catch { loadingCanvas.current = false; }
    finally { setBusy(false); }
  };
  const exportLibrary = (): void => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(current.current, null, 2)], { type: "application/json" }));
    const link = document.createElement("a"); link.href = url; link.download = "sketchbook-library.json"; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const capture = async () => {
    if (!current.current.drawingId) {
      const next = { ...current.current, drawingId: crypto.randomUUID() };
      await persist(next); current.current = next; setProject(next);
    }
    await persist(current.current);
    const instance = api.current;
    const context = tutorContext(current.current, focus);
    const ids = new Set(context.scene.elements.map(e => e.id));
    const elements = (instance?.getSceneElements() ?? []).filter(e => ids.has(e.id));
    let image: string | null = null;
    if (elements.length) {
      const opts = { elements, files: current.current.files, appState: { ...instance!.getAppState(), exportWithDarkMode: true, exportBackground: true }, maxWidthOrHeight: 2000, exportPadding: 0 };
      if (focus) {
        const canvas = await exportToCanvas(opts);
        const [x1, y1, x2, y2] = getCommonBounds(elements);
        const scaleX = canvas.width / Math.max(1, x2 - x1), scaleY = canvas.height / Math.max(1, y2 - y1);
        const cropped = document.createElement("canvas");
        const scale = Math.min(1, 1600 / Math.max(focus.width, focus.height));
        cropped.width = Math.max(1, Math.round(focus.width * scale)); cropped.height = Math.max(1, Math.round(focus.height * scale));
        const ctx = cropped.getContext("2d")!; ctx.fillStyle = "#121212"; ctx.fillRect(0, 0, cropped.width, cropped.height);
        ctx.drawImage(canvas, (focus.x - x1) * scaleX, (focus.y - y1) * scaleY, focus.width * scaleX, focus.height * scaleY, 0, 0, cropped.width, cropped.height);
        image = cropped.toDataURL("image/png");
      } else {
        const blob = await exportToBlob({ ...opts, mimeType: "image/png" });
        image = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = reject; reader.readAsDataURL(blob); });
      }
    }
    return { id: current.current.drawingId!, image, context };
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
    if (box.width > 8 && box.height > 8) {
      setFocus({ x: box.x / state.zoom.value - state.scrollX, y: box.y / state.zoom.value - state.scrollY, width: box.width / state.zoom.value, height: box.height / state.zoom.value }); setFocusScreen(box);
    }
    focusStart.current = null; setFocusing(false);
  };
  return <div className="practice-app">
    <header className="practice-header"><div><h1>Sketchbook <span className="hint">· Attempt #{project.attemptNumber ?? 1}</span></h1><label htmlFor="drawing-title">Drawing title</label><input id="drawing-title" maxLength={2000} disabled={busy} value={attempt.prompt} placeholder="Untitled drawing" onChange={event => change({ ...current.current, attempt: { ...current.current.attempt, prompt: event.target.value } })} /></div><nav><button aria-pressed={showLibrary} onClick={() => setShowLibrary(!showLibrary)}>Attempts</button><button aria-pressed={showTutor} onClick={() => setShowTutor(!showTutor)}>Tutor</button></nav></header>
    <main className="workspace" style={{ gridTemplateColumns: `${showLibrary ? "clamp(190px,20vw,260px) " : ""}minmax(0,1fr)${showTutor ? " clamp(300px,29vw,370px)" : ""}` }}>
      {showLibrary && <aside className="chapter-panel navigator" aria-label="Attempts and checkpoints">
        <label htmlFor="library-search">Search sketchbooks</label><input id="library-search" type="search" placeholder="Title or diagram text…" value={search} onChange={e => setSearch(e.target.value)} />
        <h2>Attempt #{project.attemptNumber ?? 1}</h2>
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
        <h3>Attempts</h3><button className="new-attempt" disabled={busy} onClick={() => void resetAttempt()}>＋ New Attempt</button>
        <ol className="attempt-list">
          {matchesSearch(project, search) && <li className="current-attempt"><div><strong>Attempt #{project.attemptNumber ?? 1}</strong><small>{attempt.prompt || "Untitled drawing"}</small><em>Current</em></div><button aria-label="Delete current attempt" onClick={() => void deleteAttempt(null)} disabled={busy}>×</button></li>}
          {project.past?.map((past, i) => matchesSearch(past, search) && <li key={past.drawingId ?? past.savedAt}><div><strong>Attempt #{past.attemptNumber ?? i + 1}</strong><small>{past.attempt.prompt || "Untitled drawing"}</small></div><button disabled={busy} aria-label={`Open attempt ${past.attemptNumber ?? i + 1}`} onClick={() => void openPast(i)}>Open</button><button aria-label={`Delete attempt ${past.attemptNumber ?? i + 1}`} disabled={busy} onClick={() => void deleteAttempt(i)}>×</button></li>)}
        </ol>
        <label className="import-attempt">Import drawing or library<input type="file" accept="application/json,.json,.excalidraw" disabled={busy} onChange={event => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void importAttempt(file); }} /></label><button disabled={busy} onClick={exportLibrary}>Export whole library</button>
      </aside>}
      <section ref={drawingBox} className="drawing" aria-label="Design canvas" aria-busy={busy}>
        <Excalidraw theme="dark" aiEnabled={false} key={canvasKey} excalidrawAPI={onReady} onChange={onCanvasChange} initialData={{ elements: canvasElements(draft.scene), appState: { viewBackgroundColor: draft.scene.backgroundColor }, files: project.files }} viewModeEnabled={busy}>
          <MainMenu><MainMenu.DefaultItems.LoadScene /><MainMenu.DefaultItems.SaveToActiveFile /><MainMenu.DefaultItems.Export /><MainMenu.DefaultItems.ClearCanvas /><MainMenu.Separator /><MainMenu.DefaultItems.ChangeCanvasBackground /></MainMenu>
        </Excalidraw>
        <div className="focus-controls"><button aria-pressed={focusing} onClick={() => setFocusing(!focusing)}>{focusing ? "Drag a tutor focus box…" : "Focus area"}</button>{focus && <button onClick={() => { setFocus(null); setFocusScreen(null); }}>Clear focus</button>}</div>
        {focusScreen && <div className="focus-box" style={{ left: focusScreen.x, top: focusScreen.y, width: focusScreen.width, height: focusScreen.height }}><span>Tutor focus</span></div>}
        {focusing && <div className="focus-picker" aria-label="Drag tutor focus area" onPointerDown={e => { const box = e.currentTarget.getBoundingClientRect(); focusStart.current = { x: e.clientX - box.left, y: e.clientY - box.top }; e.currentTarget.setPointerCapture(e.pointerId); }} onPointerMove={e => { const start = focusStart.current; if (!start) return; const b = e.currentTarget.getBoundingClientRect(); const x = e.clientX - b.left, y = e.clientY - b.top; setFocusScreen({ x: Math.min(x, start.x), y: Math.min(y, start.y), width: Math.abs(x - start.x), height: Math.abs(y - start.y) }); }} onPointerUp={finishFocus} />}
      </section>
      {showTutor && <TutorPanel key={project.drawingId ?? "legacy"} drawingId={project.drawingId} capture={capture} contextLabel={`Checkpoint ${(draft.index ?? attempt.chapters.length) + 1}${focus ? " · focus area" : " · full canvas"}`} />}
    </main>
    <footer className="workspace-status"><span>{saveStatus}</span>{message && <span>{message}</span>}{saveError && <span role="alert">{saveError} <button onClick={() => void persist(current.current).catch(() => {})}>Retry saving</button></span>}</footer>
  </div>;
}
