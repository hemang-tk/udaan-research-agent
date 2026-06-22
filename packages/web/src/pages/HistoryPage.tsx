import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { getHistory } from "../api.js";
import type { ResearchSummary } from "../types.js";

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

/** Lists every past research session (most recent first). Each card opens its detail page. */
export function HistoryPage() {
  const [items, setItems] = useState<ResearchSummary[] | null>(null);

  useEffect(() => {
    let alive = true;
    getHistory()
      .then((r) => alive && setItems(r))
      .catch(() => alive && setItems([]));
    return () => {
      alive = false;
    };
  }, []);

  return (
    <main className="page page--history">
      <h1 className="page__title">Research History</h1>

      {items === null && <p className="page__muted">Loading…</p>}

      {items !== null && items.length === 0 && (
        <div className="empty">
          <p className="empty__lead">No research yet.</p>
          <p className="page__muted">Every brief you generate is saved here.</p>
          <Link to="/" className="btn btn--accent">
            Run your first research
          </Link>
        </div>
      )}

      {items !== null && items.length > 0 && (
        <ul className="histgrid">
          {items.map((r) => (
            <li key={r.id}>
              <Link to={`/research/${r.id}`} className="histcard">
                <span className="histcard__q">{r.query}</span>
                <span className="histcard__meta">
                  <span>{formatDate(r.createdAt)}</span>
                  <span className="histcard__stat">
                    {r.totalClaims} claims · {r.sections} sections
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
