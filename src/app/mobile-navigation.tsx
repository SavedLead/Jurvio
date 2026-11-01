"use client";

import type { Route } from "next";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { AccountNavLink } from "./account-nav-link";
import { NavLinks } from "./nav-links";

interface MobileNavigationProps {
  items: ReadonlyArray<readonly [label: string, href: Route]>;
}

/**
 * Mobile menu: a <details> disclosure (works without JavaScript) that opens a
 * full-width sheet under the header, so the page heading never shows through.
 * Escape closes it and returns focus to the toggle.
 */
export function MobileNavigation({ items }: MobileNavigationProps) {
  const menu = useRef<HTMLDetailsElement>(null);
  const [open, setOpen] = useState(false);

  function closeMenu() {
    if (menu.current) menu.current.open = false;
  }

  useEffect(() => {
    document.documentElement.classList.toggle("mobileMenuOpen", open);
    if (!open) return;
    function onKey(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      closeMenu();
      menu.current?.querySelector("summary")?.focus();
    }
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.documentElement.classList.remove("mobileMenuOpen");
    };
  }, [open]);

  return (
    <details className="mobileNavigation" ref={menu} onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary aria-label={open ? "Close navigation" : "Open navigation"}>
        <span aria-hidden="true" />
        <span aria-hidden="true" />
        <span aria-hidden="true" />
        <span className="menuLabel">{open ? "Close" : "Menu"}</span>
      </summary>
      <nav aria-label="Mobile">
        <Link className="mobileSearch" href="/search" onClick={closeMenu}>Search Jurvio</Link>
        <NavLinks items={items} onNavigate={closeMenu} />
        <AccountNavLink onClick={closeMenu} />
      </nav>
    </details>
  );
}
