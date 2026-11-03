-- migrate:up
create table probe_cic (id int);

-- migrate:down
drop table probe_cic;
