"use client";

import { useState } from "react";

interface PublicCaseToolsProps {
  permanentUrl: string;
  shareTitle: string;
  citation?: string | null;
}

export function PublicCaseTools({ permanentUrl, shareTitle, citation }: PublicCaseToolsProps) {
  const [message, setMessage] = useState("");

  async function copy(value: string, confirmation: string) {
    try {
      await navigator.clipboard.writeText(value);
      setMessage(confirmation);
    } catch {
      setMessage("Copy is unavailable in this browser.");
    }
  }

  async function share() {
    if (navigator.share) {
      try {
        await navigator.share({ title: shareTitle, url: permanentUrl });
        return;
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
      }
    }
    await copy(permanentUrl, "Permanent link copied.");
  }

  return (
    <div className="publicCaseTools" aria-label="Case tools">
      <button type="button" onClick={() => window.print()}>Print</button>
      <button type="button" onClick={() => copy(permanentUrl, "Permanent link copied.")}>Copy link</button>
      {citation ? <button type="button" onClick={() => copy(citation, "Citation copied.")}>Copy citation</button> : null}
      <button type="button" onClick={share}>Share</button>
      <span role="status" aria-live="polite">{message}</span>
    </div>
  );
}
