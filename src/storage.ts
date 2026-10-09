import type { BinaryFiles } from "@excalidraw/excalidraw/types";
import { checkpoint, createAttempt, normalizeScene, parseAttempt, type Attempt, type Scene } from "./history";
import type { Drafts } from "./drafts";

export type Draft = { id?: string; cleanSlate?: boolean; index: number | null; scene: Scene; title: string; notes: string };
export type Timing = { enabled: boolean; chaptersMs: number[]; draftMs: number };
/** An earlier attempt kept by "Start a fresh attempt"; images stay in the shared files map. */
export type PastAttempt = { drawingId?: string; attemptNumber?: number; savedAt: number; attempt: Attempt; draft: Draft; timing?: Timing; drafts?: Drafts };
export type Project = { drawingId?: string; attemptNumber?: number; attempt: Attempt; draft: Draft; files: BinaryFiles; timing?: Timing; drafts?: Drafts; past?: PastAttempt[] };
type SavedProject = { project: Project; revision: string };
const databaseName = "nexo-practice-v1";
const storeName = "projects";
const key = "current";

export class StorageConflictError extends Error {
  override name = "StorageConflictError";
  constructor() { super("This practice attempt changed in another tab or on another device. Reload to use its saved version; your current drawing has not overwritten it."); }
}

// Served by scripts/practice_server.py, the attempt lives on the host Mac and every device shares it.
// Anywhere else (for example the API's /static/practice/), it stays in this browser's IndexedDB.
type Location = "host" | "browser";
let where: Location = "browser";
const hostProject = (): string => new URL("api/project", window.location.href).href;
const askHost = (init?: RequestInit): Promise<Response | null> =>
  typeof window === "undefined" ? Promise.resolve(null) : fetch(hostProject(), init).catch(() => null);

export function storageLocation(): Location { return where; }

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function parseProject(value: unknown): Project {
  if (!object(value) || !object(value.draft) || !object(value.files)) {
    throw new Error("The saved practice project has an invalid format.");
  }
  const attempt = parseAttempt(value.attempt);
  const draft = value.draft;
  if ((draft.index !== null && (!Number.isInteger(draft.index)
    || (draft.index as number) < 0 || (draft.index as number) >= attempt.chapters.length))
    || typeof draft.title !== "string" || typeof draft.notes !== "string") {
    throw new Error("The saved drawing must name an existing checkpoint or the next one.");
  }
  for (const [id, file] of Object.entries(value.files)) {
    if (!id || !object(file) || file.id !== id || typeof file.mimeType !== "string"
      || typeof file.dataURL !== "string" || !file.dataURL.startsWith("data:")
      || typeof file.created !== "number" || !Number.isFinite(file.created)) {
      throw new Error("The saved practice project contains an invalid image.");
    }
  }
  let timing: Timing | undefined;
  if (value.timing !== undefined) {
    const saved = value.timing;
    const duration = (time: unknown): time is number => typeof time === "number" && Number.isFinite(time) && time >= 0;
    if (!object(saved) || typeof saved.enabled !== "boolean" || !Array.isArray(saved.chaptersMs)
      || saved.chaptersMs.length !== attempt.chapters.length || !saved.chaptersMs.every(duration)
      || !duration(saved.draftMs)) {
      throw new Error("Saved timing needs a nonnegative duration for every checkpoint and the current draft.");
    }
    timing = { enabled: saved.enabled, chaptersMs: [...saved.chaptersMs], draftMs: saved.draftMs };
  }
  let drafts: Drafts | undefined;
  if (value.drafts !== undefined) {
    if (!object(value.drafts)) throw new Error("Saved drafts have an invalid format.");
    drafts = {};
    for (const [key, saved] of Object.entries(value.drafts)) {
      const position = Number(key);
      if ((key !== "next" && !(Number.isInteger(position) && position >= 0 && position < attempt.chapters.length && String(position) === key))
        || !object(saved) || typeof saved.title !== "string" || typeof saved.notes !== "string") {
        throw new Error("A saved draft must belong to an existing checkpoint or the next one.");
      }
      drafts[key] = { ...(typeof saved.id === "string" ? { id: saved.id } : {}), ...(saved.cleanSlate === true ? { cleanSlate: true } : {}), scene: normalizeScene(saved.scene as Scene), title: saved.title, notes: saved.notes };
    }
  }
  let past: PastAttempt[] | undefined;
  if (value.past !== undefined) {
    if (!Array.isArray(value.past)) throw new Error("Saved past attempts have an invalid format.");
    past = value.past.map(entry => {
      if (!object(entry) || typeof entry.savedAt !== "number" || !Number.isFinite(entry.savedAt) || entry.past !== undefined) {
        throw new Error("A saved past attempt is invalid.");
      }
      // A past attempt has the same shape as the current one, minus the shared images.
      const { drawingId, attemptNumber, attempt: pastAttempt, draft: pastDraft, timing: pastTiming, drafts: pastDrafts } = parseProject({ ...entry, files: {} });
      return { ...(drawingId ? { drawingId } : {}), ...(attemptNumber ? { attemptNumber } : {}), savedAt: entry.savedAt, attempt: pastAttempt, draft: pastDraft,
        ...(pastTiming ? { timing: pastTiming } : {}), ...(pastDrafts ? { drafts: pastDrafts } : {}) };
    });
  }
  if (value.drawingId !== undefined && (typeof value.drawingId !== "string" || !/^[a-zA-Z0-9_-]{1,100}$/.test(value.drawingId))) throw new Error("Invalid drawing ID.");
  return {
    ...(typeof value.drawingId === "string" ? { drawingId: value.drawingId } : {}),
    ...(typeof value.attemptNumber === "number" && Number.isInteger(value.attemptNumber) && value.attemptNumber > 0 ? { attemptNumber: value.attemptNumber } : {}),
    attempt,
    ...(drafts && Object.keys(drafts).length ? { drafts } : {}),
    ...(past && past.length ? { past } : {}),
    draft: { ...(typeof draft.id === "string" ? { id: draft.id } : {}), ...(draft.cleanSlate === true ? { cleanSlate: true } : {}), index: draft.index as number | null, scene: normalizeScene(draft.scene as Scene),
      title: draft.title, notes: draft.notes },
    files: structuredClone(value.files) as BinaryFiles,
    ...(timing ? { timing } : {}),
  };
}

function parseSaved(value: unknown): SavedProject | null {
  if (value === undefined) return null;
  if (!object(value) || typeof value.revision !== "string" || !value.revision) {
    throw new Error("The saved practice revision is invalid. It has been kept unchanged.");
  }
  return { project: parseProject(value.project), revision: value.revision };
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName, 1);
    let blocked = false;
    request.onupgradeneeded = () => request.result.createObjectStore(storeName);
    request.onerror = () => reject(request.error ?? new Error("Practice storage could not open."));
    request.onblocked = () => { blocked = true; reject(new Error("Close other practice tabs and retry opening storage.")); };
    request.onsuccess = () => { if (blocked) request.result.close(); else resolve(request.result); };
  });
}

async function transaction<T>(
  mode: IDBTransactionMode, operation: (store: IDBObjectStore, saved: SavedProject | null) => T,
): Promise<T> {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(storeName, mode);
    const store = transaction.objectStore(storeName);
    let result: T;
    let failure: unknown;
    transaction.oncomplete = () => { database.close(); resolve(result); };
    transaction.onabort = () => {
      database.close();
      reject(failure ?? transaction.error ?? new Error("Practice storage did not finish. Your previous saved attempt is kept."));
    };
    const read = store.get(key);
    read.onsuccess = () => {
      try { result = operation(store, parseSaved(read.result)); }
      catch (error) { failure = error; transaction.abort(); }
    };
  });
}

export async function loadProject(): Promise<SavedProject | null> {
  const response = await askHost({ cache: "no-store" });
  if (response?.headers.get("X-Nexo-Practice-Store") === "host") {
    where = "host";
    if (response.status === 204) return null;
    if (!response.ok) throw new Error(`The host Mac could not read the practice attempt (${response.status}).`);
    return parseSaved(await response.json());
  }
  where = "browser";
  return transaction("readonly", (_store, saved) => saved);
}

/** Read an attempt exported from browser storage, either {revision, project} or a bare project. */
export function parseImport(text: string, title = "Imported drawing"): Project {
  const value: unknown = JSON.parse(text);
  if (object(value) && value.type === "excalidraw" && Array.isArray(value.elements)) {
    const scene = normalizeScene({ elements: value.elements.filter(element => !element.isDeleted), backgroundColor: object(value.appState) && typeof value.appState.viewBackgroundColor === "string" ? value.appState.viewBackgroundColor : "#ffffff" });
    return parseProject({ attempt: checkpoint(createAttempt(title), scene, "Imported drawing", ""), draft: { index: null, scene, title: "", notes: "" }, files: value.files ?? {} });
  }
  return parseProject(object(value) && "project" in value ? value.project : value);
}

export async function saveProject(project: Project, expectedRevision: string | null): Promise<string> {
  const validated = parseProject(project);
  if (where === "host") {
    const response = await askHost({
      method: "PUT", headers: { "Content-Type": "application/json", "X-Nexo-Practice": "1" },
      body: JSON.stringify({ expected_revision: expectedRevision, project: validated }),
    });
    if (!response) throw new Error("The host Mac is not reachable. Check that practice_server.py is running, then retry.");
    if (response.status === 409) throw new StorageConflictError();
    const result = await response.json().catch(() => ({})) as { revision?: unknown; error?: unknown };
    if (!response.ok || typeof result.revision !== "string") {
      throw new Error(typeof result.error === "string" ? result.error : `The host Mac did not save the attempt (${response.status}).`);
    }
    return result.revision;
  }
  return transaction("readwrite", (store, saved) => {
    // The revision check and replacement share one transaction, so competing tabs cannot both win.
    if ((saved?.revision ?? null) !== expectedRevision) throw new StorageConflictError();
    const revision = crypto.randomUUID();
    store.put({ project: validated, revision }, key);
    return revision;
  });
}
