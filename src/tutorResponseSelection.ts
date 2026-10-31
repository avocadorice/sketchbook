export type TutorQuote = { turnId: string; text: string };
export type TutorQuoteDraft = { scope: string; quotes: TutorQuote[] };
export const tutorFollowupQuestions = { clarify: 'Clarify', example: 'Example' } as const;
export type TutorQuoteAction = 'add-to-chat' | keyof typeof tutorFollowupQuestions;
export const tutorQuestionLimit = 12000;

export function quotesForScope(draft: TutorQuoteDraft, scope: string): TutorQuote[] {
  return draft.scope === scope ? draft.quotes : [];
}

// Keep the existing question API and saved conversation format. Only explicitly
// attached, visible text is quoted; the rest of the reply is never copied.
export function questionWithQuotes(question: string, quotes: readonly TutorQuote[]): string {
  if (!quotes.length) return question;
  const context = quotes.map(quote => `Quoted tutor response:\n${quote.text.split('\n').map(line => `> ${line}`).join('\n')}`).join('\n\n');
  return `${context}\n\n${question}`;
}

export function selectedTutorResponse(root: HTMLElement, selection: Selection | null): TutorQuote | undefined {
  if (!selection || selection.isCollapsed || selection.rangeCount !== 1) return;
  const range = selection.getRangeAt(0);
  const ancestor = range.commonAncestorContainer;
  const element = ancestor.nodeType === 1 ? ancestor as Element : ancestor.parentElement;
  const body = element?.closest('.tutor-reply-body');
  if (!body || !root.contains(body)) return;
  const turnId = body.closest('[data-tutor-turn-id]')?.getAttribute('data-tutor-turn-id');
  const text = selection.toString();
  if (turnId && text.trim()) return { turnId, text };
}

export type TutorResponseHighlight = { quote: TutorQuote; bounds: DOMRect };

export function observeTutorResponseSelection(root: HTMLElement, toolbar: () => HTMLElement | null,
  onChange: (highlight?: TutorResponseHighlight) => void): () => void {
  const doc = root.ownerDocument;
  const view = doc.defaultView!;
  let selecting = false;
  let frame: number | undefined;
  const cancelUpdate = () => {
    if (frame !== undefined) view.cancelAnimationFrame(frame);
    frame = undefined;
  };
  const dismiss = () => { cancelUpdate(); onChange(undefined); };
  const update = () => {
    frame = undefined;
    if (selecting || toolbar()?.contains(doc.activeElement)) return;
    const selection = doc.getSelection();
    const quote = selectedTutorResponse(root, selection);
    if (!quote) { onChange(undefined); return; }
    const bounds = selection!.getRangeAt(0).getBoundingClientRect();
    const container = root.getBoundingClientRect();
    const visible = bounds.bottom > Math.max(0, container.top) && bounds.top < Math.min(view.innerHeight, container.bottom)
      && bounds.right > Math.max(0, container.left) && bounds.left < Math.min(view.innerWidth, container.right);
    onChange(visible ? { quote, bounds } : undefined);
  };
  // Pointer release can precede the browser's final native selection update.
  // Read on the next frame, including mouseup and late selectionchange events.
  const scheduleUpdate = () => {
    cancelUpdate();
    if (!selecting) frame = view.requestAnimationFrame(update);
  };
  const down = (event: PointerEvent) => {
    if (toolbar()?.contains(event.target as Node)) return;
    selecting = event.button === 0 && root.contains(event.target as Node);
    dismiss();
  };
  const up = (event: Event) => {
    if (toolbar()?.contains(event.target as Node)) return;
    selecting = false;
    scheduleUpdate();
  };
  const reset = () => { selecting = false; dismiss(); };
  const key = (event: KeyboardEvent) => {
    const actions = toolbar();
    if (event.key === 'Escape' && actions) {
      event.preventDefault();
      event.stopPropagation();
      const focused = actions.contains(doc.activeElement);
      reset();
      if (focused) root.focus({ preventScroll: true });
    } else if (event.key === 'Tab' && actions && !actions.contains(doc.activeElement)
      && selectedTutorResponse(root, doc.getSelection())) {
      event.preventDefault();
      actions.querySelector('button')?.focus({ preventScroll: true });
    }
  };
  doc.addEventListener('selectionchange', scheduleUpdate);
  // Capture releases even when another component stops event propagation.
  doc.addEventListener('pointerdown', down, true);
  doc.addEventListener('pointerup', up, true);
  doc.addEventListener('mouseup', up, true);
  doc.addEventListener('pointercancel', reset, true);
  doc.addEventListener('keydown', key);
  doc.addEventListener('scroll', scheduleUpdate, true);
  view.addEventListener('resize', scheduleUpdate);
  view.addEventListener('blur', reset);
  return () => {
    cancelUpdate();
    doc.removeEventListener('selectionchange', scheduleUpdate);
    doc.removeEventListener('pointerdown', down, true);
    doc.removeEventListener('pointerup', up, true);
    doc.removeEventListener('mouseup', up, true);
    doc.removeEventListener('pointercancel', reset, true);
    doc.removeEventListener('keydown', key);
    doc.removeEventListener('scroll', scheduleUpdate, true);
    view.removeEventListener('resize', scheduleUpdate);
    view.removeEventListener('blur', reset);
  };
}
