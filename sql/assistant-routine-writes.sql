-- Assistant routine writes. These RPCs are deliberately narrow and are not
-- generic table-write access. Apply only after reviewing production schema.
begin;

create table if not exists public.assistant_write_audit (
  id bigint generated always as identity primary key,
  actor_id uuid,
  action text not null check (action in ('school_created', 'job_created', 'group_created', 'group_updated', 'deposit_recorded')),
  record_id uuid not null,
  related_id uuid,
  created_at timestamptz not null default now()
);
alter table public.assistant_write_audit enable row level security;
revoke all on public.assistant_write_audit from public, anon, authenticated;

-- Quantity belongs to routine school/contact data; event/delivery dates stay blocked.
create or replace function public.guard_assistant_routine_updates()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare permitted_columns text[];
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
      'grade_or_class', 'student_count', 'last_contact_date', 'next_follow_up_date',
      'follow_up_status', 'commercial_notes'
    ]
    when 'jobs' then array['title', 'notes']
    else array[]::text[]
  end;
  if (to_jsonb(new) - permitted_columns) is distinct from (to_jsonb(old) - permitted_columns) then
    raise exception 'Este rol solo puede editar datos rutinarios permitidos.' using errcode = '42501';
  end if;
  return new;
end;
$$;

-- Routine group operations add/edit contact and student data only. Suppress
-- package/price synchronization for those operations; package triggers remain
-- unchanged for owner workflows.
create or replace function public.sync_group_package()
returns trigger language plpgsql security definer set search_path = '' as $$
declare target_job uuid;
begin
  if tg_op = 'DELETE' then target_job := old.job_id;
  else
    target_job := new.job_id;
    if tg_op = 'INSERT' or
      new.selected_package_id is distinct from old.selected_package_id or
      new.package_quantity is distinct from old.package_quantity or
      new.photo_format is distinct from old.photo_format then
      update public.print_items pi set
        selected_package_id = new.selected_package_id,
        selected_file_id = case when exists (
          select 1 from public.package_images im where im.id = pi.selected_file_id and im.package_id = new.selected_package_id
        ) then pi.selected_file_id else (
          select im.id from public.package_images im where im.package_id = new.selected_package_id order by im.created_at desc, im.id limit 1
        ) end,
        status = case when new.selected_package_id is null then 'PENDING' else 'CATALOG_SELECTED' end,
        notes = (select 'Paquete seleccionado: ' || p.name || case new.photo_format
          when 'GROUP' then ' · Foto grupal' when 'INDIVIDUAL' then ' · Foto individual' else '' end
          from public.packages p where p.id = new.selected_package_id)
      where pi.group_id = new.id and pi.item_type = 'PHOTO_PACKAGE';
    end if;
  end if;
  if current_setting('app.assistant_group_routine', true) is distinct from 'on' then
    update public.jobs j set
      price = coalesce((select sum(g.price) from public.school_groups g where g.job_id = target_job), 0),
      package_quantity = coalesce((select sum(g.package_quantity) from public.school_groups g where g.job_id = target_job), 0)
    where j.id = target_job;
  end if;
  return null;
end $$;

create or replace function public.assistant_create_school(p_input jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_client public.clients;
  v_school public.school_profiles;
  v_name text;
  v_phone text;
begin
  if not coalesce((select public.has_staff_role(array['assistant']::public.staff_role[])), false) then
    raise exception 'Assistant role required.' using errcode = '42501';
  end if;
  if p_input is null or jsonb_typeof(p_input) <> 'object' or p_input = '{}'::jsonb
    or exists (select 1 from jsonb_object_keys(p_input) as keys(key) where key not in (
      'school_name','school_level','contact_name','contact_phone','contact_email',
      'teacher_name','teacher_phone','principal_name','principal_phone','grade_or_class',
      'student_count','last_contact_date','next_follow_up_date','follow_up_status','commercial_notes'
    )) then
    raise exception 'Invalid school fields.' using errcode = '22023';
  end if;
  v_name := nullif(btrim(p_input->>'school_name'), '');
  v_phone := nullif(btrim(p_input->>'contact_phone'), '');
  if v_name is null or length(v_name) > 200 or v_phone is null or length(v_phone) > 40 then
    raise exception 'School name and contact phone are required.' using errcode = '22023';
  end if;
  if p_input ? 'school_level' and p_input->>'school_level' is not null
    and p_input->>'school_level' not in ('KINDER','PRIMARY','SECONDARY') then
    raise exception 'Invalid school level.' using errcode = '22023';
  end if;
  if p_input ? 'student_count' and p_input->'student_count' <> 'null'::jsonb and (jsonb_typeof(p_input->'student_count') <> 'number'
    or (p_input->>'student_count')::numeric < 0 or (p_input->>'student_count')::numeric > 10000
    or trunc((p_input->>'student_count')::numeric) <> (p_input->>'student_count')::numeric) then
    raise exception 'Invalid student count.' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_each(p_input) e where e.key not in ('school_level','student_count','last_contact_date','next_follow_up_date','follow_up_status')
    and e.value <> 'null'::jsonb and (jsonb_typeof(e.value) <> 'string' or length(e.value #>> '{}') > case e.key
      when 'school_name' then 200 when 'contact_name' then 200 when 'contact_phone' then 40
      when 'contact_email' then 254 when 'teacher_name' then 200 when 'teacher_phone' then 40
      when 'principal_name' then 200 when 'principal_phone' then 40 when 'grade_or_class' then 120
      when 'commercial_notes' then 5000 else 0 end)) then
    raise exception 'Invalid school field value.' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(lower(v_name), 0));
  if exists (select 1 from public.school_profiles where lower(btrim(school_name)) = lower(v_name)) then
    raise exception 'School already exists.' using errcode = '23505';
  end if;

  insert into public.clients(client_type, name, phone, email, is_active)
  values ('SCHOOL_GRADUATION', v_name, v_phone, nullif(btrim(p_input->>'contact_email'), ''), true)
  returning * into v_client;

  insert into public.school_profiles(
    client_id, school_name, school_level, contact_name, contact_phone, contact_email,
    teacher_name, teacher_phone, principal_name, principal_phone, grade_or_class,
    student_count, last_contact_date, next_follow_up_date, follow_up_status, commercial_notes
  ) values (
    v_client.id, v_name, nullif(p_input->>'school_level', ''),
    nullif(btrim(p_input->>'contact_name'), ''), v_phone,
    nullif(btrim(p_input->>'contact_email'), ''), nullif(btrim(p_input->>'teacher_name'), ''),
    nullif(btrim(p_input->>'teacher_phone'), ''), nullif(btrim(p_input->>'principal_name'), ''),
    nullif(btrim(p_input->>'principal_phone'), ''), nullif(btrim(p_input->>'grade_or_class'), ''),
    case when p_input ? 'student_count' then (p_input->>'student_count')::integer end,
    case when p_input ? 'last_contact_date' and p_input->>'last_contact_date' is not null then (p_input->>'last_contact_date')::date end,
    case when p_input ? 'next_follow_up_date' and p_input->>'next_follow_up_date' is not null then (p_input->>'next_follow_up_date')::date end,
    coalesce(nullif(p_input->>'follow_up_status', ''), 'NEW_CONTACT'),
    nullif(p_input->>'commercial_notes', '')
  ) returning * into v_school;

  insert into public.assistant_write_audit(actor_id, action, record_id, related_id)
  values (auth.uid(), 'school_created', v_school.id, v_client.id);
  return jsonb_build_object('ok', true, 'data', jsonb_build_object(
    'id', v_school.id, 'client_id', v_client.id, 'school_name', v_school.school_name,
    'school_level', v_school.school_level, 'contact_name', v_school.contact_name,
    'contact_phone', v_school.contact_phone, 'contact_email', v_school.contact_email,
    'teacher_name', v_school.teacher_name, 'teacher_phone', v_school.teacher_phone,
    'principal_name', v_school.principal_name, 'principal_phone', v_school.principal_phone,
    'grade_or_class', v_school.grade_or_class, 'student_count', v_school.student_count,
    'follow_up_status', v_school.follow_up_status
  ));
end;
$$;

create or replace function public.assistant_create_job(p_input jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_client public.clients; v_job public.jobs;
begin
  if not coalesce((select public.has_staff_role(array['assistant']::public.staff_role[])), false) then
    raise exception 'Assistant role required.' using errcode = '42501';
  end if;
  if p_input is null or jsonb_typeof(p_input) <> 'object' or p_input = '{}'::jsonb
    or exists (select 1 from jsonb_object_keys(p_input) as keys(key) where key not in ('client_id','title','event_type','notes')) then
    raise exception 'Invalid job fields.' using errcode = '22023';
  end if;
  if nullif(btrim(p_input->>'title'), '') is null or length(p_input->>'title') > 200 then
    raise exception 'Title is required.' using errcode = '22023';
  end if;
  if p_input ? 'event_type' and p_input->'event_type' <> 'null'::jsonb
    and (jsonb_typeof(p_input->'event_type') <> 'string' or length(p_input->>'event_type') > 60) then
    raise exception 'Invalid event type.' using errcode = '22023';
  end if;
  if p_input ? 'notes' and p_input->'notes' <> 'null'::jsonb
    and (jsonb_typeof(p_input->'notes') <> 'string' or length(p_input->>'notes') > 5000) then
    raise exception 'Invalid notes.' using errcode = '22023';
  end if;
  select * into v_client from public.clients where id = (p_input->>'client_id')::uuid;
  if v_client.id is null then raise exception 'Client not found.' using errcode = 'P0002'; end if;
  insert into public.jobs(client_id, job_type, title, event_type, notes, price, package_quantity, approval_token)
  values (v_client.id, v_client.client_type, btrim(p_input->>'title'),
    nullif(btrim(p_input->>'event_type'), ''), p_input->>'notes', 0, 0, encode(gen_random_bytes(32), 'hex'))
  returning * into v_job;
  insert into public.assistant_write_audit(actor_id, action, record_id, related_id)
  values (auth.uid(), 'job_created', v_job.id, v_client.id);
  return jsonb_build_object('ok', true, 'data', jsonb_build_object(
    'id', v_job.id, 'client_id', v_job.client_id, 'job_type', v_job.job_type,
    'title', v_job.title, 'event_type', v_job.event_type, 'status', v_job.status, 'notes', v_job.notes
  ));
end;
$$;

create or replace function public.assistant_create_group(p_job_id uuid, p_input jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_group public.school_groups;
begin
  if not coalesce((select public.has_staff_role(array['assistant']::public.staff_role[])), false) then
    raise exception 'Assistant role required.' using errcode = '42501';
  end if;
  if p_input is null or jsonb_typeof(p_input) <> 'object' or p_input = '{}'::jsonb
    or exists (select 1 from jsonb_object_keys(p_input) as keys(key) where key not in ('group_name','teacher_name','teacher_phone','student_count','notes')) then
    raise exception 'Invalid group fields.' using errcode = '22023';
  end if;
  if nullif(btrim(p_input->>'group_name'), '') is null or length(p_input->>'group_name') > 200 then
    raise exception 'Group name is required.' using errcode = '22023';
  end if;
  if p_input ? 'student_count' and p_input->'student_count' <> 'null'::jsonb and (jsonb_typeof(p_input->'student_count') <> 'number'
    or (p_input->>'student_count')::numeric < 0 or (p_input->>'student_count')::numeric > 10000
    or trunc((p_input->>'student_count')::numeric) <> (p_input->>'student_count')::numeric) then
    raise exception 'Invalid student count.' using errcode = '22023';
  end if;
  if (p_input ? 'teacher_name' and p_input->'teacher_name' <> 'null'::jsonb and (jsonb_typeof(p_input->'teacher_name') <> 'string' or length(p_input->>'teacher_name') > 200))
    or (p_input ? 'teacher_phone' and p_input->'teacher_phone' <> 'null'::jsonb and (jsonb_typeof(p_input->'teacher_phone') <> 'string' or length(p_input->>'teacher_phone') > 40))
    or (p_input ? 'notes' and p_input->'notes' <> 'null'::jsonb and (jsonb_typeof(p_input->'notes') <> 'string' or length(p_input->>'notes') > 2000)) then
    raise exception 'Invalid group field value.' using errcode = '22023';
  end if;
  if not exists (select 1 from public.jobs where id = p_job_id and job_type = 'SCHOOL_GRADUATION') then
    raise exception 'School job not found.' using errcode = 'P0002';
  end if;
  perform set_config('app.assistant_group_routine', 'on', true);
  insert into public.school_groups(job_id, group_name, teacher_name, teacher_phone, student_count, notes)
  values (p_job_id, btrim(p_input->>'group_name'), nullif(btrim(p_input->>'teacher_name'), ''),
    nullif(btrim(p_input->>'teacher_phone'), ''),
    case when p_input ? 'student_count' then (p_input->>'student_count')::integer end,
    nullif(p_input->>'notes', ''))
  returning * into v_group;
  perform set_config('app.assistant_group_routine', 'off', true);
  insert into public.assistant_write_audit(actor_id, action, record_id, related_id)
  values (auth.uid(), 'group_created', v_group.id, p_job_id);
  return jsonb_build_object('ok', true, 'data', jsonb_build_object(
    'id', v_group.id, 'job_id', v_group.job_id, 'group_name', v_group.group_name,
    'teacher_name', v_group.teacher_name, 'teacher_phone', v_group.teacher_phone,
    'student_count', v_group.student_count, 'notes', v_group.notes
  ));
end;
$$;

create or replace function public.assistant_update_group_routine(p_group_id uuid, p_patch jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_group public.school_groups;
begin
  if not coalesce((select public.has_staff_role(array['assistant']::public.staff_role[])), false) then
    raise exception 'Assistant role required.' using errcode = '42501';
  end if;
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' or p_patch = '{}'::jsonb
    or exists (select 1 from jsonb_object_keys(p_patch) as keys(key) where key not in ('group_name','teacher_name','teacher_phone','student_count','notes')) then
    raise exception 'Invalid group fields.' using errcode = '22023';
  end if;
  if p_patch ? 'group_name' and (jsonb_typeof(p_patch->'group_name') <> 'string'
    or nullif(btrim(p_patch->>'group_name'), '') is null or length(p_patch->>'group_name') > 200) then
    raise exception 'Invalid group name.' using errcode = '22023';
  end if;
  if p_patch ? 'student_count' and p_patch->'student_count' <> 'null'::jsonb
    and (jsonb_typeof(p_patch->'student_count') <> 'number'
      or (p_patch->>'student_count')::numeric < 0 or (p_patch->>'student_count')::numeric > 10000
      or trunc((p_patch->>'student_count')::numeric) <> (p_patch->>'student_count')::numeric) then
    raise exception 'Invalid student count.' using errcode = '22023';
  end if;
  if (p_patch ? 'teacher_name' and p_patch->'teacher_name' <> 'null'::jsonb and (jsonb_typeof(p_patch->'teacher_name') <> 'string' or length(p_patch->>'teacher_name') > 200))
    or (p_patch ? 'teacher_phone' and p_patch->'teacher_phone' <> 'null'::jsonb and (jsonb_typeof(p_patch->'teacher_phone') <> 'string' or length(p_patch->>'teacher_phone') > 40))
    or (p_patch ? 'notes' and p_patch->'notes' <> 'null'::jsonb and (jsonb_typeof(p_patch->'notes') <> 'string' or length(p_patch->>'notes') > 2000)) then
    raise exception 'Invalid group field value.' using errcode = '22023';
  end if;
  perform set_config('app.assistant_group_routine', 'on', true);
  update public.school_groups g set
    group_name = case when p_patch ? 'group_name' then btrim(p_patch->>'group_name') else g.group_name end,
    teacher_name = case when p_patch ? 'teacher_name' then nullif(btrim(p_patch->>'teacher_name'), '') else g.teacher_name end,
    teacher_phone = case when p_patch ? 'teacher_phone' then nullif(btrim(p_patch->>'teacher_phone'), '') else g.teacher_phone end,
    student_count = case when p_patch ? 'student_count' then (p_patch->>'student_count')::integer else g.student_count end,
    notes = case when p_patch ? 'notes' then p_patch->>'notes' else g.notes end
  where g.id = p_group_id and exists (select 1 from public.jobs j where j.id = g.job_id and j.job_type = 'SCHOOL_GRADUATION')
  returning g.* into v_group;
  perform set_config('app.assistant_group_routine', 'off', true);
  if v_group.id is null then raise exception 'Group not found.' using errcode = 'P0002'; end if;
  insert into public.assistant_write_audit(actor_id, action, record_id, related_id)
  values (auth.uid(), 'group_updated', v_group.id, v_group.job_id);
  return jsonb_build_object('ok', true, 'data', jsonb_build_object(
    'id', v_group.id, 'job_id', v_group.job_id, 'group_name', v_group.group_name,
    'teacher_name', v_group.teacher_name, 'teacher_phone', v_group.teacher_phone,
    'student_count', v_group.student_count, 'notes', v_group.notes
  ));
end;
$$;

create or replace function public.assistant_record_deposit(p_job_id uuid, p_input jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_deposit public.deposits;
begin
  if not coalesce((select public.has_staff_role(array['assistant']::public.staff_role[])), false) then
    raise exception 'Assistant role required.' using errcode = '42501';
  end if;
  if p_input is null or jsonb_typeof(p_input) <> 'object' or p_input = '{}'::jsonb
    or exists (select 1 from jsonb_object_keys(p_input) as keys(key) where key not in ('amount','deposit_date','notes')) then
    raise exception 'Invalid deposit fields.' using errcode = '22023';
  end if;
  if jsonb_typeof(p_input->'amount') <> 'number' or (p_input->>'amount')::numeric <= 0
    or (p_input->>'amount')::numeric > 9999999999.99
    or scale((p_input->>'amount')::numeric) > 2 then
    raise exception 'Invalid deposit amount.' using errcode = '22023';
  end if;
  if nullif(p_input->>'deposit_date', '') is null then
    raise exception 'Deposit date is required.' using errcode = '22023';
  end if;
  if jsonb_typeof(p_input->'deposit_date') <> 'string'
    or p_input->>'deposit_date' !~ '^\d{4}-\d{2}-\d{2}$'
    or (p_input->>'deposit_date')::date is null then
    raise exception 'Invalid deposit date.' using errcode = '22023';
  end if;
  if p_input ? 'notes' and p_input->'notes' <> 'null'::jsonb
    and (jsonb_typeof(p_input->'notes') <> 'string' or length(p_input->>'notes') > 500) then
    raise exception 'Invalid deposit notes.' using errcode = '22023';
  end if;
  if not exists (select 1 from public.jobs where id = p_job_id) then
    raise exception 'Job not found.' using errcode = 'P0002';
  end if;
  insert into public.deposits(job_id, amount, deposit_date, notes)
  values (p_job_id, (p_input->>'amount')::numeric, (p_input->>'deposit_date')::date, p_input->>'notes')
  returning * into v_deposit;
  insert into public.assistant_write_audit(actor_id, action, record_id, related_id)
  values (auth.uid(), 'deposit_recorded', v_deposit.id, p_job_id);
  return jsonb_build_object('ok', true, 'data', jsonb_build_object(
    'id', v_deposit.id, 'job_id', v_deposit.job_id, 'amount', v_deposit.amount,
    'deposit_date', v_deposit.deposit_date, 'notes', v_deposit.notes, 'created_at', v_deposit.created_at
  ));
end;
$$;

alter function public.assistant_create_school(jsonb) owner to postgres;
alter function public.assistant_create_job(jsonb) owner to postgres;
alter function public.assistant_create_group(uuid, jsonb) owner to postgres;
alter function public.assistant_update_group_routine(uuid, jsonb) owner to postgres;
alter function public.assistant_record_deposit(uuid, jsonb) owner to postgres;
revoke all on function public.assistant_create_school(jsonb) from public, anon, authenticated;
revoke all on function public.assistant_create_job(jsonb) from public, anon, authenticated;
revoke all on function public.assistant_create_group(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.assistant_update_group_routine(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.assistant_record_deposit(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.assistant_create_school(jsonb) to authenticated;
grant execute on function public.assistant_create_job(jsonb) to authenticated;
grant execute on function public.assistant_create_group(uuid, jsonb) to authenticated;
grant execute on function public.assistant_update_group_routine(uuid, jsonb) to authenticated;
grant execute on function public.assistant_record_deposit(uuid, jsonb) to authenticated;
grant update (student_count) on public.school_profiles to authenticated;

notify pgrst, 'reload schema';
commit;
