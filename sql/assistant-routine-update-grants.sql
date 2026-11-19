-- Adds only the routine assistant-update columns to the authenticated role.
-- RLS policies and guard_assistant_routine_updates() remain mandatory.
-- Do not grant table-wide UPDATE and do not grant INSERT or DELETE.

grant update (
  name,
  phone,
  secondary_phone,
  email,
  notes
) on table public.clients to authenticated;

grant update (
  school_name,
  contact_name,
  contact_phone,
  contact_email,
  teacher_name,
  teacher_phone,
  principal_name,
  principal_phone,
  grade_or_class,
  last_contact_date,
  next_follow_up_date,
  follow_up_status,
  commercial_notes
) on table public.school_profiles to authenticated;

grant update (
  title,
  notes
) on table public.jobs to authenticated;

notify pgrst, 'reload schema';
