-- migrate:up
create schema app;
create schema spike;
revoke all on schema app from public;
revoke all on schema spike from public;
grant usage on schema app to app_user;
grant usage on schema spike to app_user;

-- Tenant context readers. An unset or empty setting yields NULL, which matches
-- no rows in the policies (fail closed). A malformed value raises an error.
create function app.current_org_id() returns uuid
  language sql stable
  as $$ select nullif(pg_catalog.current_setting('app.current_org_id', true), '')::uuid $$;

create function app.current_user_id() returns uuid
  language sql stable
  as $$ select nullif(pg_catalog.current_setting('app.current_user_id', true), '')::uuid $$;

revoke execute on function app.current_org_id() from public;
revoke execute on function app.current_user_id() from public;
grant execute on function app.current_org_id() to app_user;
grant execute on function app.current_user_id() to app_user;

-- Trigger functions (SECURITY INVOKER).
create function app.set_updated_at() returns trigger
  language plpgsql
  as $$
begin
  new.updated_at := pg_catalog.now();
  return new;
end
$$;

create function app.reject_update() returns trigger
  language plpgsql
  as $$
begin
  raise exception 'table %.% is append-only', tg_table_schema, tg_table_name
    using errcode = 'insufficient_privilege';
end
$$;

revoke execute on function app.set_updated_at() from public;
revoke execute on function app.reject_update() from public;

-- migrate:down
drop function app.reject_update();
drop function app.set_updated_at();
drop function app.current_user_id();
drop function app.current_org_id();
drop schema spike;
drop schema app;
