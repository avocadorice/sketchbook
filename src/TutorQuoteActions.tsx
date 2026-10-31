import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { observeTutorResponseSelection, tutorFollowupQuestions, type TutorQuote, type TutorQuoteAction, type TutorResponseHighlight } from './tutorResponseSelection';

type Pending = TutorResponseHighlight & { scope: string };

export function TutorResponseSelection({ root, scope, disabled, followupDisabled = false, onSelect }: {
  root: RefObject<HTMLDivElement>; scope: string; disabled: boolean; followupDisabled?: boolean;
  onSelect: (quote: TutorQuote, action: TutorQuoteAction) => void;
}) {
  const [pending, setPending] = useState<Pending>();
  const toolbar = useRef<HTMLDivElement>(null);
  const shown = !disabled && pending?.scope === scope ? pending : undefined;

  useEffect(() => {
    setPending(undefined);
    const container = root.current;
    if (!container || disabled) return;
    return observeTutorResponseSelection(container, () => toolbar.current,
      highlight => setPending(highlight ? { scope, ...highlight } : undefined));
  }, [root, scope, disabled]);

  useLayoutEffect(() => {
    const node = toolbar.current;
    if (!shown || !node) return;
    const bounds = node.getBoundingClientRect();
    node.style.left = `${Math.max(8, Math.min(shown.bounds.left, window.innerWidth - bounds.width - 8))}px`;
    node.style.top = `${Math.max(8, Math.min(shown.bounds.top >= bounds.height + 16
      ? shown.bounds.top - bounds.height - 8 : shown.bounds.bottom + 8, window.innerHeight - bounds.height - 8))}px`;
  }, [shown]);

  const choose = (action: TutorQuoteAction) => {
    if (!shown) return;
    onSelect(shown.quote, action);
    setPending(undefined);
    document.getSelection()?.removeAllRanges();
  };
  return shown && createPortal(<div ref={toolbar} className="tutor-response-selection" role="group" aria-label="Selected tutor text"
    style={{ left: shown.bounds.left, top: shown.bounds.bottom + 8 }} onPointerDown={event => event.preventDefault()}>
    <TutorQuoteButtons followupDisabled={followupDisabled} onSelect={choose} />
  </div>, document.body);
}

export function TutorQuoteButtons({ followupDisabled, onSelect }: {
  followupDisabled: boolean; onSelect: (action: TutorQuoteAction) => void;
}) {
  return <>
    <button type="button" onClick={() => onSelect('add-to-chat')}>Add to chat</button>
    <button type="button" disabled={followupDisabled} title="Ask tutor to clarify this text" onClick={() => onSelect('clarify')}>{tutorFollowupQuestions.clarify}</button>
    <button type="button" disabled={followupDisabled} title="Ask tutor for an example of this text" onClick={() => onSelect('example')}>{tutorFollowupQuestions.example}</button>
  </>;
}

export function TutorQuoteAttachments({ quotes, disabled, onRemove }: {
  quotes: readonly TutorQuote[]; disabled: boolean; onRemove: (index: number) => void;
}) {
  if (!quotes.length) return null;
  return <ul className="tutor-quote-attachments" aria-label="Quoted tutor text">{quotes.map((quote, index) => <li key={`${quote.turnId}-${index}`}>
    <div><small>Tutor quote</small><blockquote>{quote.text}</blockquote></div>
    <button type="button" disabled={disabled} aria-label={`Remove tutor quote ${index + 1}`} onClick={() => onRemove(index)}>×</button>
  </li>)}</ul>;
}
