import { useEffect, useRef, useState } from "react";
type Turn = { id: string; question: string; answer?: string; provider: string; model?: string; status: string; error?: string; createdAt: number; image?: boolean };
type Thread = { id: string; revision: number; turns: Turn[] };
type Capture = { id: string; image: string | null; context: unknown };
async function request(path: string, body?: unknown): Promise<Thread> {
  const response = await fetch(new URL(`api/tutor${path}`, location.href), body ? { method: "POST", headers: { "Content-Type": "application/json", "X-Nexo-Practice": "1" }, body: JSON.stringify(body) } : { cache: "no-store" });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? "The host Mac could not load this conversation.");
  return result;
}
const names: Record<string, string> = { chatgpt: "ChatGPT", claude: "Claude", gemini: "Gemini" };
export function TutorPanel({ drawingId, capture, contextLabel }: { contextLabel: string; drawingId?: string; capture: () => Promise<Capture> }): React.JSX.Element {
  const [thread, setThread] = useState<Thread>({ id: drawingId ?? "", revision: 0, turns: [] });
  const [provider, setProvider] = useState(localStorage.getItem("sketchbook-provider") || "chatgpt");
  const [effort, setEffort] = useState("low");
  const draftKey = `sketchbook-question-${drawingId ?? "new"}`;
  const [question, setQuestion] = useState(localStorage.getItem(draftKey) ?? "");
  const [error, setError] = useState(""); const [sending, setSending] = useState(false);
  const [ready, setReady] = useState(!drawingId);
  const bottom = useRef<HTMLDivElement>(null);
  const running = thread.turns.some(t => t.status === "thinking");
  useEffect(() => {
    let alive = true;
    const refresh = async () => { if (!drawingId) return; try { const next = await request(`?id=${encodeURIComponent(drawingId)}`); if (alive) { setThread(old => next.revision >= old.revision ? next : old); setReady(true); } } catch (e) { if (alive) setError(String(e)); } };
    void refresh(); const id = setInterval(() => void refresh(), 1800);
    return () => { alive = false; clearInterval(id); };
  }, [drawingId]);
  useEffect(() => { bottom.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [thread.revision]);
  const send = async (retry?: string) => {
    if (sending || running || !ready) return;
    setSending(true); setError("");
    try {
      const context = retry ? { id: thread.id } : await capture();
      const next = await request("/ask", { ...context, revision: thread.revision, question, provider, effort, retry });
      setThread(next); if (!retry) { setQuestion(""); localStorage.removeItem(draftKey); }
    } catch (e) { setError(String(e)); }
    finally { setSending(false); }
  };
  const exportChat = () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(thread, null, 2)], { type: "application/json" }));
    const a = document.createElement("a"); a.href = url; a.download = "sketchbook-conversation.json"; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return <aside className="tutor-panel" aria-label="Diagram tutor">
    <div className="tutor-heading"><div><h2>Think it through</h2><p>One drawing. One conversation. Any agent.</p></div><button onClick={exportChat} disabled={!thread.turns.length} title="Export conversation">Export</button></div>
    <div className="agent-controls"><label>Agent<select value={provider} onChange={e => { setProvider(e.target.value); localStorage.setItem("sketchbook-provider", e.target.value); }}><option value="chatgpt">ChatGPT · Luna</option><option value="claude">Claude · Sonnet</option><option value="gemini">Gemini · Flash</option></select></label><label>Reasoning<select value={effort} onChange={e => setEffort(e.target.value)}><option value="low">Quick</option><option value="medium">Balanced</option></select></label></div>
    <p className="context-note">Uses your subscription on the Mac mini. Includes this checkpoint and its predecessors. Later checkpoint conversations stay saved but are excluded from earlier questions.</p>
    <p className="current-context">{contextLabel}</p>
    <div className="conversation" aria-live="polite">
      {!thread.turns.length && <div className="tutor-empty"><span>↔</span><h3>A second pair of eyes</h3><p>“Look at the left side. I’m trying to prevent duplicate charges—what am I missing?”</p><p>Use Focus area to draw a temporary box around the part you want to discuss.</p></div>}
      {thread.turns.map((turn, index) => <article className="tutor-turn" key={turn.id}><div className="question"><small>You · {turn.image ? "diagram attached" : "canvas context"}</small><p>{turn.question}</p></div><div className="answer"><small>{names[turn.provider]}{turn.model ? ` · ${turn.model}` : ""}</small>{turn.answer && <p>{turn.answer}</p>}{turn.status === "thinking" && <p className="thinking">Looking at your diagram…</p>}{turn.status === "error" && <><p role="alert">{turn.error}</p>{index === thread.turns.length - 1 && <button disabled={sending || running} onClick={() => void send(turn.id)}>Retry with {names[provider]}</button>}</>}</div></article>)}<div ref={bottom} />
    </div>
    <form className="tutor-compose" onSubmit={e => { e.preventDefault(); void send(); }}><label htmlFor="tutor-question">What’s not clicking?</label><textarea id="tutor-question" maxLength={12000} rows={3} value={question} placeholder="Ask about your diagram…" onChange={e => { setQuestion(e.target.value); localStorage.setItem(draftKey, e.target.value); }} onKeyDown={e => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void send(); } }} />{error && <p role="alert" className="save-error">{error}</p>}<div className="compose-actions"><small>⌘ Enter to ask</small>{running ? <button type="button" onClick={() => void request("/cancel", { id: thread.id }).then(setThread).catch(e => setError(String(e)))}>Stop</button> : <button className="ask" disabled={sending || !ready || !question.trim()}>{sending ? "Saving context…" : "Ask tutor →"}</button>}</div></form>
  </aside>;
}
