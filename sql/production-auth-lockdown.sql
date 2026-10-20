-- Deprecated name retained for installations whose checklist already references
-- this file. Run after staff-roles-rbac.sql; all access remains owner-only.
begin;
do $$
declare table_name text; policy_row record;
begin
  foreach table_name in array array[
    'approvals', 'clients', 'deposits', 'diploma_templates', 'file_share_links',
    'folder_templates', 'galleries', 'job_files', 'jobs', 'message_logs',
    'package_images', 'packages', 'print_items', 'school_groups', 'school_profiles'
  ] loop
    execute format('alter table public.%I enable row level security', table_name);
    for policy_row in select policyname from pg_policies where schemaname = 'public' and tablename = table_name loop
      execute format('drop policy if exists %I on public.%I', policy_row.policyname, table_name);
    end loop;
    execute format(
      'create policy %I on public.%I for all to authenticated using ((select public.has_staff_role(array[''owner'']::public.staff_role[]))) with check ((select public.has_staff_role(array[''owner'']::public.staff_role[])))',
      'owners can manage ' || table_name, table_name
    );
  end loop;
end;
$$;
commit;
