import { Fragment, type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { askResearch } from "../api.js";
import type { ChatCitation, ResearchBrief } from "../types.js";

interface ChatPanelProps {
  researchId: string;
  query: string;
  brief: ResearchBrief;
}

interface Msg {
  role: "user" | "ai";
  text: string;
  citations?: ChatCitation[];
  error?: boolean;
}

/** Turn [n] markers in an answer into chips that reveal the cited passage on hover. */
function withCitations(text: string, citations: ChatCitation[]): ReactNode[] {
  const byN = new Map(citations.map((c) => [String(c.n), c]));
  return text.split(/(\[\d+\])/g).map((part, i) => {
    const m = part.match(/^\[(\d+)\]$/);
    if (!m) return <Fragment key={i}>{part}</Fragment>;
    const c = byN.get(m[1]);
    return (
      <span className="cite-wrap" key={i}>
        <span className="cite">{m[1]}</span>
        {c && (
          <span className="cite__pop" role="tooltip">
            <span className="cite__popLabel">Source {c.n}</span>
            <span className="cite__popQuote">“{c.quote}”</span>
            {c.doi && <span className="cite__popDoi">doi:{c.doi}</span>}
          </span>
        )}
      </span>
    );
  });
}

/** Derive a few sensible starter questions from the brief. */
function starters(brief: ResearchBrief): string[] {
  const out: string[] = ["Summarize the key findings in plain language."];
  const headings = brief.sections.map((s) => s.heading.toLowerCase());
  if (headings.some((h) => h.includes("conflict") || h.includes("disagree")))
    out.push("Where do these papers disagree, and why?");
  out.push("What are the main limitations or gaps in this research?");
  return out.slice(0, 3);
}

export function ChatPanel({ researchId, query, brief }: ChatPanelProps) {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const threadRef = useRef<HTMLDivElement>(null);
  const suggestions = useMemo(() => starters(brief), [brief]);

  // Keep the latest message in view as the thread grows.
  useEffect(() => {
    const el = threadRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, busy]);

  const ask = async (question: string) => {
    const q = question.trim();
    if (!q || busy) return;
    setInput("");
    setMessages((m) => [...m, { role: "user", text: q }]);
    setBusy(true);
    try {
      const res = await askResearch(researchId, q);
      setMessages((m) => [...m, { role: "ai", text: res.answer, citations: res.citations }]);
    } catch {
      setMessages((m) => [
        ...m,
        {
          role: "ai",
          text: "I couldn't reach the answer service just now. Please try again in a moment.",
          error: true,
        },
      ]);
    } finally {
      setBusy(false);
    }
  };

  const empty = messages.length === 0;

  return (
    <div className="chat">
      <div className="chat__head">
        <h2 className="chat__title">Ask these papers</h2>
        <p className="chat__sub">Answers come only from the sources behind this brief.</p>
      </div>

      <div className="chat__thread" ref={threadRef}>
        {empty && (
          <div className="chat__empty">
            <div className="chat__emptyIcon">💬</div>
            <p className="muted">Ask a follow-up about “{query || "this research"}”.</p>
            <div className="suggest">
              <span className="suggest__label">Try asking</span>
              {suggestions.map((s) => (
                <button key={s} type="button" className="suggest-chip" onClick={() => ask(s)}>
                  <span className="suggest-chip__q">?</span>
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m, i) => (
          <div key={i} className={`msg msg--${m.role}`}>
            <div className="msg__bubble">
              {m.role === "ai" && !m.error
                ? withCitations(m.text, m.citations ?? [])
                : m.text}
            </div>
            {m.role === "ai" && m.citations && m.citations.length > 0 && (
              <div className="msg__sources">
                {m.citations.map((c) => (
                  <span
                    key={c.n}
                    className="src-chip"
                    title={c.title ? `${c.title}${c.doi ? ` · doi:${c.doi}` : ""}` : c.quote}
                  >
                    <span className="src-chip__doi">[{c.n}]</span>
                    <span className="src-chip__txt">{c.title || c.doi || c.quote}</span>
                  </span>
                ))}
              </div>
            )}
          </div>
        ))}

        {busy && (
          <div className="msg msg--ai">
            <div className="msg__bubble">
              <span className="typing" aria-label="Thinking">
                <span />
                <span />
                <span />
              </span>
            </div>
          </div>
        )}
      </div>

      <form
        className="chat__form"
        onSubmit={(e) => {
          e.preventDefault();
          ask(input);
        }}
      >
        <textarea
          className="chat__input"
          rows={1}
          placeholder="Ask about these papers…"
          value={input}
          disabled={busy}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              ask(input);
            }
          }}
        />
        <button
          className="chat__send"
          type="submit"
          disabled={busy || input.trim().length === 0}
          aria-label="Send"
        >
          ↑
        </button>
      </form>
    </div>
  );
}
