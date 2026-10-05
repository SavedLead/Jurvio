"use client";

import { useEffect, useRef, type ReactNode } from "react";

/**
 * Filters render open so they work without JavaScript. On narrow screens the
 * panel collapses after hydration unless a filter is already active.
 */
export function FilterDisclosure({
  summary,
  keepOpen,
  className,
  children,
}: {
  summary: ReactNode;
  keepOpen: boolean;
  className?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    const details = ref.current;
    if (!details) return;
    const narrow = window.matchMedia("(max-width: 900px)");
    const sync = () => {
      if (!narrow.matches) details.open = true;
      else if (!keepOpen) details.open = false;
    };
    sync();
    narrow.addEventListener("change", sync);
    return () => narrow.removeEventListener("change", sync);
  }, [keepOpen]);

  return (
    <details ref={ref} className={className} open>
      <summary>{summary}</summary>
      {children}
    </details>
  );
}
