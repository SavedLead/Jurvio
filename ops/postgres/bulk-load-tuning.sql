-- Bulk-load window settings for the full federal backfill (ADR 0075).
-- Every setting here is reloadable: no PostgreSQL restart. Apply with
--   docker compose -f docker-compose.production.yml exec -T postgres \
--     psql -U jurvio -d jurvio -v ON_ERROR_STOP=1 < ops/postgres/bulk-load-tuning.sql
-- and undo with ops/postgres/bulk-load-tuning-reset.sql after the load.
--
-- Values assume web-01 resized to 16 GB RAM with PostgreSQL on a block volume that
-- has at least 32 GB free beyond the database (max_wal_size can use 16 GB of WAL).

-- Fewer, larger checkpoints: bulk writes otherwise force a checkpoint every few
-- minutes and rewrite the same pages again and again.
ALTER SYSTEM SET max_wal_size = '16GB';
ALTER SYSTEM SET min_wal_size = '2GB';
ALTER SYSTEM SET checkpoint_timeout = '30min';
ALTER SYSTEM SET checkpoint_completion_target = 0.9;
ALTER SYSTEM SET wal_compression = on;

-- Index builds and vacuums of tables with tens of millions of rows.
ALTER SYSTEM SET maintenance_work_mem = '1GB';
ALTER SYSTEM SET effective_cache_size = '11GB';

-- Let autovacuum keep pace with the insert rate instead of falling behind and
-- then running for hours against the largest tables.
ALTER SYSTEM SET autovacuum_vacuum_cost_limit = 2000;
ALTER SYSTEM SET autovacuum_vacuum_insert_scale_factor = 0.05;
ALTER SYSTEM SET autovacuum_analyze_scale_factor = 0.02;

SELECT pg_reload_conf();
-- The reload is asynchronous; give it a moment before reading the values back.
SELECT pg_sleep(1);
SELECT name, setting, unit FROM pg_settings
WHERE name IN ('max_wal_size', 'checkpoint_timeout', 'maintenance_work_mem',
  'effective_cache_size', 'autovacuum_vacuum_cost_limit', 'shared_buffers')
ORDER BY name;
