-- Supplier personal area, stage 6a (supplier-approaches-spec-he.md 7). An approach gets a
-- deadline. The supplier answers with an offer or a decline, and staff record answers that
-- came by email or phone. An offer stays sealed until the deadline has passed: no function,
-- table or storage policy hands its amount, note or file to staff before then.

alter table public.supplier_approaches
  add column respond_by date,
  add column deadline_note text check (length(deadline_note) <= 500),
  add constraint supplier_approaches_respond_by_check
    check (respond_by is null or respond_by > approached_on);

-- Answers live in approach_responses from now on; the old columns are written by nobody.
revoke insert, update on public.supplier_approaches from authenticated;
grant insert (request_id, supplier_id, approached_on, channel, note), update (note)
  on public.supplier_approaches to authenticated;

create table public.approach_responses (
  id uuid primary key default gen_random_uuid(),
  approach_id uuid not null references public.supplier_approaches (id) on delete restrict,
  answer text not null check (answer in ('offer', 'declined')),
  offer_amount numeric(14, 2) check (offer_amount > 0),
  offer_includes_vat boolean,
  decline_reason text
    check (decline_reason in ('no_capacity', 'not_our_field', 'too_short', 'other')),
  note text check (length(note) <= 2000),
  file_path text check (length(file_path) <= 500),
  source text not null check (source in ('portal', 'staff')),
  account_id uuid references public.supplier_accounts (id) on delete set null,
  received_on date,
  withdrawn_at timestamptz,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now(),
  check ((answer = 'offer') = (offer_amount is not null)),
  check ((offer_amount is null) = (offer_includes_vat is null)),
  check ((answer = 'declined') = (decline_reason is not null)),
  check (decline_reason is distinct from 'other' or length(trim(coalesce(note, ''))) >= 2),
  check ((source = 'staff') = (received_on is not null)),
  check (source = 'portal' or (account_id is null and file_path is null))
);
-- At most one answer that counts per approach; a withdrawn one stays for the record.
create unique index approach_responses_current_idx on public.approach_responses (approach_id)
  where withdrawn_at is null;
create index approach_responses_approach_idx on public.approach_responses (approach_id);
create index approach_responses_account_idx on public.approach_responses (account_id);
select private.track_table('public.approach_responses');

-- Nobody reads the table directly: the sealing rule depends on the date.
alter table public.approach_responses enable row level security;
revoke all on public.approach_responses from public, anon, authenticated;

create function private.israel_today()
returns date language sql stable set search_path = '' as $$
  select (now() at time zone 'Asia/Jerusalem')::date
$$;

-- Sealed: the deadline is today or later. An approach without a deadline is never sealed.
create function private.approach_sealed(a public.supplier_approaches)
returns boolean language sql stable set search_path = '' as $$
  select a.respond_by is not null and private.israel_today() <= a.respond_by
$$;

create function private.request_closed(request uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select r.status in ('cancelled', 'rejected', 'contracted')
    from public.engagement_requests r where r.id = request), true)
$$;

-- Editors and managers of the request's unit, and admins, record approaches and answers.
create function private.require_request_editor(request uuid)
returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if not (private.in_unit(private.request_unit(request), array['editor', 'unit_manager'])
    or private.is_admin()) then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
end;
$$;

-- A deadline from tomorrow up to 90 days ahead, and later than after_day when one is given.
create function private.approach_deadline(value text, after_day date)
returns date language plpgsql stable set search_path = '' as $$
declare
  due date;
begin
  if nullif(value, '') is null then
    return null;
  end if;
  if value !~ '^\d{4}-\d{2}-\d{2}$' then
    raise exception 'reason:approach_deadline' using errcode = '22023';
  end if;
  due := value::date;
  if due <= private.israel_today() or due > private.israel_today() + 90
    or due <= coalesce(after_day, '-infinity'::date) then
    raise exception 'reason:approach_deadline' using errcode = '22023';
  end if;
  return due;
exception when datetime_field_overflow or invalid_datetime_format then
  raise exception 'reason:approach_deadline' using errcode = '22023';
end;
$$;

create function private.response_json(x public.approach_responses)
returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object('id', x.id, 'answer', x.answer, 'offer_amount', x.offer_amount,
    'offer_includes_vat', x.offer_includes_vat, 'decline_reason', x.decline_reason,
    'note', x.note, 'file_path', x.file_path, 'source', x.source, 'received_on', x.received_on,
    'withdrawn_at', x.withdrawn_at, 'created_at', x.created_at)
$$;

-- The offer's amount, note and file go out only once the deadline has passed.
create function private.sealed_json(x public.approach_responses, sealed boolean)
returns jsonb language sql stable set search_path = '' as $$
  select case when sealed and x.answer = 'offer'
    then private.response_json(x) - 'offer_amount' - 'offer_includes_vat' - 'note' - 'file_path'
    else private.response_json(x) end
$$;

-- The offer or decline fields of an answer, checked. A portal offer needs its uploaded file.
create function private.answer_fields(target public.supplier_approaches, answer jsonb,
  portal boolean)
returns public.approach_responses language plpgsql stable set search_path = '' as $$
declare
  item public.approach_responses;
begin
  item.answer := answer ->> 'answer';
  item.note := nullif(trim(answer ->> 'note'), '');
  if item.answer = 'offer' then
    if coalesce(answer ->> 'offer_amount', '') !~ '^\d{1,9}(\.\d{1,2})?$'
      or (answer ->> 'offer_amount')::numeric <= 0
      or jsonb_typeof(answer -> 'offer_includes_vat') is distinct from 'boolean' then
      raise exception 'reason:approach_amount' using errcode = '22023';
    end if;
    item.offer_amount := (answer ->> 'offer_amount')::numeric;
    item.offer_includes_vat := (answer ->> 'offer_includes_vat')::boolean;
    item.file_path := nullif(trim(answer ->> 'file_path'), '');
    if portal and (item.file_path is null or item.file_path not like
      format('%s/offers/%s/%%', target.supplier_id, target.id) or not exists (select 1
        from storage.objects o where o.bucket_id = 'supplier-documents'
          and o.name = item.file_path)) then
      raise exception 'reason:file_required' using errcode = '22023';
    end if;
  elsif item.answer = 'declined' then
    item.decline_reason := answer ->> 'decline_reason';
    if item.decline_reason = 'other' and length(coalesce(item.note, '')) < 2 then
      raise exception 'reason:reason_required' using errcode = '22023';
    end if;
  else
    raise exception 'Invalid answer' using errcode = '22023';
  end if;
  return item;
end;
$$;

-- Saves an answer to a locked approach row; one answer counts at a time.
create function private.save_answer(target public.supplier_approaches, answer jsonb,
  received date)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  item public.approach_responses := private.answer_fields(target, answer, received is null);
begin
  if exists (select 1 from public.approach_responses x
    where x.approach_id = target.id and x.withdrawn_at is null) then
    raise exception 'reason:approach_answered' using errcode = '23505';
  end if;
  insert into public.approach_responses (approach_id, answer, offer_amount, offer_includes_vat,
    decline_reason, note, file_path, source, account_id, received_on)
  values (target.id, item.answer, item.offer_amount, item.offer_includes_vat, item.decline_reason,
    item.note, item.file_path, case when received is null then 'portal' else 'staff' end,
    case when received is null then (select a.id from public.supplier_accounts a
      where a.user_id = auth.uid() and a.supplier_id = target.supplier_id
        and a.status = 'active') end, received)
  returning * into item;
  return private.response_json(item);
end;
$$;

-- The approach a linked supplier may answer now, locked; otherwise the refusal it deserves.
create function private.portal_open_approach(approach text)
returns public.supplier_approaches language plpgsql volatile security definer
set search_path = '' as $$
declare
  target public.supplier_approaches;
begin
  perform private.require_portal_caller();
  if coalesce(approach, '') ~ '^[0-9a-f-]{36}$' then
    select * into target from public.supplier_approaches a where a.id = approach::uuid
    for update;
  end if;
  if target.id is null or private.portal_role(target.supplier_id) is null
    or target.respond_by is null then
    raise exception 'reason:supplier_unavailable' using errcode = 'P0002';
  end if;
  if not private.approach_sealed(target) or private.request_closed(target.request_id) then
    raise exception 'reason:approach_closed' using errcode = '22023';
  end if;
  return target;
end;
$$;

-- The supplier's approaches with a deadline, and its latest answer to each. Nothing about
-- the estimate, the other suppliers or how many were approached.
create function public.portal_approaches(supplier_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if private.portal_role(supplier_id) is null then
    raise exception 'reason:supplier_unavailable' using errcode = 'P0002';
  end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'subject', r.subject,
      'unit_name', u.name, 'approached_on', a.approached_on, 'respond_by', a.respond_by,
      'needed_by', r.needed_by, 'cancelled', r.status in ('cancelled', 'rejected'),
      'open', private.approach_sealed(a) and not private.request_closed(r.id),
      'answer', (select private.response_json(x) from public.approach_responses x
        where x.approach_id = a.id order by x.created_at desc limit 1))
      order by a.respond_by desc, a.created_at desc)
    from public.supplier_approaches a
    join public.engagement_requests r on r.id = a.request_id
    join public.org_units u on u.id = r.unit_id
    where a.supplier_id = portal_approaches.supplier_id and a.respond_by is not null),
    '[]'::jsonb);
end;
$$;

-- An offer or a decline from a linked supplier, before the deadline (spec 5.2, 5.3).
create function public.portal_answer_approach(answer jsonb)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  target public.supplier_approaches := private.portal_open_approach(answer ->> 'approach_id');
begin
  if not private.take_quota('portal_answer', 30, interval '1 day') then
    raise exception 'reason:too_many_attempts' using errcode = '54000';
  end if;
  return private.save_answer(target, answer, null);
end;
$$;

-- Withdraws the supplier's own answer before the deadline, so it can answer again (5.4).
create function public.portal_withdraw_answer(response_id uuid)
returns void language plpgsql volatile security definer set search_path = '' as $$
declare
  mine public.approach_responses;
begin
  select * into mine from public.approach_responses x
  where x.id = response_id and x.source = 'portal';
  perform private.portal_open_approach(mine.approach_id::text);
  if mine.withdrawn_at is not null then
    raise exception 'reason:already_decided' using errcode = 'P0002';
  end if;
  update public.approach_responses set withdrawn_at = now() where id = response_id;
end;
$$;

-- Records approaches with a channel and a deadline (spec 6.1). The deadline is required for
-- the personal area; a supplier already approached for the request keeps its first item.
create function public.record_supplier_approaches(request uuid, suppliers uuid[], channel text,
  respond_by text)
returns integer language plpgsql volatile security definer set search_path = '' as $$
declare
  due date := private.approach_deadline(respond_by, null);
  added integer;
begin
  perform private.require_request_editor(request);
  if private.request_closed(request) then
    raise exception 'reason:approach_closed' using errcode = '22023';
  end if;
  if channel = 'portal' and due is null then
    raise exception 'reason:approach_deadline' using errcode = '22023';
  end if;
  with inserted as (
    insert into public.supplier_approaches (request_id, supplier_id, approached_on, channel,
      respond_by)
    select request, s, private.israel_today(), channel, due from unnest(suppliers) s
    on conflict (request_id, supplier_id) do nothing
    returning 1
  )
  select count(*)::integer into added from inserted;
  return added;
end;
$$;

-- The request's approaches and answers for staff (spec 6.2): before the deadline an offer
-- shows that it came, not its amount, note or file.
create function public.request_approaches(request_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not (private.in_unit(private.request_unit(request_id), array['editor', 'unit_manager'])
    or private.can_read_all()) then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', a.id,
      'supplier_id', a.supplier_id, 'supplier_name', s.display_name, 'channel', a.channel,
      'approached_on', a.approached_on, 'respond_by', a.respond_by,
      'sealed', private.approach_sealed(a), 'answer', (select private.sealed_json(x,
        private.approach_sealed(a)) from public.approach_responses x
        where x.approach_id = a.id and x.withdrawn_at is null))
      order by s.display_name, a.id)
    from public.supplier_approaches a join public.suppliers s on s.id = a.supplier_id
    where a.request_id = request_approaches.request_id), '[]'::jsonb);
end;
$$;

-- An answer that reached staff by email, phone or letter, on or before the deadline (6.3).
create function public.record_approach_answer(answer jsonb)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  target public.supplier_approaches;
  received date;
begin
  if coalesce(answer ->> 'approach_id', '') ~ '^[0-9a-f-]{36}$' then
    select * into target from public.supplier_approaches a
    where a.id = (answer ->> 'approach_id')::uuid for update;
  end if;
  if target.id is null then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  perform private.require_request_editor(target.request_id);
  if coalesce(answer ->> 'received_on', '') !~ '^\d{4}-\d{2}-\d{2}$' then
    raise exception 'reason:date_invalid' using errcode = '22023';
  end if;
  received := (answer ->> 'received_on')::date;
  if received < target.approached_on or received > private.israel_today() then
    raise exception 'reason:date_invalid' using errcode = '22023';
  end if;
  if received > coalesce(target.respond_by, 'infinity'::date)
    or private.request_closed(target.request_id) then
    raise exception 'reason:approach_closed' using errcode = '22023';
  end if;
  return private.save_answer(target, answer, received);
exception when datetime_field_overflow or invalid_datetime_format then
  raise exception 'reason:date_invalid' using errcode = '22023';
end;
$$;

-- Moves the deadline of every still-open approach of the request forward, with the reason.
create function public.extend_approach_deadline(request uuid, respond_by text, reason text)
returns integer language plpgsql volatile security definer set search_path = '' as $$
declare
  latest date;
  due date;
  moved integer;
begin
  perform private.require_request_editor(request);
  if length(trim(coalesce(reason, ''))) < 3 then
    raise exception 'reason:change_reason_required' using errcode = '22023';
  end if;
  select max(a.respond_by) into latest from public.supplier_approaches a
  where a.request_id = request and private.approach_sealed(a);
  if latest is null or private.request_closed(request) then
    raise exception 'reason:approach_closed' using errcode = '22023';
  end if;
  due := private.approach_deadline(respond_by, latest);
  update public.supplier_approaches a set respond_by = due, deadline_note = trim(reason)
  where a.request_id = request and private.approach_sealed(a);
  get diagnostics moved = row_count;
  return moved;
end;
$$;

-- Offer files: staff of the request's unit, the auditor and admins read one only after the
-- deadline. The supplier reads its own folder as before.
create function private.offer_file_open(path text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.supplier_approaches a
    where a.supplier_id::text = (storage.foldername(path))[1]
      and a.id::text = (storage.foldername(path))[3]
      and not private.approach_sealed(a)
      and (private.in_unit(private.request_unit(a.request_id), array['editor', 'unit_manager'])
        or private.can_read_all()))
$$;

drop policy supplier_document_read on storage.objects;
create policy supplier_document_read on storage.objects for select to authenticated
  using (bucket_id = 'supplier-documents' and (storage.foldername(name))[1] <> 'link-proofs'
    and ((storage.foldername(name))[1] in (select s::text from private.my_supplier_ids() s)
      or ((select private.is_admin())
        and coalesce((storage.foldername(name))[2], '') <> 'offers')
      or ((storage.foldername(name))[2] = 'offers' and private.offer_file_open(name))));

revoke all on function private.israel_today(),
  private.approach_sealed(public.supplier_approaches), private.request_closed(uuid),
  private.require_request_editor(uuid), private.approach_deadline(text, date),
  private.response_json(public.approach_responses),
  private.sealed_json(public.approach_responses, boolean),
  private.answer_fields(public.supplier_approaches, jsonb, boolean),
  private.save_answer(public.supplier_approaches, jsonb, date),
  private.portal_open_approach(text)
  from public, anon, authenticated;
-- The storage policy runs as the caller.
grant execute on function private.offer_file_open(text) to authenticated;
revoke all on function private.offer_file_open(text) from public, anon;
revoke all on function public.portal_approaches(uuid), public.portal_answer_approach(jsonb),
  public.portal_withdraw_answer(uuid),
  public.record_supplier_approaches(uuid, uuid[], text, text),
  public.request_approaches(uuid), public.record_approach_answer(jsonb),
  public.extend_approach_deadline(uuid, text, text)
  from public, anon;
grant execute on function public.portal_approaches(uuid), public.portal_answer_approach(jsonb),
  public.portal_withdraw_answer(uuid),
  public.record_supplier_approaches(uuid, uuid[], text, text),
  public.request_approaches(uuid), public.record_approach_answer(jsonb),
  public.extend_approach_deadline(uuid, text, text)
  to authenticated;
