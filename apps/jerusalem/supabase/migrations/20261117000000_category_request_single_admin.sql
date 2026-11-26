-- The four-eyes rule from 20261116040000 is dropped for now: there is a single administrator,
-- who must be able to approve their own requests. The other checks stay.
create or replace function public.decide_category_request(
  request_id uuid,
  decision text,
  note text,
  category_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  request public.category_requests;
  resolved uuid := category_id;
begin
  if not private.is_admin() then
    raise exception 'Only an admin decides category requests' using errcode = '42501';
  end if;
  if decision is null or decision not in ('approved', 'rejected', 'linked') then
    raise exception 'Invalid decision' using errcode = '22023';
  end if;
  select * into request from public.category_requests
  where id = request_id and status = 'pending'
  for update;
  if not found then
    -- P0002 arrives as 404, so the site knows to refresh the list.
    raise exception 'Request not found or already decided' using errcode = 'P0002';
  end if;
  if decision = 'rejected' and length(btrim(coalesce(note, ''))) < 2 then
    raise exception 'A rejection reason is required' using errcode = '22023';
  end if;
  if decision = 'linked' and not exists (
    select 1 from public.categories where id = category_id and active
  ) then
    raise exception 'Choose an active category' using errcode = '22023';
  end if;
  if decision = 'approved' then
    insert into public.categories (name, description, parent_id)
    values (request.proposed_name, request.description, request.parent_id)
    returning id into resolved;
  elsif decision = 'rejected' then
    resolved := null;
  end if;
  update public.category_requests
  set status = decision, decided_by = auth.uid(), decided_at = now(),
    decision_note = note, resolved_category_id = resolved
  where id = request_id;
  return resolved;
end;
$$;
