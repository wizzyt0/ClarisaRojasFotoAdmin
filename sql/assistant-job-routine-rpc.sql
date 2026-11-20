-- Allows the assistant to update only jobs.title and jobs.notes without
-- granting it direct SELECT access to the sensitive jobs table.
begin;

create or replace function public.assistant_update_job_routine(
  p_job_id uuid,
  p_patch jsonb
)
returns table (id uuid, title text, notes text)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not coalesce(
    (select public.has_staff_role(array['assistant']::public.staff_role[])),
    false
  ) then
    raise exception 'Assistant role required.' using errcode = '42501';
  end if;

  if p_patch is null or jsonb_typeof(p_patch) <> 'object' or p_patch = '{}'::jsonb then
    raise exception 'A non-empty JSON object is required.' using errcode = '22023';
  end if;

  if exists (
    select 1
    from jsonb_object_keys(p_patch) as keys(key)
    where key not in ('title', 'notes')
  ) then
    raise exception 'Only title and notes can be updated.' using errcode = '22023';
  end if;

  if p_patch ? 'title' and (
    jsonb_typeof(p_patch -> 'title') <> 'string'
    or length(btrim(p_patch ->> 'title')) = 0
    or length(p_patch ->> 'title') > 200
  ) then
    raise exception 'Invalid title.' using errcode = '22023';
  end if;

  if p_patch ? 'notes' and (
    jsonb_typeof(p_patch -> 'notes') not in ('string', 'null')
    or length(p_patch ->> 'notes') > 5000
  ) then
    raise exception 'Invalid notes.' using errcode = '22023';
  end if;

  return query
  update public.jobs as j
  set title = case when p_patch ? 'title' then p_patch ->> 'title' else j.title end,
      notes = case when p_patch ? 'notes' then p_patch ->> 'notes' else j.notes end
  where j.id = p_job_id
  returning j.id, j.title, j.notes;
end;
$$;

alter function public.assistant_update_job_routine(uuid, jsonb) owner to postgres;
revoke all on function public.assistant_update_job_routine(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.assistant_update_job_routine(uuid, jsonb) to authenticated;

notify pgrst, 'reload schema';
commit;
