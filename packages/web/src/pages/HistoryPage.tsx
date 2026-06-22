import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ResearchCard } from "../components/ResearchCard.js";
import { getHistory } from "../api.js";
import type { ResearchSummary } from "../types.js";

/** Every past research session (most recent first), full-width and filterable. */
export function HistoryPage() {
  const [items, setItems] = useState<ResearchSummary[] | null>(null);
  const [q, setQ] = useState("");

  useEffect(() => {
    let alive = true;
    getHistory()
      .then((r) => alive && setItems(r))
      .catch(() => alive && setItems([]));
    return () => {
      alive = false;
    };
  }, []);

  const filtered = useMemo(() => {
    if (!items) return [];
    const needle = q.trim().toLowerCase();
    if (!needle) return items;
    return items.filter((r) => r.query.toLowerCase().includes(needle));
  }, [items, q]);

  return (
    <main className="view">
      <div className="view__inner">
        <h1 className="view__title">Research History</h1>
        <p className="view__lead">Every brief you generate is saved here — open one to read it or chat with its papers.</p>

        {items === null && <p className="muted">Loading…</p>}

        {items !== null && items.length === 0 && (
          <div className="empty">
            <span className="empty__icon">📚</span>
            <p className="empty__lead">No research yet</p>
            <p className="muted">Every brief you generate will show up here.</p>
            <Link to="/" className="btn btn--accent">
              Run your first research
            </Link>
          </div>
        )}

        {items !== null && items.length > 0 && (
          <>
            <div className="searchbar">
              <span className="searchbar__icon" aria-hidden="true">🔍</span>
              <input
                className="searchbar__input"
                type="search"
                placeholder="Filter by question…"
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
            </div>

            {filtered.length === 0 ? (
              <p className="muted">No research matches “{q}”.</p>
            ) : (
              <ul className="cards">
                {filtered.map((r) => (
                  <li key={r.id}>
                    <ResearchCard research={r} />
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </main>
  );
}
