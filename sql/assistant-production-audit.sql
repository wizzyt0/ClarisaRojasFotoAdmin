-- Run as an administrator. Returns schema metadata only; does not read application rows.
with target_tables as (
  select c.oid, c.relowner, c.relname, c.relrowsecurity, c.relforcerowsecurity
  from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind in ('r', 'p')
    and c.relname in ('clients', 'school_profiles', 'jobs', 'school_groups',
                      'deposits', 'assistant_write_audit', 'staff_roles')
), target_functions as (
  select p.*
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.prokind = 'f'
    and (p.proname like 'assistant\_%' escape '\'
         or p.proname in ('has_staff_role', 'guard_assistant_routine_updates',
                          'prepare_group_package', 'sync_group_package')
         or p.oid in (select t.tgfoid from pg_catalog.pg_trigger t
                      join target_tables r on r.oid = t.tgrelid where not t.tgisinternal))
)
select jsonb_pretty(jsonb_build_object(
  'tables', (
    select jsonb_agg(jsonb_build_object(
      'name', r.relname, 'owner', pg_get_userbyid(r.relowner),
      'rls', r.relrowsecurity, 'force_rls', r.relforcerowsecurity,
      'authenticated_table_grants', (
        select jsonb_object_agg(priv, has_table_privilege('authenticated', r.oid, priv))
        from unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']) as g(priv)
      ),
      'columns', (
        select jsonb_agg(jsonb_build_object(
          'name', a.attname, 'type', format_type(a.atttypid, a.atttypmod),
          'not_null', a.attnotnull,
          'authenticated_update', has_column_privilege('authenticated', r.oid, a.attnum, 'UPDATE')
        ) order by a.attnum)
        from pg_catalog.pg_attribute a
        where a.attrelid = r.oid and a.attnum > 0 and not a.attisdropped
      ),
      'policies', (
        select jsonb_agg(to_jsonb(p) order by p.policyname)
        from pg_catalog.pg_policies p where p.schemaname = 'public' and p.tablename = r.relname
      ),
      'triggers', (
        select jsonb_agg(jsonb_build_object(
          'name', t.tgname, 'enabled', t.tgenabled, 'definition', pg_get_triggerdef(t.oid, false)
        ) order by t.tgname)
        from pg_catalog.pg_trigger t where t.tgrelid = r.oid and not t.tgisinternal
      ),
      'constraints', (
        select jsonb_agg(jsonb_build_object(
          'name', c.conname, 'definition', pg_get_constraintdef(c.oid, false), 'validated', c.convalidated
        ) order by c.conname)
        from pg_catalog.pg_constraint c where c.conrelid = r.oid
      )
    ) order by r.relname) from target_tables r
  ),
  'functions', (
    select jsonb_agg(jsonb_build_object(
      'signature', format('public.%I(%s)', f.proname, pg_get_function_identity_arguments(f.oid)),
      'owner', o.rolname, 'owner_bypasses_rls', o.rolbypassrls or o.rolsuper,
      'security_definer', f.prosecdef,
      'anon_execute', has_function_privilege('anon', f.oid, 'EXECUTE'),
      'authenticated_execute', has_function_privilege('authenticated', f.oid, 'EXECUTE'),
      'definition', pg_get_functiondef(f.oid)
    ) order by f.proname, f.oid)
    from target_functions f join pg_catalog.pg_roles o on o.oid = f.proowner
  )
)) as assistant_production_audit;
