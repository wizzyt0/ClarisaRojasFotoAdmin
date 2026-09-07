-- Security hardening for Clarisa Rojas Fotografia.
-- Run this once in Supabase SQL Editor while signed in as the project owner.
-- The dashboard is restricted to this Supabase Auth user only.

begin;

-- Fix the database-linter warning for the trigger helper.
alter function public.set_updated_at() set search_path = public;

-- Make the financial view respect the permissions of the querying user.
alter view public.job_financial_summary set (security_invoker = true);

-- Replace the previous "using (true)" policies. Service-role access used by the
-- Cloudflare Worker is unaffected, and public token RPCs keep working because
-- their SECURITY DEFINER functions validate the opaque approval token internally.
do $$
declare
  table_name text;
  admin_id constant uuid := 'c97cb4d0-cd9f-4868-8e04-1903909097b9';
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
    execute format('drop policy if exists %I on public.%I', 'admin read ' || table_name, table_name);
    execute format('drop policy if exists %I on public.%I', 'admin write ' || table_name, table_name);
    execute format(
      'create policy %I on public.%I for select to authenticated using (auth.uid() = %L::uuid)',
      'admin read ' || table_name, table_name, admin_id::text
    );
    execute format(
      'create policy %I on public.%I for all to authenticated using (auth.uid() = %L::uuid) with check (auth.uid() = %L::uuid)',
      'admin write ' || table_name, table_name, admin_id::text, admin_id::text
    );
  end loop;
end;
$$;

commit;

-- Verify that only this user is allowed by each admin policy:
select tablename, policyname, roles, cmd, qual, with_check
from pg_policies
where schemaname = 'public'
  and policyname like 'admin %'
order by tablename, policyname;
