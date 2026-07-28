"use client";

import { useEffect, useMemo, useState } from "react";

type ReaderSize = "small" | "regular" | "large";
type ReaderWidth = "standard" | "wide";
type ReaderTheme = "paper" | "soft";

interface ReaderSection {
  id: string;
  label: string;
}

interface OpinionReaderToolsProps {
  targetId: string;
  permanentUrl: string;
  shareTitle: string;
  citation?: string | null;
}

const preferenceKey = "jurvio-opinion-reader";

export function OpinionReaderTools({
  targetId,
  permanentUrl,
  shareTitle,
  citation,
}: OpinionReaderToolsProps) {
  const [size, setSize] = useState<ReaderSize>("regular");
  const [width, setWidth] = useState<ReaderWidth>("standard");
  const [theme, setTheme] = useState<ReaderTheme>("paper");
  const [sections, setSections] = useState<ReaderSection[]>([]);
  const [query, setQuery] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(preferenceKey) ?? "{}") as {
        size?: ReaderSize; width?: ReaderWidth; theme?: ReaderTheme;
      };
      if (saved.size) setSize(saved.size);
      if (saved.width) setWidth(saved.width);
      if (saved.theme) setTheme(saved.theme);
    } catch {
      // Invalid local preferences safely fall back to defaults.
    }
  }, []);

  useEffect(() => {
    const target = document.getElementById(targetId);
    if (!target) return;
    target.dataset.readerSize = size;
    target.dataset.readerWidth = width;
    target.dataset.readerTheme = theme;
    localStorage.setItem(preferenceKey, JSON.stringify({ size, width, theme }));
  }, [size, targetId, theme, width]);

  useEffect(() => {
    const target = document.getElementById(targetId);
    if (!target) return;
    const found = [...target.querySelectorAll<HTMLElement>("h2, h3, .reportersNote")]
      .filter((heading) => heading.textContent?.trim())
      .map((heading, index) => {
        const id = heading.id || `opinion-section-${index + 1}`;
        heading.id = id;
        const nested = heading.querySelector<HTMLElement>("h2, h3");
        return { id, label: (nested?.textContent ?? heading.textContent ?? "").trim().slice(0, 80) };
      });
    setSections(found);
  }, [targetId]);

  const controlsLabel = useMemo(() => `Reader settings: ${size} text, ${width} width, ${theme} theme`, [size, theme, width]);

  function searchOpinion(event: React.FormEvent) {
    event.preventDefault();
    const value = query.trim();
    if (!value) return;
    const browserFind = (window as typeof window & { find?: (text: string, caseSensitive?: boolean, backwards?: boolean, wrap?: boolean) => boolean }).find;
    const found = browserFind?.(value, false, false, true) ?? false;
    setMessage(found ? `Found “${value}”.` : `No match for “${value}”.`);
  }

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
    <aside id="opinion-reader-tools" className="opinionReaderTools" aria-label="Opinion reader tools">
      <details open>
        <summary>Read and navigate</summary>
        <form className="opinionSearch" onSubmit={searchOpinion} role="search">
          <label htmlFor="opinion-search">Search this opinion</label>
          <div><input id="opinion-search" value={query} onChange={(event) => setQuery(event.target.value)} /><button type="submit">Find</button></div>
        </form>
        {sections.length > 0 ? (
          <nav aria-label="Opinion sections" className="opinionSectionNav">
            <strong>In this opinion</strong>
            {sections.map((section) => <a key={section.id} href={`#${section.id}`}>{section.label}</a>)}
          </nav>
        ) : null}
      </details>
      <details>
        <summary>Reader settings</summary>
        <div className="readerSettings" aria-label={controlsLabel}>
          <fieldset><legend>Text size</legend>
            <button type="button" aria-pressed={size === "small"} onClick={() => setSize("small")}>A−</button>
            <button type="button" aria-pressed={size === "regular"} onClick={() => setSize("regular")}>A</button>
            <button type="button" aria-pressed={size === "large"} onClick={() => setSize("large")}>A+</button>
          </fieldset>
          <fieldset><legend>Reading width</legend>
            <button type="button" aria-pressed={width === "standard"} onClick={() => setWidth("standard")}>Standard</button>
            <button type="button" aria-pressed={width === "wide"} onClick={() => setWidth("wide")}>Wide</button>
          </fieldset>
          <fieldset><legend>Contrast</legend>
            <button type="button" aria-pressed={theme === "paper"} onClick={() => setTheme("paper")}>Paper</button>
            <button type="button" aria-pressed={theme === "soft"} onClick={() => setTheme("soft")}>Soft</button>
          </fieldset>
        </div>
      </details>
      <div className="readerPublicTools">
        <button type="button" onClick={() => window.print()}>Print</button>
        <button type="button" onClick={() => copy(permanentUrl, "Permanent link copied.")}>Copy link</button>
        {citation ? <button type="button" onClick={() => copy(citation, "Citation copied.")}>Copy citation</button> : null}
        <button type="button" onClick={share}>Share</button>
      </div>
      <span className="toolStatus" role="status" aria-live="polite">{message}</span>
    </aside>
  );
}
