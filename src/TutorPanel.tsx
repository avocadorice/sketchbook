import "../../shared/tutor-markdown.css";
import { useEffect, useRef, useState } from "react";
import { TutorReply } from "../../shared/TutorReply";
import { TutorAttachments, TutorDropOverlay, useTutorAttachments } from "../../shared/TutorAttachments";
import { attachTutorImages } from "../../shared/tutorImages";
import { TutorQuoteAttachments, TutorResponseSelection } from "./TutorQuoteActions";
import { tutorFollowupQuestions, questionWithQuotes, quotesForScope, tutorQuestionLimit, type TutorQuote, type TutorQuoteAction, type TutorQuoteDraft } from "./tutorResponseSelection";
type Turn = { id: string; question: string; answer?: string; provider: string; model?: string; status: string; error?: string; createdAt: number; image?: boolean; compacting?: boolean; compacted?: boolean; handoff?: { link: string; threadId: string; recordCount: number; missingImages: number } };
type Thread = { id: string; revision: number; turns: Turn[] };
type Capture = { id: string; image: string | null; context: unknown };
async function request(path: string, body?: unknown): Promise<Thread> {
  const response = await fetch(new URL(`api/tutor${path}`, location.href), body ? { method: "POST", headers: { "Content-Type": "application/json", "X-Nexo-Practice": "1" }, body: JSON.stringify(body) } : { cache: "no-store" });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? "The host Mac could not load this conversation.");
  return result;
}
const names: Record<string, string> = { chatgpt: "ChatGPT", claude: "Claude", gemini: "Gemini" };
const nextQuestion = "I'm ready for the next small step. Continue from where we left off with just one new idea in 1–3 short sentences, then pause until I ask to continue.";
export function TutorPanel({ drawingId, attachmentScope, capture, contextLabel, onHide, clearFocus, startFocus, hasFocus, hidden = false, readOnly = false }: { readOnly?: boolean; hidden?: boolean; attachmentScope: string; startFocus: () => void; onHide: () => void; clearFocus: () => void; hasFocus: boolean; contextLabel: string; drawingId?: string; capture: (includeCanvas: boolean) => Promise<Capture> }): React.JSX.Element {
  const [thread, setThread] = useState<Thread>({ id: drawingId ?? "", revision: 0, turns: [] });
  const provider = "chatgpt";
  const effort = "medium";
  const draftKey = `sketchbook-question-${drawingId ?? "new"}`;
  const [question, setQuestion] = useState(localStorage.getItem(draftKey) ?? "");
  const [quoteDraft, setQuoteDraft] = useState<TutorQuoteDraft>({ scope: attachmentScope, quotes: [] });
  const quotes = quotesForScope(quoteDraft, attachmentScope);
  const [canvasChoice, setCanvasChoice] = useState<{ scope: string; include: boolean }>();
  const includeCanvas = canvasChoice?.scope === attachmentScope ? canvasChoice.include : !quotes.length;
  const questionLength = questionWithQuotes(question, quotes).trim().length;
  const questionInput = useRef<HTMLTextAreaElement>(null);
  const conversation = useRef<HTMLDivElement>(null);
  const [error, setError] = useState(""); const [sending, setSending] = useState(false);
  const [pendingFollowup, setPendingFollowup] = useState<{ scope: string; question: string }>();
  const sendPending = useRef(false);
  const attachments = useTutorAttachments(attachmentScope, sending || readOnly);
  const currentScope = useRef(attachmentScope); currentScope.current = attachmentScope;
  const [ready, setReady] = useState(!drawingId);
  const bottom = useRef<HTMLDivElement>(null);
  const running = thread.turns.some(t => t.status === "thinking");
  const hasSessionLink = /codex:\/\//i.test(question);
  useEffect(() => { setQuoteDraft({ scope: attachmentScope, quotes: [] }); setCanvasChoice(undefined); }, [attachmentScope]);
  useEffect(() => {
    let alive = true;
    const refresh = async () => { if (!drawingId) return; try { const next = await request(`?id=${encodeURIComponent(drawingId)}`); if (alive) { setThread(old => next.revision >= old.revision ? next : old); setReady(true); } } catch (e) { if (alive) setError(String(e)); } };
    void refresh(); const id = setInterval(() => void refresh(), 1800);
    return () => { alive = false; clearInterval(id); };
  }, [drawingId]);
  useEffect(() => { if (!hidden) bottom.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [thread.revision, hidden, pendingFollowup]);
  const addQuote = (quote: TutorQuote, action: TutorQuoteAction) => {
    if (readOnly || sendPending.current || sending || running || currentScope.current !== attachmentScope) return;
    if (action !== 'add-to-chat') {
      void send(undefined, false, { question: tutorFollowupQuestions[action], quotes: [quote] });
      return;
    }
    const nextQuotes = quotes.some(saved => saved.turnId === quote.turnId && saved.text === quote.text) ? quotes : [...quotes, quote];
    if (questionWithQuotes(question, nextQuotes).trim().length > tutorQuestionLimit) {
      setError("Your question and quoted text exceed 12,000 characters. Shorten the question or select less text.");
      return;
    }
    setQuoteDraft({ scope: attachmentScope, quotes: nextQuotes });
    setError("");
    questionInput.current?.focus();
    questionInput.current?.setSelectionRange(question.length, question.length);
  };
  const send = async (retry?: string, nextStep = false, followup?: { question: string; quotes: readonly TutorQuote[] }) => {
    if (readOnly || sendPending.current || sending || running || !ready || attachments.reading || (nextStep && thread.turns.at(-1)?.status !== "complete")) return;
    // Selection actions submit their own prompt and quote without changing the draft.
    const questionText = followup?.question ?? question;
    const submittedQuestion = nextStep ? nextQuestion : questionWithQuotes(questionText, followup?.quotes ?? quotes);
    if (!retry && !nextStep && (!questionText.trim() || submittedQuestion.trim().length > tutorQuestionLimit)) {
      setError("Enter a question with no more than 12,000 characters, including quoted text.");
      return;
    }
    sendPending.current = true;
    setSending(true); setError("");
    if (followup) setPendingFollowup({ scope: attachmentScope, question: submittedQuestion });
    try {
      const context = retry ? { id: thread.id } : await capture(!nextStep && !followup && includeCanvas);
      const image = retry ? undefined : await attachTutorImages('image' in context ? context.image : null, nextStep || followup ? [] : attachments.images);
      if (!retry && currentScope.current !== attachmentScope) throw new Error('Checkpoint changed while preparing context. Ask again from the current checkpoint.');
      const next = await request("/ask", { ...context, ...(!retry ? { image } : {}), revision: thread.revision, question: submittedQuestion, provider, effort, retry });
      setThread(next); if (!retry && !nextStep && !followup && currentScope.current === attachmentScope) { setQuestion(""); localStorage.removeItem(draftKey); attachments.clear(); setQuoteDraft({ scope: attachmentScope, quotes: [] }); setCanvasChoice(undefined); }
    } catch (e) { setError(String(e)); }
    finally { sendPending.current = false; setSending(false); setPendingFollowup(undefined); }
  };
  return <aside id="design-tutor-pane" className="tutor-panel" aria-label="Diagram tutor" hidden={hidden} {...attachments.paneProps}>
    {!readOnly && attachments.dragging && <TutorDropOverlay busy={sending || attachments.reading} />}
    <div className="tutor-heading"><h2>Tutor</h2><button aria-label="Hide tutor pane" onClick={onHide}>×</button></div>
    {!readOnly && <p className="tutor-settings"><span>Agent: ChatGPT · GPT‑6.1 Sol</span><span>Reasoning: Balanced</span></p>}
    <div className="conversation" ref={conversation} tabIndex={-1} aria-live="polite">
      {thread.turns.map((turn, index) => <article className="tutor-turn" key={turn.id}><div className="question"><small>You{turn.image ? " · image context attached" : ""}</small><p>{turn.question}</p>{turn.handoff && <div className="codex-handoff-receipt"><span>Codex session attached · {turn.handoff.recordCount} records</span><small>Saved conversation and tool history · {turn.handoff.threadId}</small>{turn.handoff.missingImages > 0 && <small>To discuss images from that session, attach them here too.</small>}</div>}{turn.image && <details className="sent-image"><summary>View sent image</summary><img alt="Image context sent with this question" src={new URL(`api/tutor/image/${turn.id}`, location.href).href} loading="lazy" /></details>}</div><div className="answer" data-tutor-turn-id={turn.id}><small>{names[turn.provider]}{turn.model ? ` · ${turn.model}` : ""}</small>{turn.answer && <TutorReply answer={turn.answer}
        onContinue={!readOnly && index === thread.turns.length - 1 && turn.status === "complete" ? () => void send(undefined, true) : undefined}
        continueDisabled={sending || running || !ready || attachments.reading} />}{turn.status === "thinking" && <p className="thinking">{turn.compacting ? "Compacting earlier context automatically… Full history is saved." : "Thinking…"}</p>}{turn.compacted && <small>Earlier context compacted automatically · Full history is saved</small>}{turn.status === "error" && <><p role="alert">{turn.error}</p>{!readOnly && index === thread.turns.length - 1 && <button disabled={sending || running || attachments.reading} onClick={() => void send(turn.id)}>Retry with {names[provider]}</button>}</>}</div></article>)}
      {pendingFollowup?.scope === attachmentScope && <article className="tutor-turn" aria-busy="true"><div className="question"><small>You · conversation context</small><p>{pendingFollowup.question}</p></div><div className="answer"><p className="thinking" role="status">Sending…</p></div></article>}
      <div ref={bottom} />
    </div>
    <TutorResponseSelection root={conversation} scope={attachmentScope} disabled={readOnly || hidden || sending || running} followupDisabled={!ready || attachments.reading} onSelect={addQuote} />
    {readOnly ? <div className="tutor-compose archive-notice">Archived conversation · Read only.{error && <p role="alert">{error}</p>}</div> : <form className="tutor-compose" onSubmit={e => { e.preventDefault(); void send(); }}>
      <div className="capture-context">
        <label className="include-canvas"><input type="checkbox" checked={includeCanvas} disabled={sending || running} onChange={e => setCanvasChoice({ scope: attachmentScope, include: e.target.checked })} />Include canvas</label>
        {includeCanvas ? <><span>{contextLabel}</span>{hasFocus ? <button type="button" onClick={clearFocus}>Clear</button> : <button type="button" onClick={startFocus} aria-label="Select focus regions" title="Hold Option + Shift and drag, or click here then drag">⌥⇧ drag to focus</button>}</> : <small>Canvas omitted · Attachments still included</small>}
      </div>
      <TutorQuoteAttachments quotes={quotes} disabled={sending} onRemove={index => setQuoteDraft({ scope: attachmentScope, quotes: quotes.filter((_, position) => position !== index) })} />
      <textarea ref={questionInput} aria-label="Ask tutor" aria-describedby="codex-handoff-help tutor-submit-help" id="tutor-question" maxLength={tutorQuestionLimit} rows={3} value={question} placeholder="Ask about your diagram, or paste a Codex session link…" onChange={e => { setQuestion(e.target.value); localStorage.setItem(draftKey, e.target.value); }} onKeyDown={e => {
        if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing && e.nativeEvent.keyCode !== 229) {
          e.preventDefault();
          if (!e.repeat) void send();
        }
      }} />
      {questionLength > tutorQuestionLimit && <p role="alert" className="save-error">Your question and quoted text exceed 12,000 characters. Shorten the question or remove a quote.</p>}
      <p id="codex-handoff-help" className={hasSessionLink ? "codex-handoff-pending" : "codex-handoff-help"} role={hasSessionLink ? "status" : undefined}>{hasSessionLink ? "Continue from Codex · The saved conversation and tool history on the host Mac will be attached to this question." : <>From Codex? Paste a <code>codex://threads/…</code> link to continue here.</>}</p>
      <TutorAttachments attachments={attachments} disabled={sending} />{error && <p role="alert" className="save-error">{error}</p>}
      <div className="compose-actions"><small id="tutor-submit-help">Enter to ask · Shift+Enter for a new line</small>{running ? <button type="button" onClick={() => void request("/cancel", { id: thread.id }).then(setThread).catch(e => setError(String(e)))}>Stop</button> : <button className="ask" disabled={sending || attachments.reading || !ready || !question.trim() || questionLength > tutorQuestionLimit}>{sending ? "Saving context…" : hasSessionLink ? "Continue with tutor →" : "Ask tutor →"}</button>}</div>
    </form>}
  </aside>;
}
