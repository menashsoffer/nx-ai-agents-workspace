-- Editing and cancelling a saved engagement request (owner's request, 18.11). A request is
-- never deleted: route checks and supplier approaches point at it, and the audit log keeps
-- who changed what and when. "Cancel" sets the status to 'cancelled' with a note saying why,
-- and the saved-requests list hides it. Both functions run as the caller, so the existing
-- update policy decides who may change which unit's request (editor or unit manager).

alter table public.engagement_requests
  add column cancel_note text check (length(cancel_note) <= 2000);
grant update (cancel_note) on public.engagement_requests to authenticated;

-- The current status, or a not-found error when the caller cannot see the request.
create function private.request_status_for_change(request uuid)
returns text language plpgsql stable security invoker set search_path = '' as $$
declare
  found_status text;
begin
  select status into found_status from public.engagement_requests where id = request;
  if found_status is null then
    raise exception 'Request not found' using errcode = 'P0002';
  end if;
  return found_status;
end;
$$;
revoke all on function private.request_status_for_change(uuid) from public, anon;
grant execute on function private.request_status_for_change(uuid) to authenticated;

-- Only an open request (draft or submitted) can be edited. Earlier route checks keep the
-- input they were run on, so editing never rewrites what was checked.
create function public.update_engagement_request(request uuid, draft jsonb)
returns void language plpgsql volatile security invoker set search_path = '' as $$
begin
  if private.request_status_for_change(request) not in ('draft', 'submitted') then
    perform private.raise_rule('request_closed');
  end if;
  update public.engagement_requests set
    subject = trim(draft ->> 'subject'),
    estimated_value = (draft ->> 'estimated_value')::numeric,
    value_includes_vat = (draft ->> 'value_includes_vat')::boolean,
    requested_exemption = nullif(draft ->> 'requested_exemption', '')
  where id = request;
  if not found then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
end;
$$;
revoke all on function public.update_engagement_request(uuid, jsonb) from public, anon;
grant execute on function public.update_engagement_request(uuid, jsonb) to authenticated;

-- A request that is no longer relevant is cancelled with a reason. An approved request can
-- still be cancelled (the contract was not signed); a rejected or contracted one cannot.
create function public.cancel_engagement_request(request uuid, note text)
returns void language plpgsql volatile security invoker set search_path = '' as $$
begin
  if private.request_status_for_change(request) not in ('draft', 'submitted', 'approved') then
    perform private.raise_rule('request_closed');
  end if;
  perform private.raise_rule(private.rule_problem('decision_note', btrim(note)));
  update public.engagement_requests
  set status = 'cancelled', cancel_note = btrim(note)
  where id = request;
  if not found then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
end;
$$;
revoke all on function public.cancel_engagement_request(uuid, text) from public, anon;
grant execute on function public.cancel_engagement_request(uuid, text) to authenticated;
