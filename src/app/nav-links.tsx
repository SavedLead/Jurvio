"use client";

import type { Route } from "next";
import Link from "next/link";
import { usePathname } from "next/navigation";

// Extra path prefixes that belong to a primary navigation section, so the
// section stays marked as current on its detail pages.
const SECTION_PREFIXES: Readonly<Record<string, readonly string[]>> = {
  "/cases": ["/cases", "/case"],
  "/attorneys": ["/attorneys", "/us-attorneys", "/law-firms"],
  "/judges": ["/judges", "/courts"],
  "/supreme-court": ["/supreme-court", "/scotus"],
};

function underPrefix(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

/** True when `href` is the navigation section for `pathname`. */
export function isCurrentSection(pathname: string | null, href: string): boolean {
  if (!pathname) return false;
  if (href === "/") return pathname === "/";
  return (SECTION_PREFIXES[href] ?? [href]).some((prefix) => underPrefix(pathname, prefix));
}

/** Primary navigation links that mark the current section with aria-current="page". */
export function NavLinks({ items, onNavigate }: {
  items: ReadonlyArray<readonly [label: string, href: Route]>;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  return <>
    {items.map(([label, href]) => (
      <Link href={href} key={href} onClick={onNavigate} aria-current={isCurrentSection(pathname, href) ? "page" : undefined}>
        {label}
      </Link>
    ))}
  </>;
}
