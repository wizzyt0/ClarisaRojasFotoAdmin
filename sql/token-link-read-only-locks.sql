-- Run after staff-roles-rbac.sql and print-items-workflow.sql.
-- Public teacher links remain readable while all public mutations are one-way.
begin;

-- Expire existing links eight months after this migration when no expiry was
-- configured previously. Keep explicit expiry dates and revoked links intact.
alter table public.jobs
  alter column approval_token_expires_at set default (now() + interval '8 months');
update public.jobs
set approval_token_expires_at = now() + interval '8 months'
where approval_token is not null
  and approval_revoked_at is null
  and approval_token_expires_at is null;

alter table public.print_items
  alter column approval_token_expires_at set default (now() + interval '8 months');
update public.print_items
set approval_token_expires_at = now() + interval '8 months'
where approval_token is not null
  and approval_revoked_at is null
  and approval_token_expires_at is null;

create or replace function public.guard_public_print_item_transition()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.role() = 'service_role'
      or (select public.has_staff_role(array['owner']::public.staff_role[])) then
    return new;
  end if;

  -- A catalog choice can be recorded once, before the design is sent for approval.
  if old.selected_file_id is null
      and new.selected_file_id is not null
      and new.status = 'CATALOG_SELECTED'
      and old.approved_at is null
      and old.status in ('PENDING', 'READY_FOR_REVIEW', 'CHANGES_REQUESTED', 'SENT_FOR_APPROVAL')
      and (to_jsonb(new) - array['selected_file_id','selected_package_id','status','client_notes','changes_requested_at','notes','updated_at'])
        = (to_jsonb(old) - array['selected_file_id','selected_package_id','status','client_notes','changes_requested_at','notes','updated_at']) then
    return new;
  end if;

  -- Only an item currently awaiting the teacher can be approved.
  if old.status = 'SENT_FOR_APPROVAL'
      and old.approved_at is null
      and new.status = 'APPROVED_FOR_PRINT'
      and new.approved_at is not null
      and new.selected_file_id is not distinct from old.selected_file_id
      and new.selected_package_id is not distinct from old.selected_package_id
      and (to_jsonb(new) - array['approved_at','approved_by_name','terms_accepted','status','client_notes','changes_requested_at','updated_at'])
        = (to_jsonb(old) - array['approved_at','approved_by_name','terms_accepted','status','client_notes','changes_requested_at','updated_at']) then
    return new;
  end if;

  -- Internal synchronization triggers may write the same saved selection twice
  -- in one transaction. Allow only metadata changes in that exact same state.
  if old.selected_file_id is not null
      and new.selected_file_id is not distinct from old.selected_file_id
      and new.selected_package_id is not distinct from old.selected_package_id
      and new.status = old.status
      and new.approved_at is not distinct from old.approved_at
      and (to_jsonb(new) - array['notes','client_notes','changes_requested_at','updated_at'])
        = (to_jsonb(old) - array['notes','client_notes','changes_requested_at','updated_at']) then
    return new;
  end if;

  -- A correction request is accepted only before approval and does not alter the choice.
  if old.status = 'SENT_FOR_APPROVAL'
      and old.approved_at is null
      and new.status = 'CHANGES_REQUESTED'
      and new.changes_requested_at is not null
      and new.selected_file_id is not distinct from old.selected_file_id
      and new.selected_package_id is not distinct from old.selected_package_id
      and (to_jsonb(new) - array['approved_by_name','client_notes','changes_requested_at','status','updated_at'])
        = (to_jsonb(old) - array['approved_by_name','client_notes','changes_requested_at','status','updated_at']) then
    return new;
  end if;

  raise exception 'Este enlace es solo informativo. La selección o aprobación ya no se puede modificar desde aquí.';
end;
$$;

revoke all on function public.guard_public_print_item_transition() from public, anon, authenticated;
drop trigger if exists guard_public_print_item_transition on public.print_items;
create trigger guard_public_print_item_transition
  before update on public.print_items
  for each row execute function public.guard_public_print_item_transition();

create or replace function public.guard_public_group_package_selection()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.role() = 'service_role'
      or (select public.has_staff_role(array['owner']::public.staff_role[])) then
    return new;
  end if;

  if old.selected_package_id is not null
      or old.photo_format is not null
      or old.package_quantity > 0 then
    raise exception 'El paquete del grupo ya fue seleccionado. Este enlace es solo informativo; para solicitar un cambio, comuníquese con Clarisa Rojas.';
  end if;

  if new.selected_package_id is null
      or new.photo_format not in ('GROUP', 'INDIVIDUAL')
      or new.package_quantity < 1
      or new.package_quantity > 99
      or (to_jsonb(new) - array['selected_package_id','photo_format','package_quantity','price','updated_at'])
        <> (to_jsonb(old) - array['selected_package_id','photo_format','package_quantity','price','updated_at']) then
    raise exception 'La selección del paquete está incompleta o no es válida.';
  end if;

  return new;
end;
$$;

revoke all on function public.guard_public_group_package_selection() from public, anon, authenticated;
drop trigger if exists guard_public_group_package_selection on public.school_groups;
create trigger guard_public_group_package_selection
  before update of selected_package_id, photo_format, package_quantity, price
  on public.school_groups
  for each row execute function public.guard_public_group_package_selection();

-- sync_group_package already mirrors photo_format and package selection to the
-- print item; remove the older duplicate sync which would issue a second update.
drop trigger if exists school_group_photo_format_sync on public.school_groups;

create or replace function public.approve_job_by_token(token text, approval_name text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare approved_job public.jobs;
begin
  update public.jobs
  set approved_at = now(),
      approval_name = nullif(trim(approve_job_by_token.approval_name), ''),
      approval_terms_accepted = true,
      status = 'PRINTING'
  where approval_token = approve_job_by_token.token
    and approval_revoked_at is null
    and status = 'WAITING_APPROVAL'
    and approved_at is null
    and (approval_token_expires_at is null or approval_token_expires_at > now())
  returning * into approved_job;

  if approved_job.id is null then
    return jsonb_build_object('ok', false, 'message', 'Este enlace ya fue utilizado o no está pendiente de aprobación. Permanece disponible solo para consulta.');
  end if;

  update public.approvals
  set status = 'APPROVED',
      approved_at = now(),
      approved_by_name = nullif(trim(approve_job_by_token.approval_name), ''),
      terms_accepted = true
  where job_id = approved_job.id and status = 'PENDING';

  return jsonb_build_object('ok', true, 'job_id', approved_job.id, 'approved_at', approved_job.approved_at);
end;
$$;

grant execute on function public.approve_job_by_token(text, text) to anon, authenticated;

-- Keep the legacy job link read-only after authorization while retaining
-- the financial information teachers need to review over time.
create or replace function public.get_public_approval_by_token(token text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  result jsonb;
begin
  select jsonb_build_object(
    'job', jsonb_build_object(
      'id', j.id,
      'job_type', j.job_type,
      'title', j.title,
      'event_type', j.event_type,
      'status', j.status,
      'price', j.price,
      'package_quantity', j.package_quantity,
      'approved_at', j.approved_at,
      'approval_name', j.approval_name,
      'approval_terms_accepted', j.approval_terms_accepted
    ),
    'client', jsonb_build_object('name', c.name, 'client_type', c.client_type),
    'package', case
      when p.id is null then null
      else jsonb_build_object('name', p.name, 'price', p.price)
    end,
    'school_profile', case
      when sp.id is null then null
      else jsonb_build_object(
        'school_name', sp.school_name,
        'school_level', sp.school_level,
        'teacher_name', sp.teacher_name,
        'principal_name', sp.principal_name,
        'grade_or_class', sp.grade_or_class,
        'student_count', sp.student_count
      )
    end,
    'galleries', coalesce(
      jsonb_agg(distinct jsonb_build_object(
        'id', g.id,
        'title', g.title,
        'gallery_type', g.gallery_type,
        'google_photos_url', g.google_photos_url
      )) filter (where g.id is not null and g.is_active = true),
      '[]'::jsonb
    ),
    'financial', jsonb_build_object(
      'price', j.price,
      'total_deposited', coalesce((select sum(d.amount) from public.deposits d where d.job_id = j.id), 0),
      'remaining_balance', greatest(j.price - coalesce((select sum(d.amount) from public.deposits d where d.job_id = j.id), 0), 0),
      'last_deposit_date', (select max(d.deposit_date) from public.deposits d where d.job_id = j.id)
    )
  )
  into result
  from public.jobs j
  join public.clients c on c.id = j.client_id
  left join public.packages p on p.id = j.package_id
  left join public.school_profiles sp on sp.client_id = c.id
  left join public.galleries g on g.job_id = j.id
  where j.approval_token = get_public_approval_by_token.token
    and j.approval_revoked_at is null
    and (j.approval_token_expires_at is null or j.approval_token_expires_at > now())
  group by j.id, c.id, p.id, sp.id;

  return result;
end;
$$;

revoke all on function public.get_public_approval_by_token(text) from public;
grant execute on function public.get_public_approval_by_token(text) to anon, authenticated;

comment on column public.print_items.approval_token_expires_at is
  'Teacher information link expires eight calendar months after issue. Existing explicit expiry dates are preserved.';
comment on column public.jobs.approval_token_expires_at is
  'Teacher information link expires eight calendar months after issue. Existing explicit expiry dates are preserved.';

commit;
