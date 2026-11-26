-- Engagements: monthly thresholds, a unit's engagement request, the route check
-- the rules engine returned, approaches to suppliers, committee decisions,
-- contracts and their changes. Everything here is internal and scoped by unit.

-- Regulation 2: thresholds are updated on the 16th of each month by the index.
create table public.thresholds (
  id uuid primary key default gen_random_uuid(),
  valid_from date not null,
  valid_until date,
  no_tender_max numeric(14, 2) not null check (no_tender_max > 0),
  zuta4_max numeric(14, 2) not null check (zuta4_max > no_tender_max),
  zuta6_max numeric(14, 2) not null check (zuta6_max > zuta4_max),
  index_value numeric(10, 4) check (index_value > 0),
  source text not null check (length(trim(source)) between 2 and 500),
  is_official boolean not null default false,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now(),
  check (valid_until is null or valid_until >= valid_from),
  exclude using gist (daterange(valid_from, valid_until, '[]') with &&)
);

create table public.engagement_requests (
  id uuid primary key default gen_random_uuid(),
  unit_id uuid not null references public.org_units (id) on delete restrict,
  subject text not null check (length(trim(subject)) between 3 and 500),
  -- Regulation 5: related requests share a key so splitting can be checked.
  subject_key text check (length(subject_key) <= 200),
  estimated_value numeric(14, 2) not null check (estimated_value >= 0),
  value_includes_vat boolean not null,
  requested_exemption text check (requested_exemption ~ '^3\([0-9]+א?\)$'),
  facts jsonb not null default '{}'::jsonb check (jsonb_typeof(facts) = 'object'),
  supplier_id uuid references public.suppliers (id) on delete restrict,
  membership_id uuid references public.memberships (id) on delete restrict,
  needed_by date,
  status text not null default 'draft' check (status in (
    'draft', 'submitted', 'approved', 'rejected', 'cancelled', 'contracted'
  )),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now()
);
create index engagement_requests_unit_idx on public.engagement_requests (unit_id, status);
create index engagement_requests_subject_idx on public.engagement_requests (unit_id, subject_key);
create index engagement_requests_supplier_idx on public.engagement_requests (supplier_id);
create index engagement_requests_membership_idx on public.engagement_requests (membership_id);

-- Append-only: what the engine answered, with its exact input and thresholds.
create table public.route_checks (
  id bigint generated always as identity primary key,
  request_id uuid not null references public.engagement_requests (id) on delete restrict,
  threshold_id uuid references public.thresholds (id) on delete restrict,
  checked_on date not null,
  input jsonb not null check (jsonb_typeof(input) = 'object'),
  route text not null check (length(route) <= 100),
  regulation text check (length(regulation) <= 100),
  status text not null check (status in ('ok', 'needs_review', 'blocked')),
  allowed boolean not null,
  missing jsonb not null default '[]'::jsonb check (jsonb_typeof(missing) = 'array'),
  warnings jsonb not null default '[]'::jsonb check (jsonb_typeof(warnings) = 'array'),
  engine_version text not null check (length(engine_version) <= 100),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now()
);
create index route_checks_request_idx on public.route_checks (request_id);
create index route_checks_threshold_idx on public.route_checks (threshold_id);

create table public.supplier_approaches (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.engagement_requests (id) on delete restrict,
  supplier_id uuid not null references public.suppliers (id) on delete restrict,
  approached_on date not null,
  channel text not null check (channel in ('email', 'phone', 'portal', 'letter', 'other')),
  responded boolean,
  offer_amount numeric(14, 2) check (offer_amount >= 0),
  offer_includes_vat boolean,
  note text check (length(note) <= 2000),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now(),
  unique (request_id, supplier_id),
  check ((offer_amount is null) = (offer_includes_vat is null))
);
create index supplier_approaches_supplier_idx on public.supplier_approaches (supplier_id);

create table public.contracts (
  id uuid primary key default gen_random_uuid(),
  unit_id uuid not null references public.org_units (id) on delete restrict,
  supplier_id uuid not null references public.suppliers (id) on delete restrict,
  request_id uuid references public.engagement_requests (id) on delete restrict,
  contract_number text check (length(contract_number) <= 100),
  subject text not null check (length(trim(subject)) between 3 and 500),
  starts_on date not null,
  ends_on date,
  original_value numeric(14, 2) not null check (original_value >= 0),
  value_includes_vat boolean not null,
  status text not null default 'active'
    check (status in ('draft', 'active', 'ended', 'terminated')),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now(),
  check (ends_on is null or ends_on >= starts_on)
);
create unique index contracts_number_idx on public.contracts (contract_number);
create index contracts_unit_idx on public.contracts (unit_id, status);
create index contracts_supplier_idx on public.contracts (supplier_id);
create index contracts_request_idx on public.contracts (request_id);

create table public.committee_decisions (
  id uuid primary key default gen_random_uuid(),
  committee text not null
    check (committee in ('tenders', 'exemption', 'procurement', 'council', 'other')),
  request_id uuid references public.engagement_requests (id) on delete restrict,
  contract_id uuid references public.contracts (id) on delete restrict,
  decided_on date not null,
  decision text not null check (decision in ('approved', 'rejected', 'deferred')),
  regulation text check (length(regulation) <= 100),
  reasoning text check (length(reasoning) <= 5000),
  published_on date,
  source_document_id uuid references public.source_documents (id) on delete restrict,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now(),
  check (request_id is not null or contract_id is not null),
  check (published_on is null or published_on >= decided_on)
);
create index committee_decisions_request_idx on public.committee_decisions (request_id);
create index committee_decisions_contract_idx on public.committee_decisions (contract_id);
create index committee_decisions_source_idx on public.committee_decisions (source_document_id);

-- Regulation 3(7) increases and 3(20) continuations, counted cumulatively.
create table public.contract_changes (
  id uuid primary key default gen_random_uuid(),
  contract_id uuid not null references public.contracts (id) on delete restrict,
  kind text not null check (kind in (
    'increase_existing_item', 'increase_added_items', 'continuation_3_20',
    'option_exercise', 'extension'
  )),
  amount numeric(14, 2) not null default 0 check (amount >= 0),
  months integer check (months > 0),
  item_description text check (length(item_description) <= 1000),
  decision_id uuid references public.committee_decisions (id) on delete restrict,
  regulation text check (length(regulation) <= 100),
  effective_on date not null,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now()
);
create index contract_changes_contract_idx on public.contract_changes (contract_id);
create index contract_changes_decision_idx on public.contract_changes (decision_id);

select private.track_table('public.thresholds');
select private.track_table('public.engagement_requests');
select private.track_table('public.route_checks');
select private.track_table('public.supplier_approaches');
select private.track_table('public.contracts');
select private.track_table('public.committee_decisions');
select private.track_table('public.contract_changes');
