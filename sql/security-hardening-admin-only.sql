-- Security hardening for Clarisa Rojas Fotografia.
-- Run this once in Supabase SQL Editor while signed in as the project owner.
-- Access is based on staff_roles, so every configured owner keeps administrator access.

begin;

-- Fix the database-linter warning for the trigger helper.
alter function public.set_updated_at() set search_path = public;

-- Make the financial view respect the permissions of the querying user.
alter view public.job_financial_summary set (security_invoker = true);

-- Remove all existing policies on application data before installing owner-only
-- rules. This also removes stale permissive policies left by earlier setup scripts.
do $$
declare
  table_name text;
  policy_row record;
begin
  foreach table_name in array array[
    'approvals',
    'clients',
    'deposits',
    'diploma_templates',
    'file_share_links',
    'folder_templates',
    'galleries',
    'job_files',
    'jobs',
    'message_logs',
    'package_images',
    'packages',
    'print_items',
    'school_groups',
    'school_profiles'
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

-- Verify the owner-role policies:
select tablename, policyname, roles, cmd, qual, with_check
from pg_policies
where schemaname = 'public'
  and policyname like 'owners can manage %'
order by tablename, policyname;
