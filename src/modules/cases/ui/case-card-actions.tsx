"use client";

import Link from "next/link";
import type { Route } from "next";
import { useEffect, useRef, useState } from "react";

interface CaseCardActionsProps {
  permanentUrl: string;
  shareTitle: string;
  citation?: string | null;
  summaryPath: string;
}

/** Summary-card actions after Follow: Share, plus a small "More" menu (print, copy link, copy citation, one-page summary). */
export function CaseCardActions({ permanentUrl, shareTitle, citation, summaryPath }: CaseCardActionsProps) {
  const [message, setMessage] = useState("");
  const menu = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    const details = menu.current;
    if (!details) return;
    const close = (event: Event) => {
      if (!details.open) return;
      if (event instanceof KeyboardEvent) {
        if (event.key !== "Escape") return;
        details.open = false;
        details.querySelector("summary")?.focus();
        return;
      }
      if (!details.contains(event.target as Node)) details.open = false;
    };
    document.addEventListener("click", close);
    document.addEventListener("keydown", close);
    return () => { document.removeEventListener("click", close); document.removeEventListener("keydown", close); };
  }, []);

  async function copy(value: string, confirmation: string) {
    try {
      await navigator.clipboard.writeText(value);
      setMessage(confirmation);
    } catch {
      setMessage("Copy is unavailable in this browser.");
    }
    if (menu.current) menu.current.open = false;
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

  return <>
    <button type="button" className="cdAction" onClick={share}>Share</button>
    <details className="cdMenu" ref={menu}>
      <summary className="cdAction" aria-label="More case tools">More</summary>
      <div className="cdMenuList" role="group" aria-label="More case tools">
        <button type="button" onClick={() => { if (menu.current) menu.current.open = false; window.print(); }}>Print</button>
        <button type="button" onClick={() => copy(permanentUrl, "Permanent link copied.")}>Copy link</button>
        {citation ? <button type="button" onClick={() => copy(citation, "Citation copied.")}>Copy citation</button> : null}
        <Link href={summaryPath as Route}>One-page summary</Link>
      </div>
    </details>
    <span className="cdActionStatus" role="status" aria-live="polite">{message}</span>
  </>;
}
