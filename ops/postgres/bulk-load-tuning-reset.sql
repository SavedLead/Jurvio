-- Return PostgreSQL to its normal settings after the federal backfill (ADR 0075).
ALTER SYSTEM RESET max_wal_size;
ALTER SYSTEM RESET min_wal_size;
ALTER SYSTEM RESET checkpoint_timeout;
ALTER SYSTEM RESET checkpoint_completion_target;
ALTER SYSTEM RESET wal_compression;
ALTER SYSTEM RESET maintenance_work_mem;
ALTER SYSTEM RESET effective_cache_size;
ALTER SYSTEM RESET autovacuum_vacuum_cost_limit;
ALTER SYSTEM RESET autovacuum_vacuum_insert_scale_factor;
ALTER SYSTEM RESET autovacuum_analyze_scale_factor;
SELECT pg_reload_conf();
