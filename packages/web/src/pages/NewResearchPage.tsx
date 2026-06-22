import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Link } from "react-router-dom";
import { PipelineLedger } from "../components/PipelineLedger.js";
import { QueryConsole } from "../components/QueryConsole.js";
import { ResearchCard } from "../components/ResearchCard.js";
import { getHistory, startResearch, streamProgress } from "../api.js";
import type { PhaseStatus, ResearchSummary } from "../types.js";

type Mode = "idle" | "running" | "rejected" | "error";

const ENGINE_DOWN = "Can't reach the research engine right now. Please try again in a moment.";

/** Ask a question + watch the pipeline. On success it navigates to the research's
 *  detail page (the result is persisted, so the detail page renders it). Recent
 *  runs are shown below so the screen is never empty. */
export function NewResearchPage() {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<Mode>("idle");
  const [statuses, setStatuses] = useState<Record<number, PhaseStatus>>({});
  const [details, setDetails] = useState<Record<number, string | undefined>>({});
  const [message, setMessage] = useState("");
  const [recent, setRecent] = useState<ResearchSummary[]>([]);
  const unsub = useRef<(() => void) | null>(null);

  useEffect(() => () => unsub.current?.(), []);

  useEffect(() => {
    let alive = true;
    getHistory()
      .then((r) => alive && setRecent(r.slice(0, 6)))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  const run = useCallback(async () => {
    if (query.trim().length < 8) return;
    unsub.current?.();
    setStatuses({});
    setDetails({});
    setMessage("");
    setMode("running");
    try {
      const { jobId } = await startResearch(query.trim());
      unsub.current = streamProgress(jobId, {
        onProgress: (e) => {
          setStatuses((s) => ({ ...s, [e.phase]: e.status === "done" ? "done" : "active" }));
          if (e.detail) setDetails((d) => ({ ...d, [e.phase]: e.detail }));
        },
        onResult: (result) => {
          if ("status" in result && result.status === "ok") {
            navigate(`/research/${jobId}`);
          } else if ("status" in result && result.status === "rejected") {
            setMessage(`Query rejected (${result.reason}). Try rephrasing as a research question.`);
            setMode("rejected");
          } else {
            setMessage("error" in result ? result.error : "The run did not complete.");
            setMode("error");
          }
        },
        onError: () => {
          setMessage(ENGINE_DOWN);
          setMode("error");
        },
      });
    } catch {
      setMessage(ENGINE_DOWN);
      setMode("error");
    }
  }, [query, navigate]);

  const busy = mode === "running";

  return (
    <main className="view">
      <div className="view__inner">
        <section className="home__hero">
          <span className="hero__eyebrow">✦ Every claim traces to a real passage</span>
          <h1 className="hero__title">
            Research, <em>synthesized</em> and sourced.
          </h1>
          <p className="hero__sub">
            Ask a research question. Udaan searches the literature, reads the papers, and writes a
            brief — every sentence anchored to a source you can open, verify, and chat with.
          </p>
          <div className="hero__console">
            <QueryConsole value={query} onChange={setQuery} onSubmit={run} busy={busy} />
          </div>
        </section>

        {mode === "running" && (
          <section className="home__progress">
            <PipelineLedger statuses={statuses} details={details} />
          </section>
        )}
        {mode === "rejected" && <p className="banner banner--warn">{message}</p>}
        {mode === "error" && <p className="banner banner--error">{message}</p>}

        {!busy && recent.length > 0 && (
          <section className="home__recent">
            <div className="section-head">
              <h2 className="section-head__title">Recent research</h2>
              <Link to="/history" className="section-head__link">
                View all →
              </Link>
            </div>
            <ul className="cards">
              {recent.map((r) => (
                <li key={r.id}>
                  <ResearchCard research={r} />
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </main>
  );
}
