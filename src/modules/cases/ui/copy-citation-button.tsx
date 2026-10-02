"use client";

import { useState } from "react";

export function CopyCitationButton({ citation, className }: { citation: string; className?: string }) {
  const [status, setStatus] = useState<"idle" | "copied" | "failed">("idle");

  async function copy() {
    try {
      await navigator.clipboard.writeText(citation);
      setStatus("copied");
    } catch {
      setStatus("failed");
    }
  }

  return (
    <button type="button" className={className} onClick={copy} aria-label={`Copy citation ${citation}`}>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <rect x="8" y="8" width="12" height="12" rx="2" />
        <path d="M4 16V6a2 2 0 0 1 2-2h10" />
      </svg>
      <span aria-live="polite">{status === "copied" ? "Citation copied" : status === "failed" ? "Copy unavailable" : "Copy citation"}</span>
    </button>
  );
}
