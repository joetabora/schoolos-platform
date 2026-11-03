-- migrate:up
-- Synthetic fixture tables. They mirror M1 patterns (tenant root, tenant table,
-- composite tenant FK child, append-only per-org sequence) but are not the M1 schema.

create table spike.organizations (
  id uuid primary key,
  name text not null,
  slug text not null unique,
  created_at timestamptz not null default now()
);

create table spike.schools (
  id uuid primary key,
  organization_id uuid not null references spike.organizations (id) on delete restrict,
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id)
);
create index schools_org_idx on spike.schools (organization_id);

create table spike.school_notes (
  id uuid primary key,
  organization_id uuid not null,
  school_id uuid not null,
  body text not null,
  created_at timestamptz not null default now(),
  constraint school_notes_school_fk
    foreign key (organization_id, school_id)
    references spike.schools (organization_id, id) on delete restrict
);
create index school_notes_org_school_idx on spike.school_notes (organization_id, school_id);

create table spike.org_events (
  organization_id uuid not null references spike.organizations (id) on delete restrict,
  seq bigint not null,
  action text not null check (action in ('created', 'updated', 'probe')),
  occurred_at timestamptz not null default now(),
  primary key (organization_id, seq)
);

create trigger schools_set_updated_at
  before update on spike.schools
  for each row execute function app.set_updated_at();

create trigger org_events_append_only
  before update on spike.org_events
  for each row execute function app.reject_update();

-- Row-level security: enabled and forced on every table. Policies apply to
-- app_user only, so any other role (including the owner) matches no policy and
-- sees nothing (deny by default).
alter table spike.organizations enable row level security;
alter table spike.organizations force row level security;
alter table spike.schools enable row level security;
alter table spike.schools force row level security;
alter table spike.school_notes enable row level security;
alter table spike.school_notes force row level security;
alter table spike.org_events enable row level security;
alter table spike.org_events force row level security;

create policy organizations_tenant_select on spike.organizations
  for select to app_user
  using (id = (select app.current_org_id()));

create policy schools_tenant on spike.schools
  for all to app_user
  using (organization_id = (select app.current_org_id()))
  with check (organization_id = (select app.current_org_id()));

create policy school_notes_tenant on spike.school_notes
  for all to app_user
  using (organization_id = (select app.current_org_id()))
  with check (organization_id = (select app.current_org_id()));

create policy org_events_tenant_select on spike.org_events
  for select to app_user
  using (organization_id = (select app.current_org_id()));

create policy org_events_tenant_insert on spike.org_events
  for insert to app_user
  with check (organization_id = (select app.current_org_id()));

-- Grants. app_user never gets UPDATE/DELETE on append-only rows, TRUNCATE, or
-- REFERENCES; organizations are read-only to it.
grant select on spike.organizations to app_user;
grant select, insert, update on spike.schools to app_user;
grant select, insert, update, delete on spike.school_notes to app_user;
grant select, insert on spike.org_events to app_user;

-- migrate:down
drop table spike.org_events;
drop table spike.school_notes;
drop table spike.schools;
drop table spike.organizations;
