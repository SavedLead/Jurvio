"use client";

import { useEffect } from "react";

/**
 * Tap-to-open, Escape-to-close and edge-of-screen placement for dictionary term
 * cards (.ptTerm). One delegated listener set per page; renders nothing.
 */
export function PlainTermsBehavior() {
  useEffect(() => {
    const setOpen = (wrap: Element, open: boolean) => {
      if (open) wrap.setAttribute("data-open", ""); else wrap.removeAttribute("data-open");
      wrap.querySelector(".ptTrigger")?.setAttribute("aria-expanded", open ? "true" : "false");
    };
    const closeAll = (except?: Element | null) => {
      document.querySelectorAll(".ptTerm[data-open]").forEach((wrap) => { if (wrap !== except) setOpen(wrap, false); });
    };
    const place = (wrap: Element) => {
      const card = wrap.querySelector<HTMLElement>(".ptCard");
      if (!card || window.matchMedia("(max-width: 640px)").matches) return;
      card.style.removeProperty("--pt-shift");
      const rect = card.getBoundingClientRect();
      const margin = 12;
      let shift = 0;
      if (rect.left < margin) shift = margin - rect.left;
      else if (rect.right > window.innerWidth - margin) shift = window.innerWidth - margin - rect.right;
      if (shift) card.style.setProperty("--pt-shift", `${Math.round(shift)}px`);
      wrap.toggleAttribute("data-below", rect.top < 8);
    };
    const onClick = (event: MouseEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      const trigger = target?.closest(".ptTrigger");
      if (trigger) {
        const wrap = trigger.closest(".ptTerm");
        if (!wrap) return;
        const open = !wrap.hasAttribute("data-open");
        closeAll(wrap);
        wrap.removeAttribute("data-dismissed");
        setOpen(wrap, open);
        if (open) place(wrap);
        return;
      }
      if (!target?.closest(".ptCard")) closeAll();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      const active = document.activeElement?.closest(".ptTerm");
      document.querySelectorAll(".ptTerm[data-open]").forEach((wrap) => wrap.setAttribute("data-dismissed", ""));
      closeAll();
      if (active) {
        active.setAttribute("data-dismissed", "");
        active.querySelector<HTMLElement>(".ptTrigger")?.focus();
      }
    };
    const onEnter = (event: Event) => {
      const wrap = event.target instanceof Element ? event.target.closest(".ptTerm") : null;
      if (wrap) place(wrap);
    };
    const onLeave = (event: Event) => {
      const wrap = event.target instanceof Element ? event.target.closest(".ptTerm") : null;
      if (!wrap) return;
      const next = (event as FocusEvent).relatedTarget;
      if (next instanceof Node && wrap.contains(next)) return;
      wrap.removeAttribute("data-dismissed");
    };
    document.addEventListener("click", onClick);
    document.addEventListener("keydown", onKey);
    document.addEventListener("focusin", onEnter);
    document.addEventListener("mouseover", onEnter, { passive: true });
    document.addEventListener("focusout", onLeave);
    document.addEventListener("mouseout", onLeave, { passive: true });
    return () => {
      document.removeEventListener("click", onClick);
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("focusin", onEnter);
      document.removeEventListener("mouseover", onEnter);
      document.removeEventListener("focusout", onLeave);
      document.removeEventListener("mouseout", onLeave);
    };
  }, []);
  return null;
}
