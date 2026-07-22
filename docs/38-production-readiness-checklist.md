# Production Readiness Checklist

Status: implementation-ready; external account steps remain intentionally unexecuted.

## Deployment shape

Jurvio begins with one DigitalOcean Droplet running the application and PostgreSQL in separate containers. PostgreSQL has no public port. The application binds only to `127.0.0.1:3000`. Host Nginx terminates a Cloudflare Origin Certificate and proxies requests to the application. Cloudflare remains the only intended public route to the origin.

This is the economical pre-revenue shape. It is not the permanent high-availability architecture.

## One-time DigitalOcean bootstrap

1. Create a Jurvio-only Droplet in the Jurvio team. Do not grant unrelated developers team access.
2. Add a non-root deployment user with SSH-key access and membership in the Docker group.
3. Create `/opt/jurvio`, owned by the deployment user, with subdirectories `scripts` and `backups`.
4. Install Docker Engine, the Docker Compose plugin, Nginx, and unattended security updates.
5. Copy `.env.production.example` to `/opt/jurvio/.env.production`, replace every placeholder, and set mode `600`.
6. Install `ops/nginx-jurvio.conf`, the Cloudflare Origin Certificate, and its private key. The key must never enter Git or ChatGPT.
7. Restrict the DigitalOcean firewall to SSH from the owner's administrative IPs and HTTP/HTTPS from Cloudflare's published IP ranges.
8. Add a separate encrypted off-Droplet backup destination before treating the deployment as production.

## GitHub production environment

Create a protected GitHub environment named `production` and require owner approval. Add:

- `DO_HOST`: Droplet address.
- `DO_USER`: non-root deployment user.
- `DO_SSH_KEY`: deployment-only private key.
- `DO_KNOWN_HOSTS`: the verified Droplet SSH host-key line obtained through the DigitalOcean console, not an unverified network scan.

The deployment workflow builds an immutable commit-tagged image, pushes it to GitHub Container Registry, copies only release controls, makes a pre-migration database dump, applies additive migrations, starts the new image, checks readiness, and restores the prior application image if readiness fails.

## Cloudflare and DNS

1. Keep GoDaddy as registrar and delegate nameservers to Cloudflare.
2. Create proxied `A` records for `jurvio.com` and `www` only after staging is healthy.
3. Set SSL/TLS to **Full (strict)**.
4. Protect `/internal/*` with Cloudflare Access before DNS cutover.
5. Enable basic managed security rules and rate limits after observing legitimate traffic.
6. Do not enable caching of `/internal/*`, authenticated pages, or mutation endpoints.

## First release gate

- GitHub CI is green for the exact commit.
- PostgreSQL and raw-artifact volumes are persistent.
- `/api/health` and `/api/ready` succeed locally and through Cloudflare.
- `/internal/publication` and `/internal/analytics` are inaccessible without Cloudflare Access.
- `robots.txt`, `llms.txt`, `sitemap.xml`, and a machine-readable case URL behave as designed.
- A draft case, document, or suppressed record cannot be fetched publicly or through `ai.json`.
- A database backup is non-empty, decompresses successfully, and has been copied off the Droplet.
- DNS changes occur only after every preceding check passes.

## First corpus run

Start with a bounded batch:

```bash
docker compose -f docker-compose.production.yml run --rm app \
  node jobs/ingest-courtlistener-opinions.mjs \
  --court scotus --since 2025-01-01 --limit 10 --order newest
```

This first run deliberately imports metadata and readable primary-opinion text only. It does not
invoke an LLM or publish records. After verifying the run ledger, artifacts, and draft records,
run a second bounded batch with `--order cited` to prioritize high-interest authority without
paying for AI enrichment.

The production image contains pre-bundled ingestion jobs but no compiler or developer toolchain. Run jobs as short-lived containers; do not install ad-hoc packages into the running web container. A continuously scheduled worker is deferred until measured ingestion volume requires it.

## Known boundary

The local pre-migration dump retained on the Droplet supports release rollback but is not disaster recovery. A separate encrypted backup location and a successful restore test are required before public launch.
