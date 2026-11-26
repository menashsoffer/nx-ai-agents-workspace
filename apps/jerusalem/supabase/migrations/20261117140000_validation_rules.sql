-- Content rules for supplier writes (documentation/validation-rules-he.md).
-- Twin of web/src/lib/rules: every check reports the same key, raised as 'invalid:<key>'.
-- web/src/lib/rules/tests/rule-cases.ts runs the same cases against both.
-- Only writes by a signed-in user are checked: imports of published municipal data
-- (service role, no auth.uid()) keep their source text, and existing rows are untouched.

create function private.text_problem(value text, min_length int, max_length int, min_letters int)
returns text language sql immutable set search_path = '' as $$
  select case
    when value is null or value = '' then 'required'
    when value ~ '[\x01-\x08\x0b\x0c\x0e-\x1f\x7f]' then 'control_chars'
    when length(value) < min_length then 'too_short'
    when length(value) > max_length then 'too_long'
    when length(regexp_replace(value, '[^A-Za-zא-ת]', '', 'g')) < min_letters then 'needs_letters'
    when value ~ '(.)\1\1\1\1' then 'repeated'
  end;
$$;

create function private.valid_check_digit(number text)
returns boolean language plpgsql immutable set search_path = '' as $$
declare
  digits text;
  total int := 0;
  product int;
begin
  if number is null or number !~ '^[0-9]{5,9}$' then return false; end if;
  digits := lpad(number, 9, '0');
  for position in 1..9 loop
    product := substr(digits, position, 1)::int * (2 - position % 2);
    total := total + case when product > 9 then product - 9 else product end;
  end loop;
  return total % 10 = 0;
end;
$$;

create function private.phone_problem(value text)
returns text language sql immutable set search_path = '' as $$
  with digits as (
    select regexp_replace(regexp_replace(coalesce(value, ''), '[\s\-().]', '', 'g'), '^\+972', '0')
      as number
  )
  select case
    when value is null or value = '' then 'required'
    when number ~ '^0(5[0-9]|7[0-9])[0-9]{7}$' or number ~ '^0[2-489][0-9]{7}$'
      or number ~ '^1(700|800|599|801)[0-9]{6}$' or number ~ '^\*[0-9]{4}$'
      or (number ~ '^\+[1-9][0-9]{7,14}$' and number !~ '^\+972') then null
    else 'bad_phone'
  end from digits;
$$;

create function private.identifier_problem(scheme text, value text)
returns text language sql immutable set search_path = '' as $$
  select case
    when value is null or value = '' then 'required'
    when not (case scheme
      when 'company' then value ~ '^5[0-9]{8}$'
      when 'nonprofit' then value ~ '^58[0-9]{7}$'
      when 'vat_dealer' then value ~ '^[0-9]{5,9}$'
      else false end) then 'bad_identifier'
    when not private.valid_check_digit(value) then 'bad_check_digit'
  end;
$$;

create function private.real_date(value text)
returns boolean language plpgsql immutable set search_path = '' as $$
begin
  return value ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' and to_char(value::date, 'YYYY-MM-DD') = value;
exception when others then
  return false;
end;
$$;

create function private.date_problem(value date, latest date)
returns text language sql immutable set search_path = '' as $$
  select case
    when value is null then 'required'
    when value < date '1990-01-01' or value > date '2100-12-31' then 'date_range'
    when value > latest then 'date_future'
  end;
$$;

-- One entry point per rule name, matching RULES in web/src/lib/rules/catalog.ts.
create function private.rule_problem(rule text, value text, today date default null)
returns text language plpgsql stable set search_path = '' as $$
begin
  return case rule
    when 'supplier_name' then private.text_problem(value, 2, 300, 1)
    when 'phone' then private.phone_problem(value)
    when 'email' then case
      when value is null or value = '' then 'required'
      when length(value) > 254 then 'too_long'
      when value !~ '^[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}$' then 'bad_email'
    end
    when 'website' then case
      when value is null or value = '' then 'required'
      when length(value) > 500 then 'too_long'
      when value !~ '^(https?://)?([A-Za-z0-9-]+\.)+[A-Za-z]{2,}(:[0-9]{2,5})?(/\S*)?$' then 'bad_website'
    end
    when 'address' then private.text_problem(value, 5, 300, 2)
    when 'contact_person' then case
      when position('@' in coalesce(value, '')) > 0 then 'has_at'
      else private.text_problem(value, 2, 100, 2)
    end
    when 'status_reason' then private.text_problem(value, 3, 500, 2)
    when 'status_source' then private.text_problem(value, 2, 500, 2)
    when 'identifier:company' then private.identifier_problem('company', value)
    when 'identifier:nonprofit' then private.identifier_problem('nonprofit', value)
    when 'identifier:vat_dealer' then private.identifier_problem('vat_dealer', value)
    when 'date' then case
      when value is null or value = '' then 'required'
      when not private.real_date(value) then 'bad_date'
      else private.date_problem(value::date,
        coalesce(today, (now() at time zone 'Asia/Jerusalem')::date))
    end
    else 'bad_choice'
  end;
end;
$$;

create function private.raise_rule(key text)
returns void language plpgsql immutable set search_path = '' as $$
begin
  if key is not null then
    raise exception 'invalid:%', key using errcode = '22023';
  end if;
end;
$$;

create function private.signed_in_write()
returns boolean language sql stable set search_path = '' as $$
  select auth.uid() is not null;
$$;

create function private.check_supplier_row()
returns trigger language plpgsql set search_path = '' as $$
begin
  if not private.signed_in_write() then return new; end if;
  if tg_op = 'INSERT' or new.display_name is distinct from old.display_name then
    perform private.raise_rule(private.rule_problem('supplier_name', new.display_name));
  end if;
  if new.status = 'inactive' and (tg_op = 'INSERT' or old.status is distinct from 'inactive'
    or new.status_reason is distinct from old.status_reason
    or new.status_source is distinct from old.status_source
    or new.status_changed_on is distinct from old.status_changed_on) then
    perform private.raise_rule(private.rule_problem('status_reason', new.status_reason));
    if new.status_source is not null then
      perform private.raise_rule(private.rule_problem('status_source', new.status_source));
    end if;
    perform private.raise_rule(private.date_problem(new.status_changed_on,
      (now() at time zone 'Asia/Jerusalem')::date));
  end if;
  return new;
end;
$$;

create function private.check_contact_row()
returns trigger language plpgsql set search_path = '' as $$
begin
  if private.signed_in_write() then
    perform private.raise_rule(private.rule_problem(new.kind, new.value));
  end if;
  return new;
end;
$$;

create function private.check_identifier_row()
returns trigger language plpgsql set search_path = '' as $$
begin
  -- Personal ids come only from published pool files and are never typed in a form.
  if private.signed_in_write() and new.scheme <> 'personal_id' then
    perform private.raise_rule(private.identifier_problem(new.scheme, new.value));
  end if;
  return new;
end;
$$;

create function private.check_membership_dates()
returns trigger language plpgsql set search_path = '' as $$
declare
  day date;
begin
  if not private.signed_in_write() then return new; end if;
  foreach day in array array[new.registered_from, new.registered_until, new.engagement_started_on]
  loop
    if day is not null then perform private.raise_rule(private.date_problem(day, date '2100-12-31')); end if;
  end loop;
  if new.registered_until < new.registered_from then
    perform private.raise_rule('dates_order');
  end if;
  return new;
end;
$$;

revoke all on function private.text_problem(text, int, int, int), private.valid_check_digit(text),
  private.phone_problem(text), private.identifier_problem(text, text), private.real_date(text),
  private.date_problem(date, date), private.rule_problem(text, text, date),
  private.raise_rule(text), private.signed_in_write(), private.check_supplier_row(),
  private.check_contact_row(), private.check_identifier_row(), private.check_membership_dates()
  from public, anon;
grant execute on function private.text_problem(text, int, int, int), private.valid_check_digit(text),
  private.phone_problem(text), private.identifier_problem(text, text), private.real_date(text),
  private.date_problem(date, date), private.rule_problem(text, text, date),
  private.raise_rule(text), private.signed_in_write() to authenticated;

create trigger check_rules before insert or update on public.suppliers
  for each row execute function private.check_supplier_row();
create trigger check_rules before insert or update of kind, value on public.supplier_contacts
  for each row execute function private.check_contact_row();
create trigger check_rules before insert or update of scheme, value on public.supplier_identifiers
  for each row execute function private.check_identifier_row();
create trigger check_rules
  before insert or update of registered_from, registered_until, engagement_started_on
  on public.memberships for each row execute function private.check_membership_dates();

-- The edit dialog saves the name and every changed contact in one transaction: either all
-- of it is stored or none. Each part goes through the existing invoker functions, so their
-- permission checks, history rows and the rules above apply unchanged.
create function public.update_supplier(payload jsonb)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  supplier uuid := nullif(payload ->> 'supplier_id', '')::uuid;
  item jsonb;
begin
  if jsonb_typeof(payload) <> 'object'
    or payload - array['supplier_id', 'display_name', 'contacts'] <> '{}'::jsonb
    or supplier is null or jsonb_typeof(payload -> 'contacts') is distinct from 'array'
    or jsonb_array_length(payload -> 'contacts') > 50 then
    raise exception 'Invalid supplier input' using errcode = '22023';
  end if;
  if payload ? 'display_name' then
    perform public.rename_supplier(jsonb_build_object(
      'supplier_id', supplier, 'display_name', payload ->> 'display_name'));
  end if;
  for item in select * from jsonb_array_elements(payload -> 'contacts') loop
    if jsonb_typeof(item) <> 'object' or item - array['contact_id', 'kind', 'value'] <> '{}'::jsonb then
      raise exception 'Invalid contact' using errcode = '22023';
    end if;
    perform public.replace_supplier_contact(jsonb_build_object(
      'supplier_id', supplier, 'contact_id', coalesce(item ->> 'contact_id', ''),
      'kind', item ->> 'kind', 'value', item ->> 'value'));
  end loop;
  return supplier;
end;
$$;
revoke all on function public.update_supplier(jsonb) from public, anon;
grant execute on function public.update_supplier(jsonb) to authenticated;
