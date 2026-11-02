DELETE FROM district_opinion_judge s USING (SELECT DISTINCT case_id FROM incoming_seat) i WHERE s.case_id = i.case_id;
INSERT INTO district_opinion_judge (case_id, court_id, decided_on, seat_index, role, observed_name, judge_id, match_status, appointing_party, matcher_version)
SELECT DISTINCT ON (i.case_id, i.role, i.seat_index) i.case_id, i.court_id, i.decided_on, i.seat_index, i.role, i.observed_name,
  j.id, CASE WHEN j.id IS NULL AND i.match_status = 'matched' THEN 'unmatched' ELSE i.match_status END, i.appointing_party, i.matcher_version
FROM incoming_seat i
JOIN legal_case c ON c.id = i.case_id
LEFT JOIN judge j ON j.id = i.judge_id
ORDER BY i.case_id, i.role, i.seat_index;
COMMIT;
