-- Give editors access only to Canva links for diploma designs attached to
-- their own assigned print items. No school, client, or financial data is exposed.
create or replace function public.get_my_assignment_canva_links()
returns table (assignment_id uuid, canva_url text, template_name text)
language sql
stable
security definer
set search_path = ''
as $$
  select wa.id, dt.canva_url, dt.name
  from public.work_assignments wa
  join public.print_items pi on pi.id = wa.print_item_id
  join public.diploma_templates dt on dt.id = pi.selected_file_id
  where wa.assigned_to = (select auth.uid())
    and pi.item_type = 'DIPLOMA'
    and dt.canva_url is not null
    and btrim(dt.canva_url) <> '';
$$;

revoke all on function public.get_my_assignment_canva_links() from public;
grant execute on function public.get_my_assignment_canva_links() to authenticated;
