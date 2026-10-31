import { createAttempt, sceneAt } from './history';
import { newestProblems, type Entry, type Problem } from './problems';
import type { Project } from './storage';

/** New canvases use the existing draft format; saved legacy history stays untouched. */
export function createSketchProject(title = 'Untitled problem'): Project {
  const problemId = crypto.randomUUID();
  const attempt = createAttempt(title);
  return { schemaVersion: 2, problemId, problems: [{ id: problemId, title, workspace: 'sketch' }],
    drawingId: crypto.randomUUID(), attemptNumber: 1, attempt,
    draft: { id: crypto.randomUUID(), index: null, scene: sceneAt(attempt), title: '', notes: '' }, files: {} };
}

export function isSketchEntry(entry: Entry, problem?: Problem): boolean {
  // Even an import with a sketch marker must never make old checkpoints editable.
  return problem?.workspace === 'sketch' && entry.attempt.chapters.length === 0 && entry.draft.index === null
    && !Object.keys(entry.drafts ?? {}).length;
}

export function isSketchProject(project: Project): boolean {
  return isSketchEntry(project, project.problems?.find(p => p.id === project.problemId))
    && !(project.past ?? []).some(entry => entry.problemId === project.problemId);
}

export function shelveProject(project: Project): NonNullable<Project['past']> {
  const { problemId, drawingId, attemptNumber, attempt, draft, timing, drafts } = project;
  return [{ problemId, drawingId, attemptNumber, savedAt: Date.now(), attempt, draft,
    ...(timing ? { timing } : {}), ...(drafts ? { drafts } : {}) }, ...(project.past ?? [])];
}

export function openProblem(project: Project, position: number): Project {
  const chosen = project.past?.[position];
  if (!chosen) return project;
  const { savedAt: _savedAt, ...restored } = chosen;
  return { schemaVersion: 2, problems: project.problems, files: project.files, ...restored,
    past: shelveProject({ ...project, past: project.past?.filter((_, i) => i !== position) }) };
}

/** Delete a whole problem, retaining every other attempt and the shared image store. */
export function deleteProblem(project: Project, problemId: string): Project {
  if (!project.problems?.some(problem => problem.id === problemId)) return project;
  let next = project;
  if (project.problemId === problemId) {
    const replacement = newestProblems(project).find(problem => problem.id !== problemId
      && project.past?.some(entry => entry.problemId === problem.id));
    if (replacement) next = openProblem(project, project.past!.findIndex(entry => entry.problemId === replacement.id));
    else {
      const fresh = createSketchProject();
      next = { ...fresh, files: project.files, past: project.past, problems: [...project.problems, ...fresh.problems!] };
    }
  }
  const { past: previous, ...active } = next;
  const past = previous?.filter(entry => entry.problemId !== problemId);
  return { ...active, problems: next.problems?.filter(problem => problem.id !== problemId),
    ...(past?.length ? { past } : {}) };
}

export type LegacySelection = { index: number | null; draft?: boolean } | null;

/** A temporary read-only view: never persist it over the legacy entry's active draft. */
export function legacyView(project: Project, selection: LegacySelection): Project {
  if (!selection || isSketchProject(project)) return project;
  const { index } = selection;
  if (selection.draft) {
    const draft = project.draft.index === index ? project.draft : project.drafts?.[index === null ? 'next' : String(index)];
    return draft ? { ...project, draft: { ...draft, index } } : project;
  }
  if (index === null || !project.attempt.chapters[index]) return project;
  const chapter = project.attempt.chapters[index];
  return { ...project, draft: { id: chapter.id, index, title: chapter.title, notes: chapter.notes, scene: sceneAt(project.attempt, index) } };
}
