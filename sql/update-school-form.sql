alter table school_profiles
add column if not exists school_level text;

alter table school_profiles
add column if not exists contact_name text,
add column if not exists contact_phone text,
add column if not exists contact_email text;

alter table school_profiles
drop column if exists contact_person_name;

alter table school_profiles
drop column if exists contact_person_phone;

alter table school_profiles
drop column if exists school_year;

alter table school_profiles
drop constraint if exists school_profiles_school_level_check;

alter table school_profiles
add constraint school_profiles_school_level_check
check (school_level is null or school_level in ('KINDER', 'PRIMARY', 'SECONDARY'));

create index if not exists school_profiles_school_level_idx on school_profiles(school_level);

alter table packages drop constraint if exists packages_package_type_check;
alter table packages add constraint packages_package_type_check
check (package_type in ('PHOTO_SESSION', 'SCHOOL_GRADUATION', 'SCHOOL_MEMORY', 'SCHOOL_CHRISTMAS', 'GENERAL'));
