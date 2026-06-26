alter table jobs
drop constraint if exists jobs_client_id_fkey;

alter table jobs
add constraint jobs_client_id_fkey
foreign key (client_id)
references clients(id)
on delete cascade;
