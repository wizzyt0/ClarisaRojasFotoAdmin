-- Run after package-levels-activity.sql. The photo format is a per-group choice;
-- package prices and catalog images remain unchanged.
begin;

alter table public.school_groups
  add column if not exists photo_format text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.school_groups'::regclass
      and conname = 'school_groups_photo_format_check'
  ) then
    alter table public.school_groups
      add constraint school_groups_photo_format_check
      check (photo_format in ('GROUP', 'INDIVIDUAL'));
  end if;
end;
$$;

create or replace function public.require_group_photo_format()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.selected_package_id is not null and new.photo_format is null then
    raise exception 'Seleccione foto grupal o individual para el paquete.';
  end if;
  return new;
end;
$$;

revoke all on function public.require_group_photo_format() from public, anon, authenticated;
drop trigger if exists school_group_package_format_on_insert on public.school_groups;
drop trigger if exists school_group_package_format_on_update on public.school_groups;
create trigger school_group_package_format_on_insert
  before insert on public.school_groups
  for each row execute function public.require_group_photo_format();
create trigger school_group_package_format_on_update
  before update of selected_package_id, photo_format on public.school_groups
  for each row execute function public.require_group_photo_format();

create or replace function public.select_package_option_by_token(
  token text,
  option_id uuid,
  client_notes text,
  package_quantity integer,
  photo_format text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  item public.print_items;
  selected_package uuid;
  selected_name text;
  package_price numeric(12,2);
  photo_label text;
begin
  select * into item
  from public.print_items
  where approval_token = select_package_option_by_token.token
    and approval_revoked_at is null
    and (approval_token_expires_at is null or approval_token_expires_at > now());

  if item.id is null then
    return jsonb_build_object('ok', false, 'message', 'El link no existe o expiró.');
  end if;
  if item.approved_at is not null or item.status in ('APPROVED_FOR_PRINT', 'PRINTING', 'PRINTED', 'DELIVERED') then
    return jsonb_build_object('ok', false, 'message', 'Esta pieza ya fue autorizada y no puede cambiarse desde este catálogo.');
  end if;
  if item.item_type <> 'PHOTO_PACKAGE' then
    return jsonb_build_object('ok', false, 'message', 'Este link no corresponde al catálogo de paquetes.');
  end if;
  if item.group_id is null then
    return jsonb_build_object('ok', false, 'message', 'Este catálogo no está asociado a un grupo. Solicite ayuda a Clarisa.');
  end if;
  if select_package_option_by_token.photo_format is null
      or select_package_option_by_token.photo_format not in ('GROUP', 'INDIVIDUAL') then
    return jsonb_build_object('ok', false, 'message', 'Seleccione foto grupal o individual.');
  end if;
  if select_package_option_by_token.package_quantity is null
      or select_package_option_by_token.package_quantity < 1
      or select_package_option_by_token.package_quantity > 99 then
    return jsonb_build_object('ok', false, 'message', 'La cantidad debe estar entre 1 y 99.');
  end if;

  select pi.package_id, p.name, p.price
  into selected_package, selected_name, package_price
  from public.package_images pi
  join public.packages p on p.id = pi.package_id
  where pi.id = select_package_option_by_token.option_id and p.is_active is true;
  if selected_package is null then
    return jsonb_build_object('ok', false, 'message', 'El paquete seleccionado no está disponible.');
  end if;
  perform public.validate_school_package(item.job_id, selected_package);

  -- Match the lock order used by the existing package selection and group triggers.
  perform 1 from public.school_groups where id = item.group_id for update;
  perform 1 from public.jobs where id = item.job_id for update;
  perform 1 from public.print_items where id = item.id for update;

  photo_label := case select_package_option_by_token.photo_format
    when 'GROUP' then 'Foto grupal'
    else 'Foto individual'
  end;

  update public.print_items
  set selected_file_id = select_package_option_by_token.option_id,
      selected_package_id = selected_package,
      status = 'CATALOG_SELECTED',
      client_notes = nullif(trim(select_package_option_by_token.client_notes), ''),
      changes_requested_at = now(),
      notes = 'Paquete seleccionado: ' || selected_name || ' · ' || photo_label
  where id = item.id;

  update public.school_groups
  set selected_package_id = selected_package,
      photo_format = select_package_option_by_token.photo_format,
      package_quantity = select_package_option_by_token.package_quantity,
      price = package_price * select_package_option_by_token.package_quantity
  where id = item.group_id;

  return jsonb_build_object(
    'ok', true,
    'selected_name', selected_name,
    'photo_format', select_package_option_by_token.photo_format,
    'package_quantity', select_package_option_by_token.package_quantity,
    'price', package_price * select_package_option_by_token.package_quantity
  );
end;
$$;

revoke all on function public.select_package_option_by_token(text, uuid, text, integer, text) from public;
grant execute on function public.select_package_option_by_token(text, uuid, text, integer, text)
  to anon, authenticated;

create or replace function public.sync_group_photo_format_to_print_item()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.print_items pi
  set notes = 'Paquete seleccionado: ' || p.name || case new.photo_format
    when 'GROUP' then ' · Foto grupal'
    when 'INDIVIDUAL' then ' · Foto individual'
    else ''
  end
  from public.packages p
  where pi.group_id = new.id
    and pi.item_type = 'PHOTO_PACKAGE'
    and pi.selected_package_id = p.id
    and new.selected_package_id = p.id;
  return null;
end;
$$;

revoke all on function public.sync_group_photo_format_to_print_item() from public, anon, authenticated;
drop trigger if exists school_group_photo_format_sync on public.school_groups;
create trigger school_group_photo_format_sync
  after update of photo_format on public.school_groups
  for each row execute function public.sync_group_photo_format_to_print_item();

create or replace function public.record_group_photo_format_activity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor text;
  before_value jsonb;
  after_value jsonb;
begin
  if tg_op = 'UPDATE' and new.photo_format is not distinct from old.photo_format then
    return null;
  end if;
  if tg_op = 'INSERT' and new.photo_format is null then
    return null;
  end if;

  if tg_op = 'UPDATE' then
    before_value := jsonb_build_object(
      'photo_format', old.photo_format,
      'package_name', (select p.name from public.packages p where p.id = old.selected_package_id),
      'package_quantity', old.package_quantity,
      'price', old.price
    );
  end if;
  after_value := jsonb_build_object(
    'photo_format', new.photo_format,
    'package_name', (select p.name from public.packages p where p.id = new.selected_package_id),
    'package_quantity', new.package_quantity,
    'price', new.price
  );
  select coalesce(nullif(sr.display_name, ''), u.email) into actor
  from auth.users u left join public.staff_roles sr on sr.user_id = u.id
  where u.id = auth.uid();
  insert into public.job_activity(job_id, entity_type, entity_id, operation, actor_id, actor_label, before_data, after_data)
  values (new.job_id, 'school_groups', new.id, tg_op, auth.uid(),
    coalesce(actor, 'Enlace público / sistema'), before_value, after_value);
  return null;
end;
$$;

revoke all on function public.record_group_photo_format_activity() from public, anon, authenticated;
drop trigger if exists school_group_photo_format_insert_activity on public.school_groups;
drop trigger if exists school_group_photo_format_update_activity on public.school_groups;
create trigger school_group_photo_format_insert_activity
  after insert on public.school_groups
  for each row execute function public.record_group_photo_format_activity();
create trigger school_group_photo_format_update_activity
  after update of photo_format on public.school_groups
  for each row execute function public.record_group_photo_format_activity();

commit;
