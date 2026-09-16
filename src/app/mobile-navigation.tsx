"use client";

import type { Route } from "next";
import Link from "next/link";
import { useRef } from "react";

interface MobileNavigationProps {
  items: ReadonlyArray<readonly [label: string, href: Route]>;
}

export function MobileNavigation({ items }: MobileNavigationProps) {
  const menu = useRef<HTMLDetailsElement>(null);

  function closeMenu() {
    if (menu.current) menu.current.open = false;
  }

  return (
    <details className="mobileNavigation" ref={menu}>
      <summary aria-label="Open navigation">
        <span aria-hidden="true" />
        <span aria-hidden="true" />
        <span aria-hidden="true" />
        <span className="menuLabel">Menu</span>
      </summary>
      <nav aria-label="Mobile">
        {items.map(([label, href]) => (
          <Link href={href} key={href} onClick={closeMenu}>
            {label}
          </Link>
        ))}
      </nav>
    </details>
  );
}
