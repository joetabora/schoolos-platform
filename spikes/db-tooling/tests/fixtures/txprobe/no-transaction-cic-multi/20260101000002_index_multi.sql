-- migrate:up transaction:false
create table probe_cic_side (id int);
create index concurrently probe_cic_idx on probe_cic (id);

-- migrate:down transaction:false
