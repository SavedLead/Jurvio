BEGIN;

UPDATE internal_user
SET role = 'administrator',
    active = true,
    password_hash = 'scrypt$ugi6Y36T-blD5_nSAa2SGQ$BtYzFrjXQtLyFT7JlUknuD92Rr1eV9iPXlNeP0sCPfk7VtOX2kbMZzlqoP3CGSqTILAlIIzAkGq7Fc07OLKdZg',
    must_change_password = true,
    updated_at = now()
WHERE lower(email) = 'research@jurvio.com';

DELETE FROM internal_session
WHERE internal_user_id IN (
  SELECT id
  FROM internal_user
  WHERE lower(email) = 'research@jurvio.com'
);

COMMIT;
