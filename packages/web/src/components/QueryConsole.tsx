import { useCallback, useLayoutEffect, useRef } from "react";

interface QueryConsoleProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onSample: () => void;
  busy: boolean;
}

export function QueryConsole({ value, onChange, onSubmit, onSample, busy }: QueryConsoleProps) {
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Grow the textarea to fit its content. Once it would run off-screen, cap the
  // height (≈45% of the viewport) and switch to scrolling — the caret stays in
  // view while earlier lines scroll above, instead of pushing the page taller.
  const fit = useCallback(() => {
    const el = inputRef.current;
    if (!el) return;
    const max = Math.min(360, Math.max(120, Math.round(window.innerHeight * 0.45)));
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, max)}px`;
    el.style.overflowY = el.scrollHeight > max ? "auto" : "hidden";
  }, []);

  useLayoutEffect(() => {
    fit();
  }, [value, fit]);

  useLayoutEffect(() => {
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, [fit]);

  return (
    <section className="console" aria-label="Research query">
      <label className="console__label" htmlFor="query">
        Research question
      </label>
      <textarea
        ref={inputRef}
        id="query"
        className="console__input"
        rows={3}
        placeholder="e.g. How does micro-caching impact p99 tail latency in distributed stateful systems?"
        value={value}
        disabled={busy}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === "Enter") onSubmit();
        }}
      />
      <div className="console__row">
        <span className="console__hint">⌘/Ctrl + Enter to run</span>
        <div className="console__actions">
          <button type="button" className="btn btn--ghost" onClick={onSample} disabled={busy}>
            See a sample brief
          </button>
          <button
            type="button"
            className="btn btn--accent"
            onClick={onSubmit}
            disabled={busy || value.trim().length < 8}
          >
            {busy ? "Synthesizing…" : "Run synthesis"}
          </button>
        </div>
      </div>
    </section>
  );
}
