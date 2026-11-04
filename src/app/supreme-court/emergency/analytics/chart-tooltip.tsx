"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import styles from "./analytics.module.css";

/**
 * Hover / focus / tap tooltips for the analytics charts. Any element inside
 * with a `data-tip` attribute (lines separated by "\n", first line bold) shows
 * it. The same text is in each chart's table, so nothing depends on this.
 */
export function ChartTooltips({ children }: { children: ReactNode }) {
  const root = useRef<HTMLDivElement>(null);
  const [tip, setTip] = useState<{ text: string; x: number; y: number } | null>(null);

  useEffect(() => {
    const element = root.current;
    if (!element) return;
    const target = (event: Event) => (event.target instanceof Element ? event.target.closest<HTMLElement>("[data-tip]") : null);
    const place = (text: string, x: number, y: number) => {
      const width = 260;
      setTip({ text, x: Math.max(8, Math.min(x + 14, window.innerWidth - width - 8)), y: Math.max(8, y - 12) });
    };
    const move = (event: PointerEvent) => {
      const hit = target(event);
      if (!hit) { if (event.pointerType === "mouse") setTip(null); return; }
      place(hit.dataset.tip ?? "", event.clientX, event.clientY);
    };
    const focus = (event: FocusEvent) => {
      const hit = target(event);
      if (!hit) return;
      const rect = hit.getBoundingClientRect();
      place(hit.dataset.tip ?? "", rect.left + rect.width / 2, rect.top);
    };
    const hide = () => setTip(null);
    element.addEventListener("pointermove", move);
    element.addEventListener("pointerdown", move);
    element.addEventListener("pointerleave", hide);
    element.addEventListener("focusin", focus);
    element.addEventListener("focusout", hide);
    window.addEventListener("scroll", hide, { passive: true });
    return () => {
      element.removeEventListener("pointermove", move);
      element.removeEventListener("pointerdown", move);
      element.removeEventListener("pointerleave", hide);
      element.removeEventListener("focusin", focus);
      element.removeEventListener("focusout", hide);
      window.removeEventListener("scroll", hide);
    };
  }, []);

  const [first, ...rest] = (tip?.text ?? "").split("\n");
  return <div ref={root}>
    {children}
    {tip ? <div className={styles.tip} role="presentation" style={{ left: tip.x, top: tip.y, transform: "translateY(-100%)" }}>
      <b>{first}</b>{rest.length ? `\n${rest.join("\n")}` : ""}
    </div> : null}
  </div>;
}

/** Filter form that applies itself on change (the Apply button stays for no-JS). */
export function AutoSubmitForm({ children, className, action }: { children: ReactNode; className?: string; action: string }) {
  return <form className={className} action={action} method="get" role="search" aria-label="Filter analytics"
    onChange={(event) => {
      // Apply on change with a clean URL (no empty parameters); without JS the Apply button submits the form.
      const form = event.currentTarget as HTMLFormElement;
      const params = new URLSearchParams();
      for (const [key, value] of new FormData(form)) if (typeof value === "string" && value) params.set(key, value);
      const query = params.toString();
      window.location.assign(query ? `${action}?${query}` : action);
    }}>
    {children}
  </form>;
}
