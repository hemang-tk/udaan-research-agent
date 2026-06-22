import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { QueryConsole } from "../components/QueryConsole.js";
import { ResearchCard } from "../components/ResearchCard.js";
import { useRunStatus } from "../RunStatusContext.js";
import { getHistory, startResearch } from "../api.js";
import type { ResearchSummary } from "../types.js";

const ENGINE_DOWN = "Can't reach the research engine right now. Please try again in a moment.";

/** Ask a question, then hand off to the run's own page (/research/:id), which
 *  shows the live pipeline and the finished brief — and survives a reload.
 *  Recent runs are shown below so the screen is never empty. */
export function NewResearchPage() {
  const navigate = useNavigate();
  const { setRunning } = useRunStatus();
  const [query, setQuery] = useState("");
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState("");
  const [recent, setRecent] = useState<ResearchSummary[]>([]);

  // Submitting kicks off a synthesis — flag it so the shell disables everything
  // until the run's page takes over (and clear it on unmount).
  useEffect(() => {
    setRunning(starting);
  }, [starting, setRunning]);
  useEffect(() => () => setRunning(false), [setRunning]);

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
    if (query.trim().length < 8 || starting) return;
    setError("");
    setStarting(true);
    try {
      const { jobId } = await startResearch(query.trim());
      navigate(`/research/${jobId}`);
    } catch {
      setError(ENGINE_DOWN);
      setStarting(false);
    }
  }, [query, starting, navigate]);

  return (
    <main className="view">
      <div className="view__inner">
        <section className="home__hero">
          <span className="hero__eyebrow">✦ Every claim traces to a real passage</span>
          <h1 className="hero__title">
            Research, <em>synthesized</em> and sourced.
          </h1>
          <div className="hero__console">
            <QueryConsole value={query} onChange={setQuery} onSubmit={run} busy={starting} />
          </div>
        </section>

        {error && <p className="banner banner--error">{error}</p>}

        {recent.length > 0 && (
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
