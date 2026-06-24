import { Link } from "react-router-dom";
import type { ResearchSummary } from "../types.js";

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return iso;
  }
}

/** One past-research tile, shared by Home (recent) and History (grid). */
export function ResearchCard({ research }: { research: ResearchSummary }) {
  return (
    <Link to={`/research/${research.id}`} className="card">
      <span className="card__q">{research.query}</span>
      <span className="card__meta">
        <span>{formatDate(research.createdAt)}</span>
        <span className="card__stats">
          <span className="chip chip--accent">{research.totalClaims} claims</span>
          <span className="chip">{research.sections} sections</span>
        </span>
      </span>
    </Link>
  );
}
