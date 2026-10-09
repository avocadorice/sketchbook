import { sceneAt, type Scene } from "./history";
import type { Project } from "./storage";
export type Focus = { x: number; y: number; width: number; height: number };
export function inFocus(scene: Scene, focus: Focus | null): Scene {
  if (!focus) return scene;
  return { ...scene, elements: scene.elements.filter(e => {
    const x = Number(e.x ?? 0), y = Number(e.y ?? 0), w = Number(e.width ?? 0), h = Number(e.height ?? 0);
    return x + Math.abs(w) >= focus.x && x <= focus.x + focus.width && y + Math.abs(h) >= focus.y && y <= focus.y + focus.height;
  }) };
}
export function tutorContext(project: Project, focus: Focus | null) {
  const index = project.draft.index ?? project.attempt.chapters.length;
  const prior = project.attempt.chapters.slice(0, index).map((chapter, i) => ({ id: chapter.id, number: i + 1, title: chapter.title, scene: inFocus(sceneAt(project.attempt, i), focus) }));
  return { title: project.attempt.prompt, checkpointId: project.draft.index === null ? project.draft.id ?? `next-${project.attempt.chapters.length}` : project.attempt.chapters[index]?.id,
    checkpointNumber: index + 1, priorCheckpointIds: prior.map(c => c.id), priorCheckpoints: prior,
    futureExcluded: true, focus, scene: inFocus(project.draft.scene, focus) };
}
export function matchesSearch(project: Pick<Project, 'attempt' | 'draft' | 'drafts'>, query: string): boolean {
  const text = [project.attempt.prompt, ...project.attempt.chapters.map(c => c.title),
    ...project.attempt.chapters.flatMap((_, i) => sceneAt(project.attempt, i).elements.map(e => `${e.text ?? ''} ${e.originalText ?? ''}`)),
    ...project.draft.scene.elements.map(e => `${e.text ?? ''} ${e.originalText ?? ''}`),
    ...Object.values(project.drafts ?? {}).flatMap(d => d.scene.elements.map(e => `${e.text ?? ''} ${e.originalText ?? ''}`))].join(' ').toLowerCase();
  return query.toLowerCase().trim().split(/\s+/).every(word => text.includes(word));
}
