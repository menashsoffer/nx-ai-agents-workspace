-- The supplier screen shows the change history to system administrators only (decision of
-- 17.11.2026, documentation/supplier-page-spec-he.md section 6). Auditors and editors get
-- `audit: null`. Only the history condition changes; the rest of the function is as before.
create or replace function public.supplier_detail(supplier_id uuid)
returns jsonb language sql stable security invoker set search_path = '' as $$
  with related as (
    select 'suppliers'::text as table_name, s.id::text as row_id
      from public.suppliers s where s.id = supplier_id
    union all select 'supplier_names', n.id::text
      from public.supplier_names n where n.supplier_id = supplier_detail.supplier_id
    union all select 'supplier_identifiers', i.id::text
      from public.supplier_identifiers i where i.supplier_id = supplier_detail.supplier_id
    union all select 'supplier_contacts', c.id::text
      from public.supplier_contacts c where c.supplier_id = supplier_detail.supplier_id
    union all select 'memberships', m.id::text
      from public.memberships m where m.supplier_id = supplier_detail.supplier_id
  ), discovered as (
    select a.table_name, a.row_id from public.audit_log a
    where private.is_admin()
      and a.table_name in ('suppliers', 'supplier_names', 'supplier_identifiers',
        'supplier_contacts', 'memberships')
      and (a.changes -> 'supplier_id' ->> 'old' = supplier_id::text
        or a.changes -> 'supplier_id' ->> 'new' = supplier_id::text)
  ), ids as (select * from related union select * from discovered)
  select jsonb_build_object(
    'identifiers', coalesce((select jsonb_agg(to_jsonb(i) order by i.id)
      from public.supplier_identifiers i
      where i.supplier_id = supplier_detail.supplier_id), '[]'::jsonb),
    'contacts', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'kind', c.kind,
      'value', c.value, 'is_valid', c.is_valid, 'source_document_id', c.source_document_id,
      'status', c.status) order by c.id)
      from public.supplier_contacts c
      where c.supplier_id = supplier_detail.supplier_id and c.status = 'current'),
      '[]'::jsonb),
    'audit', case when private.is_admin() then coalesce((
      select jsonb_agg(to_jsonb(a) order by a.created_at desc, a.id desc)
      from public.audit_log a where exists (select 1 from ids
        where ids.table_name = a.table_name and ids.row_id = a.row_id)
    ), '[]'::jsonb) else null end
  )
$$;
