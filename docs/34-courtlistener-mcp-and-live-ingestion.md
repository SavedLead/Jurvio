# CourtListener MCP and live ingestion

## Decision

Jurvio will use two complementary CourtListener connections:

1. The REST API and bulk datasets are the canonical ingestion transport for repeatable,
   resumable, high-volume synchronization.
2. The official CourtListener MCP server is the agent research transport for targeted legal
   research, semantic search, citation verification, alerts, and gap investigation.

MCP does not replace the ingestion ledger, immutable raw artifacts, field provenance, or
publication review. Agent output is never treated as a court record.

## Official MCP connection

- Server: `https://mcp.courtlistener.com`
- Authentication: OAuth
- ChatGPT setup: Settings → Apps → Advanced Settings → Developer Mode → Create App
- App name: `CourtListener`

Official instructions:
https://wiki.free.law/c/courtlistener/help/api/mcp/model-context-protocol-mcp-server-for-agentic-access

## REST ingestion

CourtListener recommends token authentication for programmatic API access. The documented
default authenticated allowance is 5 requests per minute, 50 per hour, and 125 per day. Jurvio
therefore defaults to a 12.5-second minimum interval between requests and retries throttled or
temporary server responses.

Official API documentation:
https://wiki.free.law/c/courtlistener/help/api/rest/v4/overview

The bounded update command is:

```sh
pnpm ingest:updates -- --since 2026-07-20T00:00:00Z --max-cases 5
```

It stores every source response as an immutable artifact, records the run and cursor, imports
records sequentially, leaves cases in draft, and never publishes automatically.

## Credential handling

`COURTLISTENER_API_TOKEN` must be stored in the runtime secret manager or GitHub Actions secret.
It must never be committed, logged, included in an artifact, or pasted into a chat.

## Scaling boundary

Free API access is sufficient for a small correctness pilot, not nationwide continuous
ingestion. Before scaling, Jurvio should request a commercial agreement or elevated access from
Free Law Project rather than creating multiple accounts or evading throttles.
