import { useState } from "react";
import { uploadPdf } from "../api.js";
import type { PaywalledEntry } from "../types.js";

type UploadState = "idle" | "busy" | "done" | "error";

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result);
      resolve(result.slice(result.indexOf(",") + 1));
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

export function PaywallUploads({
  entries,
  onClose,
}: {
  entries: PaywalledEntry[];
  onClose?: () => void;
}) {
  const [states, setStates] = useState<Record<string, UploadState>>({});

  const handle = async (entry: PaywalledEntry, file: File | undefined) => {
    if (!file) return;
    setStates((s) => ({ ...s, [entry.internalId]: "busy" }));
    try {
      const pdfBase64 = await fileToBase64(file);
      await uploadPdf({ doi: entry.doi, internalId: entry.internalId, pdfBase64 });
      setStates((s) => ({ ...s, [entry.internalId]: "done" }));
    } catch {
      setStates((s) => ({ ...s, [entry.internalId]: "error" }));
    }
  };

  return (
    <section className="paywall" aria-label="Paywalled sources">
      {onClose && (
        <button
          type="button"
          className="paywall__close"
          onClick={onClose}
          aria-label="Dismiss paywalled sources"
          title="Dismiss"
        >
          ✕
        </button>
      )}
      <h2 className="paywall__title">Paywalled sources</h2>
      <p className="paywall__lead">
        {entries.length} paper{entries.length === 1 ? "" : "s"} couldn’t be retrieved openly. If you have
        access, add the PDF and re-run to fold them into the brief.
      </p>
      <ul className="paywall__list">
        {entries.map((entry) => {
          const state = states[entry.internalId] ?? "idle";
          return (
            <li key={entry.internalId} className="paywall__item">
              <div className="paywall__info">
                <span className="paywall__paper">{entry.metadataSnapshot.title}</span>
                {entry.doi && <span className="paywall__doi">{entry.doi}</span>}
              </div>
              {state === "done" ? (
                <span className="paywall__ok">Added ✓</span>
              ) : (
                <label className={`paywall__btn${state === "busy" ? " paywall__btn--busy" : ""}`}>
                  {state === "busy" ? "Uploading…" : state === "error" ? "Retry upload" : "Upload PDF"}
                  <input
                    type="file"
                    accept="application/pdf"
                    hidden
                    disabled={state === "busy"}
                    onChange={(e) => handle(entry, e.target.files?.[0])}
                  />
                </label>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
