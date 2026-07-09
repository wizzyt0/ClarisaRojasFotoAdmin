alter table deposits add column if not exists group_id uuid references school_groups(id) on delete set null;

create index if not exists deposits_group_id_idx on deposits(group_id);
