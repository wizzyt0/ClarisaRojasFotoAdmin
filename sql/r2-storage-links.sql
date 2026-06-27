create table if not exists job_files (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references jobs(id) on delete cascade,
  file_type text not null check (file_type in ('TEACHER_PREVIEW','PRINT_HIGH_RES')),
  r2_key text not null,
  file_name text not null,
  content_type text,
  size_bytes bigint,
  notes text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists file_share_links (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references jobs(id) on delete cascade,
  token text not null unique default encode(gen_random_bytes(36), 'base64url'),
  link_type text not null check (link_type in ('TEACHER_PREVIEW','PRINT_DOWNLOAD')),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists job_files_job_id_idx on job_files(job_id);
create index if not exists job_files_file_type_idx on job_files(file_type);
create index if not exists file_share_links_job_id_idx on file_share_links(job_id);
create index if not exists file_share_links_token_idx on file_share_links(token);

drop trigger if exists job_files_updated_at on job_files;
create trigger job_files_updated_at before update on job_files for each row execute function set_updated_at();

drop trigger if exists file_share_links_updated_at on file_share_links;
create trigger file_share_links_updated_at before update on file_share_links for each row execute function set_updated_at();

alter table job_files enable row level security;
alter table file_share_links enable row level security;

drop policy if exists "admin read job_files" on job_files;
drop policy if exists "admin write job_files" on job_files;
drop policy if exists "admin read file_share_links" on file_share_links;
drop policy if exists "admin write file_share_links" on file_share_links;

create policy "admin read job_files" on job_files for select to authenticated using (true);
create policy "admin write job_files" on job_files for all to authenticated using (true) with check (true);
create policy "admin read file_share_links" on file_share_links for select to authenticated using (true);
create policy "admin write file_share_links" on file_share_links for all to authenticated using (true) with check (true);
