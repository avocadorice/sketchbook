import { useState } from 'react';

export function TagEditor({ tags, suggestions, disabled, onChange }: {
  tags: string[]; suggestions: string[]; disabled: boolean; onChange: (tags: string[]) => void;
}): React.JSX.Element {
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const selected = new Set(tags.map(tag => tag.toLowerCase()));
  const choices = suggestions.filter(tag => !selected.has(tag.toLowerCase()) && tag.toLowerCase().includes(text.trim().toLowerCase())).slice(0, 5);
  const add = (value: string): void => {
    const tag = value.trim();
    if (disabled || !tag) return;
    if (tag.length > 100) { setError('Each tag must be at most 100 characters.'); return; }
    if (selected.has(tag.toLowerCase())) { setError('This tag is already added.'); return; }
    onChange([...tags, tag]); setText(''); setError('');
  };
  return <form className="tag-editor" onSubmit={event => { event.preventDefault(); add(text); }}>
    <label htmlFor="problem-tag-input">Tags</label>
    <p className="tag-description">Subjects, technologies, companies…</p>
    {!!tags.length && <ul className="editable-tags" aria-label="Problem tags">{tags.map(tag => <li key={tag}>
      <span>{tag}</span><button type="button" disabled={disabled} aria-label={`Remove tag ${tag}`} onClick={() => { onChange(tags.filter(value => value !== tag)); setError(''); }}>×</button>
    </li>)}</ul>}
    <div className="tag-input-row"><input id="problem-tag-input" value={text} disabled={disabled} maxLength={100} placeholder="Tag name" autoComplete="off" onChange={event => { setText(event.target.value); setError(''); }} />
      <button type="submit" disabled={disabled || !text.trim()} aria-label="Add tag">Add</button></div>
    {!!choices.length && <div className="tag-suggestions" aria-label="Suggested tags"><small>Suggestions</small>{choices.map(tag => <button type="button" key={tag} disabled={disabled} onClick={() => add(tag)}>＋ {tag}</button>)}</div>}
    {error && <p role="alert">{error}</p>}
  </form>;
}
