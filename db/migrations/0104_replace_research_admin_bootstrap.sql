BEGIN;

UPDATE internal_user
SET role = 'administrator',
    active = true,
    password_hash = 'scrypt$0MB82FDm-guO3uy8gSG_6w$YNZoVMh_TZ2uBbq223vD7tAAYUfE0W_Nzmw2SA-WlEThCpLrtLpSPidu6aDfuZdt9IMQBh3y2R2wGo-7pwOpYg',
    must_change_password = true,
    updated_at = now()
WHERE lower(email) = 'research@jurvio.com';

DELETE FROM internal_session
WHERE internal_user_id IN (
  SELECT id FROM internal_user WHERE lower(email) = 'research@jurvio.com'
);

COMMIT;
