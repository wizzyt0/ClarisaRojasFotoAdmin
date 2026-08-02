alter table galleries
add column if not exists group_id uuid references school_groups(id) on delete cascade;

create index if not exists galleries_group_id_idx on galleries(group_id);
