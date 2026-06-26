alter table clients enable row level security;
alter table school_profiles enable row level security;
alter table packages enable row level security;
alter table jobs enable row level security;
alter table galleries enable row level security;
alter table approvals enable row level security;
alter table deposits enable row level security;
alter table message_logs enable row level security;

create policy "admin read clients" on clients for select to authenticated using (true);
create policy "admin write clients" on clients for all to authenticated using (true) with check (true);
create policy "admin read school_profiles" on school_profiles for select to authenticated using (true);
create policy "admin write school_profiles" on school_profiles for all to authenticated using (true) with check (true);
create policy "admin read packages" on packages for select to authenticated using (true);
create policy "admin write packages" on packages for all to authenticated using (true) with check (true);
create policy "admin read jobs" on jobs for select to authenticated using (true);
create policy "admin write jobs" on jobs for all to authenticated using (true) with check (true);
create policy "admin read galleries" on galleries for select to authenticated using (true);
create policy "admin write galleries" on galleries for all to authenticated using (true) with check (true);
create policy "admin read approvals" on approvals for select to authenticated using (true);
create policy "admin write approvals" on approvals for all to authenticated using (true) with check (true);
create policy "admin read deposits" on deposits for select to authenticated using (true);
create policy "admin write deposits" on deposits for all to authenticated using (true) with check (true);
create policy "admin read message_logs" on message_logs for select to authenticated using (true);
create policy "admin write message_logs" on message_logs for all to authenticated using (true) with check (true);

drop function if exists get_public_approval_by_token(text);
drop function if exists approve_job_by_token(text, text);

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
    'job', to_jsonb(j),
    'client', jsonb_build_object('name', c.name, 'client_type', c.client_type),
    'package', case when p.id is null then null else jsonb_build_object('name', p.name, 'price', p.price) end,
    'school_profile', case when sp.id is null then null else to_jsonb(sp) - 'created_at' - 'updated_at' end,
    'galleries', coalesce(jsonb_agg(distinct to_jsonb(g)) filter (where g.id is not null and g.is_active = true), '[]'::jsonb),
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
  where j.approval_token = get_public_approval_by_token.token
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
    approval_name = nullif(trim(approve_job_by_token.approval_name), ''),
    approval_terms_accepted = true,
    status = 'APPROVED_FOR_PRINT'
  where approval_token = approve_job_by_token.token
    and approval_revoked_at is null
    and (approval_token_expires_at is null or approval_token_expires_at > now())
  returning * into approved_job;

  if approved_job.id is null then
    return jsonb_build_object('ok', false, 'message', 'El link de aprobación no existe o expiró.');
  end if;

  update approvals
  set status = 'APPROVED',
      approved_at = now(),
      approved_by_name = nullif(trim(approve_job_by_token.approval_name), ''),
      terms_accepted = true
  where job_id = approved_job.id and status = 'PENDING';

  return jsonb_build_object('ok', true, 'job_id', approved_job.id, 'approved_at', approved_job.approved_at);
end;
$$;

grant execute on function get_public_approval_by_token(text) to anon, authenticated;
grant execute on function approve_job_by_token(text, text) to anon, authenticated;
