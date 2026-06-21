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
    // Placeholders don't contribute to scrollHeight, so when the field is empty
    // measure against the placeholder — the default field then fully shows the
    // example question instead of clipping it.
    const empty = el.value === "";
    if (empty) el.value = el.placeholder;
    el.style.height = "auto";
    const needed = el.scrollHeight;
    if (empty) el.value = "";
    el.style.height = `${Math.min(needed, max)}px`;
    el.style.overflowY = needed > max ? "auto" : "hidden";
  }, []);

  useLayoutEffect(() => {
    fit();
  }, [value, fit]);

  useLayoutEffect(() => {
    window.addEventListener("resize", fit);
    // The custom serif loads async; the placeholder reflows (often gaining a line)
    // when it swaps in, so re-fit once fonts are ready — otherwise the last line of
    // the example question is clipped on first paint.
    document.fonts?.ready.then(() => fit()).catch(() => {});
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
