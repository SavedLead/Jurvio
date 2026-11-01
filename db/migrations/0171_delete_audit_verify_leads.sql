-- Live verification of the waitlist (2026-11-01) stored two leads for an
-- internal test address; remove them so they are never emailed.
DELETE FROM lead_waitlist WHERE lower(email) = 'david.audit-verify+waitlist@jurvio.com';
