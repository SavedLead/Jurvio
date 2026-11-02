"use client";

import { useEffect } from "react";

/** Opens the collapsed section holding the URL's #target (and the Follow box after a follow link), then scrolls to it. */
export function CaseSectionOpener() {
  useEffect(() => {
    const open = () => {
      const id = decodeURIComponent(window.location.hash.slice(1));
      const target = id ? document.getElementById(id) : null;
      if (new URLSearchParams(window.location.search).has("follow")) {
        const follow = document.getElementById("follow");
        if (follow instanceof HTMLDetailsElement) follow.open = true;
      }
      if (!target) return;
      for (let node: HTMLElement | null = target; node; node = node.parentElement) {
        if (node instanceof HTMLDetailsElement) node.open = true;
      }
      target.scrollIntoView();
    };
    open();
    window.addEventListener("hashchange", open);
    return () => window.removeEventListener("hashchange", open);
  }, []);
  return null;
}
