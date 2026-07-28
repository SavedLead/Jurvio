import type { Route } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { db } from "@/db/client";
import { requireInternalPrincipal } from "@/modules/identity/cloudflare-access";
import styles from "./internal.module.css";

const navigation = [
  { href: "/internal", icon: "◫", label: "Overview" },
  { href: "/internal/operations", icon: "↻", label: "Corpus & ingestion" },
  { href: "/internal/analytics", icon: "↗", label: "Demand analytics" },
  { href: "/internal/governance", icon: "◇", label: "Trust & governance" },
  { href: "/internal/publication", icon: "✓", label: "Publication review" },
  { href: "/internal/status-review", icon: "≋", label: "Status review" },
] as const;

export default async function InternalLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  let principal;
  try { principal = await requireInternalPrincipal(db(), await headers(), ["viewer", "reviewer", "administrator"]); } catch { notFound(); }
  return <div className={styles.frame}><aside className={styles.sidebar}>
    <Link href={"/internal" as Route} className={styles.brand}><span className={styles.brandMark}>J<span className={styles.brandDot}>.</span></span><span>Jurvio</span></Link>
    <p className={styles.workspaceLabel}>Command center</p><nav className={styles.nav} aria-label="Internal navigation">{navigation.map(item=><Link key={item.href} href={item.href as Route} className={styles.navLink}><span className={styles.navIcon} aria-hidden="true">{item.icon}</span><span>{item.label}</span></Link>)}<span className={styles.navLink} aria-disabled="true"><span className={styles.navIcon} aria-hidden="true">⚙</span><span>Agents</span><span className={styles.navHint}>Soon</span></span></nav>
    <div className={styles.sideFooter}><div className={styles.role}>{principal.role}</div><div className={styles.email}>{principal.displayName ?? principal.email}</div></div>
  </aside><div className={styles.content}><header className={styles.topbar}><p className={styles.topbarTitle}>Jurvio operations</p><span className={styles.live}><span className={styles.liveDot} />Production connected</span></header>{children}</div></div>;
}
