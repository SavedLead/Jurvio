import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import "./globals.css";

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
          <nav aria-label="Primary">
            <Link href="/cases">Cases</Link>
            <Link href="/search?q=parties">Parties</Link>
            <Link href="/search?q=attorneys">Attorneys</Link>
            <Link href="/search?q=judges">Judges</Link>
            <Link href="/search?q=courts">Courts</Link>
            <Link href="/#explainers">Explainers</Link>
            <Link className="navSearch" href="/search" aria-label="Search Jurvio">Search</Link>
          </nav>
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
            <Link href="/cases">Cases</Link><Link href="/search">Search</Link>
            <Link href="/sitemap.xml">Sitemap</Link>
          </nav>
        </footer>
      </body>
    </html>
  );
}
