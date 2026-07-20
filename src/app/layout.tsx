import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Jurvio | Public Legal Intelligence",
    template: "%s | Jurvio",
  },
  description: "Public litigation made searchable, understandable, and connected.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <header className="siteHeader">
          <a className="brand" href="/">Jurvio</a>
          <nav aria-label="Primary">
            <a href="/cases">Cases</a>
            <a href="/search">Search</a>
          </nav>
        </header>
        {children}
      </body>
    </html>
  );
}
