export type NavigatorSection = 'problems' | 'attempt';
const sections: NavigatorSection[] = ['problems', 'attempt'];

export function navigatorSectionForKey(key: string, section: NavigatorSection): NavigatorSection | undefined {
  if (key === 'Home') return 'problems';
  if (key === 'End') return 'attempt';
  if (key === 'ArrowLeft' || key === 'ArrowRight') return sections[(sections.indexOf(section) + 1) % sections.length];
}

export function NavigatorTabs({ section, onChange }: { section: NavigatorSection; onChange: (section: NavigatorSection) => void }): React.JSX.Element {
  return <div className="navigator-tabs" role="tablist" aria-label="Problem navigation">{sections.map(value => <button key={value}
    id={`navigator-tab-${value}`} role="tab" aria-selected={section === value} aria-controls={`navigator-panel-${value}`} tabIndex={section === value ? 0 : -1}
    onClick={() => onChange(value)} onKeyDown={event => {
      const next = navigatorSectionForKey(event.key, value);
      if (!next) return;
      event.preventDefault(); event.stopPropagation(); onChange(next);
      document.getElementById(`navigator-tab-${next}`)?.focus();
    }}>{value === 'problems' ? 'Problems' : 'Current problem'}</button>)}</div>;
}
