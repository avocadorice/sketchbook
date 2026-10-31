import type { Project } from './storage';
import type { LegacySelection } from './workspace';

export function LegacyHistory({ project, selection, disabled, onSelect }: {
  project: Project; selection: LegacySelection; disabled: boolean; onSelect: (selection: LegacySelection) => void;
}): React.JSX.Element {
  return <section className="legacy-history" aria-label="Archived sketch history">
    <p className="archive-notice">Archived problem · Read only. Create a new problem for a new sketch.</p>
    <button disabled={disabled} aria-current={selection === null ? 'step' : undefined} onClick={() => onSelect(null)}>
      {project.draft.index === null ? 'Unfinished sketch' : 'Last open sketch'}{project.draft.title && ` · ${project.draft.title}`}
    </button>
    <ol>{project.attempt.chapters.map((chapter, index) => <li key={chapter.id ?? index}>
      <button disabled={disabled} aria-current={selection?.index === index && !selection.draft ? 'step' : undefined} onClick={() => onSelect({ index })}>
        {index + 1}. {chapter.title || `Checkpoint ${index + 1}`}
      </button>
      {(project.draft.index === index || project.drafts?.[String(index)]) && <button className="archive-draft" disabled={disabled}
        aria-current={selection?.index === index && selection.draft ? 'step' : undefined} onClick={() => onSelect({ index, draft: true })}>View saved draft</button>}
    </li>)}</ol>
    {project.draft.index !== null && project.drafts?.next && <button disabled={disabled} aria-current={selection?.index === null && selection.draft ? 'step' : undefined}
      onClick={() => onSelect({ index: null, draft: true })}>View unfinished draft</button>}
  </section>;
}
