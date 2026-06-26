create or replace function get_public_approval_by_token(token text)
returns jsonb
language plpgsql
security definer
set search_path = public
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
    'client', jsonb_build_object(
      'name', c.name,
      'client_type', c.client_type
    ),
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
      jsonb_agg(
        distinct jsonb_build_object(
          'id', g.id,
          'title', g.title,
          'gallery_type', g.gallery_type,
          'google_photos_url', g.google_photos_url
        )
      ) filter (where g.id is not null and g.is_active = true),
      '[]'::jsonb
    ),
    'financial', jsonb_build_object(
      'price', j.price,
      'total_deposited', coalesce((select sum(amount) from deposits where job_id = j.id), 0),
      'remaining_balance', greatest(j.price - coalesce((select sum(amount) from deposits where job_id = j.id), 0), 0)
    )
  )
  into result
  from jobs j
  join clients c on c.id = j.client_id
  left join packages p on p.id = j.package_id
  left join school_profiles sp on sp.client_id = c.id
  left join galleries g on g.job_id = j.id
  where j.approval_token = token
    and j.approval_revoked_at is null
    and (j.approval_token_expires_at is null or j.approval_token_expires_at > now())
  group by j.id, c.id, p.id, sp.id;

  return result;
end;
$$;

create or replace function approve_job_by_token(token text, approval_name text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  approved_job jobs;
begin
  update jobs
  set
    approved_at = now(),
    approval_name = nullif(trim(approval_name), ''),
    approval_terms_accepted = true,
    status = 'APPROVED_FOR_PRINT'
  where approval_token = token
    and approval_revoked_at is null
    and (approval_token_expires_at is null or approval_token_expires_at > now())
  returning * into approved_job;

  if approved_job.id is null then
    return jsonb_build_object('ok', false, 'message', 'El link de aprobación no existe o expiró.');
  end if;

  update approvals
  set
    status = 'APPROVED',
    approved_at = now(),
    approved_by_name = nullif(trim(approval_name), ''),
    terms_accepted = true
  where job_id = approved_job.id and status = 'PENDING';

  return jsonb_build_object('ok', true, 'job_id', approved_job.id, 'approved_at', approved_job.approved_at);
end;
$$;

revoke all on function get_public_approval_by_token(text) from public;
revoke all on function approve_job_by_token(text, text) from public;

grant execute on function get_public_approval_by_token(text) to anon, authenticated;
grant execute on function approve_job_by_token(text, text) to anon, authenticated;
