-- Read-only. Did scotus-orders-index write index rows, and were any PDFs stored?
SELECT count(*)::int AS lists,
       count(*) FILTER (WHERE pdf_sha256 IS NULL)::int AS index_only,
       count(*) FILTER (WHERE pdf_sha256 IS NOT NULL)::int AS with_pdf,
       max(index_retrieved_at) AS latest_index
FROM scotus_order_list;

SELECT count(*)::int AS items FROM scotus_order_list_item;
