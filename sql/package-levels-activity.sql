-- Run AFTER staff-roles-rbac.sql. Existing packages keep their selection;
-- classify their school_level in the panel before sending new catalogues.
begin;
alter table public.packages add column if not exists school_level text
  check (school_level in ('KINDER', 'PRIMARY', 'SECONDARY'));

-- Validate selections on the server, including public token calls.
create or replace function public.validate_school_package(p_job uuid, p_package uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  event_kind text;
  level_code text;
  pkg public.packages;
begin
  select j.event_type, sp.school_level into event_kind, level_code
  from public.jobs j left join public.school_profiles sp on sp.client_id = j.client_id
  where j.id = p_job;
  select * into pkg from public.packages where id = p_package;
  if pkg.id is null or pkg.is_active is not true then
    raise exception 'El paquete no esta disponible.';
  end if;
  if pkg.package_type <> (case coalesce(event_kind, 'GRADUATION')
      when 'GRADUATION' then 'SCHOOL_GRADUATION'
      when 'CHRISTMAS' then 'SCHOOL_CHRISTMAS'
      when 'MEMORY' then 'SCHOOL_MEMORY' else 'PHOTO_SESSION' end) then
    raise exception 'El paquete no corresponde al tipo de trabajo.';
  end if;
  if pkg.package_type = 'SCHOOL_GRADUATION' and
      (level_code is null or pkg.school_level is null or pkg.school_level <> level_code) then
    raise exception 'El paquete no corresponde al nivel escolar. Clasifique el paquete y la escuela.';
  end if;
end $$;
revoke all on function public.validate_school_package(uuid, uuid) from public, anon, authenticated;

create or replace function public.check_print_package_level()
returns trigger language plpgsql security definer set search_path = '' as $$
declare chosen uuid; grp public.school_groups;
begin
  if tg_op = 'INSERT' and new.item_type = 'PHOTO_PACKAGE' and new.group_id is not null
      and new.selected_package_id is null then
    select * into grp from public.school_groups where id = new.group_id;
    if grp.selected_package_id is not null then
      new.selected_package_id := grp.selected_package_id;
      select im.id into new.selected_file_id from public.package_images im
        where im.package_id = grp.selected_package_id order by im.created_at desc, im.id limit 1;
      new.status := 'CATALOG_SELECTED';
      select 'Paquete seleccionado: ' || p.name into new.notes from public.packages p where p.id = grp.selected_package_id;
    end if;
  end if;
  if new.item_type = 'PHOTO_PACKAGE' and new.selected_file_id is not null then
    select package_id into chosen from public.package_images where id = new.selected_file_id;
    if chosen is null or chosen is distinct from new.selected_package_id then
      raise exception 'La imagen no corresponde al paquete seleccionado.';
    end if;
    perform public.validate_school_package(new.job_id, chosen);
  end if;
  return new;
end $$;
revoke all on function public.check_print_package_level() from public, anon, authenticated;
drop trigger if exists check_print_package_level on public.print_items;
create trigger check_print_package_level before insert or update of selected_file_id, selected_package_id
on public.print_items for each row execute function public.check_print_package_level();

-- Serialize financial changes by work so simultaneous group changes cannot lose totals.
create or replace function public.prepare_group_package()
returns trigger language plpgsql security definer set search_path = '' as $$
declare package_changed boolean;
begin
  if tg_op = 'DELETE' then
    perform 1 from public.jobs where id = old.job_id for update;
    return old;
  end if;
  perform 1 from public.jobs where id = new.job_id for update;
  if tg_op = 'INSERT' then
    package_changed := true;
  else
    package_changed := new.selected_package_id is distinct from old.selected_package_id
      or new.package_quantity is distinct from old.package_quantity;
  end if;
  if package_changed then
    if new.selected_package_id is null then
      new.price := 0;
      new.package_quantity := 0;
    else
      perform public.validate_school_package(new.job_id, new.selected_package_id);
      select p.price * new.package_quantity into new.price from public.packages p where p.id = new.selected_package_id;
    end if;
  end if;
  return new;
end $$;
revoke all on function public.prepare_group_package() from public, anon, authenticated;
drop trigger if exists prepare_group_package on public.school_groups;
create trigger prepare_group_package before insert or update or delete on public.school_groups
for each row execute function public.prepare_group_package();

create or replace function public.sync_group_package()
returns trigger language plpgsql security definer set search_path = '' as $$
declare target_job uuid;
begin
  if tg_op = 'DELETE' then target_job := old.job_id;
  else
    target_job := new.job_id;
    if tg_op = 'INSERT' or
      new.selected_package_id is distinct from old.selected_package_id or
      new.package_quantity is distinct from old.package_quantity then
      update public.print_items pi set
        selected_package_id = new.selected_package_id,
        selected_file_id = case when exists (
          select 1 from public.package_images im where im.id = pi.selected_file_id and im.package_id = new.selected_package_id
        ) then pi.selected_file_id else (
          select im.id from public.package_images im where im.package_id = new.selected_package_id order by im.created_at desc, im.id limit 1
        ) end,
        status = case when new.selected_package_id is null then 'PENDING' else 'CATALOG_SELECTED' end,
        notes = (select 'Paquete seleccionado: ' || p.name from public.packages p where p.id = new.selected_package_id)
      where pi.group_id = new.id and pi.item_type = 'PHOTO_PACKAGE';
    end if;
  end if;
  update public.jobs j set
    price = coalesce((select sum(g.price) from public.school_groups g where g.job_id = target_job), 0),
    package_quantity = coalesce((select sum(g.package_quantity) from public.school_groups g where g.job_id = target_job), 0)
  where j.id = target_job;
  return null;
end $$;
revoke all on function public.sync_group_package() from public, anon, authenticated;
drop trigger if exists sync_group_package on public.school_groups;
create trigger sync_group_package after insert or update or delete on public.school_groups
for each row execute function public.sync_group_package();

-- Audit data is append-only through triggers; even owners have read-only access.
create table if not exists public.job_activity (
  id bigint generated always as identity primary key,
  job_id uuid not null,
  entity_type text not null,
  entity_id uuid not null,
  operation text not null,
  actor_id uuid,
  actor_label text not null,
  before_data jsonb,
  after_data jsonb,
  created_at timestamptz not null default now()
);
create index if not exists job_activity_job_idx on public.job_activity(job_id, id desc);
alter table public.job_activity enable row level security;
revoke all on public.job_activity from public, anon, authenticated;
grant select on public.job_activity to authenticated;
drop policy if exists "owners read activity" on public.job_activity;
create policy "owners read activity" on public.job_activity for select to authenticated
using ((select public.has_staff_role(array['owner']::public.staff_role[])));

create or replace function public.record_job_activity()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  previous jsonb;
  following jsonb;
  row_data jsonb;
  actor text;
  target_job uuid;
begin
  if tg_op <> 'INSERT' then previous := to_jsonb(old); end if;
  if tg_op <> 'DELETE' then following := to_jsonb(new); end if;
  row_data := coalesce(following, previous);
  target_job := case when tg_table_name = 'jobs' then (row_data->>'id')::uuid else (row_data->>'job_id')::uuid end;
  -- Keep only meaningful changes; never record bearer tokens or file URLs.
  select jsonb_object_agg(key, value) into previous from jsonb_each(previous)
    where key = any(array['group_id','group_name','selected_package_id','package_quantity','price','amount','deposit_date','notes','status','title','selected_file_id']);
  select jsonb_object_agg(key, value) into following from jsonb_each(following)
    where key = any(array['group_id','group_name','selected_package_id','package_quantity','price','amount','deposit_date','notes','status','title','selected_file_id']);
  if previous is not distinct from following then return null; end if;
  if previous->>'selected_package_id' is not null then
    previous := previous || jsonb_build_object('package_name', (select p.name from public.packages p where p.id = (previous->>'selected_package_id')::uuid));
  end if;
  if following->>'selected_package_id' is not null then
    following := following || jsonb_build_object('package_name', (select p.name from public.packages p where p.id = (following->>'selected_package_id')::uuid));
  end if;
  if previous->>'group_id' is not null then
    previous := previous || jsonb_build_object('group_label', (select g.group_name from public.school_groups g where g.id = (previous->>'group_id')::uuid));
  end if;
  if following->>'group_id' is not null then
    following := following || jsonb_build_object('group_label', (select g.group_name from public.school_groups g where g.id = (following->>'group_id')::uuid));
  end if;
  select coalesce(nullif(sr.display_name, ''), u.email) into actor from auth.users u
    left join public.staff_roles sr on sr.user_id = u.id where u.id = auth.uid();
  insert into public.job_activity(job_id, entity_type, entity_id, operation, actor_id, actor_label, before_data, after_data)
    values(target_job, tg_table_name, (row_data->>'id')::uuid, tg_op, auth.uid(),
      coalesce(actor, 'Enlace publico / sistema'), previous, following);
  return null;
end $$;
revoke all on function public.record_job_activity() from public, anon, authenticated;
do $$
declare t text;
begin
  foreach t in array array['school_groups','deposits','jobs','print_items'] loop
    execute format('drop trigger if exists record_job_activity on public.%I', t);
    execute format('create trigger record_job_activity after insert or update or delete on public.%I for each row execute function public.record_job_activity()', t);
  end loop;
end $$;

create or replace function get_public_catalog_by_print_item_token(token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  item print_items;
  school_level_value text;
  event_type_value text;
  package_type_value text;
  result jsonb;
begin
  select *
  into item
  from print_items
  where approval_token = get_public_catalog_by_print_item_token.token
    and approval_revoked_at is null
    and (approval_token_expires_at is null or approval_token_expires_at > now());

  if item.id is null then
    return null;
  end if;

  select sp.school_level
  into school_level_value
  from jobs j
  join clients c on c.id = j.client_id
  left join school_profiles sp on sp.client_id = c.id
  where j.id = item.job_id
  limit 1;

  select j.event_type
  into event_type_value
  from jobs j
  where j.id = item.job_id
  limit 1;

  package_type_value := case event_type_value
    when 'GRADUATION' then 'SCHOOL_GRADUATION'
    when 'MEMORY' then 'SCHOOL_MEMORY'
    when 'CHRISTMAS' then 'SCHOOL_CHRISTMAS'
    else 'SCHOOL_GRADUATION'
  end;

  if item.item_type = 'DIPLOMA' then
    select jsonb_agg(jsonb_build_object(
      'id', dt.id,
      'name', dt.name,
      'file_name', dt.file_name,
      'school_level', dt.school_level,
      'table', 'diploma_templates'
    ) order by dt.created_at desc)
    into result
    from diploma_templates dt
    where dt.is_active = true
      and (
        dt.school_level = school_level_value
        or school_level_value is null
        or dt.school_level is null
      );

    return coalesce(result, '[]'::jsonb);
  end if;

  if item.item_type = 'FOLDER_OPTION' then
    select jsonb_agg(jsonb_build_object(
      'id', ft.id,
      'name', ft.name,
      'file_name', ft.file_name,
      'school_level', ft.school_level,
      'table', 'folder_templates'
    ) order by ft.created_at desc)
    into result
    from folder_templates ft
    where ft.is_active = true
      and (
        ft.school_level = school_level_value
        or school_level_value is null
        or ft.school_level is null
      );

    return coalesce(result, '[]'::jsonb);
  end if;

  if item.item_type = 'PHOTO_PACKAGE' then
    select jsonb_agg(jsonb_build_object(
      'id', pi.id,
      'package_id', p.id,
      'name', p.name,
      'description', p.description,
      'price', p.price,
      'file_name', pi.file_name,
      'table', 'package_images'
    ) order by p.price asc, p.name asc, pi.created_at desc)
    into result
    from package_images pi
    join packages p on p.id = pi.package_id
    where p.is_active = true
      and p.package_type = package_type_value
      and (p.package_type <> 'SCHOOL_GRADUATION' or p.school_level = school_level_value);

    return coalesce(result, '[]'::jsonb);
  end if;

  return '[]'::jsonb;
end;
$$;


create or replace function select_catalog_option_by_token(token text, option_table text, option_id uuid, client_notes text default null, package_quantity integer default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  item print_items;
  selected_package uuid;
  selected_name text;
  package_price numeric(12,2);
  quantity integer;
begin
  select *
  into item
  from print_items
  where approval_token = select_catalog_option_by_token.token
    and approval_revoked_at is null
    and (approval_token_expires_at is null or approval_token_expires_at > now());

  if item.id is null then
    return jsonb_build_object('ok', false, 'message', 'El link no existe o expiró.');
  end if;

  if option_table = 'diploma_templates' and item.item_type = 'DIPLOMA' then
    select name into selected_name from diploma_templates where id = option_id and is_active = true;
    if selected_name is null then
      return jsonb_build_object('ok', false, 'message', 'El diploma seleccionado no está disponible.');
    end if;

    update print_items
    set selected_file_id = option_id,
        status = 'CATALOG_SELECTED',
        client_notes = nullif(trim(select_catalog_option_by_token.client_notes), ''),
        changes_requested_at = now(),
        notes = 'Diploma de catálogo seleccionado: ' || selected_name
    where id = item.id;

    update jobs
    set status = 'EDITING'
    where id = item.job_id;

    return jsonb_build_object('ok', true, 'selected_name', selected_name);
  end if;

  if option_table = 'folder_templates' and item.item_type = 'FOLDER_OPTION' then
    select name into selected_name from folder_templates where id = option_id and is_active = true;
    if selected_name is null then
      return jsonb_build_object('ok', false, 'message', 'La carpeta seleccionada no está disponible.');
    end if;

    update print_items
    set selected_file_id = option_id,
        status = 'CATALOG_SELECTED',
        client_notes = nullif(trim(select_catalog_option_by_token.client_notes), ''),
        changes_requested_at = now(),
        notes = 'Carpeta de catálogo seleccionada: ' || selected_name
    where id = item.id;

    update jobs
    set status = 'EDITING'
    where id = item.job_id;

    return jsonb_build_object('ok', true, 'selected_name', selected_name);
  end if;

  if option_table = 'package_images' and item.item_type = 'PHOTO_PACKAGE' then
    quantity := coalesce(select_catalog_option_by_token.package_quantity, 0);
    if quantity < 1 then
      return jsonb_build_object('ok', false, 'message', 'Indique cuántos paquetes necesita.');
    end if;

    select pi.package_id, p.name, p.price
    into selected_package, selected_name, package_price
    from package_images pi
    join packages p on p.id = pi.package_id
    where pi.id = option_id and p.is_active = true;

    if selected_package is null then
      return jsonb_build_object('ok', false, 'message', 'El paquete seleccionado no está disponible.');
    end if;

    -- Lock in the same order as administrative group changes.
    if item.group_id is not null then
      perform 1 from school_groups where id = item.group_id for update;
    end if;
    perform 1 from jobs where id = item.job_id for update;

    update print_items
    set selected_file_id = option_id,
        selected_package_id = selected_package,
        status = 'CATALOG_SELECTED',
        client_notes = nullif(trim(select_catalog_option_by_token.client_notes), ''),
        changes_requested_at = now(),
        notes = 'Paquete seleccionado: ' || selected_name
    where id = item.id;

    if item.group_id is not null then
      update school_groups
      set selected_package_id = selected_package,
          package_quantity = quantity,
          price = package_price * quantity
      where id = item.group_id;

      -- The group trigger synchronizes the work total in this transaction.
    else
      update jobs
      set package_id = selected_package,
          package_quantity = quantity,
          price = package_price * quantity
      where id = item.job_id;
    end if;

    return jsonb_build_object('ok', true, 'selected_name', selected_name, 'package_quantity', quantity, 'price', package_price * quantity);
  end if;

  return jsonb_build_object('ok', false, 'message', 'La selección no corresponde a esta pieza.');
end;
$$;

grant execute on function get_public_catalog_by_print_item_token(text) to anon, authenticated;
grant execute on function select_catalog_option_by_token(text, text, uuid, text, integer) to anon, authenticated;

commit;
