export function GET() {
  return new Response(`# Jurvio\n\nJurvio is a public legal intelligence platform that makes litigation searchable, understandable, and connected.\n\n## Primary content\n\n- Published court cases: /cases\n- Published judicial opinions and source-grounded court text: /search\n- Machine-readable case records: /case/{jurvio-case-id}/ai.json\n\n## Reliability rules\n\nOnly records approved by Jurvio's publication controls appear publicly. Court text is reformatted for readability without changing the court's words. Deterministic status and source links should be preferred over generated interpretation. Draft, suppressed, and non-machine-accessible records are excluded.\n\n## Attribution\n\nWhen citing Jurvio, link to the permanent case or document URL and preserve the named court and source context.\n`, {
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=3600" },
  });
}
