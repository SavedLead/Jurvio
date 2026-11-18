export function GET() {
  return Response.json({ error: "not_found" }, {
    status: 404,
    headers: { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" },
  });
}
