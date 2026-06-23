import { useEffect, useState } from "react";
import { generateResearchTable, getResearchTable } from "../api.js";
import type { TableResult } from "../types.js";

type State = "loading" | "empty" | "generating" | "ready" | "error";

/** Elicit-style per-paper comparison table. Loads the cached table; if none exists
 *  yet, offers to generate it (one LLM call per paper, then cached server-side). */
export function ExtractionTable({ researchId }: { researchId: string }) {
  const [table, setTable] = useState<TableResult | null>(null);
  const [state, setState] = useState<State>("loading");

  useEffect(() => {
    let alive = true;
    setState("loading");
    getResearchTable(researchId)
      .then((t) => {
        if (!alive) return;
        if (t) {
          setTable(t);
          setState("ready");
        } else {
          setState("empty");
        }
      })
      .catch(() => alive && setState("empty"));
    return () => {
      alive = false;
    };
  }, [researchId]);

  const generate = async () => {
    setState("generating");
    try {
      setTable(await generateResearchTable(researchId));
      setState("ready");
    } catch {
      setState("error");
    }
  };

  if (state === "loading") return <p className="muted">Loading…</p>;

  if (state === "generating") {
    return (
      <div className="table-empty">
        <span className="typing" aria-label="Generating">
          <span />
          <span />
          <span />
        </span>
        <p className="muted">Reading each paper and extracting the fields…</p>
      </div>
    );
  }

  if (state === "empty" || state === "error") {
    return (
      <div className="table-empty">
        <span className="table-empty__icon">▦</span>
        <p className="muted">
          {state === "error"
            ? "Couldn't build the table. Please try again."
            : "Build a per-paper comparison table — objective, method, key findings, and limitations for each paper."}
        </p>
        <button type="button" className="btn btn--accent" onClick={generate}>
          Generate table
        </button>
      </div>
    );
  }

  if (!table || table.rows.length === 0) {
    return <p className="muted">No papers available to tabulate.</p>;
  }

  return (
    <div className="xtable-wrap">
      <div className="xtable-head">
        <span className="muted">
          {table.rows.length} paper{table.rows.length === 1 ? "" : "s"}
        </span>
        <button type="button" className="btn btn--ghost" onClick={generate}>
          Regenerate
        </button>
      </div>
      <div className="xtable-scroll">
        <table className="xtable">
          <thead>
            <tr>
              <th>Paper</th>
              {table.columns.map((c) => (
                <th key={c.key}>{c.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {table.rows.map((r, i) => (
              <tr key={i}>
                <td className="xtable__paper">
                  {r.doi ? (
                    <a href={`https://doi.org/${r.doi}`} target="_blank" rel="noreferrer">
                      doi:{r.doi}
                    </a>
                  ) : (
                    `Paper ${i + 1}`
                  )}
                </td>
                {table.columns.map((c) => (
                  <td key={c.key}>{r.values[c.key] ?? "—"}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
