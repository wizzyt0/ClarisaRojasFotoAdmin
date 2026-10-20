-- One bearer link presents both school catalogs and records each choice on its own print item.
begin;

create or replace function public.get_public_school_catalog_by_print_item_token(token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  source_item public.print_items;
  school_level_value text;
  diploma_options jsonb;
  folder_options jsonb;
  diploma_selected uuid;
  folder_selected uuid;
begin
  select * into source_item
  from public.print_items pi
  where pi.approval_token = get_public_school_catalog_by_print_item_token.token
    and pi.item_type in ('DIPLOMA', 'FOLDER_OPTION')
    and pi.approval_revoked_at is null
    and (pi.approval_token_expires_at is null or pi.approval_token_expires_at > now());

  if source_item.id is null or source_item.group_id is null then
    return null;
  end if;
  if source_item.approved_at is not null or source_item.status in ('APPROVED_FOR_PRINT','PRINTING','PRINTED','DELIVERED') then
    return null;
  end if;

  select sp.school_level into school_level_value
  from public.jobs j
  join public.clients c on c.id = j.client_id
  left join public.school_profiles sp on sp.client_id = c.id
  where j.id = source_item.job_id
  limit 1;

  select pi.selected_file_id into diploma_selected
  from public.print_items pi
  where pi.group_id = source_item.group_id and pi.item_type = 'DIPLOMA'
  limit 1;
  select pi.selected_file_id into folder_selected
  from public.print_items pi
  where pi.group_id = source_item.group_id and pi.item_type = 'FOLDER_OPTION'
  limit 1;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', dt.id, 'name', dt.name, 'file_name', dt.file_name,
    'school_level', dt.school_level, 'table', 'diploma_templates'
  ) order by dt.created_at desc), '[]'::jsonb)
  into diploma_options
  from public.diploma_templates dt
  where dt.is_active is true
    and school_level_value is not null
    and dt.school_level = school_level_value;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', ft.id, 'name', ft.name, 'file_name', ft.file_name,
    'school_level', ft.school_level, 'table', 'folder_templates'
  ) order by ft.created_at desc), '[]'::jsonb)
  into folder_options
  from public.folder_templates ft
  where ft.is_active is true
    and school_level_value is not null
    and ft.school_level = school_level_value;

  return jsonb_build_object(
    'group_id', source_item.group_id,
    'school_level', school_level_value,
    'diploma_options', diploma_options,
    'folder_options', folder_options,
    'diploma_selected_id', diploma_selected,
    'folder_selected_id', folder_selected
  );
end;
$$;

create or replace function public.select_school_catalog_option_by_token(
  token text,
  catalog_kind text,
  option_id uuid,
  client_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  source_item public.print_items;
  target_item public.print_items;
  school_level_value text;
  selected_name text;
  target_type text;
begin
  if catalog_kind is null or catalog_kind not in ('DIPLOMA', 'FOLDER') then
    return jsonb_build_object('ok', false, 'message', 'Tipo de catálogo no válido.');
  end if;
  select * into source_item
  from public.print_items pi
  where pi.approval_token = select_school_catalog_option_by_token.token
    and pi.item_type in ('DIPLOMA', 'FOLDER_OPTION')
    and pi.approval_revoked_at is null
    and (pi.approval_token_expires_at is null or pi.approval_token_expires_at > now())
  for update;
  if source_item.id is null or source_item.group_id is null then
    return jsonb_build_object('ok', false, 'message', 'El enlace no existe, expiró o no corresponde a un grupo.');
  end if;
  if source_item.approved_at is not null or source_item.status in ('APPROVED_FOR_PRINT','PRINTING','PRINTED','DELIVERED') then
    return jsonb_build_object('ok', false, 'message', 'Este grupo ya no acepta selecciones de catálogo.');
  end if;

  target_type := case catalog_kind when 'DIPLOMA' then 'DIPLOMA' else 'FOLDER_OPTION' end;
  select * into target_item from public.print_items pi
  where pi.group_id = source_item.group_id and pi.item_type = target_type
  for update;
  if target_item.id is null or target_item.approved_at is not null
      or target_item.status in ('APPROVED_FOR_PRINT','PRINTING','PRINTED','DELIVERED') then
    return jsonb_build_object('ok', false, 'message', 'La pieza ya no está disponible para selección.');
  end if;
  if target_item.selected_file_id is not null then
    return jsonb_build_object('ok', false, 'message', 'Esta selección ya quedó registrada. El enlace es solo informativo; para solicitar un cambio, comuníquese con Clarisa Rojas.');
  end if;
  select sp.school_level into school_level_value
  from public.jobs j join public.clients c on c.id = j.client_id
  left join public.school_profiles sp on sp.client_id = c.id
  where j.id = source_item.job_id limit 1;

  if catalog_kind = 'DIPLOMA' then
    select dt.name into selected_name from public.diploma_templates dt
    where dt.id = option_id and dt.is_active is true
      and school_level_value is not null
      and dt.school_level = school_level_value;
  else
    select ft.name into selected_name from public.folder_templates ft
    where ft.id = option_id and ft.is_active is true
      and school_level_value is not null
      and ft.school_level = school_level_value;
  end if;
  if selected_name is null then
    return jsonb_build_object('ok', false, 'message', 'La opción no está disponible para el nivel escolar de este grupo.');
  end if;

  update public.print_items
  set selected_file_id = option_id,
      status = 'CATALOG_SELECTED',
      client_notes = nullif(trim(select_school_catalog_option_by_token.client_notes), ''),
      changes_requested_at = now(),
      notes = case catalog_kind
        when 'DIPLOMA' then 'Diploma de catálogo seleccionado: ' || selected_name
        else 'Carpeta de catálogo seleccionada: ' || selected_name
      end
  where id = target_item.id;
  update public.jobs set status = 'EDITING' where id = source_item.job_id;
  return jsonb_build_object('ok', true, 'catalog_kind', catalog_kind, 'selected_name', selected_name);
end;
$$;

revoke all on function public.get_public_school_catalog_by_print_item_token(text) from public;
grant execute on function public.get_public_school_catalog_by_print_item_token(text) to anon, authenticated;
revoke all on function public.select_school_catalog_option_by_token(text, text, uuid, text) from public;
grant execute on function public.select_school_catalog_option_by_token(text, text, uuid, text) to anon, authenticated;

commit;
