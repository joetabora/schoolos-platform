-- migrate:up
-- Runtime roles. Passwords are provisioned out-of-band (never in migrations).
-- Roles are cluster-wide objects, not per-database.
create role app_user login nosuperuser nobypassrls nocreaterole nocreatedb noinherit;
create role app_auth login nosuperuser nobypassrls nocreaterole nocreatedb noinherit;
-- Owns the org-enumeration SECURITY DEFINER function. Cannot log in.
create role app_org_enumerator nologin nosuperuser nobypassrls nocreaterole nocreatedb noinherit;

do $$
begin
  execute format('grant connect on database %I to app_user, app_auth', current_database());
end
$$;

-- migrate:down
do $$
begin
  execute format('revoke connect on database %I from app_user, app_auth', current_database());
end
$$;
drop role app_org_enumerator;
drop role app_auth;
drop role app_user;
