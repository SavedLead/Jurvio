import type { Route } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "@/db/client";
import { requireInternalPrincipal } from "@/modules/identity/cloudflare-access";
import styles from "./internal.module.css";

const navigation = [
  { href: "/internal", icon: "◫", label: "Command center" },
  { href: "/internal/pulse", icon: "◎", label: "Pulse" },
  { href: "/internal/operations", icon: "↻", label: "Ingestion & workers" },
  { href: "/internal/uptime", icon: "♥", label: "Uptime & Speed" },
  { href: "/internal/ingestion-report", icon: "≣", label: "Publication X-ray" },
  { href: "/internal/freshness", icon: "◷", label: "Court freshness" },
  { href: "/internal/agency-sources", icon: "§", label: "Agency sources" },
  { href: "/internal#alerts", icon: "◉", label: "Case alerts" },
  { href: "/internal/governance", icon: "◇", label: "Costs & governance" },
  { href: "/internal/analytics", icon: "↗", label: "Product analytics" },
  { href: "/internal/signups", icon: "+", label: "Growth" },
  { href: "/internal#users", icon: "♙", label: "Users & access" },
  { href: "/internal/publication", icon: "✓", label: "Content review" },
  { href: "/internal/case-news", icon: "✎", label: "Case news review" },
  { href: "/internal#launch", icon: "△", label: "Launch readiness" },
] as const;

export default async function InternalLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  let principal;
  try {
    principal = await requireInternalPrincipal(db(), await headers(), ["viewer", "reviewer", "administrator"]);
  } catch { redirect("/login"); }
  if (principal.mustChangePassword) redirect("/change-password");
  return <div className={styles.frame}>
    <aside className={styles.sidebar}>
      <Link href={"/internal" as Route} className={styles.brand}>
        <span className={styles.brandMark}>J<span className={styles.brandDot}>.</span></span><span>Jurvio</span>
      </Link>
      <p className={styles.workspaceLabel}>Private command center</p>
      <nav className={styles.nav} aria-label="Internal navigation">
        {navigation.map((item) => <Link key={item.href} href={item.href as Route} className={styles.navLink}>
          <span className={styles.navIcon} aria-hidden="true">{item.icon}</span><span>{item.label}</span>
        </Link>)}
      </nav>
      <div className={styles.sideFooter}><div className={styles.role}>{principal.role}</div><div className={styles.email}>{principal.displayName ?? principal.email}</div></div>
    </aside>
    <div className={styles.content}><header className={styles.topbar}><p className={styles.topbarTitle}>Jurvio operations</p>
      <span className={styles.live}><span className={styles.liveDot}/>Production connected</span></header>{children}</div>
  </div>;
}
