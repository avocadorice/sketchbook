/** One linear attempt: each chapter stores only what changed since its predecessor. */
export type Element = { id: string; [field: string]: unknown };
export type Scene = { elements: Element[]; backgroundColor: string };
export type ElementChange = { id: string; set: Record<string, unknown>; unset: string[] };
export type SceneDelta = {
  added: Element[];
  removed: string[];
  changed: ElementChange[];
  order?: string[];
  backgroundColor?: string;
};
export type Chapter = { id?: string; reset?: boolean; title: string; notes: string; delta: SceneDelta };
export type Attempt = { version: 1; prompt: string; chapters: Chapter[] };

const transientFields = new Set(["version", "versionNonce", "updated", "index"]);
const blank = (): Scene => ({ elements: [], backgroundColor: "#ffffff" });

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function copy(value: unknown): unknown {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (Array.isArray(value)) return value.map(copy);
  if (record(value)) return Object.fromEntries(Object.keys(value).sort()
    .filter(key => value[key] !== undefined).map(key => [key, copy(value[key])]));
  throw new Error("A drawing must contain only JSON values.");
}

function same(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (Array.isArray(left) && Array.isArray(right)) {
    return left.length === right.length && left.every((value, index) => same(value, right[index]));
  }
  if (record(left) && record(right)) {
    const keys = Object.keys(left);
    return keys.length === Object.keys(right).length
      && keys.every(key => Object.hasOwn(right, key) && same(left[key], right[key]));
  }
  return false;
}

function string(value: unknown, label: string, limit = Infinity): asserts value is string {
  if (typeof value !== "string" || value.length > limit) {
    throw new Error(`${label} must be text${limit < Infinity ? ` of at most ${limit} characters` : ""}.`);
  }
}

function ids(value: unknown, label: string): asserts value is string[] {
  if (!Array.isArray(value) || value.some(id => typeof id !== "string" || !id)
    || new Set(value).size !== value.length) throw new Error(`${label} needs distinct element IDs.`);
}

function element(value: unknown): Element {
  if (!record(value) || typeof value.id !== "string" || !value.id) {
    throw new Error("Every drawing element needs an ID.");
  }
  return Object.fromEntries(Object.keys(value).sort()
    .filter(key => !transientFields.has(key) && value[key] !== undefined)
    // Excalidraw restores an empty binding list as [], even when the saved element used null.
    .map(key => [key, key === "boundElements" && value[key] === null ? [] : copy(value[key])])) as Element;
}

/** Ignore edit counters and fractional indices; the array gives layer order. Keep drawing seeds. */
export function normalizeScene(value: Scene): Scene {
  if (!record(value) || !Array.isArray(value.elements)) throw new Error("Expected a drawing scene.");
  string(value.backgroundColor, "Background color");
  const elements = value.elements.map(element);
  ids(elements.map(item => item.id), "The drawing");
  return { elements, backgroundColor: value.backgroundColor };
}

function deltaBetween(before: Scene, after: Scene): SceneDelta {
  const previous = new Map(before.elements.map(item => [item.id, item]));
  const next = new Map(after.elements.map(item => [item.id, item]));
  const added = after.elements.filter(item => !previous.has(item.id));
  const removed = before.elements.filter(item => !next.has(item.id)).map(item => item.id);
  const changed: ElementChange[] = [];
  for (const current of after.elements) {
    const old = previous.get(current.id);
    if (!old) continue;
    const set = Object.fromEntries(Object.entries(current)
      .filter(([key, value]) => key !== "id" && (!Object.hasOwn(old, key) || !same(old[key], value))));
    const unset = Object.keys(old).filter(key => key !== "id" && !Object.hasOwn(current, key));
    if (Object.keys(set).length || unset.length) changed.push({ id: current.id, set, unset });
  }
  const delta: SceneDelta = { added, removed, changed };
  const naturalOrder = [...before.elements.filter(item => next.has(item.id)), ...added]
    .map(item => item.id);
  const order = after.elements.map(item => item.id);
  if (!same(naturalOrder, order)) delta.order = order;
  if (before.backgroundColor !== after.backgroundColor) delta.backgroundColor = after.backgroundColor;
  return delta;
}

function applyDelta(before: Scene, delta: SceneDelta): Scene {
  const removed = new Set(delta.removed);
  const elements = new Map(before.elements.filter(item => !removed.has(item.id))
    .map(item => [item.id, element(item)]));
  // A later move or label edit does not bring back an element deleted from an earlier chapter.
  for (const change of delta.changed) {
    const current = elements.get(change.id);
    if (!current) continue;
    for (const key of change.unset) delete current[key];
    for (const [key, value] of Object.entries(change.set)) {
      Object.defineProperty(current, key, { value: copy(value), writable: true,
        configurable: true, enumerable: true });
    }
  }
  // An explicit later addition is different: undo/re-add can deliberately restore that stable ID.
  for (const added of delta.added) {
    elements.delete(added.id);
    elements.set(added.id, element(added));
  }
  let order = [...elements.keys()];
  if (delta.order) {
    const requested = delta.order.filter(id => elements.has(id));
    const known = new Set(requested);
    let index = 0;
    // New elements inherited from an earlier edit keep their slots among the explicitly ordered IDs.
    order = order.map(id => known.has(id) ? requested[index++] : id);
  }
  return { elements: order.map(id => elements.get(id)!),
    backgroundColor: delta.backgroundColor ?? before.backgroundColor };
}

export function createAttempt(prompt: string): Attempt {
  string(prompt, "Problem prompt", 10000);
  return { version: 1, prompt, chapters: [] };
}

function chapterIndex(attempt: Attempt, index: number): void {
  if (!Number.isInteger(index) || index < 0 || index >= attempt.chapters.length) {
    throw new Error("Choose an existing checkpoint.");
  }
}

/** Index -1 is the blank starting canvas; omitted index materializes the latest checkpoint. */
export function sceneAt(attempt: Attempt, index = attempt.chapters.length - 1): Scene {
  if (index !== -1) chapterIndex(attempt, index);
  let scene = blank();
  for (let chapter = 0; chapter <= index; chapter++) {
    scene = applyDelta(attempt.chapters[chapter].reset ? blank() : scene, attempt.chapters[chapter].delta);
  }
  return normalizeScene(scene);
}

function chapter(before: Scene, scene: Scene, title: string, notes: string): Chapter {
  string(title, "Chapter title", 200);
  string(notes, "Chapter notes", 20000);
  return { title, notes, delta: deltaBetween(before, normalizeScene(scene)) };
}

export function checkpoint(attempt: Attempt, scene: Scene, title: string, notes: string): Attempt {
  const result = copy(attempt) as Attempt;
  result.chapters.push(chapter(sceneAt(attempt), scene, title, notes));
  return result;
}

/** Later field changes remain intact: a later explicit change to the same field wins. */
export function updateChapter(
  attempt: Attempt, index: number, scene: Scene, title: string, notes: string,
): Attempt {
  chapterIndex(attempt, index);
  const result = copy(attempt) as Attempt;
  result.chapters[index] = { ...result.chapters[index], ...chapter(result.chapters[index].reset ? blank() : sceneAt(attempt, index - 1), scene, title, notes) };
  return result;
}

/** Removing a chapter removes its changes, then later chapters replay on the remaining history. */
export function deleteChapter(attempt: Attempt, index: number): Attempt {
  chapterIndex(attempt, index);
  const result = copy(attempt) as Attempt;
  result.chapters.splice(index, 1);
  return result;
}

/**
 * Moving a chapter moves its stored changes: what it adds now appears at the new position.
 * Edits to elements that only exist later are skipped while replaying, but stay stored, so moving
 * the chapter back restores them.
 */
export function moveChapter(attempt: Attempt, from: number, to: number): Attempt {
  chapterIndex(attempt, from);
  chapterIndex(attempt, to);
  const result = copy(attempt) as Attempt;
  const [moved] = result.chapters.splice(from, 1);
  result.chapters.splice(to, 0, moved!);
  return result;
}

/** Count a chapter's element edits and removals that would have nothing to act on at its position. */
export function skippedChanges(attempt: Attempt, index: number): number {
  chapterIndex(attempt, index);
  const present = new Set(sceneAt(attempt, index - 1).elements.map(item => item.id));
  const { changed, removed } = attempt.chapters[index]!.delta;
  return changed.filter(change => !present.has(change.id)).length
    + removed.filter(id => !present.has(id)).length;
}

function exactKeys(value: Record<string, unknown>, required: string[], optional: string[] = []): void {
  if (required.some(key => !Object.hasOwn(value, key))
    || Object.keys(value).some(key => !required.includes(key) && !optional.includes(key))) {
    throw new Error("The saved practice attempt has an unexpected format.");
  }
}

/** Validate browser-stored version 1 data before using its deltas, returning an independent copy. */
export function parseAttempt(value: unknown): Attempt {
  if (!record(value) || value.version !== 1 || !Array.isArray(value.chapters)) {
    throw new Error("This is not a supported practice attempt.");
  }
  exactKeys(value, ["version", "prompt", "chapters"]);
  string(value.prompt, "Problem prompt", 10000);
  const chapters: Chapter[] = value.chapters.map(item => {
    if (!record(item) || !record(item.delta)) throw new Error("Expected a saved checkpoint.");
    exactKeys(item, ["title", "notes", "delta"], ["id", "reset"]);
    if (item.id !== undefined) string(item.id, "Checkpoint ID", 100);
    if (item.reset !== undefined && typeof item.reset !== "boolean") throw new Error("Invalid checkpoint reset flag.");
    string(item.title, "Chapter title", 200);
    string(item.notes, "Chapter notes", 20000);
    const delta = item.delta;
    exactKeys(delta, ["added", "removed", "changed"], ["order", "backgroundColor"]);
    if (!Array.isArray(delta.added) || !Array.isArray(delta.changed)) {
      throw new Error("Expected the checkpoint's element changes.");
    }
    const added = delta.added.map(element);
    ids(added.map(item => item.id), "Added elements");
    ids(delta.removed, "Removed elements");
    const changed = delta.changed.map(item => {
      if (!record(item) || typeof item.id !== "string" || !item.id || !record(item.set)) {
        throw new Error("Expected an element's field changes.");
      }
      exactKeys(item, ["id", "set", "unset"]);
      ids(item.unset, "Unset fields");
      const fields = [...Object.keys(item.set), ...item.unset];
      if (fields.some(key => key === "id" || transientFields.has(key))
        || new Set(fields).size !== fields.length) throw new Error("Invalid changed element fields.");
      return { id: item.id, set: copy(item.set) as Record<string, unknown>, unset: [...item.unset] };
    });
    ids([...added.map(item => item.id), ...delta.removed, ...changed.map(item => item.id)],
      "Chapter changes");
    const clean: SceneDelta = { added, removed: [...delta.removed], changed };
    if (delta.order !== undefined) {
      ids(delta.order, "Layer order");
      clean.order = [...delta.order];
    }
    if (delta.backgroundColor !== undefined) {
      string(delta.backgroundColor, "Background color");
      clean.backgroundColor = delta.backgroundColor;
    }
    return { ...(typeof item.id === "string" ? { id: item.id } : {}), ...(item.reset === true ? { reset: true } : {}), title: item.title, notes: item.notes, delta: clean };
  });
  return { version: 1, prompt: value.prompt, chapters };
}
