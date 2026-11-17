-- Remembers an orders-index term that had no order-list PDF, so the hourly
-- job moves on instead of requesting that page again. No case or alert writes.

CREATE TABLE IF NOT EXISTS scotus_orders_index_probe (
  term_year text PRIMARY KEY CHECK (term_year ~ '^[0-9]{2}$'),
  order_lists integer NOT NULL CHECK (order_lists >= 0),
  probed_at timestamptz NOT NULL
);
