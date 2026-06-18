import { Fragment, type ReactNode } from "react";
import type { ResearchBrief } from "../types.js";

function toneFor(heading: string): string {
  const h = heading.toLowerCase();
  if (h.includes("conflict")) return "conflict";
  if (h.includes("consensus")) return "consensus";
  if (h.includes("thin") || h.includes("open")) return "thin";
  return "accent";
}

/** Render body text, turning [n] citations into anchors that tether to sources. */
function withCitations(text: string): ReactNode[] {
  return text.split(/(\[\d+\])/g).map((part, i) => {
    const match = part.match(/^\[(\d+)\]$/);
    if (!match) return <Fragment key={i}>{part}</Fragment>;
    const n = match[1];
    return (
      <a key={i} className="cite" href={`#ref-${n}`} aria-label={`Source ${n}`}>
        {n}
      </a>
    );
  });
}

export function Brief({ brief }: { brief: ResearchBrief }) {
  const refs = Object.entries(brief.bibliography).sort((a, b) => Number(a[0]) - Number(b[0]));

  const { degraded, degradedStages } = brief.metadata;

  return (
    <article className="brief" aria-label="Research brief">
      {degraded && (
        <div className="brief__degraded" role="alert">
          <strong>Degraded mode.</strong> This brief was produced with low-quality
          fallback implementations
          {degradedStages.length > 0 ? ` for: ${degradedStages.join(", ")}` : ""}. Results may
          be unreliable — install the ML extras for full-quality output.
        </div>
      )}
      <header className="brief__meta">
        <span className="brief__metaItem">
          <strong>{brief.metadata.totalClaims}</strong> sourced claims
        </span>
        <span className="brief__metaItem">
          <strong>{brief.metadata.sectionsGenerated}</strong> sections
        </span>
        <span className="brief__metaItem brief__metaItem--seal">every sentence traced</span>
      </header>

      {brief.sections.map((section, i) => (
        <section key={i} className={`brief__section brief__section--${toneFor(section.heading)}`}>
          <h3 className="brief__heading">
            <span className="brief__tick" aria-hidden="true" />
            {section.heading}
          </h3>
          <p className="brief__body">{withCitations(section.bodyText)}</p>
        </section>
      ))}

      {refs.length > 0 && (
        <section className="brief__bib" aria-label="Sources">
          <h3 className="brief__heading">Sources</h3>
          <ol className="bib">
            {refs.map(([n, entry]) => (
              <li key={n} id={`ref-${n}`} className="bib__item">
                <span className="bib__num">{n}</span>
                <div className="bib__detail">
                  <div className="bib__ids">
                    <span className="bib__claim">{entry.claimId}</span>
                    {entry.doi && (
                      <a className="bib__doi" href={`https://doi.org/${entry.doi}`} target="_blank" rel="noreferrer">
                        {entry.doi}
                      </a>
                    )}
                  </div>
                  <blockquote className="bib__quote">{entry.text}</blockquote>
                </div>
              </li>
            ))}
          </ol>
        </section>
      )}
    </article>
  );
}
