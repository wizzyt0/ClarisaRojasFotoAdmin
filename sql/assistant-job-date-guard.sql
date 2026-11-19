-- Narrow the existing assistant update guard. Apply only after testing in a
-- separate Supabase project; this changes the live database function.
begin;

create or replace function public.guard_assistant_routine_updates()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  permitted_columns text[];
begin
  if not (select public.has_staff_role(array['assistant']::public.staff_role[])) then
    return new;
  end if;

  new.updated_at := old.updated_at;

  permitted_columns := case tg_table_name
    when 'clients' then array['name', 'phone', 'secondary_phone', 'email', 'notes']
    when 'school_profiles' then array[
      'school_name', 'contact_name', 'contact_phone', 'contact_email',
      'teacher_name', 'teacher_phone', 'principal_name', 'principal_phone',
      'grade_or_class', 'last_contact_date', 'next_follow_up_date',
      'follow_up_status', 'commercial_notes'
    ]
    when 'jobs' then array['title', 'notes']
    else array[]::text[]
  end;

  if (to_jsonb(new) - permitted_columns) is distinct from (to_jsonb(old) - permitted_columns) then
    raise exception 'Este rol solo puede editar datos rutinarios permitidos.' using errcode = '42501';
  end if;
  return new;
end;
$$;

commit;
