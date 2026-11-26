-- The load-control tab (documentation/catalog-portal-spec-he.md, stage E, section 6.7). One
-- read for an admin or an auditor, built from what the database records about loads: job
-- runs, import batches, registries and their memberships, identifier candidates waiting for
-- a decision, and suppliers that share a name. Counts and statuses only: no contact
-- details, identifier numbers or free-text notes leave the function.

create function public.load_control()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not (private.is_admin() or private.has_role(array['auditor'])) then
    raise exception 'Only an admin or an auditor reads load control' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'jobs', coalesce((select jsonb_agg(to_jsonb(j) order by j.started_at desc) from (
      select job, status, started_at, finished_at from public.job_runs
      order by started_at desc limit 20) j), '[]'::jsonb),
    'batches', coalesce((select jsonb_agg(to_jsonb(b) order by b.created_at desc) from (
      select b.script_name, b.status, b.row_count, b.created_at,
        count(r.id) filter (where r.status = 'pending')::int as pending,
        count(r.id) filter (where r.status = 'duplicate')::int as duplicates
      from public.import_batches b left join public.import_rows r on r.batch_id = b.id
      group by b.id order by b.created_at desc limit 20) b), '[]'::jsonb),
    'registries', coalesce((select jsonb_agg(to_jsonb(g) order by g.name) from (
      select r.name, r.status,
        count(m.id) filter (where m.review_status not in ('rejected', 'removed'))::int
          as memberships,
        count(m.id) filter (where m.review_status = 'needs_review')::int as needs_review,
        count(m.id) filter (where m.review_status = 'verified')::int as verified
      from public.registries r
      left join public.registry_versions v on v.registry_id = r.id
      left join public.memberships m on m.registry_version_id = v.id
      group by r.id) g), '[]'::jsonb),
    'candidates', coalesce((select jsonb_object_agg(source, n) from (
      select source, count(*)::int as n from public.identifier_candidates
      where status = 'pending' group by source) c), '{}'::jsonb),
    'identifiers_pending', (select count(*)::int from public.supplier_identifiers
      where review_status = 'needs_review'),
    -- A shared name is only a reason to look, never proof of the same supplier.
    'same_names', (select count(*)::int from (
      select 1 from public.suppliers where status <> 'merged'
      group by lower(trim(display_name)) having count(*) > 1) d),
    'venues', (select count(*)::int from public.venue_specs)
  );
end;
$$;
revoke all on function public.load_control() from public, anon;
grant execute on function public.load_control() to authenticated;
