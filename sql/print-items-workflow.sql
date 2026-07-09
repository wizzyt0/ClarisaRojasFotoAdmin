create table if not exists print_items (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references jobs(id) on delete cascade,
  group_id uuid,
  item_type text not null check (item_type in ('STUDENT_GALLERY','DIPLOMA','FOLDER_OPTION','GROUP_PHOTO','PHOTO_PACKAGE','OTHER')),
  title text not null,
  status text not null default 'PENDING' check (status in ('PENDING','READY_FOR_REVIEW','CATALOG_SELECTED','SENT_FOR_APPROVAL','APPROVED_FOR_PRINT','PRINTING','PRINTED','DELIVERED','CHANGES_REQUESTED','CANCELLED')),
  approval_token text not null unique default encode(gen_random_bytes(32), 'hex'),
  approval_token_expires_at timestamptz,
  approval_revoked_at timestamptz,
  sent_at timestamptz,
  approved_at timestamptz,
  approved_by_name text,
  terms_accepted boolean default false,
  selected_file_id uuid,
  selected_package_id uuid references packages(id) on delete set null,
  notes text,
  client_notes text,
  changes_requested_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists school_groups (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references jobs(id) on delete cascade,
  group_name text not null,
  teacher_name text,
  teacher_phone text,
  student_count integer,
  selected_package_id uuid references packages(id) on delete set null,
  package_quantity integer not null default 0 check (package_quantity >= 0),
  price numeric(12,2) not null default 0 check (price >= 0),
  notes text,
  sort_order integer not null default 0,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table job_files add column if not exists print_item_id uuid references print_items(id) on delete set null;
alter table file_share_links add column if not exists print_item_id uuid references print_items(id) on delete cascade;
alter table print_items add column if not exists group_id uuid references school_groups(id) on delete cascade;
alter table print_items drop constraint if exists print_items_group_id_fkey;
alter table print_items add constraint print_items_group_id_fkey foreign key (group_id) references school_groups(id) on delete cascade;
alter table print_items add column if not exists client_notes text;
alter table print_items add column if not exists changes_requested_at timestamptz;
alter table school_groups add column if not exists selected_package_id uuid references packages(id) on delete set null;
alter table school_groups add column if not exists package_quantity integer not null default 0 check (package_quantity >= 0);
alter table school_groups add column if not exists price numeric(12,2) not null default 0 check (price >= 0);
alter table print_items drop constraint if exists print_items_status_check;
alter table print_items add constraint print_items_status_check
  check (status in ('PENDING','READY_FOR_REVIEW','CATALOG_SELECTED','SENT_FOR_APPROVAL','APPROVED_FOR_PRINT','PRINTING','PRINTED','DELIVERED','CHANGES_REQUESTED','CANCELLED'));

alter table message_logs drop constraint if exists message_logs_message_type_check;
alter table message_logs add constraint message_logs_message_type_check
  check (message_type in ('GALLERY_LINK','APPROVAL_REMINDER','FOLLOW_UP','CUSTOM','R2_TEACHER_PREVIEW','PRINT_ITEM_APPROVAL'));

create index if not exists print_items_job_id_idx on print_items(job_id);
create index if not exists print_items_group_id_idx on print_items(group_id);
create index if not exists print_items_status_idx on print_items(status);
create index if not exists print_items_approval_token_idx on print_items(approval_token);
create index if not exists school_groups_job_id_idx on school_groups(job_id);
create index if not exists job_files_print_item_id_idx on job_files(print_item_id);
create index if not exists file_share_links_print_item_id_idx on file_share_links(print_item_id);

drop trigger if exists school_groups_updated_at on school_groups;
create trigger school_groups_updated_at before update on school_groups for each row execute function set_updated_at();

drop trigger if exists print_items_updated_at on print_items;
create trigger print_items_updated_at before update on print_items for each row execute function set_updated_at();

alter table school_groups enable row level security;
alter table print_items enable row level security;

drop policy if exists "admin read school_groups" on school_groups;
drop policy if exists "admin write school_groups" on school_groups;
drop policy if exists "admin read print_items" on print_items;
drop policy if exists "admin write print_items" on print_items;

create policy "admin read school_groups" on school_groups for select to authenticated using (true);
create policy "admin write school_groups" on school_groups for all to authenticated using (true) with check (true);
create policy "admin read print_items" on print_items for select to authenticated using (true);
create policy "admin write print_items" on print_items for all to authenticated using (true) with check (true);

drop function if exists get_public_print_item_by_token(text);
drop function if exists approve_print_item_by_token(text, text);
drop function if exists request_print_item_changes_by_token(text, text, text);

create or replace function get_public_print_item_by_token(token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  result jsonb;
begin
  select jsonb_build_object(
    'print_item', jsonb_build_object(
      'id', pi.id,
      'item_type', pi.item_type,
      'title', pi.title,
      'group_id', pi.group_id,
      'status', pi.status,
      'approved_at', pi.approved_at,
      'approved_by_name', pi.approved_by_name,
      'client_notes', pi.client_notes,
      'selected_file_id', pi.selected_file_id,
      'selected_package_id', pi.selected_package_id
    ),
    'job', jsonb_build_object(
      'id', j.id,
      'title', j.title,
      'job_type', j.job_type
    ),
    'client', jsonb_build_object(
      'name', c.name,
      'client_type', c.client_type
    ),
    'school_profile', case
      when sp.id is null then null
      else jsonb_build_object(
        'school_name', sp.school_name,
        'contact_name', sp.contact_name,
        'contact_phone', sp.contact_phone,
        'contact_email', sp.contact_email,
        'teacher_name', sp.teacher_name,
        'principal_name', sp.principal_name,
        'grade_or_class', sp.grade_or_class
      )
    end,
    'school_group', case
      when sg.id is null then null
      else jsonb_build_object(
        'id', sg.id,
        'group_name', sg.group_name,
        'teacher_name', sg.teacher_name,
        'teacher_phone', sg.teacher_phone,
        'student_count', sg.student_count,
        'package_quantity', sg.package_quantity,
        'price', sg.price
      )
    end
  )
  into result
  from print_items pi
  join jobs j on j.id = pi.job_id
  join clients c on c.id = j.client_id
  left join school_profiles sp on sp.client_id = c.id
  left join school_groups sg on sg.id = pi.group_id
  where pi.approval_token = get_public_print_item_by_token.token
    and pi.approval_revoked_at is null
    and (pi.approval_token_expires_at is null or pi.approval_token_expires_at > now());

  return result;
end;
$$;

create or replace function approve_print_item_by_token(token text, approval_name text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  approved_item print_items;
begin
  update print_items
  set
    approved_at = now(),
    approved_by_name = nullif(trim(approve_print_item_by_token.approval_name), ''),
    terms_accepted = true,
    status = 'APPROVED_FOR_PRINT',
    client_notes = null,
    changes_requested_at = null
  where approval_token = approve_print_item_by_token.token
    and approval_revoked_at is null
    and (approval_token_expires_at is null or approval_token_expires_at > now())
  returning * into approved_item;

  if approved_item.id is null then
    return jsonb_build_object('ok', false, 'message', 'El link de aprobación no existe o expiró.');
  end if;

  return jsonb_build_object('ok', true, 'print_item_id', approved_item.id, 'approved_at', approved_item.approved_at);
end;
$$;

create or replace function request_print_item_changes_by_token(token text, approval_name text, client_notes text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  changed_item print_items;
begin
  update print_items
  set
    approved_by_name = nullif(trim(request_print_item_changes_by_token.approval_name), ''),
    client_notes = nullif(trim(request_print_item_changes_by_token.client_notes), ''),
    changes_requested_at = now(),
    status = 'CHANGES_REQUESTED'
  where approval_token = request_print_item_changes_by_token.token
    and approval_revoked_at is null
    and (approval_token_expires_at is null or approval_token_expires_at > now())
  returning * into changed_item;

  if changed_item.id is null then
    return jsonb_build_object('ok', false, 'message', 'El link de revisión no existe o expiró.');
  end if;

  return jsonb_build_object('ok', true, 'print_item_id', changed_item.id, 'changes_requested_at', changed_item.changes_requested_at);
end;
$$;

grant execute on function get_public_print_item_by_token(text) to anon, authenticated;
grant execute on function approve_print_item_by_token(text, text) to anon, authenticated;
grant execute on function request_print_item_changes_by_token(text, text, text) to anon, authenticated;
