create table if not exists package_images (
  id uuid primary key default gen_random_uuid(),
  package_id uuid not null references packages(id) on delete cascade,
  r2_key text not null,
  file_name text not null,
  content_type text,
  size_bytes bigint,
  created_at timestamptz default now()
);

alter table jobs drop constraint if exists jobs_package_quantity_check;
alter table jobs add constraint jobs_package_quantity_check check (package_quantity >= 0);

create table if not exists diploma_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  r2_key text not null,
  file_name text not null,
  content_type text,
  size_bytes bigint,
  school_level text check (school_level in ('KINDER','PRIMARY','SECONDARY')),
  is_active boolean default true,
  created_at timestamptz default now()
);

alter table diploma_templates add column if not exists school_level text check (school_level in ('KINDER','PRIMARY','SECONDARY'));

create index if not exists package_images_package_id_idx on package_images(package_id);
create index if not exists diploma_templates_is_active_idx on diploma_templates(is_active);
create index if not exists diploma_templates_school_level_idx on diploma_templates(school_level);

alter table package_images enable row level security;
alter table diploma_templates enable row level security;

drop policy if exists "admin read package_images" on package_images;
drop policy if exists "admin write package_images" on package_images;
drop policy if exists "admin read diploma_templates" on diploma_templates;
drop policy if exists "admin write diploma_templates" on diploma_templates;

create policy "admin read package_images" on package_images for select to authenticated using (true);
create policy "admin write package_images" on package_images for all to authenticated using (true) with check (true);
create policy "admin read diploma_templates" on diploma_templates for select to authenticated using (true);
create policy "admin write diploma_templates" on diploma_templates for all to authenticated using (true) with check (true);

drop function if exists get_public_catalog_by_print_item_token(text);
drop function if exists select_catalog_option_by_token(text, text, uuid, text);
drop function if exists select_catalog_option_by_token(text, text, uuid, text, integer);

create or replace function get_public_catalog_by_print_item_token(token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  item print_items;
  school_level_value text;
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
      and p.package_type in ('SCHOOL_GRADUATION','GENERAL');

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

      update jobs
      set price = coalesce((select sum(price) from school_groups where job_id = item.job_id), 0),
          package_quantity = coalesce((select sum(package_quantity) from school_groups where job_id = item.job_id), 0)
      where id = item.job_id;
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
