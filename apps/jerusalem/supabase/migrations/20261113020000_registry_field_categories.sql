-- Add multiple categories per source field while keeping the existing single
-- category column working for older clients during the transition.
create table public.registry_field_categories (
  id uuid primary key default gen_random_uuid(),
  registry_field_id uuid not null references public.registry_fields (id) on delete restrict,
  category_id uuid not null references public.categories (id) on delete restrict,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now(),
  unique (registry_field_id, category_id)
);
create index registry_field_categories_category_idx on public.registry_field_categories (category_id);
select private.track_table('public.registry_field_categories');

alter table public.registry_field_categories enable row level security;
revoke all on public.registry_field_categories from public, anon, authenticated;
grant select, insert, delete on public.registry_field_categories to authenticated;
create policy field_categories_read on public.registry_field_categories for select to authenticated
  using ((select private.is_member()) and exists (
    select 1 from public.categories c where c.id = category_id
  ));
create policy field_categories_insert on public.registry_field_categories for insert to authenticated
  with check ((select private.is_admin()));
create policy field_categories_delete on public.registry_field_categories for delete to authenticated
  using ((select private.is_admin()));

-- Migrate existing mappings without interpreting or overwriting source data.
insert into public.registry_field_categories (registry_field_id, category_id)
select id, category_id from public.registry_fields where category_id is not null;

-- A change made through the old column also updates its corresponding link.
create function private.sync_legacy_field_category()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and old.category_id is distinct from new.category_id then
    delete from public.registry_field_categories
      where registry_field_id = new.id and category_id = old.category_id;
  end if;
  if new.category_id is not null then
    insert into public.registry_field_categories (registry_field_id, category_id)
      values (new.id, new.category_id) on conflict (registry_field_id, category_id) do nothing;
  end if;
  return new;
end;
$$;
revoke all on function private.sync_legacy_field_category() from public, anon, authenticated;
create trigger sync_legacy_field_category after insert or update of category_id
  on public.registry_fields for each row execute function private.sync_legacy_field_category();

-- Remove the legacy mapping through registry_fields first, so the old and new
-- representations cannot disagree. Extra links can be removed directly.
create function private.guard_legacy_field_category()
returns trigger language plpgsql set search_path = '' as $$
begin
  if exists (select 1 from public.registry_fields f
      where f.id = old.registry_field_id and f.category_id = old.category_id) then
    raise exception 'Clear the legacy category before deleting its link' using errcode = '23514';
  end if;
  return old;
end;
$$;
revoke all on function private.guard_legacy_field_category() from public, anon, authenticated;
create trigger guard_legacy_field_category before delete on public.registry_field_categories
  for each row execute function private.guard_legacy_field_category();
