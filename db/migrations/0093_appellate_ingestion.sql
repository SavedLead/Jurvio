BEGIN;

CREATE TABLE appellate_source_registry (
  court_code text PRIMARY KEY,
  court_name text NOT NULL,
  circuit text NOT NULL,
  official_website text NOT NULL,
  opinions_url text NOT NULL,
  historical_url text NOT NULL,
  rss_url text,
  adapter_type text NOT NULL,
  checkpoint text,
  last_successful_retrieval timestamptz,
  health_state text NOT NULL DEFAULT 'unknown',
  consecutive_failures integer NOT NULL DEFAULT 0,
  next_poll_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE appellate_ingestion_item (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  court_code text NOT NULL REFERENCES appellate_source_registry(court_code),
  docket_number text,
  caption text NOT NULL,
  decided_on date,
  document_url text NOT NULL,
  source_listing_url text NOT NULL,
  source_artifact_id uuid REFERENCES raw_artifact(id),
  document_content_hash text,
  state text NOT NULL DEFAULT 'discovered' CHECK (state IN ('discovered','downloaded','extracted','enriched','publication_ready','published','blocked','dead_letter')),
  stage_attempts jsonb NOT NULL DEFAULT '{}',
  blocker_code text,
  blocker_detail text,
  next_action text,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  published_case_id uuid REFERENCES legal_case(id),
  UNIQUE(court_code,document_url)
);
CREATE INDEX appellate_ingestion_queue_idx ON appellate_ingestion_item(state,court_code,decided_on DESC NULLS LAST);
CREATE INDEX appellate_ingestion_blockers_idx ON appellate_ingestion_item(blocker_code) WHERE state='blocked';

CREATE TABLE appellate_worker_heartbeat (
  worker_id text PRIMARY KEY,
  stage text NOT NULL,
  court_code text,
  current_item_id uuid REFERENCES appellate_ingestion_item(id),
  started_at timestamptz NOT NULL DEFAULT now(),
  heartbeat_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb NOT NULL DEFAULT '{}'
);

INSERT INTO appellate_source_registry(court_code,court_name,circuit,official_website,opinions_url,historical_url,rss_url,adapter_type)
VALUES
('ca1','United States Court of Appeals for the First Circuit','1','https://www.ca1.uscourts.gov','https://www.ca1.uscourts.gov/opn','https://www.ca1.uscourts.gov/opn','https://www.ca1.uscourts.gov/rss/opinions','official-html-pdf-v1'),
('ca2','United States Court of Appeals for the Second Circuit','2','https://www.ca2.uscourts.gov','https://www.ca2.uscourts.gov/decisions.html','https://www.ca2.uscourts.gov/decisions.html','https://www.ca2.uscourts.gov/nav/rss.html','official-html-pdf-v1'),
('ca3','United States Court of Appeals for the Third Circuit','3','https://www.ca3.uscourts.gov','https://www2.ca3.uscourts.gov/recentop/week/recprec.htm','https://www.ca3.uscourts.gov/opinions-and-oral-arguments','https://www2.ca3.uscourts.gov/rss/recentopinions.xml','official-html-pdf-v1'),
('ca4','United States Court of Appeals for the Fourth Circuit','4','https://www.ca4.uscourts.gov','https://www.ca4.uscourts.gov/opinions/daily-opinions','https://www.ca4.uscourts.gov/opinions/search-opinions','https://www.ca4.uscourts.gov/RSS/RSSFeed.ashx?type=Opinions','official-html-pdf-v1'),
('ca5','United States Court of Appeals for the Fifth Circuit','5','https://www.ca5.uscourts.gov','https://www.ca5.uscourts.gov/opinions','https://www.ca5.uscourts.gov/opinions',NULL,'official-html-pdf-v1'),
('ca6','United States Court of Appeals for the Sixth Circuit','6','https://www.ca6.uscourts.gov','https://www.opn.ca6.uscourts.gov/opinions.pdf','https://www.ca6.uscourts.gov/opinions',NULL,'official-html-pdf-v1'),
('ca7','United States Court of Appeals for the Seventh Circuit','7','https://www.ca7.uscourts.gov','https://www.ca7.uscourts.gov/opinions.htm','https://www.ca7.uscourts.gov/opinions.htm',NULL,'official-html-pdf-v1'),
('ca8','United States Court of Appeals for the Eighth Circuit','8','https://www.ca8.uscourts.gov','https://ecf.ca8.uscourts.gov/cgi-bin/opnByDate.pl','https://www.ca8.uscourts.gov/opinions',NULL,'official-html-pdf-v1'),
('ca9','United States Court of Appeals for the Ninth Circuit','9','https://www.ca9.uscourts.gov','https://www.ca9.uscourts.gov/opinions/','https://www.ca9.uscourts.gov/opinions/','https://cdn.ca9.uscourts.gov/datastore/opinions/rss.xml','official-html-pdf-v1'),
('ca10','United States Court of Appeals for the Tenth Circuit','10','https://www.ca10.uscourts.gov','https://www.ca10.uscourts.gov/opinions','https://www.ca10.uscourts.gov/opinions',NULL,'official-html-pdf-v1'),
('ca11','United States Court of Appeals for the Eleventh Circuit','11','https://www.ca11.uscourts.gov','https://media.ca11.uscourts.gov/opinions/pub.php','https://media.ca11.uscourts.gov/opinions',NULL,'official-html-pdf-v1'),
('cadc','United States Court of Appeals for the District of Columbia Circuit','DC','https://www.cadc.uscourts.gov','https://media.cadc.uscourts.gov/opinions/bydate.asp','https://media.cadc.uscourts.gov/opinions/',NULL,'official-html-pdf-v1'),
('cafc','United States Court of Appeals for the Federal Circuit','Federal','https://www.cafc.uscourts.gov','https://www.cafc.uscourts.gov/home/case-information/opinions-orders/','https://www.cafc.uscourts.gov/home/case-information/opinions-orders/','https://www.cafc.uscourts.gov/category/opinions-orders/feed/','official-html-pdf-v1');

COMMIT;
