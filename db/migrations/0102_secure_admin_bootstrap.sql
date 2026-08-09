BEGIN;

ALTER TABLE internal_user
  ADD COLUMN IF NOT EXISTS must_change_password boolean NOT NULL DEFAULT false;

UPDATE internal_user
SET active = false,
    password_hash = NULL,
    must_change_password = false,
    updated_at = now()
WHERE lower(email) = 'david@cleanyourname.com';

DELETE FROM internal_session
WHERE internal_user_id IN (
  SELECT id FROM internal_user WHERE lower(email) = 'david@cleanyourname.com'
);

INSERT INTO internal_user (email, role, active, password_hash, must_change_password)
VALUES (
  'research@jurvio.com',
  'administrator',
  true,
  'scrypt$SDR9V2PFwDds3xbrz0A6YQ$O80aXAqhLg7WSCUHvBSaa90AlXgivDIi8yvPIUj8O9or-Xlu6t4mq80VFCHB7x0eTsBFrH3emngTJfpIuLn-Ww',
  true
)
ON CONFLICT (email) DO UPDATE
SET role = 'administrator',
    active = true,
    password_hash = EXCLUDED.password_hash,
    must_change_password = true,
    updated_at = now();

DELETE FROM internal_session
WHERE internal_user_id IN (
  SELECT id FROM internal_user WHERE lower(email) = 'research@jurvio.com'
);

COMMIT;
