-- Return the stored package format so the teacher can review a prior selection.
create or replace function public.get_public_print_item_by_token(token text)
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
    'preview_files', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', jf.id,
        'file_name', jf.file_name,
        'content_type', jf.content_type,
        'size_bytes', jf.size_bytes
      ) order by jf.created_at desc)
      from (
        select jf.id, jf.file_name, jf.content_type, jf.size_bytes, jf.created_at
        from job_files jf
        where jf.print_item_id = pi.id
          and jf.file_type = 'TEACHER_PREVIEW'
        order by jf.created_at desc
        limit 1
      ) jf
    ), '[]'::jsonb),
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
        'selected_package_id', sg.selected_package_id,
        'photo_format', sg.photo_format,
        'unit_package_price', (select p.price from packages p where p.id = sg.selected_package_id),
        'package_quantity', sg.package_quantity,
        'price', sg.price,
        'total_deposited', coalesce((select sum(d.amount) from deposits d where d.group_id = sg.id), 0),
        'remaining_balance', greatest(sg.price - coalesce((select sum(d.amount) from deposits d where d.group_id = sg.id), 0), 0),
        'last_deposit_date', (select max(d.deposit_date) from deposits d where d.group_id = sg.id)
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

grant execute on function public.get_public_print_item_by_token(text) to anon, authenticated;
