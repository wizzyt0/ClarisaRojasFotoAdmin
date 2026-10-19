-- Reusable named school package offers with independently illustrated photo formats.
-- Run once in Supabase SQL Editor. Existing selections and package IDs remain intact.
begin;

create table if not exists public.package_offers (
  id uuid primary key default gen_random_uuid(),
  offer_code text not null,
  name text not null,
  package_type text not null check (package_type in ('SCHOOL_GRADUATION', 'SCHOOL_MEMORY')),
  school_level text check (school_level in ('KINDER', 'PRIMARY', 'SECONDARY')),
  price numeric(12,2) not null default 0 check (price >= 0),
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((package_type = 'SCHOOL_GRADUATION' and school_level is not null) or package_type = 'SCHOOL_MEMORY')
);

alter table public.packages add column if not exists package_offer_id uuid;
do $$ begin
  alter table public.packages add constraint packages_package_offer_id_fkey
    foreign key (package_offer_id) references public.package_offers(id) on delete set null;
exception when duplicate_object then null;
end $$;
create index if not exists packages_package_offer_id_idx on public.packages(package_offer_id);
create unique index if not exists package_offers_identity_idx
  on public.package_offers(package_type, coalesce(school_level, ''), offer_code);

-- Group only complete legacy pairs whose two formats share the same price.
with eligible as (
  select package_type, school_level, package_tier,
         min(price) as price
  from public.packages
  where package_type in ('SCHOOL_GRADUATION', 'SCHOOL_MEMORY')
    and package_tier in ('SMALL', 'LARGE')
    and photo_presentation in ('BASTIDOR', 'GROUP_INDIVIDUAL')
  group by package_type, school_level, package_tier
  having count(*) = 2 and count(distinct photo_presentation) = 2 and min(price) = max(price)
), inserted as (
  insert into public.package_offers(offer_code, name, package_type, school_level, price, sort_order)
  select concat(package_tier, '-', coalesce(school_level, 'ALL')),
         case package_tier when 'SMALL' then 'Paquete 1' else 'Paquete 2' end,
         package_type, school_level, price,
         case package_tier when 'SMALL' then 1 else 2 end
  from eligible
  on conflict do nothing
  returning id
)
select 1 from inserted;

with eligible as (
  select package_type, school_level, package_tier, min(price) as price
  from public.packages
  where package_type in ('SCHOOL_GRADUATION', 'SCHOOL_MEMORY')
    and package_tier in ('SMALL', 'LARGE')
    and photo_presentation in ('BASTIDOR', 'GROUP_INDIVIDUAL')
  group by package_type, school_level, package_tier
  having count(*) = 2 and count(distinct photo_presentation) = 2 and min(price) = max(price)
)
update public.package_offers o set price = e.price
from eligible e
where o.package_type = e.package_type
  and coalesce(o.school_level, '') = coalesce(e.school_level, '')
  and o.offer_code = concat(e.package_tier, '-', coalesce(e.school_level, 'ALL'));

with eligible as (
  select package_type, school_level, package_tier
  from public.packages
  where package_type in ('SCHOOL_GRADUATION', 'SCHOOL_MEMORY')
    and package_tier in ('SMALL', 'LARGE')
    and photo_presentation in ('BASTIDOR', 'GROUP_INDIVIDUAL')
  group by package_type, school_level, package_tier
  having count(*) = 2 and count(distinct photo_presentation) = 2 and min(price) = max(price)
)
update public.packages p set package_offer_id = o.id
from eligible e
join public.package_offers o
  on o.package_type = e.package_type
  and coalesce(o.school_level, '') = coalesce(e.school_level, '')
  and o.offer_code = concat(e.package_tier, '-', coalesce(e.school_level, 'ALL'))
where p.package_type = e.package_type
  and coalesce(p.school_level, '') = coalesce(e.school_level, '')
  and p.package_tier = e.package_tier
  and p.photo_presentation in ('BASTIDOR', 'GROUP_INDIVIDUAL');

alter table public.package_offers enable row level security;
revoke all on public.package_offers from public, anon;
grant select, insert, update, delete on public.package_offers to authenticated;
drop policy if exists "owners manage package offers" on public.package_offers;
create policy "owners manage package offers" on public.package_offers for all to authenticated
  using ((select public.has_staff_role(array['owner']::public.staff_role[])))
  with check ((select public.has_staff_role(array['owner']::public.staff_role[])));

create or replace function public.sync_package_offer_variants()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update public.packages p set
    price = new.price,
    is_active = new.is_active,
    name = new.name || case p.photo_presentation
      when 'BASTIDOR' then ' - Foto individual'
      else ' - Foto grupal' end
  where p.package_offer_id = new.id;
  return new;
end;
$$;
revoke all on function public.sync_package_offer_variants() from public, anon, authenticated;
drop trigger if exists sync_package_offer_variants on public.package_offers;
create trigger sync_package_offer_variants after update of name, price, is_active
on public.package_offers for each row execute function public.sync_package_offer_variants();

create or replace function public.create_package_offer(
  offer_name text, package_type text, school_level text, offer_price numeric, offer_active boolean default true
) returns uuid language plpgsql security definer set search_path = '' as $$
declare offer_id uuid;
begin
  if not (select public.has_staff_role(array['owner']::public.staff_role[])) then
    raise exception 'Solo una administradora puede crear paquetes.';
  end if;
  if nullif(btrim(offer_name), '') is null or offer_price < 0
     or package_type not in ('SCHOOL_GRADUATION', 'SCHOOL_MEMORY')
     or (package_type = 'SCHOOL_GRADUATION' and school_level not in ('KINDER', 'PRIMARY', 'SECONDARY'))
     or (package_type = 'SCHOOL_MEMORY' and school_level is not null) then
    raise exception 'Los datos del paquete no son válidos.';
  end if;
  insert into public.package_offers(offer_code, name, package_type, school_level, price, is_active)
  values(gen_random_uuid()::text, btrim(offer_name), package_type, school_level, offer_price, offer_active)
  returning id into offer_id;
  insert into public.packages(package_offer_id, name, package_type, school_level, price, is_active, package_tier, photo_presentation, description)
  values
    (offer_id, btrim(offer_name) || ' - Foto individual', package_type, school_level, offer_price, offer_active, null, 'BASTIDOR', null),
    (offer_id, btrim(offer_name) || ' - Foto grupal', package_type, school_level, offer_price, offer_active, null, 'GROUP_INDIVIDUAL', null);
  return offer_id;
end;
$$;
revoke all on function public.create_package_offer(text, text, text, numeric, boolean) from public, anon;
grant execute on function public.create_package_offer(text, text, text, numeric, boolean) to authenticated;

create or replace function public.get_public_school_package_options_by_token(token text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  item public.print_items;
  event_kind text;
  level_code text;
  result jsonb;
begin
  select * into item from public.print_items pi
  where pi.approval_token = get_public_school_package_options_by_token.token
    and pi.approval_revoked_at is null
    and (pi.approval_token_expires_at is null or pi.approval_token_expires_at > now());
  if item.id is null or item.item_type <> 'PHOTO_PACKAGE' or item.group_id is null then return '[]'::jsonb; end if;

  select j.event_type, sp.school_level into event_kind, level_code
  from public.jobs j left join public.school_profiles sp on sp.client_id = j.client_id
  where j.id = item.job_id;

  select jsonb_agg(jsonb_build_object(
    'id', pi.id, 'package_id', p.id, 'name', p.name,
    'description', p.description, 'price', p.price,
    'file_name', pi.file_name, 'table', 'package_images',
    'offer_id', po.id,
    'offer_name', coalesce(po.name, case p.package_tier when 'SMALL' then 'Paquete 1' when 'LARGE' then 'Paquete 2' end),
    'offer_price', coalesce(po.price, p.price),
    'offer_sort_order', coalesce(po.sort_order, case p.package_tier when 'SMALL' then 1 when 'LARGE' then 2 else 999 end),
    'package_tier', p.package_tier,
    'photo_presentation', p.photo_presentation
  ) order by coalesce(po.sort_order, case p.package_tier when 'SMALL' then 1 when 'LARGE' then 2 else 999 end), p.photo_presentation, pi.created_at desc)
  into result
  from public.package_images pi
  join public.packages p on p.id = pi.package_id
  left join public.package_offers po on po.id = p.package_offer_id and po.is_active is true
  where p.is_active is true
    and p.package_type = case coalesce(event_kind, 'GRADUATION')
      when 'GRADUATION' then 'SCHOOL_GRADUATION'
      when 'CHRISTMAS' then 'SCHOOL_CHRISTMAS'
      when 'MEMORY' then 'SCHOOL_MEMORY'
      else 'PHOTO_SESSION' end
    and (p.package_type <> 'SCHOOL_GRADUATION' or p.school_level = level_code)
    and (p.package_offer_id is null or po.id is not null);
  return coalesce(result, '[]'::jsonb);
end;
$$;
revoke all on function public.get_public_school_package_options_by_token(text) from public;
grant execute on function public.get_public_school_package_options_by_token(text) to anon, authenticated;

commit;
