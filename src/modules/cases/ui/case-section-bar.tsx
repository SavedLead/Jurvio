"use client";

import { useEffect, useRef, useState } from "react";

export interface SectionChip { id: string; label: string }

/**
 * Sticky, horizontally scrolling chip bar of the page's sections. Highlights the section being read and keeps
 * its chip in view. It also publishes the site header's height (--cd-header-h) so the bar and the section
 * anchors sit just below it; that only changes sticky offsets and scroll margins, never the layout.
 */
export function CaseSectionBar({ chips }: { chips: SectionChip[] }) {
  const [current, setCurrent] = useState<string | null>(null);
  const bar = useRef<HTMLElement>(null);
  const followed = useRef<string | null>(null);

  useEffect(() => {
    const header = document.querySelector(".siteHeader");
    const setHeader = () => {
      const height = header && getComputedStyle(header).position === "sticky" ? header.getBoundingClientRect().height : 0;
      document.documentElement.style.setProperty("--cd-header-h", `${Math.round(height)}px`);
    };
    setHeader();
    let frame = 0;
    const update = () => {
      frame = 0;
      const offset = (bar.current?.getBoundingClientRect().bottom ?? 0) + 12;
      let active: string | null = null;
      for (const chip of chips) {
        const section = document.getElementById(`${chip.id}-section`);
        if (section && section.getBoundingClientRect().top <= offset) active = chip.id;
      }
      const atEnd = window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 4;
      // Near the end of the page a section can't scroll up to the bar: the chip last followed stays current while visible.
      const last = followed.current;
      const followedTop = last ? document.getElementById(`${last}-section`)?.getBoundingClientRect().top : undefined;
      if (atEnd && last && followedTop !== undefined && followedTop < window.innerHeight) active = last;
      setCurrent(active);
    };
    const onHash = () => {
      const id = window.location.hash.replace(/^#/, "").replace(/-section$/, "");
      followed.current = chips.some((chip) => chip.id === id) ? id : null;
      requestAnimationFrame(update);
    };
    const onScroll = () => { if (!frame) frame = requestAnimationFrame(update); };
    const onResize = () => { setHeader(); onScroll(); };
    onHash();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onResize);
    window.addEventListener("hashchange", onHash);
    return () => {
      window.removeEventListener("scroll", onScroll); window.removeEventListener("resize", onResize); window.removeEventListener("hashchange", onHash);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [chips]);

  useEffect(() => {
    const list = bar.current?.querySelector(".cdBarList");
    const chip = current ? list?.querySelector<HTMLElement>(`[data-chip="${current}"]`) : null;
    if (!list || !chip) return;
    const left = chip.offsetLeft - 16;
    const right = chip.offsetLeft + chip.offsetWidth + 16 - list.clientWidth;
    if (list.scrollLeft > left) list.scrollTo({ left, behavior: "smooth" });
    else if (list.scrollLeft < right) list.scrollTo({ left: right, behavior: "smooth" });
  }, [current]);

  if (chips.length < 2) return null;
  return <nav className="cdBar" aria-label="On this page" ref={bar}>
    <ul className="cdBarList">
      {chips.map((chip) => <li key={chip.id}>
        <a href={`#${chip.id}-section`} data-chip={chip.id} aria-current={current === chip.id ? "location" : undefined}
          onClick={(event) => {
            // Open the section even when the URL already points at it (no hashchange), then move focus into it.
            const section = document.getElementById(`${chip.id}-section`);
            if (!(section instanceof HTMLDetailsElement)) return;
            event.preventDefault();
            section.open = true;
            if (window.location.hash !== `#${chip.id}-section`) history.pushState(null, "", `#${chip.id}-section`);
            followed.current = chip.id;
            const smooth = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
            section.scrollIntoView({ behavior: smooth ? "smooth" : "auto" });
            section.querySelector("summary")?.focus({ preventScroll: true });
            setCurrent(chip.id);
          }}>{chip.label}</a>
      </li>)}
    </ul>
  </nav>;
}
