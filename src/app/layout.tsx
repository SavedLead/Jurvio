import type { Metadata } from "next";
import type { Route } from "next";
import Image from "next/image";
import Link from "next/link";
import "./globals.css";
import "./scotus-layout.css";
import { robotsFor } from "@/lib/seo/indexing";
import { PrivacySafeAnalytics } from "./privacy-safe-analytics";
import { FirstTouch } from "./first-touch";
import { MobileNavigation } from "./mobile-navigation";
import { AccountNavLink } from "./account-nav-link";
import { NavLinks } from "./nav-links";
import "@/modules/plain-english/ui/plain-terms.css";
import { PlainTermsBehavior } from "@/modules/plain-english/ui/plain-terms-behavior";

const primaryNavigation = [
  ["Research", "/search"], ["Cases", "/cases"], ["Parties", "/parties"],
  ["Professionals", "/attorneys"], ["Judges & Courts", "/judges"],
  ["Supreme Court", "/supreme-court"], ["Dictionary", "/explainers"],
  ["News & Trackers", "/government-litigation"],
  ["Pricing", "/pricing"],
] as const;

const footerNavigation = [
  { title: "Research", links: [["Cases", "/cases"], ["Search", "/search"], ["Supreme Court", "/supreme-court"], ["Government litigation", "/government-litigation"]] },
  { title: "People & institutions", links: [["Parties", "/parties"], ["Attorneys", "/attorneys"], ["Law firms", "/law-firms"], ["Judges", "/judges"], ["Courts", "/courts"]] },
  { title: "Learn", links: [["Legal dictionary", "/explainers#glossary-title"], ["Step-by-step explainers", "/explainers#deep-explainers"], ["Court procedure roadmaps", "/explainers#roadmap-title"], ["Jurisdiction", "/explainers/jurisdiction"]] },
  { title: "Data & trust", links: [["Coverage", "/coverage"], ["Sources & methodology", "/methodology"], ["Editorial standards", "/editorial-standards"], ["Public-records policy", "/public-records-policy"], ["Privacy", "/privacy"], ["Terms", "/terms"], ["Contact", "/contact"], ["Corrections", "/corrections"], ["Sitemap", "/sitemap.xml"]] },
] as const;

export const metadata: Metadata = {
  metadataBase: new URL(process.env.SITE_URL ?? "https://jurvio.com"),
  title: { default: "Jurvio | Public Legal Intelligence", template: "%s | Jurvio" },
  description: "Public litigation made searchable, understandable, and connected.",
  robots: robotsFor(true),
  icons: { icon: "/brand/jurvio-icon-light.svg", shortcut: "/brand/jurvio-icon-light.svg", apple: "/brand/jurvio-icon-light.svg" },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en"><body>
      <a className="skipLink" href="#main-content">Skip to main content</a>
      <PrivacySafeAnalytics />
      <FirstTouch />
      <PlainTermsBehavior />
      <header className="siteHeader">
        <Link className="brand" href="/" aria-label="Jurvio home">
          <Image className="brandWordmark" src="/brand/jurvio-wordmark-light.svg" width={333} height={112} priority alt="Jurvio" />
        </Link>
        <nav className="desktopNavigation" aria-label="Primary">
          <NavLinks items={primaryNavigation} />
          <AccountNavLink className="headerAccount" />
          <Link className="headerSearch" href="/search">Search Jurvio</Link>
        </nav>
        <MobileNavigation items={primaryNavigation} />
      </header>
      <div id="main-content">{children}</div>
      <footer className="siteFooter">
        <div className="footerIntro">
          <Link className="brand footerBrand" href="/" aria-label="Jurvio home">
            <Image className="brandWordmark" src="/brand/jurvio-wordmark-light.svg" width={333} height={112} alt="Jurvio" />
          </Link>
          <p>Public legal intelligence that makes litigation understandable.</p>
          <small>Jurvio provides public-record information and general legal education, not legal advice.</small>
        </div>
        <div className="footerColumns">
          {footerNavigation.map((column) => (
            <nav aria-label={column.title} key={column.title}>
              <strong>{column.title}</strong>
              {column.links.map(([label, href]) => <Link href={href as Route} key={`${column.title}-${href}`}>{label}</Link>)}
            </nav>
          ))}
        </div>
        <div className="footerLegal">
          <span>© {new Date().getFullYear()} Jurvio. Public legal intelligence.</span>
          <span>Source-backed. Neutral. Built for <span className="brandHeadlineEnd">understanding<span className="signatureDot" aria-hidden="true">.</span></span></span>
        </div>
      </footer>
    </body></html>
  );
}
