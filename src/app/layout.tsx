import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import "./globals.css";

const primaryNavigation = [
  ["Cases", "/cases"],
  ["Search", "/search"],
  ["Explainers", "/explainers"],
  ["Supreme Court", "/supreme-court"],
  ["Parties", "/parties"],
  ["Attorneys", "/attorneys"],
  ["Judges", "/judges"],
  ["Law Firms", "/law-firms"],
  ["Courts", "/courts"],
  ["Government Litigation", "/government-litigation"],
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
          <div>
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
          </div>
          <nav aria-label="Footer">
            {primaryNavigation.map(([label, href]) => (
              <Link href={href} key={href}>{label}</Link>
            ))}
            <Link href="/sitemap.xml">Sitemap</Link>
          </nav>
        </footer>
      </body>
    </html>
  );
}
