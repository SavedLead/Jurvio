-- Read-only disk / size audit for jurvio production Postgres (2026-11-05).
-- Intended for diagnose-sql-once.yml (READ ONLY transaction).

\echo === databases ===
SELECT datname,
       pg_size_pretty(pg_database_size(datname)) AS size,
       pg_database_size(datname) AS bytes
FROM pg_database
WHERE datallowconn
ORDER BY pg_database_size(datname) DESC;

\echo === top_25_tables_heap_index_toast ===
SELECT n.nspname AS schema,
       c.relname AS relation,
       pg_size_pretty(pg_total_relation_size(c.oid)) AS total,
       pg_size_pretty(pg_relation_size(c.oid)) AS heap,
       pg_size_pretty(pg_indexes_size(c.oid)) AS indexes,
       pg_size_pretty(COALESCE(pg_relation_size(c.reltoastrelid), 0)) AS toast,
       pg_total_relation_size(c.oid) AS total_bytes,
       c.reltuples::bigint AS rows_est,
       CASE WHEN c.relpersistence = 'u' THEN 'unlogged' ELSE 'logged' END AS persistence
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE c.relkind = 'r'
  AND n.nspname NOT IN ('pg_catalog', 'information_schema')
ORDER BY pg_total_relation_size(c.oid) DESC
LIMIT 25;

\echo === dead_tuples_and_vacuum_stats_top_by_dead ===
SELECT schemaname,
       relname,
       n_live_tup,
       n_dead_tup,
       CASE WHEN n_live_tup > 0
            THEN round(100.0 * n_dead_tup / n_live_tup, 2)
            ELSE NULL END AS dead_pct_of_live,
       last_vacuum,
       last_autovacuum,
       last_analyze,
       last_autoanalyze,
       pg_size_pretty(pg_total_relation_size(schemaname || '.' || relname)) AS total
FROM pg_stat_user_tables
ORDER BY n_dead_tup DESC NULLS LAST
LIMIT 25;

\echo === largest_tables_with_dead_tuple_ratio ===
SELECT schemaname,
       relname,
       pg_size_pretty(pg_total_relation_size(schemaname || '.' || relname)) AS total,
       n_live_tup,
       n_dead_tup,
       CASE WHEN n_live_tup > 0
            THEN round(100.0 * n_dead_tup / n_live_tup, 2)
            ELSE NULL END AS dead_pct_of_live,
       last_autovacuum
FROM pg_stat_user_tables
ORDER BY pg_total_relation_size(schemaname || '.' || relname) DESC
LIMIT 25;

\echo === unused_indexes_idx_scan_zero ===
SELECT schemaname,
       relname AS table_name,
       indexrelname AS index_name,
       idx_scan,
       idx_tup_read,
       idx_tup_fetch,
       pg_size_pretty(pg_relation_size(indexrelid)) AS index_size,
       pg_relation_size(indexrelid) AS index_bytes,
       pg_get_indexdef(indexrelid) AS index_def
FROM pg_stat_user_indexes
WHERE idx_scan = 0
ORDER BY pg_relation_size(indexrelid) DESC
LIMIT 40;

\echo === unused_indexes_total_bytes ===
SELECT count(*) AS unused_index_count,
       pg_size_pretty(COALESCE(sum(pg_relation_size(indexrelid)), 0)) AS unused_indexes_total,
       COALESCE(sum(pg_relation_size(indexrelid)), 0) AS unused_indexes_bytes
FROM pg_stat_user_indexes
WHERE idx_scan = 0;

\echo === invalid_indexes ===
SELECT n.nspname,
       i.relname AS index_name,
       t.relname AS table_name,
       pg_size_pretty(pg_relation_size(i.oid)) AS size
FROM pg_index x
JOIN pg_class i ON i.oid = x.indexrelid
JOIN pg_class t ON t.oid = x.indrelid
JOIN pg_namespace n ON n.oid = t.relnamespace
WHERE NOT x.indisvalid;

\echo === replication_slots ===
SELECT slot_name,
       slot_type,
       active,
       restart_lsn,
       confirmed_flush_lsn,
       wal_status,
       safe_wal_size,
       pg_size_pretty(pg_wal_lsn_diff(pg_current_wal_lsn(), restart_lsn)) AS retained_wal_approx
FROM pg_replication_slots;

\echo === wal_and_checkpoints ===
SELECT pg_size_pretty(sum(size)) AS wal_dir_size,
       count(*) AS wal_files
FROM pg_ls_waldir();

SELECT name, setting, unit
FROM pg_settings
WHERE name IN (
  'max_wal_size', 'min_wal_size', 'wal_keep_size',
  'checkpoint_timeout', 'archive_mode', 'archive_command',
  'wal_level', 'max_slot_wal_keep_size'
)
ORDER BY name;

\echo === leftover_staging_backup_old_temp_tables ===
SELECT n.nspname AS schema,
       c.relname AS relation,
       c.relkind,
       CASE WHEN c.relpersistence = 'u' THEN 'unlogged' ELSE 'logged' END AS persistence,
       pg_size_pretty(pg_total_relation_size(c.oid)) AS total,
       pg_total_relation_size(c.oid) AS total_bytes,
       c.reltuples::bigint AS rows_est
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE c.relkind IN ('r', 'p', 'm')
  AND n.nspname NOT IN ('pg_catalog', 'information_schema')
  AND (
    c.relname ~* '(stage|staging|backup|_old|tmp|temp|scratch|legacy|deprecated|copy)'
    OR c.relpersistence = 'u'
  )
ORDER BY pg_total_relation_size(c.oid) DESC;

\echo === pending_cluster_breakdown ===
SELECT count(*) AS pending_rows,
       count(*) FILTER (WHERE true) AS all_rows,
       pg_size_pretty(pg_total_relation_size('courtlistener_pending_cluster')) AS total_size
FROM courtlistener_pending_cluster;

\echo === large_json_text_columns_by_declared_type ===
SELECT c.table_schema,
       c.table_name,
       c.column_name,
       c.data_type,
       c.udt_name,
       pg_size_pretty(pg_total_relation_size(format('%I.%I', c.table_schema, c.table_name))) AS table_total
FROM information_schema.columns c
WHERE c.table_schema = 'public'
  AND (
    c.data_type IN ('json', 'jsonb', 'text', 'xml')
    OR c.udt_name IN ('json', 'jsonb', 'text', 'bytea')
  )
  AND pg_total_relation_size(format('%I.%I', c.table_schema, c.table_name)) > 100 * 1024 * 1024
ORDER BY pg_total_relation_size(format('%I.%I', c.table_schema, c.table_name)) DESC,
         c.table_name, c.column_name
LIMIT 60;

\echo === toast_heavy_relations ===
SELECT c.relname,
       pg_size_pretty(pg_relation_size(c.oid)) AS heap,
       pg_size_pretty(COALESCE(pg_relation_size(c.reltoastrelid), 0)) AS toast,
       pg_size_pretty(pg_indexes_size(c.oid)) AS indexes,
       pg_size_pretty(pg_total_relation_size(c.oid)) AS total,
       COALESCE(pg_relation_size(c.reltoastrelid), 0) AS toast_bytes
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE c.relkind = 'r'
  AND n.nspname = 'public'
  AND COALESCE(pg_relation_size(c.reltoastrelid), 0) > 50 * 1024 * 1024
ORDER BY COALESCE(pg_relation_size(c.reltoastrelid), 0) DESC
LIMIT 20;

\echo === bloat_hint_tables_high_dead_and_large ===
SELECT schemaname,
       relname,
       pg_size_pretty(pg_total_relation_size(schemaname || '.' || relname)) AS total,
       n_live_tup,
       n_dead_tup,
       round(100.0 * n_dead_tup / NULLIF(n_live_tup, 0), 2) AS dead_pct,
       pg_size_pretty(
         (pg_total_relation_size(schemaname || '.' || relname)::numeric
          * n_dead_tup / NULLIF(n_live_tup + n_dead_tup, 0))::bigint
       ) AS approx_dead_bytes_share
FROM pg_stat_user_tables
WHERE n_dead_tup > 10000
  AND pg_total_relation_size(schemaname || '.' || relname) > 100 * 1024 * 1024
ORDER BY (pg_total_relation_size(schemaname || '.' || relname)::numeric
          * n_dead_tup / NULLIF(n_live_tup + n_dead_tup, 0)) DESC NULLS LAST
LIMIT 20;
