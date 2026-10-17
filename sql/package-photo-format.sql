-- Add an administrator-only descriptor for whether a package is group or individual photography.
-- Existing rows remain NULL until an administrator edits them.
alter table public.packages
  add column if not exists photo_format text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.packages'::regclass
      and conname = 'packages_photo_format_check'
  ) then
    alter table public.packages
      add constraint packages_photo_format_check
      check (photo_format in ('GROUP', 'INDIVIDUAL'));
  end if;
end;
$$;
