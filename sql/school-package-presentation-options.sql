-- Classify the four school photo-package records into two prices and two
-- presentations. Run once in Supabase SQL Editor before deploying the frontend.
begin;

alter table public.packages
  add column if not exists package_tier text,
  add column if not exists photo_presentation text;

alter table public.packages drop constraint if exists packages_package_tier_check;
alter table public.packages add constraint packages_package_tier_check
  check (package_tier is null or package_tier in ('SMALL', 'LARGE'));

alter table public.packages drop constraint if exists packages_photo_presentation_check;
alter table public.packages add constraint packages_photo_presentation_check
  check (photo_presentation is null or photo_presentation in ('BASTIDOR', 'GROUP_INDIVIDUAL'));

create or replace function public.get_public_school_package_options_by_token(token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  item public.print_items;
  event_kind text;
  level_code text;
  result jsonb;
begin
  select * into item
  from public.print_items pi
  where pi.approval_token = get_public_school_package_options_by_token.token
    and pi.approval_revoked_at is null
    and (pi.approval_token_expires_at is null or pi.approval_token_expires_at > now());

  if item.id is null or item.item_type <> 'PHOTO_PACKAGE' or item.group_id is null then
    return '[]'::jsonb;
  end if;

  select j.event_type, sp.school_level into event_kind, level_code
  from public.jobs j
  left join public.school_profiles sp on sp.client_id = j.client_id
  where j.id = item.job_id;

  select jsonb_agg(jsonb_build_object(
    'id', pi.id,
    'package_id', p.id,
    'name', p.name,
    'description', p.description,
    'price', p.price,
    'file_name', pi.file_name,
    'table', 'package_images',
    'package_tier', p.package_tier,
    'photo_presentation', p.photo_presentation
  ) order by p.package_tier, p.photo_presentation, pi.created_at desc)
  into result
  from public.package_images pi
  join public.packages p on p.id = pi.package_id
  where p.is_active is true
    and p.package_type = case coalesce(event_kind, 'GRADUATION')
      when 'GRADUATION' then 'SCHOOL_GRADUATION'
      when 'CHRISTMAS' then 'SCHOOL_CHRISTMAS'
      when 'MEMORY' then 'SCHOOL_MEMORY'
      else 'PHOTO_SESSION'
    end
    and (p.package_type <> 'SCHOOL_GRADUATION' or p.school_level = level_code);

  return coalesce(result, '[]'::jsonb);
end;
$$;

revoke all on function public.get_public_school_package_options_by_token(text) from public;
grant execute on function public.get_public_school_package_options_by_token(text) to anon, authenticated;

commit;
