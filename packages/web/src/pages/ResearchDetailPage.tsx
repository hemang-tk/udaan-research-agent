import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Brief } from "../components/Brief.js";
import { ChatPanel } from "../components/ChatPanel.js";
import { PaywallUploads } from "../components/PaywallUploads.js";
import { getResearchRecord, type ResearchDetail } from "../api.js";

type Load = "loading" | "notfound" | "ok";

/** One research, two panes: the brief (left) and a chat over its papers (right).
 *  The URL (/research/:id) is shareable. */
export function ResearchDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [state, setState] = useState<Load>("loading");
  const [rec, setRec] = useState<ResearchDetail | null>(null);

  useEffect(() => {
    let alive = true;
    setState("loading");
    setRec(null);
    getResearchRecord(id ?? "")
      .then((r) => {
        if (!alive) return;
        if (r) {
          setRec(r);
          setState("ok");
        } else {
          setState("notfound");
        }
      })
      .catch(() => alive && setState("notfound"));
    return () => {
      alive = false;
    };
  }, [id]);

  if (state === "loading") {
    return (
      <main className="view">
        <div className="view__inner">
          <Link to="/history" className="detail__back">← History</Link>
          <p className="muted" style={{ marginTop: 24 }}>Loading…</p>
        </div>
      </main>
    );
  }

  if (state === "notfound" || !rec) {
    return (
      <main className="view">
        <div className="view__inner">
          <div className="empty">
            <span className="empty__icon">🔎</span>
            <p className="empty__lead">This research isn’t available</p>
            <p className="muted">It may have run before persistence was enabled, or the link is wrong.</p>
            <Link to="/history" className="btn btn--ghost">Back to History</Link>
          </div>
        </div>
      </main>
    );
  }

  const meta = rec.brief.metadata;

  return (
    <main className="detail">
      <div className="detail__bar">
        <Link to="/history" className="detail__back">← History</Link>
        <div className="detail__heading">
          <h1 className="detail__q" title={rec.query}>{rec.query || "Research brief"}</h1>
          {rec.createdAt && (
            <span className="detail__date">{new Date(rec.createdAt).toLocaleString()}</span>
          )}
        </div>
        <div className="detail__pills">
          <span className="chip chip--accent">{meta.totalClaims} claims</span>
          <span className="chip">{meta.sectionsGenerated} sections</span>
        </div>
      </div>

      <div className="detail__panes">
        <div className="pane pane--brief">
          {rec.paywalled.length > 0 && <PaywallUploads entries={rec.paywalled} />}
          <Brief brief={rec.brief} />
        </div>
        <div className="pane pane--chat">
          <ChatPanel researchId={id ?? ""} query={rec.query} brief={rec.brief} />
        </div>
      </div>
    </main>
  );
}
