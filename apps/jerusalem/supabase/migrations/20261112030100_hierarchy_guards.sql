-- Guards ported from the reviewed access draft (PR #5): two-level hierarchies for
-- units and categories, and revoked grants that stay revoked.

create function private.check_unit_parent()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  parent_kind text;
begin
  if new.kind = 'department' then
    select kind into parent_kind from public.org_units where id = new.parent_id for update;
    if not found or parent_kind <> 'administration' then
      raise exception 'A department must belong to an administration' using errcode = '23514';
    end if;
  end if;
  if new.kind = 'department' and exists (
    select 1 from public.org_units where parent_id = new.id
  ) then
    raise exception 'A unit with departments cannot become a department' using errcode = '23514';
  end if;
  return new;
end;
$$;

create function private.check_category_parent()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  grandparent uuid;
begin
  if new.parent_id is not null then
    select parent_id into grandparent from public.categories where id = new.parent_id for update;
    if not found or grandparent is not null then
      raise exception 'A category parent must be a top-level category' using errcode = '23514';
    end if;
    if exists (select 1 from public.categories where parent_id = new.id) then
      raise exception 'A category with children cannot become a child' using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;

create function private.prevent_grant_reactivation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.revoked_at is not null and new.revoked_at is distinct from old.revoked_at then
    raise exception 'Create a new grant instead of changing a revoked one' using errcode = '23514';
  end if;
  if new.user_id <> old.user_id or new.role <> old.role
    or new.unit_id is distinct from old.unit_id then
    raise exception 'A grant cannot be moved to another user, role or unit'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

revoke all on function private.check_unit_parent(), private.check_category_parent(),
  private.prevent_grant_reactivation() from public, anon, authenticated;

create trigger check_parent before insert or update of parent_id, kind on public.org_units
  for each row execute function private.check_unit_parent();
create trigger check_parent before insert or update of parent_id on public.categories
  for each row execute function private.check_category_parent();
create trigger prevent_reactivation before update on public.role_grants
  for each row execute function private.prevent_grant_reactivation();
