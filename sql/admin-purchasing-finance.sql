-- Owner-only purchasing and finance tables.
-- Run after schema.sql, catalog-previews.sql, print-items-workflow.sql,
-- and staff-roles-rbac.sql. This script is additive and safe to rerun.
begin;

create table if not exists public.cost_items (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  category text not null default 'MATERIAL'
    check (category in ('MATERIAL','PRINTING','PRODUCT','OTHER')),
  unit text not null,
  purchase_unit text not null,
  units_per_purchase numeric(12,3) not null default 1 check (units_per_purchase > 0),
  unit_cost numeric(12,2) not null default 0 check (unit_cost >= 0),
  stock_quantity numeric(12,3) not null default 0 check (stock_quantity >= 0),
  supplier text,
  folder_template_id uuid references public.folder_templates(id) on delete set null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.package_material_rules (
  id uuid primary key default gen_random_uuid(),
  package_id uuid not null references public.packages(id) on delete cascade,
  cost_item_id uuid not null references public.cost_items(id) on delete cascade,
  units_per_package numeric(12,3) not null check (units_per_package > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (package_id, cost_item_id)
);

create table if not exists public.purchase_orders (
  id uuid primary key default gen_random_uuid(),
  job_id uuid references public.jobs(id) on delete set null,
  order_type text not null check (order_type in ('FOLDER','MATERIAL')),
  supplier text not null,
  status text not null default 'DRAFT'
    check (status in ('DRAFT','SENT','RECEIVED','CANCELLED')),
  notes text,
  created_by uuid references auth.users(id) on delete set null,
  ordered_at timestamptz,
  received_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.purchase_order_lines (
  id uuid primary key default gen_random_uuid(),
  purchase_order_id uuid not null references public.purchase_orders(id) on delete cascade,
  cost_item_id uuid references public.cost_items(id) on delete set null,
  folder_template_id uuid references public.folder_templates(id) on delete set null,
  description text not null,
  quantity numeric(12,3) not null check (quantity > 0),
  unit text not null,
  unit_cost numeric(12,2) not null default 0 check (unit_cost >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.purchase_order_allocations (
  id uuid primary key default gen_random_uuid(),
  purchase_order_line_id uuid not null references public.purchase_order_lines(id) on delete cascade,
  group_id uuid references public.school_groups(id) on delete set null,
  group_name_snapshot text not null,
  teacher_name_snapshot text,
  quantity numeric(12,3) not null check (quantity > 0),
  unit text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.expenses (
  id uuid primary key default gen_random_uuid(),
  job_id uuid references public.jobs(id) on delete set null,
  cost_item_id uuid references public.cost_items(id) on delete set null,
  purchase_order_id uuid references public.purchase_orders(id) on delete set null,
  expense_date date not null,
  vendor text not null,
  description text not null,
  quantity numeric(12,3) not null default 1 check (quantity > 0),
  unit text not null default 'servicio',
  amount numeric(12,2) not null check (amount >= 0),
  reference text,
  notes text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists cost_items_active_name_idx on public.cost_items(is_active, name);
create index if not exists package_material_rules_package_idx on public.package_material_rules(package_id);
create index if not exists package_material_rules_cost_item_idx on public.package_material_rules(cost_item_id);
create index if not exists purchase_orders_job_status_idx on public.purchase_orders(job_id, status);
create index if not exists purchase_order_lines_order_idx on public.purchase_order_lines(purchase_order_id);
create index if not exists purchase_order_allocations_line_idx on public.purchase_order_allocations(purchase_order_line_id);
create index if not exists purchase_order_allocations_group_idx on public.purchase_order_allocations(group_id);
create index if not exists expenses_job_date_idx on public.expenses(job_id, expense_date desc);
create index if not exists expenses_order_idx on public.expenses(purchase_order_id);

do $$
declare table_name text; policy_row record;
begin
  foreach table_name in array array[
    'cost_items', 'package_material_rules', 'purchase_orders',
    'purchase_order_lines', 'purchase_order_allocations', 'expenses'
  ] loop
    execute format('alter table public.%I enable row level security', table_name);
    for policy_row in select policyname from pg_policies where schemaname = 'public' and tablename = table_name loop
      execute format('drop policy if exists %I on public.%I', policy_row.policyname, table_name);
    end loop;
    execute format(
      'create policy %I on public.%I for all to authenticated using ((select public.has_staff_role(array[''owner'']::public.staff_role[]))) with check ((select public.has_staff_role(array[''owner'']::public.staff_role[])))',
      'owners can manage ' || table_name, table_name
    );
  end loop;
end;
$$;

drop trigger if exists cost_items_updated_at on public.cost_items;
create trigger cost_items_updated_at before update on public.cost_items
  for each row execute function public.set_updated_at();
drop trigger if exists package_material_rules_updated_at on public.package_material_rules;
create trigger package_material_rules_updated_at before update on public.package_material_rules
  for each row execute function public.set_updated_at();
drop trigger if exists purchase_orders_updated_at on public.purchase_orders;
create trigger purchase_orders_updated_at before update on public.purchase_orders
  for each row execute function public.set_updated_at();
drop trigger if exists purchase_order_lines_updated_at on public.purchase_order_lines;
create trigger purchase_order_lines_updated_at before update on public.purchase_order_lines
  for each row execute function public.set_updated_at();
drop trigger if exists purchase_order_allocations_updated_at on public.purchase_order_allocations;
create trigger purchase_order_allocations_updated_at before update on public.purchase_order_allocations
  for each row execute function public.set_updated_at();
drop trigger if exists expenses_updated_at on public.expenses;
create trigger expenses_updated_at before update on public.expenses
  for each row execute function public.set_updated_at();

commit;
