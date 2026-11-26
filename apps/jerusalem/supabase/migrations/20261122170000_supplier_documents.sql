-- Supplier personal area, stage 4 (supplier-portal-spec-he.md 6.5, 7.1, 7.4, decisions 3 and 5).
-- A linked supplier uploads its bookkeeping, tax withholding and insurance certificates, and a
-- nonprofit its proper management certificate, each with the date it is valid until. An admin
-- approves (and may correct the date) or rejects with a reason. A newer upload replaces the
-- older one of the same kind once it is approved; files are never deleted.

create table public.supplier_documents (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid not null references public.suppliers (id) on delete restrict,
  kind text not null
    check (kind in ('bookkeeping', 'tax_withholding', 'insurance', 'proper_management')),
  storage_path text not null unique check (length(storage_path) <= 500),
  valid_until date not null,
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected', 'replaced')),
  account_id uuid references public.supplier_accounts (id) on delete set null,
  reviewed_by uuid references auth.users (id) on delete set null,
  reviewed_at timestamptz,
  review_note text check (length(review_note) <= 2000),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now(),
  check (storage_path like supplier_id::text || '/%'),
  check (status <> 'rejected' or length(trim(coalesce(review_note, ''))) >= 2),
  check ((status in ('approved', 'rejected')) = (reviewed_at is not null)
    or status = 'replaced')
);
create index supplier_documents_supplier_idx on public.supplier_documents (supplier_id, kind);
create index supplier_documents_account_idx on public.supplier_documents (account_id);
create index supplier_documents_reviewed_by_idx on public.supplier_documents (reviewed_by);
create index supplier_documents_pending_idx on public.supplier_documents (created_at)
  where status = 'pending';
select private.track_table('public.supplier_documents');

-- Staff and the auditor read the rows; a supplier reads its own only through portal_documents.
alter table public.supplier_documents enable row level security;
revoke all on public.supplier_documents from public, anon, authenticated;
grant select on public.supplier_documents to authenticated;
create policy supplier_documents_read on public.supplier_documents for select to authenticated
  using ((select private.is_member()) or (select private.can_read_all()));

-- Files go under <supplier id>/ for a supplier the person is actively linked to. The person
-- reads files of their own suppliers; admins read all. Nobody replaces or deletes a file.
create policy supplier_document_upload on storage.objects for insert to authenticated
  with check (bucket_id = 'supplier-documents'
    and (storage.foldername(name))[1] in (select s::text from private.my_supplier_ids() s)
    and coalesce((select auth.jwt()) ->> 'is_anonymous', 'false') <> 'true');
create policy supplier_document_read on storage.objects for select to authenticated
  using (bucket_id = 'supplier-documents' and (storage.foldername(name))[1] <> 'link-proofs'
    and ((storage.foldername(name))[1] in (select s::text from private.my_supplier_ids() s)
      or (select private.is_admin())));

-- The document kinds a supplier is asked for: proper management only for a nonprofit.
create function private.document_kinds(target uuid)
returns text[] language sql stable security definer set search_path = '' as $$
  select array['bookkeeping', 'tax_withholding', 'insurance']
    || case when exists (select 1 from public.suppliers s where s.id = target
        and s.entity_kind = 'nonprofit')
      or exists (select 1 from public.supplier_identifiers i where i.supplier_id = target
        and i.scheme = 'nonprofit' and i.review_status <> 'rejected')
      then array['proper_management'] else array[]::text[] end
$$;

create function private.document_json(d public.supplier_documents)
returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object('id', d.id, 'kind', d.kind, 'status', d.status,
    'valid_until', d.valid_until, 'review_note', d.review_note, 'created_at', d.created_at,
    'reviewed_at', d.reviewed_at, 'storage_path', d.storage_path)
$$;

-- The kinds asked of the supplier and its documents, newest first, without who reviewed them.
create function public.portal_documents(supplier_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if private.portal_role(supplier_id) is null then
    raise exception 'reason:supplier_unavailable' using errcode = 'P0002';
  end if;
  return jsonb_build_object('kinds', to_jsonb(private.document_kinds(supplier_id)),
    'documents', coalesce((select jsonb_agg(private.document_json(d) order by d.created_at desc)
      from public.supplier_documents d
      where d.supplier_id = portal_documents.supplier_id and d.status <> 'replaced'),
      '[]'::jsonb));
end;
$$;

-- Records a file the caller uploaded under the supplier's folder. It waits for an admin; an
-- earlier upload of the same kind that still waits is replaced by this one.
create function public.portal_save_document(document jsonb)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  target uuid;
  path text := nullif(trim(document ->> 'storage_path'), '');
  until date;
  saved public.supplier_documents;
begin
  perform private.require_portal_caller();
  if coalesce(document ->> 'supplier_id', '') !~ '^[0-9a-f-]{36}$'
    or private.portal_role((document ->> 'supplier_id')::uuid) is null then
    raise exception 'reason:supplier_unavailable' using errcode = 'P0002';
  end if;
  target := (document ->> 'supplier_id')::uuid;
  if not (document ->> 'kind') = any (private.document_kinds(target)) then
    raise exception 'reason:bad_choice' using errcode = '22023';
  end if;
  until := private.document_until(document ->> 'valid_until');
  if path is null or path not like target::text || '/%' or not exists (select 1
    from storage.objects o where o.bucket_id = 'supplier-documents' and o.name = path) then
    raise exception 'reason:file_required' using errcode = '22023';
  end if;
  if not private.take_quota('portal_document', 20, interval '1 day') then
    raise exception 'reason:too_many_attempts' using errcode = '54000';
  end if;
  update public.supplier_documents d set status = 'replaced'
  where d.supplier_id = target and d.kind = document ->> 'kind' and d.status = 'pending';
  insert into public.supplier_documents (supplier_id, kind, storage_path, valid_until, account_id)
  values (target, document ->> 'kind', path, until, (select a.id from public.supplier_accounts a
    where a.user_id = auth.uid() and a.supplier_id = target and a.status = 'active'))
  returning * into saved;
  return private.document_json(saved);
end;
$$;

-- A valid-until date: a real day from today up to ten years ahead.
create function private.document_until(value text)
returns date language plpgsql stable set search_path = '' as $$
declare
  until date;
begin
  if coalesce(value, '') !~ '^\d{4}-\d{2}-\d{2}$' then
    raise exception 'reason:date_invalid' using errcode = '22023';
  end if;
  until := value::date;
  if until < (now() at time zone 'Asia/Jerusalem')::date
    or until > (now() at time zone 'Asia/Jerusalem')::date + interval '10 years' then
    raise exception 'reason:date_invalid' using errcode = '22023';
  end if;
  return until;
exception when datetime_field_overflow or invalid_datetime_format then
  raise exception 'reason:date_invalid' using errcode = '22023';
end;
$$;

-- The admin's queue of waiting documents (decision 3: admins decide for now).
create function public.supplier_document_queue()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_admin() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  return coalesce((select jsonb_agg(private.document_json(d) || jsonb_build_object(
      'supplier_id', s.id, 'supplier_name', s.display_name) order by d.created_at)
    from public.supplier_documents d join public.suppliers s on s.id = d.supplier_id
    where d.status = 'pending'), '[]'::jsonb);
end;
$$;

-- Approves a waiting document, with the date corrected when given, or rejects it with a
-- reason. An approval replaces the earlier approved document of the same kind.
create function public.decide_supplier_document(document_id uuid, approve boolean, note text,
  corrected_until text)
returns void language plpgsql volatile security definer set search_path = '' as $$
declare
  doc public.supplier_documents;
begin
  if not private.is_admin() then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  if approve is null then
    raise exception 'reason:bad_choice' using errcode = '22023';
  end if;
  if not approve and length(trim(coalesce(note, ''))) < 2 then
    raise exception 'reason:reason_required' using errcode = '22023';
  end if;
  select * into doc from public.supplier_documents where id = document_id and status = 'pending'
  for update;
  if not found then
    raise exception 'reason:already_decided' using errcode = 'P0002';
  end if;
  if approve then
    update public.supplier_documents d set status = 'replaced'
    where d.supplier_id = doc.supplier_id and d.kind = doc.kind and d.status = 'approved';
  end if;
  update public.supplier_documents set
    status = case when approve then 'approved' else 'rejected' end,
    valid_until = case when approve and corrected_until is not null
      then private.document_until(corrected_until) else doc.valid_until end,
    reviewed_by = auth.uid(), reviewed_at = now(), review_note = nullif(trim(note), '')
  where id = document_id;
end;
$$;

-- The admin card counts waiting documents with the links to check.
create or replace function public.admin_overview()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  admin boolean := private.is_admin();
  counters jsonb := '{}'::jsonb;
begin
  if admin or private.has_role(array['unit_manager']) then
    counters := counters || jsonb_build_object('users_pending',
      (select count(*) from public.profiles p
        where p.status = 'pending' and (admin or private.manages_unit(p.unit_id)))
      + (select count(*) from public.access_change_requests r
        where r.status = 'pending' and private.may_decide_change(r)));
  end if;
  if admin then
    counters := counters || jsonb_build_object(
      'identifiers_pending', (select count(*) from public.identifier_candidates
        where status = 'pending'),
      'categories_pending', (select count(*) from public.category_requests
        where status = 'pending'),
      'thresholds_pending', (select count(*) from public.threshold_proposals
        where status = 'pending'),
      'addresses_not_found', (select count(*) from public.address_checks
        where result = 'not_found'),
      'supplier_links_pending', (select count(*) from public.supplier_accounts a
        where a.status = 'pending' or (a.status = 'active' and a.method = 'email_match'
          and a.created_at > now() - interval '7 days'))
        + (select count(*) from public.supplier_documents d where d.status = 'pending'));
  end if;
  return counters;
end
$$;

revoke all on function private.document_kinds(uuid),
  private.document_json(public.supplier_documents), private.document_until(text)
  from public, anon, authenticated;
revoke all on function public.portal_documents(uuid), public.portal_save_document(jsonb),
  public.supplier_document_queue(), public.decide_supplier_document(uuid, boolean, text, text)
  from public, anon;
grant execute on function public.portal_documents(uuid), public.portal_save_document(jsonb),
  public.supplier_document_queue(), public.decide_supplier_document(uuid, boolean, text, text)
  to authenticated;
