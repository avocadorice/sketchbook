import type { Entry, Problem } from './problems';
import { isSketchEntry } from './workspace';

export type ProblemGroup = { problem: Problem; entries: { entry: Entry; position: number | null }[] };

export function ProblemList({ groups, activeId, disabled, onOpen, onDelete }: {
  groups: ProblemGroup[]; activeId?: string; disabled: boolean; onOpen: (position: number | null) => void; onDelete: (problemId: string) => void;
}): React.JSX.Element {
  return <div className="problem-list">{groups.map(({ problem, entries }) => {
    const title = <><span className="problem-title">{problem.title || 'Untitled problem'}</span>
      {!!problem.companies?.length && <span className="problem-tags">{problem.companies.map(tag => <span key={tag}>{tag}</span>)}</span>}</>;
    const remove = <button className="problem-delete" disabled={disabled} aria-label={`Delete problem: ${problem.title || 'Untitled problem'}`} title="Delete problem" onClick={() => onDelete(problem.id)}><svg aria-hidden="true" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7" /></svg></button>;
    if (entries.length === 1 && isSketchEntry(entries[0].entry, problem)) return <div key={problem.id} className="problem-row"><button className="problem-open"
      aria-current={entries[0].entry.drawingId === activeId ? 'page' : undefined} disabled={disabled} onClick={() => onOpen(entries[0].position)}>{title}</button>{remove}</div>;
    return <div key={problem.id} className="problem-row"><details className={entries.some(({ entry }) => entry.drawingId === activeId) ? 'active-problem' : undefined}>
      <summary>{title}<span className="archive-label">Archive · Read only</span></summary>
      <ol className="archive-attempts">{entries.map(({ entry, position }) => <li key={entry.drawingId}>
        <button disabled={disabled} aria-current={entry.drawingId === activeId ? 'page' : undefined} onClick={() => onOpen(position)}>Attempt #{entry.attemptNumber ?? 1}</button>
      </li>)}</ol>
    </details>{remove}</div>;
  })}{!groups.length && <p className="hint">No matching problems. Try another search or clear the filters.</p>}</div>;
}
