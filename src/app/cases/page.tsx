import Link from "next/link";

export default function CasesPage() {
  return (
    <main className="shell">
      <p className="eyebrow">Public cases</p>
      <h1>Browse litigation with source-backed explanations.</h1>
      <p>
        The public case directory will include only records that pass Jurvio&apos;s publication
        and verification rules.
      </p>
      <Link href="/search">Search public legal records</Link>
    </main>
  );
}
