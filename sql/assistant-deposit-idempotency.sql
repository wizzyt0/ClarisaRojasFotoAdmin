-- Apply before deploying the Worker that requires Idempotency-Key.
begin;

do $$
begin
  if not exists (select 1 from pg_catalog.pg_class
                 where oid = 'public.deposits'::regclass and relrowsecurity) then
    raise exception 'Deposit row-level security must already be enabled.';
  end if;
end;
$$;

create table if not exists public.assistant_deposit_requests (
  request_key uuid primary key,
  actor_id uuid not null,
  job_id uuid not null,
  input jsonb not null,
  result jsonb not null
);
alter table public.assistant_deposit_requests enable row level security;
revoke all on public.assistant_deposit_requests from public, anon, authenticated;

create or replace function public.assistant_record_deposit_once(
  p_job_id uuid, p_input jsonb, p_request_key uuid
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  previous public.assistant_deposit_requests;
  outcome jsonb;
begin
  if actor is null or not coalesce(
    (select public.has_staff_role(array['assistant']::public.staff_role[])), false
  ) then
    raise exception 'Assistant role required.' using errcode = '42501';
  end if;
  if p_request_key is null or p_job_id is null or p_input is null then
    raise exception 'Job, payload and request key are required.' using errcode = '22023';
  end if;

  -- Serialize requests for the same key until the deposit and replay record commit.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('clarisa:assistant-deposit:' || p_request_key::text, 0)
  );
  select * into previous
  from public.assistant_deposit_requests
  where request_key = p_request_key;
  if found then
    if previous.actor_id <> actor then
      raise exception 'Request key is not available.' using errcode = '42501';
    end if;
    if previous.job_id <> p_job_id or previous.input is distinct from p_input then
      raise exception 'Request key was used with different data.' using errcode = 'PT409';
    end if;
    return previous.result;
  end if;

  outcome := public.assistant_record_deposit(p_job_id, p_input);
  if (outcome->>'ok') is distinct from 'true' or outcome #>> '{data,id}' is null then
    raise exception 'Deposit was not confirmed.';
  end if;
  insert into public.assistant_deposit_requests(request_key, actor_id, job_id, input, result)
  values (p_request_key, actor, p_job_id, p_input, outcome);
  return outcome;
end;
$$;

alter function public.assistant_record_deposit_once(uuid, jsonb, uuid) owner to postgres;
revoke all on function public.assistant_record_deposit_once(uuid, jsonb, uuid) from public, anon, authenticated;
grant execute on function public.assistant_record_deposit_once(uuid, jsonb, uuid) to authenticated;
revoke execute on function public.assistant_record_deposit(uuid, jsonb) from public, anon, authenticated;

drop policy if exists assistant_no_direct_deposit_insert on public.deposits;
create policy assistant_no_direct_deposit_insert on public.deposits
  as restrictive for insert to authenticated
  with check (not (select public.has_staff_role(array['assistant']::public.staff_role[])));
drop policy if exists assistant_no_deposit_update on public.deposits;
create policy assistant_no_deposit_update on public.deposits
  as restrictive for update to authenticated
  using (not (select public.has_staff_role(array['assistant']::public.staff_role[])))
  with check (not (select public.has_staff_role(array['assistant']::public.staff_role[])));
drop policy if exists assistant_no_deposit_delete on public.deposits;
create policy assistant_no_deposit_delete on public.deposits
  as restrictive for delete to authenticated
  using (not (select public.has_staff_role(array['assistant']::public.staff_role[])));

notify pgrst, 'reload schema';
commit;
