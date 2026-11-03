"use client";

import { useEffect, useState } from "react";

/** Fixed "Back to top" button, shown after scrolling past about one and a half screens. Fixed, so it never shifts layout. */
export function BackToTop() {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const onScroll = () => setShown(window.scrollY > window.innerHeight * 1.5);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  return <button type="button" className="cdTop" data-shown={shown ? "" : undefined} aria-hidden={shown ? undefined : true} tabIndex={shown ? 0 : -1}
    onClick={() => {
      const smooth = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      window.scrollTo({ top: 0, behavior: smooth ? "smooth" : "auto" });
      document.getElementById("top")?.focus({ preventScroll: true });
    }}>
    <span aria-hidden="true">↑</span><span className="cdTopLabel">Back to top</span>
  </button>;
}
