-- Private owner/editor workflow for Clarisa Rojas Fotografia.
-- Run once in Supabase SQL Editor before deploying this version of the site.

begin;

do $$ begin
  create type public.staff_role as enum ('owner', 'editor');
exception when duplicate_object then null;
end $$;

create table if not exists public.staff_roles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role public.staff_role not null,
  display_name text not null default 'Miembro del equipo',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.staff_roles add column if not exists display_name text not null default 'Miembro del equipo';
alter table public.staff_roles enable row level security;

create or replace function public.has_staff_role(allowed_roles public.staff_role[])
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.staff_roles
    where user_id = (select auth.uid()) and role = any(allowed_roles)
  );
$$;
revoke all on function public.has_staff_role(public.staff_role[]) from public;
grant execute on function public.has_staff_role(public.staff_role[]) to authenticated;

drop policy if exists "staff can read own role" on public.staff_roles;
drop policy if exists "owners can manage staff roles" on public.staff_roles;
create policy "staff can read own role" on public.staff_roles for select to authenticated
  using (user_id = (select auth.uid()));
create policy "owners can manage staff roles" on public.staff_roles for all to authenticated
  using ((select public.has_staff_role(array['owner']::public.staff_role[])))
  with check ((select public.has_staff_role(array['owner']::public.staff_role[])));

insert into public.staff_roles (user_id, role, display_name) values
  ('c97cb4d0-cd9f-4868-8e04-1903909097b9', 'owner', 'Clarisa Rojas'),
  ('8428189c-c2cd-4f0f-a108-be6bca52c569', 'owner', 'Clarissa Rojas'),
  ('51830f50-d749-4c9c-8013-9a204252f181', 'editor', 'Editor de prueba')
on conflict (user_id) do update set role = excluded.role, display_name = excluded.display_name, updated_at = now();

create table if not exists public.work_assignments (
  id uuid primary key default gen_random_uuid(),
  print_item_id uuid not null unique references public.print_items(id) on delete cascade,
  assigned_to uuid not null references auth.users(id) on delete restrict,
  display_label text not null,
  internal_brief text,
  editor_note text,
  status text not null default 'ASSIGNED' check (status in (
    'ASSIGNED', 'IN_PROGRESS', 'READY_FOR_OWNER_REVIEW', 'SENT_TO_CLIENT',
    'CHANGES_REQUESTED', 'COMPLETED', 'CANCELLED'
  )),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists work_assignments_assigned_to_idx on public.work_assignments(assigned_to, status);
alter table public.work_assignments enable row level security;
drop trigger if exists work_assignments_updated_at on public.work_assignments;
create trigger work_assignments_updated_at before update on public.work_assignments
  for each row execute function public.set_updated_at();

drop policy if exists "owners can manage work assignments" on public.work_assignments;
drop policy if exists "editors can read own assignments" on public.work_assignments;
create policy "owners can manage work assignments" on public.work_assignments for all to authenticated
  using ((select public.has_staff_role(array['owner']::public.staff_role[])))
  with check ((select public.has_staff_role(array['owner']::public.staff_role[])));
create policy "editors can read own assignments" on public.work_assignments for select to authenticated
  using (assigned_to = (select auth.uid()));

create or replace function public.update_own_work_assignment(
  assignment_id uuid,
  next_status text,
  next_editor_note text default null
) returns public.work_assignments
language plpgsql security definer set search_path = '' as $$
declare assignment_row public.work_assignments;
begin
  if next_status not in ('IN_PROGRESS', 'READY_FOR_OWNER_REVIEW') then
    raise exception 'Estado de tarea no permitido.';
  end if;
  update public.work_assignments
  set status = next_status, editor_note = coalesce(next_editor_note, editor_note)
  where id = assignment_id
    and assigned_to = (select auth.uid())
    and status in ('ASSIGNED', 'IN_PROGRESS', 'CHANGES_REQUESTED', 'READY_FOR_OWNER_REVIEW')
  returning * into assignment_row;
  if assignment_row.id is null then
    raise exception 'La tarea no está disponible para este editor.';
  end if;
  return assignment_row;
end;
$$;
revoke all on function public.update_own_work_assignment(uuid, text, text) from public;
grant execute on function public.update_own_work_assignment(uuid, text, text) to authenticated;

create or replace function public.sync_assignment_from_print_item()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'CHANGES_REQUESTED' then
    update public.work_assignments set status = 'CHANGES_REQUESTED' where print_item_id = new.id;
  elsif new.status = 'SENT_FOR_APPROVAL' then
    update public.work_assignments set status = 'SENT_TO_CLIENT' where print_item_id = new.id;
  elsif new.status = 'APPROVED_FOR_PRINT' then
    update public.work_assignments set status = 'COMPLETED' where print_item_id = new.id;
  end if;
  return new;
end;
$$;
drop trigger if exists print_item_assignment_status on public.print_items;
create trigger print_item_assignment_status after update of status on public.print_items
  for each row execute function public.sync_assignment_from_print_item();

-- Existing data stays exclusively with owners. Editors read only their task rows.
do $$
declare table_name text;
begin
  foreach table_name in array array[
    'approvals', 'clients', 'deposits', 'diploma_templates',
    'file_share_links', 'folder_templates', 'galleries', 'job_files', 'jobs',
    'message_logs', 'package_images', 'packages', 'print_items',
    'school_groups', 'school_profiles'
  ] loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('drop policy if exists %I on public.%I', 'admin read ' || table_name, table_name);
    execute format('drop policy if exists %I on public.%I', 'admin write ' || table_name, table_name);
    execute format('drop policy if exists %I on public.%I', 'owners can manage ' || table_name, table_name);
    execute format('drop policy if exists %I on public.%I', 'editors can read ' || table_name, table_name);
    execute format('drop policy if exists %I on public.%I', 'editors can add ' || table_name, table_name);
    execute format('drop policy if exists %I on public.%I', 'editors can update ' || table_name, table_name);
    execute format(
      'create policy %I on public.%I for all to authenticated using ((select public.has_staff_role(array[''owner'']::public.staff_role[]))) with check ((select public.has_staff_role(array[''owner'']::public.staff_role[])))',
      'owners can manage ' || table_name, table_name
    );
  end loop;
end $$;

alter function public.set_updated_at() set search_path = public;
alter view public.job_financial_summary set (security_invoker = true);

commit;

select user_id, role, display_name from public.staff_roles order by role, display_name;
