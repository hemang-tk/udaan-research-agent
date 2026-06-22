import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Brief } from "../components/Brief.js";
import { PaywallUploads } from "../components/PaywallUploads.js";
import { getResearchRecord, type ResearchDetail } from "../api.js";

type Load = "loading" | "notfound" | "ok";

/** Opens one research (from History or a just-finished run): its brief, query, date,
 *  and any paywalled sources. The URL (/research/:id) is shareable. */
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

  return (
    <main className="page page--detail">
      <Link to="/history" className="backlink">
        ← History
      </Link>

      {state === "loading" && <p className="page__muted">Loading…</p>}

      {state === "notfound" && (
        <div className="empty">
          <p className="empty__lead">This research isn't available.</p>
          <p className="page__muted">
            It may have run before persistence was enabled, or the link is wrong.
          </p>
          <Link to="/history" className="btn btn--ghost">
            Back to History
          </Link>
        </div>
      )}

      {state === "ok" && rec && (
        <>
          <header className="detailhead">
            {rec.query && <h1 className="detailhead__q">{rec.query}</h1>}
            {rec.createdAt && (
              <p className="detailhead__date">{new Date(rec.createdAt).toLocaleString()}</p>
            )}
          </header>
          {rec.paywalled.length > 0 && <PaywallUploads entries={rec.paywalled} />}
          <Brief brief={rec.brief} />
        </>
      )}
    </main>
  );
}
