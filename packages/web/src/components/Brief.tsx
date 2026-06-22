import { Fragment, type ReactNode } from "react";
import type { ResearchBrief } from "../types.js";

type BibEntry = ResearchBrief["bibliography"][string];

const TONE = {
  consensus: { cls: "consensus", badge: "Consensus" },
  conflict: { cls: "conflict", badge: "Conflict" },
  thin: { cls: "thin", badge: "Emerging" },
  accent: { cls: "accent", badge: "Synthesis" },
} as const;

function toneFor(heading: string): keyof typeof TONE {
  const h = heading.toLowerCase();
  if (h.includes("conflict")) return "conflict";
  if (h.includes("consensus")) return "consensus";
  if (h.includes("thin") || h.includes("open") || h.includes("emerging")) return "thin";
  return "accent";
}

/** Render body text, turning [n] citations into chips that reveal the source on
 *  hover and tether to the matching bibliography entry. */
function withCitations(text: string, refs: Record<string, BibEntry>): ReactNode[] {
  return text.split(/(\[\d+\])/g).map((part, i) => {
    const match = part.match(/^\[(\d+)\]$/);
    if (!match) return <Fragment key={i}>{part}</Fragment>;
    const n = match[1];
    const entry = refs[n];
    return (
      <span className="cite-wrap" key={i}>
        <a className="cite" href={`#ref-${n}`} aria-label={`Source ${n}`}>
          {n}
        </a>
        {entry && (
          <span className="cite__pop" role="tooltip">
            <span className="cite__popLabel">Source {n}{entry.doi ? "" : " · quote"}</span>
            <span className="cite__popQuote">“{entry.text}”</span>
            {entry.doi && <span className="cite__popDoi">doi:{entry.doi}</span>}
          </span>
        )}
      </span>
    );
  });
}

export function Brief({ brief }: { brief: ResearchBrief }) {
  const refs = Object.entries(brief.bibliography).sort((a, b) => Number(a[0]) - Number(b[0]));
  const refMap = Object.fromEntries(refs) as Record<string, BibEntry>;
  const { degraded, degradedStages, totalClaims, sectionsGenerated } = brief.metadata;

  return (
    <article className="brief" aria-label="Research brief">
      {degraded && (
        <div className="brief__degraded" role="alert">
          <strong>Degraded mode.</strong> This brief was produced with low-quality fallback
          implementations
          {degradedStages.length > 0 ? ` for: ${degradedStages.join(", ")}` : ""}. Results may be
          unreliable.
        </div>
      )}

      <header className="brief__stats">
        <span className="stat">
          <span className="stat__value">{totalClaims}</span>
          <span className="stat__label">Sourced claims</span>
        </span>
        <span className="stat">
          <span className="stat__value">{sectionsGenerated}</span>
          <span className="stat__label">Sections</span>
        </span>
        <span className="stat stat--seal">
          <span className="stat__value">✓ Traced</span>
          <span className="stat__label">Every sentence</span>
        </span>
      </header>

      {brief.sections.map((section, i) => {
        const tone = TONE[toneFor(section.heading)];
        return (
          <section key={i} className={`section-card section-card--${tone.cls}`}>
            <div className="section-card__head">
              <span className="section-card__badge">{tone.badge}</span>
              <h3 className="section-card__title">{section.heading}</h3>
            </div>
            <p className="section-card__body">{withCitations(section.bodyText, refMap)}</p>
          </section>
        );
      })}

      {refs.length > 0 && (
        <section className="sources" aria-label="Sources">
          <h3 className="sources__title">Sources</h3>
          <ol className="sources__list">
            {refs.map(([n, entry]) => (
              <li key={n} id={`ref-${n}`} className="source-card">
                <span className="source-card__num">{n}</span>
                <div>
                  <div className="source-card__ids">
                    <span className="source-card__claim">{entry.claimId}</span>
                    {entry.doi && (
                      <a
                        className="source-card__doi"
                        href={`https://doi.org/${entry.doi}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        doi:{entry.doi}
                      </a>
                    )}
                  </div>
                  <blockquote className="source-card__quote">“{entry.text}”</blockquote>
                </div>
              </li>
            ))}
          </ol>
        </section>
      )}
    </article>
  );
}
