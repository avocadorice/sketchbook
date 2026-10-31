import { organizeProblems, type Problem } from './problems';
import type { Project, PastAttempt } from './storage';

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
const attemptData = ({ savedAt: _savedAt, ...entry }: PastAttempt): Omit<PastAttempt, 'savedAt'> => entry;
const entries = (project: Project): PastAttempt[] => {
  const { problemId, drawingId, attemptNumber, attempt, draft, timing, drafts } = project;
  return [{ problemId, drawingId, attemptNumber, attempt, draft, ...(timing ? { timing } : {}), ...(drafts ? { drafts } : {}), savedAt: Date.now() }, ...(project.past ?? [])];
};
/** Reconcile whole attempts; concurrent edits stay as separate, reopenable copies. */
export function recoverProject(localValue: Project, remoteValue: Project, baseValue?: Project): Project {
  const local = organizeProblems(structuredClone(localValue));
  const remote = organizeProblems(structuredClone(remoteValue));
  const base = baseValue ? organizeProblems(structuredClone(baseValue)) : undefined;
  const problems = [...remote.problems!];
  const problemIds = new Map<string, string>();
  for (const problem of local.problems!) {
    const saved = problems.find(p => p.id === problem.id);
    const previous = base?.problems?.find(p => p.id === problem.id);
    if (same(problem, previous)) continue;
    if (!saved) { problems.push(problem); continue; }
    if (same(problem, saved)) continue;
    if (same(saved, previous)) { problems[problems.indexOf(saved)] = problem; continue; }
    const copy: Problem = { ...problem, id: crypto.randomUUID(), title: `${problem.title} (recovered)` };
    problems.push(copy); problemIds.set(problem.id, copy.id);
  }
  const files = { ...remote.files };
  const fileIds = new Map<string, string>();
  for (const [id, file] of Object.entries(local.files)) {
    if (files[id] && !same(files[id], file)) {
      const nextId = crypto.randomUUID(); fileIds.set(id, nextId);
      files[nextId] = { ...file, id: nextId as typeof file.id };
    } else files[id] = file;
  }
  const remapImages = (value: unknown): void => {
    if (!value || typeof value !== 'object') return;
    for (const [key, item] of Object.entries(value)) {
      if (key === 'fileId' && typeof item === 'string' && fileIds.has(item)) (value as Record<string, unknown>)[key] = fileIds.get(item);
      else remapImages(item);
    }
  };
  const kept = entries(remote);
  const baseline = base ? entries(base) : [];
  let activeId = remote.drawingId;
  for (const entry of entries(local)) {
    const copy = structuredClone(entry);
    remapImages(copy);
    const saved = kept.find(e => e.drawingId === entry.drawingId);
    const previous = baseline.find(e => e.drawingId === entry.drawingId);
    const unchanged = previous && same(attemptData(copy), attemptData(previous));
    if (unchanged && !problemIds.has(entry.problemId!)) continue;
    if (saved && same(attemptData(copy), attemptData(saved)) && !problemIds.has(entry.problemId!)) {
      if (entry.drawingId === local.drawingId) activeId = saved.drawingId;
      continue;
    }
    const fork = saved && (!previous || !same(attemptData(saved), attemptData(previous)) || problemIds.has(entry.problemId!));
    if (fork) copy.drawingId = crypto.randomUUID();
    if (problemIds.has(copy.problemId!)) {
      copy.problemId = problemIds.get(copy.problemId!);
      copy.attempt.prompt = problems.find(p => p.id === copy.problemId)!.title;
    }
    if (saved && !fork) kept.splice(kept.indexOf(saved), 1);
    const problem = problems.find(p => p.id === copy.problemId);
    if (problem?.workspace === 'sketch' && kept.some(e => e.problemId === copy.problemId && e.drawingId !== copy.drawingId)) {
      // A concurrent sketch is a separate top-level problem, with its own conversation.
      const recovered = { ...problem, id: crypto.randomUUID(), title: `${problem.title} (recovered)` };
      problems.push(recovered); copy.problemId = recovered.id; copy.attempt.prompt = recovered.title;
      copy.attemptNumber = 1;
    } else if (fork || kept.some(e => e.problemId === copy.problemId && e.attemptNumber === copy.attemptNumber)) {
      copy.attemptNumber = Math.max(0, ...kept.filter(e => e.problemId === copy.problemId).map(e => e.attemptNumber ?? 0)) + 1;
    }
    kept.push(copy);
    if (entry.drawingId === local.drawingId) activeId = copy.drawingId;
  }
  const active = kept.find(e => e.drawingId === activeId) ?? kept[0];
  const { savedAt: _savedAt, ...current } = active;
  return { schemaVersion: 2, problems, files, ...current, past: kept.filter(e => e !== active) };
}
