-- Monthly threshold update (regulation 2). The threshold-index Edge Function reads
-- the CPI from CBS once a day and proposes the next monthly row. A proposal changes
-- nothing until an admin approves it, and only then a row is added to thresholds.
-- public.job_runs logs every scheduled run, so a silent failure is visible.

create table public.job_runs (
  id bigint generated always as identity primary key,
  job text not null check (length(job) between 1 and 50),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'running' check (status in ('running', 'ok', 'failed')),
  detail jsonb not null default '{}'
);
create index job_runs_job_started on public.job_runs (job, started_at desc);

create table public.threshold_proposals (
  id uuid primary key default gen_random_uuid(),
  valid_from date not null unique check (extract(day from valid_from) = 16),
  index_value numeric(10, 4) not null check (index_value > 0),
  no_tender_max numeric(14, 2) not null,
  zuta4_max numeric(14, 2) not null,
  zuta6_max numeric(14, 2) not null,
  source text not null check (length(trim(source)) between 2 and 500),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by uuid references auth.users (id) on delete set null,
  threshold_id uuid references public.thresholds (id) on delete set null
);
create index threshold_proposals_decided_by on public.threshold_proposals (decided_by);
create index threshold_proposals_threshold on public.threshold_proposals (threshold_id);

alter table public.job_runs enable row level security;
alter table public.threshold_proposals enable row level security;
revoke all on public.job_runs, public.threshold_proposals from public, anon, authenticated;
grant select on public.job_runs, public.threshold_proposals to authenticated;
create policy job_runs_admin_read on public.job_runs for select to authenticated
  using ((select private.is_admin()));
create policy threshold_proposals_admin_read on public.threshold_proposals
  for select to authenticated using ((select private.is_admin()));

-- Starts a run unless the same job started within min_gap_minutes. Returns the run
-- id, or null when the run is skipped, so repeated calls to the public trigger cost one query.
create function public.job_start(job_name text, min_gap_minutes integer)
returns bigint
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  run_id bigint;
begin
  perform pg_advisory_xact_lock(hashtext('job_runs:' || job_name));
  if exists (
    select 1 from public.job_runs
    where job = job_name and started_at > now() - make_interval(mins => min_gap_minutes)
  ) then
    return null;
  end if;
  insert into public.job_runs (job) values (job_name) returning id into run_id;
  return run_id;
end
$$;

create function public.job_finish(run_id bigint, run_status text, run_detail jsonb)
returns void
language sql
volatile
security definer
set search_path = ''
as $$
  update public.job_runs
  set finished_at = now(), status = run_status, detail = coalesce(run_detail, '{}')
  where id = run_id and status = 'running'
$$;

-- Proposes the row for a month that starts on starts_on. Answers 'covered' when a
-- threshold is already in force on that day, 'pending' or 'decided' when a proposal
-- exists, and 'proposed' when a new one was added.
create function public.propose_threshold(cpi numeric, starts_on date, cpi_source text)
returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  existing text;
begin
  if exists (
    select 1 from public.thresholds t
    where starts_on between t.valid_from and coalesce(t.valid_until, starts_on)
  ) then
    return 'covered';
  end if;
  select case when p.status = 'pending' then 'pending' else 'decided' end into existing
  from public.threshold_proposals p where p.valid_from = starts_on;
  if found then
    return existing;
  end if;
  insert into public.threshold_proposals (valid_from, index_value, no_tender_max, zuta4_max,
    zuta6_max, source)
  select starts_on, cpi, c.no_tender_max, c.zuta4_max, c.zuta6_max, cpi_source
  from public.calculate_thresholds(cpi) c;
  return 'proposed';
end
$$;

revoke all on function public.job_start(text, integer), public.job_finish(bigint, text, jsonb),
  public.propose_threshold(numeric, date, text) from public, anon, authenticated;
grant execute on function public.job_start(text, integer), public.job_finish(bigint, text, jsonb),
  public.propose_threshold(numeric, date, text) to service_role;

-- An admin approves or rejects a pending proposal. The database owner may also
-- decide from the SQL editor, where no user is signed in. Approval adds the row
-- to thresholds with the same calculation as record_threshold.
create function public.decide_threshold_proposal(proposal uuid, approve boolean)
returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  p public.threshold_proposals;
  new_id uuid;
begin
  if not (private.is_admin() or (auth.uid() is null and session_user = 'postgres')) then
    raise exception 'Not authorized to decide thresholds' using errcode = '42501';
  end if;
  select * into p from public.threshold_proposals where id = proposal for update;
  if not found or p.status <> 'pending' then
    raise exception 'No pending proposal with this id' using errcode = 'P0002';
  end if;
  if approve then
    insert into public.thresholds (valid_from, valid_until, no_tender_max, zuta4_max,
      zuta6_max, index_value, source, is_official, created_by)
    values (p.valid_from, (p.valid_from + interval '1 month' - interval '1 day')::date,
      p.no_tender_max, p.zuta4_max, p.zuta6_max, p.index_value, p.source, false, auth.uid())
    returning id into new_id;
  end if;
  update public.threshold_proposals
  set status = case when approve then 'approved' else 'rejected' end,
    decided_at = now(), decided_by = auth.uid(), threshold_id = new_id
  where id = proposal;
  return new_id;
end
$$;

revoke all on function public.decide_threshold_proposal(uuid, boolean) from public, anon;
grant execute on function public.decide_threshold_proposal(uuid, boolean) to authenticated;
