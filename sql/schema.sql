create extension if not exists pgcrypto;

create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table clients (
  id uuid primary key default gen_random_uuid(),
  client_type text not null check (client_type in ('PHOTO_SESSION', 'SCHOOL_GRADUATION')),
  name text not null,
  phone text not null,
  secondary_phone text,
  email text,
  notes text,
  is_active boolean default true,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table school_profiles (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(id) on delete cascade,
  school_name text not null,
  school_level text check (school_level is null or school_level in ('KINDER', 'PRIMARY', 'SECONDARY')),
  teacher_name text,
  teacher_phone text,
  principal_name text,
  principal_phone text,
  grade_or_class text,
  student_count integer check (student_count is null or student_count >= 0),
  last_contact_date date,
  next_follow_up_date date,
  follow_up_status text default 'NEW_CONTACT' check (follow_up_status in ('NEW_CONTACT','CONTACT_NEXT_YEAR','INTERESTED','QUOTE_SENT','CONFIRMED','NOT_INTERESTED','RECURRING_CLIENT')),
  commercial_notes text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table packages (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  package_type text not null check (package_type in ('PHOTO_SESSION', 'SCHOOL_GRADUATION', 'GENERAL')),
  description text,
  price numeric(12,2) not null default 0 check (price >= 0),
  is_active boolean default true,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table jobs (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(id) on delete cascade,
  package_id uuid references packages(id) on delete set null,
  job_type text not null check (job_type in ('PHOTO_SESSION', 'SCHOOL_GRADUATION')),
  title text not null,
  event_type text,
  event_date date,
  delivery_date date,
  status text not null default 'CREATED' check (status in ('CREATED','EDITING','GALLERY_READY','GALLERY_SENT','WAITING_APPROVAL','CHANGES_REQUESTED','APPROVED_FOR_PRINT','PRINTING','READY_FOR_DELIVERY','DELIVERED','CANCELLED')),
  price numeric(12,2) not null default 0 check (price >= 0),
  package_quantity integer not null default 1 check (package_quantity >= 1),
  notes text,
  approval_token text unique not null,
  approval_token_expires_at timestamptz,
  approval_revoked_at timestamptz,
  approved_at timestamptz,
  approval_name text,
  approval_terms_accepted boolean default false,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table galleries (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references jobs(id) on delete cascade,
  title text not null,
  gallery_type text not null default 'GENERAL' check (gallery_type in ('GENERAL','STUDENT_GALLERY','GROUP_PHOTO','DOCUMENTATION_FOLDER','DIPLOMA','OTHER')),
  google_photos_url text not null,
  notes text,
  is_active boolean default true,
  sent_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table approvals (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references jobs(id) on delete cascade,
  gallery_id uuid references galleries(id) on delete set null,
  approval_type text not null check (approval_type in ('GENERAL','STUDENT_GALLERY','GROUP_PHOTO','DOCUMENTATION_FOLDER','DIPLOMA')),
  status text not null default 'PENDING' check (status in ('PENDING','APPROVED','CHANGES_REQUESTED')),
  approved_at timestamptz,
  approved_by_name text,
  terms_accepted boolean default false,
  client_notes text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table deposits (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references jobs(id) on delete cascade,
  amount numeric(12,2) not null check (amount > 0),
  deposit_date date not null,
  notes text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table message_logs (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references jobs(id) on delete cascade,
  client_id uuid not null references clients(id) on delete cascade,
  message_type text not null default 'GALLERY_LINK' check (message_type in ('GALLERY_LINK','APPROVAL_REMINDER','FOLLOW_UP','CUSTOM')),
  message_text text not null,
  wa_me_url text not null,
  created_at timestamptz default now()
);

create index clients_client_type_idx on clients(client_type);
create index clients_name_idx on clients(name);
create index clients_phone_idx on clients(phone);
create index clients_is_active_idx on clients(is_active);
create index school_profiles_client_id_idx on school_profiles(client_id);
create index school_profiles_school_level_idx on school_profiles(school_level);
create index school_profiles_next_follow_up_date_idx on school_profiles(next_follow_up_date);
create index school_profiles_follow_up_status_idx on school_profiles(follow_up_status);
create index packages_package_type_idx on packages(package_type);
create index packages_is_active_idx on packages(is_active);
create index packages_name_idx on packages(name);
create index jobs_client_id_idx on jobs(client_id);
create index jobs_package_id_idx on jobs(package_id);
create index jobs_job_type_idx on jobs(job_type);
create index jobs_status_idx on jobs(status);
create index jobs_delivery_date_idx on jobs(delivery_date);
create index jobs_approval_token_idx on jobs(approval_token);
create index jobs_approved_at_idx on jobs(approved_at);
create index galleries_job_id_idx on galleries(job_id);
create index galleries_gallery_type_idx on galleries(gallery_type);
create index galleries_is_active_idx on galleries(is_active);
create index approvals_job_id_idx on approvals(job_id);
create index approvals_gallery_id_idx on approvals(gallery_id);
create index approvals_approval_type_idx on approvals(approval_type);
create index approvals_status_idx on approvals(status);
create index deposits_job_id_idx on deposits(job_id);
create index deposits_deposit_date_idx on deposits(deposit_date);
create index message_logs_job_id_idx on message_logs(job_id);
create index message_logs_client_id_idx on message_logs(client_id);
create index message_logs_message_type_idx on message_logs(message_type);
create index message_logs_created_at_idx on message_logs(created_at);

create trigger clients_updated_at before update on clients for each row execute function set_updated_at();
create trigger school_profiles_updated_at before update on school_profiles for each row execute function set_updated_at();
create trigger packages_updated_at before update on packages for each row execute function set_updated_at();
create trigger jobs_updated_at before update on jobs for each row execute function set_updated_at();
create trigger galleries_updated_at before update on galleries for each row execute function set_updated_at();
create trigger approvals_updated_at before update on approvals for each row execute function set_updated_at();
create trigger deposits_updated_at before update on deposits for each row execute function set_updated_at();

create or replace view job_financial_summary as
select
  j.id as job_id,
  j.price,
  coalesce(sum(d.amount), 0)::numeric(12,2) as total_deposited,
  greatest(j.price - coalesce(sum(d.amount), 0), 0)::numeric(12,2) as remaining_balance,
  greatest(coalesce(sum(d.amount), 0) - j.price, 0)::numeric(12,2) as overpaid_amount
from jobs j
left join deposits d on d.job_id = j.id
group by j.id, j.price;
