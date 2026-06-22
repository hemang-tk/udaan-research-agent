import type { ResearchSummary } from "../types.js";

interface HistoryPanelProps {
  items: ResearchSummary[];
  selectedId: string;
  busy: boolean;
  onSelectSample: () => void;
  onSelect: (id: string) => void;
}

function shortDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  } catch {
    return "";
  }
}

export function HistoryPanel({ items, selectedId, busy, onSelectSample, onSelect }: HistoryPanelProps) {
  return (
    <section className="history" aria-label="Research history">
      <h2 className="history__title">Researches</h2>
      <ul className="history__list">
        <li>
          <button
            type="button"
            className={`history__item${selectedId === "sample" ? " history__item--active" : ""}`}
            onClick={onSelectSample}
            disabled={busy}
          >
            <span className="history__q">Sample brief</span>
            <span className="history__meta">illustrative</span>
          </button>
        </li>
        {items.map((r) => (
          <li key={r.id}>
            <button
              type="button"
              className={`history__item${selectedId === r.id ? " history__item--active" : ""}`}
              onClick={() => onSelect(r.id)}
              disabled={busy}
              title={r.query}
            >
              <span className="history__q">{r.query}</span>
              <span className="history__meta">
                {r.totalClaims} claims · {shortDate(r.createdAt)}
              </span>
            </button>
          </li>
        ))}
      </ul>
      {items.length === 0 && <p className="history__empty">No saved researches yet — run one below.</p>}
    </section>
  );
}
