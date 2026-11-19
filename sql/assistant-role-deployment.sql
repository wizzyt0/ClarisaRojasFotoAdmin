-- Restricted AI-assistant role. Run after the existing schema, RBAC,
-- production-auth-lockdown, print workflow, catalog and finance migrations.
-- Grants read access, with narrow routine edits to client and job descriptions.

alter type public.staff_role add value if not exists 'assistant';
commit;

begin;

create or replace function public.guard_assistant_routine_updates()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  permitted_columns text[];
begin
  if not (select public.has_staff_role(array['assistant']::public.staff_role[])) then
    return new;
  end if;

  new.updated_at := old.updated_at;

  permitted_columns := case tg_table_name
    when 'clients' then array['name', 'phone', 'secondary_phone', 'email', 'notes']
    when 'school_profiles' then array[
      'school_name', 'contact_name', 'contact_phone', 'contact_email',
      'teacher_name', 'teacher_phone', 'principal_name', 'principal_phone',
      'grade_or_class', 'last_contact_date', 'next_follow_up_date',
      'follow_up_status', 'commercial_notes'
    ]
    when 'jobs' then array['title', 'event_date', 'delivery_date', 'notes']
    else array[]::text[]
  end;

  if (to_jsonb(new) - permitted_columns) is distinct from (to_jsonb(old) - permitted_columns) then
    raise exception 'Este rol solo puede editar datos rutinarios permitidos.' using errcode = '42501';
  end if;
  return new;
end;
$$;

do $$
declare
  table_name text;
  readable_tables text[] := array[
    'clients', 'school_profiles', 'jobs', 'school_groups', 'packages',
    'package_images', 'diploma_templates', 'folder_templates', 'galleries',
    'approvals', 'print_items', 'job_files', 'deposits',
    'cost_items', 'package_material_rules', 'purchase_orders',
    'purchase_order_lines', 'purchase_order_allocations', 'expenses'
  ];
begin
  foreach table_name in array readable_tables loop
    if to_regclass(format('public.%I', table_name)) is null then
      continue;
    end if;

    execute format('alter table public.%I enable row level security', table_name);
    execute format('drop policy if exists %I on public.%I', 'assistants can read ' || table_name, table_name);
    execute format(
      'create policy %I on public.%I for select to authenticated using ((select public.has_staff_role(array[''assistant'']::public.staff_role[])))',
      'assistants can read ' || table_name, table_name
    );
  end loop;

  foreach table_name in array array['clients', 'school_profiles', 'jobs'] loop
    if to_regclass(format('public.%I', table_name)) is null then
      continue;
    end if;
    execute format('drop trigger if exists assistant_routine_update_guard on public.%I', table_name);
    execute format(
      'create trigger assistant_routine_update_guard before update on public.%I for each row execute function public.guard_assistant_routine_updates()',
      table_name
    );
    execute format('drop policy if exists %I on public.%I', 'assistants can update routine ' || table_name, table_name);
    execute format(
      'create policy %I on public.%I for update to authenticated using ((select public.has_staff_role(array[''assistant'']::public.staff_role[]))) with check ((select public.has_staff_role(array[''assistant'']::public.staff_role[])))',
      'assistants can update routine ' || table_name, table_name
    );
  end loop;
end;
$$;

-- Never expose reusable approval/share tokens or message/activity payloads.
drop policy if exists "assistants can read jobs" on public.jobs;
drop policy if exists "assistants can read print_items" on public.print_items;
drop policy if exists "assistants can read file_share_links" on public.file_share_links;
drop policy if exists "assistants can read message_logs" on public.message_logs;
drop policy if exists "assistants can read job_activity" on public.job_activity;

create or replace view public.assistant_jobs
with (security_barrier = true, security_invoker = false)
as
select id, client_id, package_id, job_type, title, event_type, event_date,
  delivery_date, status, price, package_quantity, notes, approved_at,
  approval_name, approval_terms_accepted, created_at, updated_at
from public.jobs
where (select public.has_staff_role(array['assistant']::public.staff_role[]));

create or replace view public.assistant_print_items
with (security_barrier = true, security_invoker = false)
as
select id, job_id, group_id, item_type, title, status, sent_at, approved_at,
  approved_by_name, terms_accepted, selected_file_id, selected_package_id,
  notes, client_notes, changes_requested_at, created_at, updated_at
from public.print_items
where (select public.has_staff_role(array['assistant']::public.staff_role[]));

create or replace view public.assistant_file_share_links
with (security_barrier = true, security_invoker = false)
as
select id, job_id, print_item_id, link_type, expires_at, revoked_at, created_at
from public.file_share_links
where (select public.has_staff_role(array['assistant']::public.staff_role[]));

create or replace view public.assistant_job_files
with (security_barrier = true, security_invoker = false)
as
select id, job_id, print_item_id, file_type, file_name, content_type,
  size_bytes, notes, created_at
from public.job_files
where file_type = 'TEACHER_PREVIEW'
  and (select public.has_staff_role(array['assistant']::public.staff_role[]));

drop policy if exists "assistants can read job_files" on public.job_files;

revoke all on public.assistant_jobs, public.assistant_print_items,
  public.assistant_file_share_links, public.assistant_job_files from public, anon;
grant select on public.assistant_jobs, public.assistant_print_items,
  public.assistant_file_share_links, public.assistant_job_files to authenticated;

-- Assistants can inspect their own role but cannot grant roles to anyone.
drop policy if exists "assistants cannot manage staff roles" on public.staff_roles;
create policy "assistants cannot manage staff roles" on public.staff_roles for select to authenticated
  using ((select public.has_staff_role(array['assistant']::public.staff_role[])) and user_id = (select auth.uid()));

notify pgrst, 'reload schema';

commit;
