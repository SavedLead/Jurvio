import type { Metadata } from "next";
import type { Route } from "next";
import Image from "next/image";
import Link from "next/link";
import "./globals.css";

const primaryNavigation = [
  ["Research", "/search"],
  ["Cases", "/cases"],
  ["Parties", "/parties"],
  ["Professionals", "/attorneys"],
  ["Judges & Courts", "/judges"],
  ["Supreme Court", "/supreme-court"],
  ["Explainers", "/explainers"],
  ["News & Trackers", "/government-litigation"],
] as const;

const footerNavigation = [
  {
    title: "Research",
    links: [["Cases", "/cases"], ["Search", "/search"], ["Supreme Court", "/supreme-court"], ["Government litigation", "/government-litigation"]],
  },
  {
    title: "People & institutions",
    links: [["Parties", "/parties"], ["Attorneys", "/attorneys"], ["Law firms", "/law-firms"], ["Judges", "/judges"], ["Courts", "/courts"]],
  },
  {
    title: "Learn",
    links: [["Legal explainers", "/explainers"], ["Legal procedure", "/explainers"], ["Jurisdiction", "/explainers"], ["Glossary", "/explainers"]],
  },
  {
    title: "Data & trust",
    links: [["Coverage", "/coverage"], ["Sources & methodology", "/methodology"], ["Editorial standards", "/editorial-standards"], ["Public-records policy", "/public-records-policy"], ["Sitemap", "/sitemap.xml"]],
  },
] as const;

export const metadata: Metadata = {
  metadataBase: new URL(process.env.SITE_URL ?? "https://jurvio.com"),
  title: {
    default: "Jurvio | Public Legal Intelligence",
    template: "%s | Jurvio",
  },
  description: "Public litigation made searchable, understandable, and connected.",
  icons: {
    icon: "/brand/jurvio-icon-light.svg",
    shortcut: "/brand/jurvio-icon-light.svg",
    apple: "/brand/jurvio-icon-light.svg",
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <header className="siteHeader">
          <Link className="brand" href="/" aria-label="Jurvio home">
            <Image
              className="brandWordmark"
              src="/brand/jurvio-wordmark-light.svg"
              width={333}
              height={112}
              priority
              alt="Jurvio"
            />
          </Link>
          <nav className="desktopNavigation" aria-label="Primary">
            {primaryNavigation.map(([label, href]) => (
              <Link href={href} key={href}>{label}</Link>
            ))}
            <Link className="headerSearch" href="/search">Search Jurvio</Link>
          </nav>
          <details className="mobileNavigation">
            <summary aria-label="Open navigation">
              <span aria-hidden="true" />
              <span aria-hidden="true" />
              <span aria-hidden="true" />
              <span className="menuLabel">Menu</span>
            </summary>
            <nav aria-label="Mobile">
              {primaryNavigation.map(([label, href]) => (
                <Link href={href} key={href}>{label}</Link>
              ))}
            </nav>
          </details>
        </header>
        {children}
        <footer className="siteFooter">
          <div className="footerIntro">
            <Link className="brand footerBrand" href="/" aria-label="Jurvio home">
              <Image
                className="brandWordmark"
                src="/brand/jurvio-wordmark-light.svg"
                width={333}
                height={112}
                alt="Jurvio"
              />
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
            <span>Source-backed. Neutral. Built for understanding.</span>
          </div>
        </footer>
      </body>
    </html>
  );
}
