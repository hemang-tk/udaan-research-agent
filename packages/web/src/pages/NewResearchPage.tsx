import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { PipelineLedger } from "../components/PipelineLedger.js";
import { QueryConsole } from "../components/QueryConsole.js";
import { startResearch, streamProgress } from "../api.js";
import type { PhaseStatus } from "../types.js";

type Mode = "idle" | "running" | "rejected" | "error";

const ENGINE_DOWN = "Can't reach the research engine right now. Please try again in a moment.";

/** The "ask a question + watch the pipeline" page. On success it navigates to the
 *  research's detail page (the result is persisted, so the detail page renders it). */
export function NewResearchPage() {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<Mode>("idle");
  const [statuses, setStatuses] = useState<Record<number, PhaseStatus>>({});
  const [details, setDetails] = useState<Record<number, string | undefined>>({});
  const [message, setMessage] = useState("");
  const unsub = useRef<(() => void) | null>(null);

  // Close any open SSE stream if the user navigates away mid-run.
  useEffect(() => () => unsub.current?.(), []);

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
    <main className="page page--new">
      <section className="ask">
        <h1 className="ask__headline">Every claim traces to a real passage.</h1>
        <p className="ask__sub">
          Ask a research question. Udaan searches the literature, reads the papers, and synthesizes a
          brief — every sentence anchored to a source you can open and verify.
        </p>
        <QueryConsole value={query} onChange={setQuery} onSubmit={run} busy={busy} />
      </section>

      {mode === "running" && (
        <section className="ask__progress">
          <PipelineLedger statuses={statuses} details={details} />
        </section>
      )}
      {mode === "rejected" && <p className="banner banner--warn">{message}</p>}
      {mode === "error" && <p className="banner banner--error">{message}</p>}
    </main>
  );
}
