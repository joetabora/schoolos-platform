-- migrate:up transaction:false
create table probe_nontx_a (id int);
select 1 / 0;
create table probe_nontx_b (id int);

-- migrate:down transaction:false
