-- migrate:up
-- Scheduler org enumeration (review S-3): returns organization IDs only, across
-- all tenants, without tenant context. Owned by a NOLOGIN role that has no
-- BYPASSRLS; a dedicated policy lets only that role read organization IDs.

grant usage on schema spike to app_org_enumerator;
grant select (id) on spike.organizations to app_org_enumerator;

create policy organizations_enumerator_select on spike.organizations
  for select to app_org_enumerator
  using (true);

create function app.list_organization_ids() returns setof uuid
  language sql stable
  security definer
  set search_path = pg_catalog, pg_temp
  as $$ select o.id from spike.organizations as o order by o.id $$;

revoke execute on function app.list_organization_ids() from public;
-- Must be granted before the ownership transfer: afterwards schoolos_owner no
-- longer holds grant rights on the function. ACL entries survive the transfer.
grant execute on function app.list_organization_ids() to app_user;

-- Transfer ownership to the NOLOGIN role. ALTER ... OWNER TO requires the
-- migrating role to be able to SET ROLE to the new owner, and the new owner to
-- have CREATE on the schema; CREATE is granted only for the transfer.
grant app_org_enumerator to schoolos_owner with inherit false, set true;
grant create on schema app to app_org_enumerator;
alter function app.list_organization_ids() owner to app_org_enumerator;
revoke create on schema app from app_org_enumerator;
revoke app_org_enumerator from schoolos_owner;

-- migrate:down
-- Dropping requires the privileges of the owning role, so membership is
-- granted only for the duration of the drop.
grant app_org_enumerator to schoolos_owner with inherit true, set false;
drop function app.list_organization_ids();
revoke app_org_enumerator from schoolos_owner;
drop policy organizations_enumerator_select on spike.organizations;
revoke select (id) on spike.organizations from app_org_enumerator;
revoke usage on schema spike from app_org_enumerator;
