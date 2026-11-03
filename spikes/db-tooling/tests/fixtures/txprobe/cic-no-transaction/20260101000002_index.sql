-- migrate:up transaction:false
create index concurrently probe_cic_idx on probe_cic (id);

-- migrate:down transaction:false
drop index concurrently probe_cic_idx;
