import type { Metadata } from "next";
import { db } from "@/db/client";
import { formatEasternDateTime } from "@/lib/time/eastern";
import { listPublisherCycles } from "@/modules/publication/application/list-publisher-cycles";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Publisher cycles", robots: { index: false, follow: false } };

export default async function PublishStatusPage() {
  const cycles = await listPublisherCycles(db()).catch(() => []);
  return (
    <main>
      <p>Publisher cycles</p>
      <h1>What the last publish passes did</h1>
      <p>Counts only. Sealed text is not listed.</p>
      {cycles.length === 0 ? <p>No publisher cycle has been recorded yet.</p> : (
        <table>
          <thead>
            <tr>
              <th>Started (ET)</th><th>Finished (ET)</th><th>Pass</th><th>Status</th>
              <th>Scanned</th><th>Published</th><th>Held</th><th>Held by reason</th>
              <th>Search ms</th><th>Cap</th>
            </tr>
          </thead>
          <tbody>
            {cycles.map((cycle) => (
              <tr key={`${cycle.runType}-${cycle.startedAt}`}>
                <td>{formatEasternDateTime(cycle.startedAt, "—")}</td>
                <td>{formatEasternDateTime(cycle.completedAt, "—")}</td>
                <td>{cycle.runType}</td>
                <td>{cycle.status}</td>
                <td>{cycle.scanned.toLocaleString("en-US")}</td>
                <td>{cycle.published.toLocaleString("en-US")}</td>
                <td>{cycle.held.toLocaleString("en-US")}</td>
                <td>{Object.entries(cycle.heldByReason).map(([reason, count]) => `${reason} ${count}`).join(", ") || "—"}</td>
                <td>{cycle.searchMs ?? "—"}</td>
                <td>{cycle.publishCap ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
