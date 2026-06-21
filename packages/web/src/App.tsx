import { useCallback, useRef, useState } from "react";
import { Brief } from "./components/Brief.js";
import { PaywallUploads } from "./components/PaywallUploads.js";
import { PipelineLedger } from "./components/PipelineLedger.js";
import { QueryConsole } from "./components/QueryConsole.js";
import { getStatus, startResearch, streamProgress } from "./api.js";
import { SAMPLE_BRIEF, SAMPLE_QUERY } from "./sample.js";
import type { PaywalledEntry, PhaseStatus, ResearchBrief } from "./types.js";

type Mode = "idle" | "running" | "done" | "rejected" | "error";

const emptyStatuses = (): Record<number, PhaseStatus> => ({});
const allPhasesDone = (): Record<number, PhaseStatus> => ({
  1: "done",
  2: "done",
  3: "done",
  4: "done",
  5: "done",
  6: "done",
  7: "done",
});

export function App() {
  // First load shows a ready-made sample brief so the page demonstrates the product
  // immediately; it's replaced the moment the user runs their own query (see reset()).
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<Mode>("done");
  const [statuses, setStatuses] = useState<Record<number, PhaseStatus>>(allPhasesDone);
  const [details, setDetails] = useState<Record<number, string | undefined>>({});
  const [brief, setBrief] = useState<ResearchBrief | null>(SAMPLE_BRIEF);
  const [paywalled, setPaywalled] = useState<PaywalledEntry[]>([]);
  const [message, setMessage] = useState("");
  const [isSample, setIsSample] = useState(true);
  const unsub = useRef<(() => void) | null>(null);

  const reset = useCallback(() => {
    unsub.current?.();
    setStatuses(emptyStatuses());
    setDetails({});
    setBrief(null);
    setPaywalled([]);
    setMessage("");
    setIsSample(false);
  }, []);

  const run = useCallback(async () => {
    if (query.trim().length < 8) return;
    reset();
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
            setBrief(result.brief);
            setMode("done");
            getStatus(jobId)
              .then((s) => setPaywalled(s.paywalled ?? []))
              .catch(() => undefined);
          } else if ("status" in result && result.status === "rejected") {
            setMessage(`Query rejected (${result.reason}). Try rephrasing as a research question.`);
            setMode("rejected");
          } else {
            setMessage("error" in result ? result.error : "The run did not complete.");
            setMode("error");
          }
        },
        onError: () => {
          setMessage(
            "Can't reach the synthesis engine. Start the orchestrator API on port 8080 (and the Python services), or view a sample brief.",
          );
          setMode("error");
        },
      });
    } catch {
      setMessage(
        "Can't reach the synthesis engine. Start the orchestrator API on port 8080 (and the Python services), or view a sample brief.",
      );
      setMode("error");
    }
  }, [query, reset]);

  const loadSample = useCallback(() => {
    reset();
    setQuery(SAMPLE_QUERY);
    setBrief(SAMPLE_BRIEF);
    setStatuses({ 1: "done", 2: "done", 3: "done", 4: "done", 5: "done", 6: "done", 7: "done" });
    setIsSample(true);
    setMode("done");
  }, [reset]);

  const busy = mode === "running";

  return (
    <div className="app">
      <header className="masthead">
        <div className="masthead__brand">
          <span className="masthead__mark">Udaan</span>
          <span className="masthead__tag">Research Synthesis Engine</span>
        </div>
        <p className="masthead__claim">Zero-hallucination traceability</p>
      </header>

      <main className="main">
        <QueryConsole value={query} onChange={setQuery} onSubmit={run} onSample={loadSample} busy={busy} />

        {mode === "idle" && (
          <section className="hero">
            <h1 className="hero__headline">
              Every claim in your brief traces to a real passage.
            </h1>
            <p className="hero__sub">
              Ask a research question. Udaan searches the literature, reads the papers, and synthesizes a
              brief — and every sentence it returns is anchored to a source you can open and verify.
            </p>

            <figure className="anatomy" aria-label="Anatomy of a traced claim">
              <figcaption className="anatomy__cap">Anatomy of a traced claim</figcaption>
              <p className="anatomy__claim">
                Micro-caching reduced p99 tail latency by roughly 40% under standard load
                <a className="cite cite--static" href="#ref-1">1</a>
              </p>
              <div className="anatomy__thread" aria-hidden="true" />
              <div className="anatomy__source">
                <span className="anatomy__srcLabel">source 1</span>
                <span className="bib__claim">cl_9f2a1b</span>
                <blockquote className="anatomy__quote">
                  “…ephemeral micro-caching resulted in a 40.2% reduction in p99 tail latency”
                </blockquote>
              </div>
            </figure>
          </section>
        )}

        {(mode === "running" || mode === "done") && (
          <PipelineLedger statuses={statuses} details={details} />
        )}

        {isSample && (
          <p className="banner banner--sample">Sample brief — illustrative, not a live run.</p>
        )}

        {mode === "rejected" && <p className="banner banner--warn">{message}</p>}

        {mode === "error" && (
          <div className="banner banner--error">
            <span>{message}</span>
            <button type="button" className="btn btn--ghost" onClick={loadSample}>
              View a sample brief
            </button>
          </div>
        )}

        {mode === "done" && paywalled.length > 0 && <PaywallUploads entries={paywalled} />}

        {mode === "done" && brief && <Brief brief={brief} />}
      </main>

      <footer className="foot">
        <span>Udaan Research Agent</span>
        <span className="foot__note">Claims you can click through to the source.</span>
      </footer>
    </div>
  );
}
