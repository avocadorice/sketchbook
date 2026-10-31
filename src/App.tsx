import { useCallback, useEffect, useRef, useState } from "react";
import { Excalidraw, MainMenu, restoreElements } from "@excalidraw/excalidraw";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import type { AppState, BinaryFiles, ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { normalizeScene, type Scene } from "./history";
import { loadProject, parseImport, saveProject, storageLocation, StorageConflictError, type Project } from "./storage";
import { recoverProject } from "./recovery";
import { tutorContext, tutorConversationContext, matchesSearch, type Focus } from "./tutorContext";
import { organizeProblems, renameProblem, tagProblem, matchesCompany, newestProblems } from "./problems";
import { captureViewport, visibleRegions, screenToScene, sceneToScreen, type View } from "./viewport";
import { createSketchProject, deleteProblem, isSketchProject, legacyView, openProblem, shelveProject, type LegacySelection } from "./workspace";
import { LegacyHistory } from "./LegacyHistory";
import { ProblemList } from "./ProblemList";

import { TutorMarkdown } from "../../shared/TutorMarkdown";
import { TutorPanel } from "./TutorPanel";
import { TutorPaneResizer, useTutorPaneLayout } from "./TutorPaneResizer";
import { tutorDividerWidth } from "./tutorPaneLayout";
import { ProblemPaneResizer, useProblemPaneLayout } from "./ProblemPaneResizer";
import { problemDividerWidth } from "./problemPaneLayout";
import { NavigatorTabs, type NavigatorSection } from "./NavigatorTabs";
import { TagEditor } from "./TagEditor";
import { FocusToolbar, useFocusMode } from "./DesignFocus";
import { hideFocusPane, visibleFocusPanes } from "./focusMode";

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
    if (!value) { setLoaded({ project: createSketchProject(), revision: null }); return; }
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
  const focusMode = useFocusMode();
  const visible = visibleFocusPanes(focusMode.enabled, focusMode.preset, { library: showLibrary, tutor: showTutor });
  const hidePane = (pane: 'library' | 'tutor') => {
    if (focusMode.enabled) focusMode.setPreset(hideFocusPane(focusMode.preset, pane));
    else if (pane === 'library') setShowLibrary(false);
    else setShowTutor(false);
  };
  const tutorLayout = useTutorPaneLayout(visible.library, problemDividerWidth);
  const problemLayout = useProblemPaneLayout(tutorLayout.workspaceRef);
  const [navigatorSection, setNavigatorSection] = useState<NavigatorSection>('problems');
  const showCurrentProblem = () => {
    setNavigatorSection('attempt');
    requestAnimationFrame(() => document.getElementById('navigator-tab-attempt')?.focus());
  };
  const [search, setSearch] = useState("");
  const [tagFilter, setTagFilter] = useState("");
  const [legacySelection, setLegacySelection] = useState<LegacySelection>(null);
  const viewing = useRef(initial);
  const [focuses, setFocuses] = useState<Focus[]>([]);
  const [view, setView] = useState<View>({ scrollX: 0, scrollY: 0, zoom: 1, width: 1, height: 1 });
  const [focusing, setFocusing] = useState(false);
  const focusStart = useRef<{ x: number; y: number } | null>(null);
  const [focusScreen, setFocusScreen] = useState<Focus | null>(null);
  const drawingBox = useRef<HTMLElement>(null);
  const [project, setProject] = useState(initial);
  const current = useRef(initial);
  const revision = useRef(initialRevision);
  const savedProject = useRef(initial);
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
          savedProject.current = snapshot;
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
    if (!isSketchProject(current.current)) return;
    current.current = next; setProject(next); setMessage("");
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
    const old = current.current;
    if (!isSketchProject(old)) return;
    const scene = sceneFrom(elements, appState);
    const allFiles = { ...old.files, ...files };
    if (same(scene, old.draft.scene) && same(allFiles, old.files)) return;
    change({ ...old, files: allFiles, draft: { ...old.draft, scene } });
  }, [change]);
  const loadCanvas = (next: Project): void => {
    setFocuses([]); setFocusScreen(null); setFocusing(false); setLegacySelection(null);
    loadingCanvas.current = true; current.current = next; setProject(next); setCanvasKey(value => value + 1);
  };
  const onReady = useCallback((instance: ExcalidrawImperativeAPI): void => {
    api.current = instance;
    requestAnimationFrame(() => { loadingCanvas.current = false; if (instance.getSceneElements().length) instance.scrollToContent(undefined, { fitToViewport: true, maxZoom: 1 }); });
  }, []);
  const selectLegacyCheckpoint = (selection: LegacySelection): void => {
    if (busy || isSketchProject(current.current)) return;
    loadingCanvas.current = true;
    setFocuses([]); setFocusScreen(null); setFocusing(false);
    setLegacySelection(selection); setCanvasKey(value => value + 1);
  };
  const newProblem = async (): Promise<void> => {
    if (busy) return;
    const old = current.current; const fresh = createSketchProject();
    const next: Project = { ...fresh, problems: [...(old.problems ?? []), ...fresh.problems!], files: old.files, past: shelveProject(old) };
    setBusy(true); loadingCanvas.current = true;
    try { await persist(next); loadCanvas(next); showCurrentProblem(); setMessage("New problem ready. Your sketch saves automatically."); }
    catch { loadingCanvas.current = false; }
    finally { setBusy(false); }
  };
  const openPast = async (position: number): Promise<void> => {
    const old = current.current;
    if (busy || !old.past?.[position]) return;
    const next = openProblem(old, position);
    setBusy(true); loadingCanvas.current = true;
    try { await persist(next); loadCanvas(next); showCurrentProblem(); setMessage(isSketchProject(next) ? "" : "Archived problem · Read only."); }
    catch { loadingCanvas.current = false; }
    finally { setBusy(false); }
  };
  const removeProblem = async (problemId: string): Promise<void> => {
    if (busy) return;
    const old = current.current;
    const problem = old.problems?.find(problem => problem.id === problemId);
    if (!problem || !window.confirm(`Delete “${problem.title || 'Untitled problem'}” and all its sketches and checkpoints? This cannot be undone.`)) return;
    const next = deleteProblem(old, problemId);
    setBusy(true); loadingCanvas.current = true;
    try {
      await persist(next);
      if (old.problemId === problemId) loadCanvas(next);
      else { current.current = next; setProject(next); loadingCanvas.current = false; }
      setMessage(`Deleted “${problem.title || 'Untitled problem'}”.`);
    } catch { loadingCanvas.current = false; }
    finally { setBusy(false); }
  };
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
    const next: Project = { ...imported, problems: [...(old.problems ?? []), ...imported.problems], files: { ...old.files, ...imported.files }, past: [...(shelveProject(old) ?? []), ...(imported.past ?? [])] };
    setBusy(true); loadingCanvas.current = true;
    try { await persist(next); loadCanvas(next); showCurrentProblem(); setMessage(`Imported ${file.name}. Your previous problems are kept in Problems.`); }
    catch { loadingCanvas.current = false; }
    finally { setBusy(false); }
  };
  const exportLibrary = (): void => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(current.current, null, 2)], { type: "application/json" }));
    const link = document.createElement("a"); link.href = url; link.download = "practice-problems.json"; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const retrySave = async (): Promise<void> => {
    if (busy) return;
    if (writer.current) await writer.current.catch(() => {});
    if (!(failure.current instanceof StorageConflictError)) { await persist(current.current).catch(() => {}); return; }
    setBusy(true); loadingCanvas.current = true;
    try {
      const latest = await loadProject(storageLocation() === 'host');
      if (!latest) throw new Error('The saved library is unavailable. Export your open work and retry.');
      const recovered = recoverProject(current.current, latest.project, savedProject.current);
      const nextRevision = await saveProject(recovered, latest.revision);
      revision.current = nextRevision; savedProject.current = recovered;
      failure.current = null; pending.current = null; setSaveError(''); setSaveStatus(savedLabel);
      loadCanvas(recovered); setMessage('Work recovered and saved. Concurrent edits are kept as separate sketches.');
      window.parent.dispatchEvent(new Event('practicepad-saved'));
    } catch (error) {
      // The conflict remains unresolved even if recovery failed because the host was offline.
      failure.current = new StorageConflictError();
      setSaveError(error instanceof Error ? error.message : String(error)); setSaveStatus('Not saved'); loadingCanvas.current = false;
    } finally { setBusy(false); }
  };
  const capture = async (includeCanvas: boolean) => {
    if (includeCanvas) {
      if (!api.current || !drawingBox.current) throw new Error("The canvas is not ready.");
      // Freeze the visible pixels and scene together, before waiting for network persistence.
      await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    }
    const snapshot = viewing.current;
    let image: string | null = null;
    let context;
    if (includeCanvas) {
      const state = api.current!.getAppState();
      const viewport = { scrollX: state.scrollX, scrollY: state.scrollY, zoom: state.zoom.value, width: state.width, height: state.height };
      image = captureViewport(drawingBox.current!, focuses, viewport);
      context = { ...tutorContext(snapshot, visibleRegions(focuses, viewport)), captureMode: focuses.length ? "focus-regions" : "visible-viewport", viewport };
    } else {
      context = { ...tutorConversationContext(snapshot), captureMode: "conversation-only" };
    }
    if (isSketchProject(snapshot)) await persist(snapshot);
    else { if (writer.current) await writer.current; if (failure.current) throw failure.current; }
    return { id: snapshot.drawingId!, image, context: { ...context, problemId: snapshot.problemId, attemptNumber: snapshot.attemptNumber } };
  };
  useEffect(() => {
    window.sketchbookFlushDraft = async () => { if (writer.current) await writer.current; if (failure.current) throw failure.current; };
    return () => { delete window.sketchbookFlushDraft; };
  }, [persist]);
  const displayed = legacyView(project, legacySelection);
  viewing.current = displayed;
  const { draft, attempt } = displayed;
  const readOnly = !isSketchProject(project);
  const finishFocus = (event: React.PointerEvent<HTMLDivElement>): void => {
    const start = focusStart.current; if (!start || !api.current) return;
    const bounds = event.currentTarget.getBoundingClientRect(); const end = { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
    const box = { x: Math.min(start.x, end.x), y: Math.min(start.y, end.y), width: Math.abs(end.x - start.x), height: Math.abs(end.y - start.y) };
    const state = api.current.getAppState();
    if (box.width > 8 && box.height > 8) setFocuses(old => [...old, screenToScene(box, { ...view, scrollX: state.scrollX, scrollY: state.scrollY, zoom: state.zoom.value })]);
    focusStart.current = null; setFocusScreen(null); setFocusing(event.altKey && event.shiftKey);
  };
  const entries = [{ entry: project, position: null as number | null }, ...(project.past ?? []).map((entry, position) => ({ entry, position }))];
  const activeProblem = project.problems?.find(p => p.id === project.problemId);
  const tags = [...new Map((project.problems ?? []).flatMap(p => p.companies ?? []).map(tag => [tag.toLowerCase(), tag])).values()].sort((a, b) => a.localeCompare(b));
  const groups = newestProblems(project).filter(problem => matchesCompany(problem, tagFilter)).map(problem => ({ problem, entries: entries.filter(({ entry }) => entry.problemId === problem.id && (matchesSearch(entry, search) || (!!search.trim() && search.toLowerCase().trim().split(/\s+/).every(word => `${problem.title} ${problem.description || ''} ${problem.intuition || ''} ${(problem.companies ?? []).join(' ')}`.toLowerCase().includes(word))))).sort((a, b) => (a.entry.attemptNumber ?? 1) - (b.entry.attemptNumber ?? 1)) })).filter(g => g.entries.length);
  return <div className={`practice-app${focusMode.enabled ? ' design-focus-mode' : ''}`} data-focus-layout={focusMode.enabled ? focusMode.preset : undefined}>
    <header className="practice-header" hidden={focusMode.enabled}>
      <div className="app-identity"><h1>System Design Practice</h1><input aria-label="Practice problem title" maxLength={2000} disabled={busy} readOnly={readOnly} value={attempt.prompt} placeholder="Untitled problem" onChange={e => change(renameProblem(current.current, e.target.value))} /></div>
      <nav><button aria-pressed={showLibrary} onClick={() => setShowLibrary(!showLibrary)}>Problems</button><button aria-pressed={showTutor} onClick={() => setShowTutor(!showTutor)}>Tutor</button><button ref={focusMode.enterButton} onClick={() => focusMode.setEnabled(true)} aria-label="Enter Focus mode">Focus</button></nav>
    </header>
    {focusMode.enabled && <FocusToolbar preset={focusMode.preset} onPresetChange={focusMode.setPreset} onExit={() => focusMode.setEnabled(false)} exitButton={focusMode.exitButton}
      context={`${attempt.prompt}${readOnly ? ` · Read only · Checkpoint ${(draft.index ?? attempt.chapters.length) + 1}` : ""}`} />}
    <main ref={tutorLayout.workspaceRef} className="workspace" style={{ gridTemplateColumns: `${visible.library ? `${problemLayout.width}px ${problemDividerWidth}px ` : ""}minmax(0,1fr)${visible.tutor ? ` ${tutorDividerWidth}px ${tutorLayout.width}px` : ""}` }}>
      <aside id="design-problems-pane" ref={tutorLayout.libraryRef} className="chapter-panel navigator" aria-label="Practice problems" hidden={!visible.library}>
        <div className="pane-heading"><h2>Practice Problems</h2><button aria-label="Hide problems pane" onClick={() => hidePane('library')}>×</button></div>
        <div className="new-problem-row"><button disabled={busy} onClick={() => void newProblem()}>＋ New Problem</button></div>
        <NavigatorTabs section={navigatorSection} onChange={setNavigatorSection} />
        <div id="navigator-panel-problems" className="navigator-browser" role="tabpanel" aria-labelledby="navigator-tab-problems" hidden={navigatorSection !== 'problems'}>
        <div className="navigator-filters">
        <div className="problem-search"><svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 4 4" /></svg><input aria-label="Search practice problems" type="search" placeholder="Search problems or sketch text" value={search} onChange={e => setSearch(e.target.value)} /></div>
        <label htmlFor="tag-filter">Filter by tag</label><select id="tag-filter" className="tag-filter" value={tagFilter} onChange={e => setTagFilter(e.target.value)}><option value="">All tags</option>{[...new Set([...tags, ...(tagFilter && !tags.includes(tagFilter) ? [tagFilter] : [])])].map(tag => <option key={tag} value={tag}>{tag}</option>)}</select>
        <div className="navigator-results"><span role="status">{groups.length} {search || tagFilter ? `of ${project.problems?.length ?? 0} ` : ''}problem{(search || tagFilter ? project.problems?.length : groups.length) === 1 ? '' : 's'}</span>{(search || tagFilter) ? <button onClick={() => { setSearch(''); setTagFilter(''); }}>Clear filters</button> : <span>Newest first</span>}</div>
        </div>
        <ProblemList groups={groups} activeId={project.drawingId} disabled={busy} onDelete={id => void removeProblem(id)} onOpen={position => position === null ? showCurrentProblem() : void openPast(position)} />
        <details className="navigator-transfer"><summary>Import / export</summary><label className="import-attempt">Import sketch or problems<input type="file" accept="application/json,.json,.excalidraw" disabled={busy} onChange={event => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void importAttempt(file); }} /></label><button disabled={busy} onClick={exportLibrary}>Export all problems</button></details>
        </div>
        <div id="navigator-panel-attempt" className="navigator-attempt" role="tabpanel" aria-labelledby="navigator-tab-attempt" hidden={navigatorSection !== 'attempt'}>
        <p className="active-problem-title">{activeProblem?.title || attempt.prompt || 'Untitled problem'}</p>
        {readOnly ? <LegacyHistory project={project} selection={legacySelection} disabled={busy} onSelect={selectLegacyCheckpoint} /> : <p className="hint">Your sketch saves automatically. Create a new problem for another sketch.</p>}
        <div className="problem-details-heading">Problem details</div>
        <details className="problem-tag-details"><summary>Tags{activeProblem?.companies?.length ? ` · ${activeProblem.companies.length}` : ''}</summary>{readOnly ? <div className="problem-tags">{(activeProblem?.companies ?? []).map(tag => <span key={tag}>{tag}</span>)}</div> : <TagEditor key={project.problemId} tags={activeProblem?.companies ?? []} suggestions={tags} disabled={busy} onChange={tags => change(tagProblem(current.current, tags))} />}</details>
        {activeProblem?.description && <details className="imported-question" open><summary>Interview question</summary><TutorMarkdown>{activeProblem.description}</TutorMarkdown>
          {activeProblem.asked && <p>Asked {activeProblem.asked.fromMonth} – {activeProblem.asked.toMonth}. {activeProblem.asked.note}</p>}
          {activeProblem.source && /^https:\/\/(www\.)?(1point3acres\.com|hellointerview\.com)\//.test(activeProblem.source) && <a href={activeProblem.source} target="_blank" rel="noreferrer">Original interview report</a>}
        </details>}
        </div>
      </aside>
      {visible.library && <ProblemPaneResizer width={problemLayout.width} bounds={problemLayout.bounds} onResize={problemLayout.resize} />}
      <section ref={drawingBox} className="drawing" aria-label="Design canvas" aria-busy={busy}>
        {readOnly && <div className="canvas-archive-label">Archived sketch · Read only</div>}
        <Excalidraw theme="dark" aiEnabled={false} key={canvasKey} excalidrawAPI={onReady} onChange={onCanvasChange} initialData={{ elements: canvasElements(draft.scene), appState: { viewBackgroundColor: draft.scene.backgroundColor }, files: project.files }} viewModeEnabled={busy || readOnly}
          UIOptions={{ canvasActions: { loadScene: !readOnly, clearCanvas: !readOnly, changeViewBackgroundColor: !readOnly } }}>
          <MainMenu>{!readOnly && <MainMenu.DefaultItems.LoadScene />}<MainMenu.DefaultItems.SaveToActiveFile /><MainMenu.DefaultItems.Export />{!readOnly && <><MainMenu.DefaultItems.ClearCanvas /><MainMenu.Separator /><MainMenu.DefaultItems.ChangeCanvasBackground /></>}</MainMenu>
        </Excalidraw>
        <div className="focus-overlays">{focuses.map((focus, i) => { const box = sceneToScreen(focus, view); return <div key={i} className="focus-box" style={{ left: box.x, top: box.y, width: box.width, height: box.height }}><span>Focus {i + 1} <button aria-label={`Remove focus ${i + 1}`} onClick={() => setFocuses(old => old.filter((_, n) => n !== i))}>×</button></span></div>; })}
        {focusScreen && <div className="focus-box selecting" style={{ left: focusScreen.x, top: focusScreen.y, width: focusScreen.width, height: focusScreen.height }} />}</div>
        {(focusing || focusStart.current) && <div className="focus-picker" aria-label="Drag tutor focus area" onPointerDown={e => { const box = e.currentTarget.getBoundingClientRect(); focusStart.current = { x: e.clientX - box.left, y: e.clientY - box.top }; e.currentTarget.setPointerCapture(e.pointerId); }} onPointerMove={e => { const start = focusStart.current; if (!start) return; const b = e.currentTarget.getBoundingClientRect(); const x = e.clientX - b.left, y = e.clientY - b.top; setFocusScreen({ x: Math.min(x, start.x), y: Math.min(y, start.y), width: Math.abs(x - start.x), height: Math.abs(y - start.y) }); }} onPointerUp={finishFocus} />}
      </section>
      {visible.tutor && <TutorPaneResizer width={tutorLayout.width} bounds={tutorLayout.bounds} onResize={tutorLayout.resize} />}
      <TutorPanel readOnly={readOnly} key={project.drawingId ?? "legacy"} hidden={!visible.tutor} drawingId={project.drawingId} attachmentScope={`${project.drawingId}:${draft.index === null ? draft.id ?? `next-${attempt.chapters.length}` : attempt.chapters[draft.index]?.id ?? draft.index}`} capture={capture} onHide={() => hidePane('tutor')} startFocus={() => setFocusing(true)} clearFocus={() => setFocuses([])} hasFocus={!!focuses.length} contextLabel={`${readOnly ? `Checkpoint ${(draft.index ?? attempt.chapters.length) + 1} · ` : ""}${focuses.length ? `${focuses.length} focus region${focuses.length === 1 ? "" : "s"}` : "Visible canvas"}`} />
    </main>
    <footer className="workspace-status" hidden={focusMode.enabled && !saveError && !message}><span>{saveStatus}</span>{message && <span>{message}</span>}{saveError && <span role="alert">{saveError} <button disabled={busy} onClick={() => void retrySave()}>Retry saving</button> <button disabled={busy} onClick={exportLibrary}>Export recovery backup</button></span>}</footer>
  </div>;
}
