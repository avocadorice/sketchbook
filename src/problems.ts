import type { Project, PastAttempt } from './storage';
export type Problem = { id: string; title: string; workspace?: 'sketch'; intuition?: string; companies?: string[]; description?: string; source?: string; asked?: { fromMonth: string; toMonth: string; note: string } };
export function normalizeTags(tags: readonly string[]): string[] {
  return [...new Map(tags.map(tag => tag.trim()).filter(Boolean).map(tag => [tag.toLowerCase(), tag])).values()];
}
export function companyTags(text: string): string[] {
  return normalizeTags(text.split(','));
}
export function tagProblem(project: Project, tags: string | readonly string[]): Project {
  // Keep the existing storage field and legacy CSV callers; the picker supplies whole tags.
  const companies = typeof tags === 'string' ? companyTags(tags) : normalizeTags(tags);
  return { ...project, problems: project.problems?.map(problem => problem.id === project.problemId ? { ...problem, companies } : problem) };
}
export function matchesCompany(problem: Problem, company: string): boolean {
  return !company || (problem.companies ?? []).some(tag => tag.toLowerCase() === company.toLowerCase());
}
export type Entry = Project | PastAttempt;
/** Problems are appended at creation/import; opening or editing never changes this order. */
export function newestProblems(project: Project): Problem[] {
  return [...(project.problems ?? [])].reverse();
}
/** Preserve attempt IDs/conversations; group legacy entries by their exact normalized title. */
export function organizeProblems(project: Project): Project {
  if (project.schemaVersion === 2 && project.problemId && project.problems?.length) return project;
  const next = structuredClone(project);
  const problems = [...(next.problems ?? [])];
  const byTitle = new Map(problems.map(p => [p.title.trim().toLowerCase(), p]));
  const counts = new Map<string, number>();
  for (const entry of [...[...(next.past ?? [])].reverse(), next]) {
    const title = entry.attempt.prompt.trim() || 'Untitled problem';
    let problem = problems.find(p => p.id === entry.problemId) ?? byTitle.get(title.toLowerCase());
    if (!problem) { problem = { id: crypto.randomUUID(), title }; problems.push(problem); byTitle.set(title.toLowerCase(), problem); }
    entry.problemId = problem.id;
    entry.drawingId ??= crypto.randomUUID();
    const number = (counts.get(problem.id) ?? 0) + 1; counts.set(problem.id, number); entry.attemptNumber = number;
  }
  return { ...next, schemaVersion: 2, problems };
}
export function nextAttemptNumber(project: Project, problemId: string): number {
  return Math.max(0, ...[project, ...(project.past ?? [])].filter(e => e.problemId === problemId).map(e => e.attemptNumber ?? 0)) + 1;
}
export function renameProblem(project: Project, title: string): Project {
  return { ...project, problems: project.problems?.map(p => p.id === project.problemId ? { ...p, title } : p),
    attempt: { ...project.attempt, prompt: title },
    past: project.past?.map(e => e.problemId === project.problemId ? { ...e, attempt: { ...e.attempt, prompt: title } } : e) };
}
