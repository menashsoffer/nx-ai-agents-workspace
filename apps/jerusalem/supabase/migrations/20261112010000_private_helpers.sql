-- Shared building blocks: a private schema for helpers, trigram search, row
-- stamping and an append-only audit log used by every table that follows.

create extension if not exists pg_trgm with schema extensions;

create schema private;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to authenticated;

-- Folds the spellings that differ between municipal PDFs: quotes and geresh,
-- punctuation, repeated spaces and the company suffix.
create function private.normalize_name(raw text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select nullif(trim(regexp_replace(
    regexp_replace(
      regexp_replace(lower(coalesce(raw, '')), '\mבע["״'']?מ\M', ' ', 'g'),
      '[^[:alnum:][:space:]]', ' ', 'g'),
    '\s+', ' ', 'g')), '')
$$;
revoke all on function private.normalize_name(text) from public, anon, authenticated;
grant execute on function private.normalize_name(text) to authenticated;

-- The database, not the browser, decides who created a row and when it changed.
create function private.stamp_row()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.created_at := now();
    new.created_by := coalesce(auth.uid(), new.created_by);
  else
    new.created_at := old.created_at;
    new.created_by := old.created_by;
  end if;
  new.updated_at := now();
  return new;
end;
$$;
revoke all on function private.stamp_row() from public, anon, authenticated;

create table public.audit_log (
  id bigint generated always as identity primary key,
  actor_id uuid references auth.users (id) on delete set null,
  table_name text not null,
  row_id text not null,
  operation text not null check (operation in ('INSERT', 'UPDATE', 'DELETE')),
  changes jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index audit_log_row_idx on public.audit_log (table_name, row_id);
create index audit_log_actor_idx on public.audit_log (actor_id);
alter table public.audit_log enable row level security;
revoke all on public.audit_log from public, anon, authenticated;

-- Records only the columns that changed, as old and new values. Columns named in
-- the trigger arguments are recorded as changed without their values.
create function private.audit_row()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  old_row jsonb := case when tg_op = 'INSERT' then '{}'::jsonb else to_jsonb(old) end;
  new_row jsonb := case when tg_op = 'DELETE' then '{}'::jsonb else to_jsonb(new) end;
  hidden text[] := coalesce(tg_argv::text[], '{}');
  diff jsonb;
begin
  select coalesce(jsonb_object_agg(k, case
      when k = any (hidden) then '"[hidden]"'::jsonb
      else jsonb_build_object('old', old_row -> k, 'new', new_row -> k)
    end), '{}'::jsonb)
  into diff
  from (select jsonb_object_keys(old_row || new_row) as k) keys
  where old_row -> k is distinct from new_row -> k
    and k not in ('created_at', 'updated_at');
  insert into public.audit_log (actor_id, table_name, row_id, operation, changes)
  values (auth.uid(), tg_table_name, coalesce(new_row ->> 'id', old_row ->> 'id',
    new_row ->> 'user_id', old_row ->> 'user_id'), tg_op, diff);
  return null;
end;
$$;
revoke all on function private.audit_row() from public, anon, authenticated;

-- Attaches the stamp and audit triggers and indexes created_by in one call, so
-- no table is forgotten.
create function private.track_table(target regclass, hidden_columns text[] default '{}')
returns void
language plpgsql
set search_path = ''
as $$
begin
  execute format('create trigger stamp_row before insert or update on %s '
    'for each row execute function private.stamp_row()', target);
  execute format('create trigger audit_row after insert or update or delete on %s '
    'for each row execute function private.audit_row(%s)', target,
    array_to_string(array(select quote_literal(c) from unnest(hidden_columns) c), ', '));
  execute format('create index on %s (created_by)', target);
end;
$$;
revoke all on function private.track_table(regclass, text[]) from public, anon, authenticated;
