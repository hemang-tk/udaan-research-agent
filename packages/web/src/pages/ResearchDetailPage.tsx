import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Brief } from "../components/Brief.js";
import { ChatPanel } from "../components/ChatPanel.js";
import { PaywallUploads } from "../components/PaywallUploads.js";
import { PipelineLedger } from "../components/PipelineLedger.js";
import { useRunStatus } from "../RunStatusContext.js";
import { getResearchState } from "../api.js";
import type { PaywalledEntry, PhaseStatus, ResearchBrief } from "../types.js";

type Mode = "loading" | "running" | "ready" | "failed" | "notfound";

/** One research. While it runs, this page shows the live pipeline and keeps
 *  polling — so a reload mid-run resumes instead of losing the work. When done it
 *  becomes two panes: the brief on the left, a chat over its papers on the right. */
export function ResearchDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { setRunning } = useRunStatus();
  const [mode, setMode] = useState<Mode>("loading");
  const [query, setQuery] = useState("");
  const [createdAt, setCreatedAt] = useState<string | undefined>();
  const [brief, setBrief] = useState<ResearchBrief | null>(null);
  const [paywalled, setPaywalled] = useState<PaywalledEntry[]>([]);
  const [statuses, setStatuses] = useState<Record<number, PhaseStatus>>({});
  const [details, setDetails] = useState<Record<number, string | undefined>>({});
  const [message, setMessage] = useState("");
  const [showPaywall, setShowPaywall] = useState(true);

  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    setMode("loading");
    setBrief(null);

    const tick = async () => {
      const s = await getResearchState(id ?? "").catch(() => null);
      if (!alive) return;
      if (!s) {
        setMode("notfound");
        return;
      }
      setQuery(s.query);
      setCreatedAt(s.createdAt);
      setPaywalled(s.paywalled);

      if (!s.done) {
        const st: Record<number, PhaseStatus> = {};
        const dt: Record<number, string | undefined> = {};
        for (const e of s.events) {
          st[e.phase] = e.status === "done" ? "done" : "active";
          if (e.detail) dt[e.phase] = e.detail;
        }
        setStatuses(st);
        setDetails(dt);
        setMode("running");
        timer = setTimeout(tick, 2000);
        return;
      }

      const r = s.result;
      if (r && "status" in r && r.status === "ok") {
        setBrief(r.brief);
        setMode("ready");
      } else if (r && "status" in r && r.status === "rejected") {
        setMessage(`Query rejected (${r.reason}). Try rephrasing it as a research question.`);
        setMode("failed");
      } else {
        setMessage((r && "error" in r ? r.error : s.error) || "The run did not complete.");
        setMode("failed");
      }
    };

    tick();
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
    };
  }, [id]);

  // Disable the shell's nav/buttons while this run's pipeline is in progress.
  useEffect(() => {
    setRunning(mode === "running");
    return () => setRunning(false);
  }, [mode, setRunning]);

  const Bar = (
    <div className="detail__bar">
      <Link to="/history" className="detail__back">
        ← History
      </Link>
      <div className="detail__heading">
        <h1 className="detail__q" title={query}>
          {query || "Research"}
        </h1>
        {mode === "running" && <span className="detail__date">Running…</span>}
        {mode === "ready" && createdAt && (
          <span className="detail__date">{new Date(createdAt).toLocaleString()}</span>
        )}
      </div>
      {mode === "ready" && brief && (
        <div className="detail__pills">
          <span className="chip chip--accent">{brief.metadata.totalClaims} claims</span>
          <span className="chip">{brief.metadata.sectionsGenerated} sections</span>
        </div>
      )}
    </div>
  );

  if (mode === "loading") {
    return (
      <main className="detail">
        {Bar}
        <div className="view">
          <div className="view__inner">
            <p className="muted">Loading…</p>
          </div>
        </div>
      </main>
    );
  }

  if (mode === "notfound") {
    return (
      <main className="detail">
        {Bar}
        <div className="view">
          <div className="view__inner">
            <div className="empty">
              <span className="empty__icon">🔎</span>
              <p className="empty__lead">This research isn’t available</p>
              <p className="muted">It may have run before persistence was enabled, or the link is wrong.</p>
              <Link to="/history" className="btn btn--ghost">
                Back to History
              </Link>
            </div>
          </div>
        </div>
      </main>
    );
  }

  if (mode === "running") {
    return (
      <main className="detail">
        {Bar}
        <div className="view">
          <div className="view__inner view__inner--narrow">
            <p className="run__lead">
              Searching the literature, reading the papers, and synthesizing a brief. This can take a
              couple of minutes — the page resumes automatically if you reload.
            </p>
            <PipelineLedger statuses={statuses} details={details} />
          </div>
        </div>
      </main>
    );
  }

  if (mode === "failed") {
    return (
      <main className="detail">
        {Bar}
        <div className="view">
          <div className="view__inner">
            <p className="banner banner--warn">{message}</p>
            <p style={{ marginTop: 16 }}>
              <Link to="/" className="btn btn--accent">
                Start a new research
              </Link>
            </p>
          </div>
        </div>
      </main>
    );
  }

  // mode === "ready"
  return (
    <main className="detail">
      {Bar}
      <div className="detail__panes">
        <div className="pane pane--brief">
          {paywalled.length > 0 &&
            (showPaywall ? (
              <PaywallUploads entries={paywalled} onClose={() => setShowPaywall(false)} />
            ) : (
              <button type="button" className="paywall__reopen" onClick={() => setShowPaywall(true)}>
                ⚠ Show paywalled sources ({paywalled.length})
              </button>
            ))}
          {brief && <Brief brief={brief} />}
        </div>
        <div className="pane pane--chat">
          <ChatPanel researchId={id ?? ""} query={query} brief={brief as ResearchBrief} />
        </div>
      </div>
    </main>
  );
}
