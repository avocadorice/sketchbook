import type { Project } from './storage';
import type { LegacySelection } from './workspace';

/** IDs are shared by some checkpoints and their drafts; explicit links select the saved scene kind. */
export function checkpointFromSource(project: Project, id: string | null, scene: string | null = null): LegacySelection {
  if (!id) return null;
  const checkpoint = project.attempt.chapters.findIndex(chapter => chapter.id === id);
  const saved = Object.entries(project.drafts ?? {}).find(([, draft]) => draft.id === id);
  const savedSelection = saved ? { index: saved[0] === 'next' ? null : Number(saved[0]), draft: true } : null;
  if (scene === 'checkpoint') return checkpoint >= 0 ? { index: checkpoint } : null;
  if (scene === 'draft') return null;
  if (scene === 'saved-draft') return savedSelection ? { ...savedSelection, savedDraft: true } : null;
  // Keep the precedence of existing links that did not specify a scene kind.
  if (id === project.draft.id) return null;
  if (checkpoint >= 0) return { index: checkpoint };
  return savedSelection;
}
