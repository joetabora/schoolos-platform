-- migrate:up
create index concurrently probe_cic_idx on probe_cic (id);

-- migrate:down
drop index concurrently probe_cic_idx;
