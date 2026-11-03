-- migrate:up
create role spike_txprobe_role nologin;
create table probe_partial (id int);
select 1 / 0;

-- migrate:down
