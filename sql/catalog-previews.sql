create table if not exists package_images (
  id uuid primary key default gen_random_uuid(),
  package_id uuid not null references packages(id) on delete cascade,
  r2_key text not null,
  file_name text not null,
  content_type text,
  size_bytes bigint,
  created_at timestamptz default now()
);

create table if not exists diploma_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  r2_key text not null,
  file_name text not null,
  content_type text,
  size_bytes bigint,
  is_active boolean default true,
  created_at timestamptz default now()
);

create index if not exists package_images_package_id_idx on package_images(package_id);
create index if not exists diploma_templates_is_active_idx on diploma_templates(is_active);

alter table package_images enable row level security;
alter table diploma_templates enable row level security;

drop policy if exists "admin read package_images" on package_images;
drop policy if exists "admin write package_images" on package_images;
drop policy if exists "admin read diploma_templates" on diploma_templates;
drop policy if exists "admin write diploma_templates" on diploma_templates;

create policy "admin read package_images" on package_images for select to authenticated using (true);
create policy "admin write package_images" on package_images for all to authenticated using (true) with check (true);
create policy "admin read diploma_templates" on diploma_templates for select to authenticated using (true);
create policy "admin write diploma_templates" on diploma_templates for all to authenticated using (true) with check (true);
