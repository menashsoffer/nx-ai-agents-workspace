-- Content rules for engagement requests and review notes (documentation/validation-rules-he.md,
-- section 2). Same keys as web/src/lib/rules/requests.ts; the shared cases run on both.
-- Like the supplier rules, only writes by a signed-in user are checked.

create or replace function private.rule_problem(rule text, value text, today date default null)
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
    when 'engagement_subject' then private.text_problem(value, 3, 500, 2)
    when 'amount' then case
      when value is null or value = '' then 'required'
      when replace(value, ',', '') !~ '^[0-9]{1,12}(\.[0-9]{1,2})?$'
        or replace(value, ',', '')::numeric <= 0 then 'bad_amount'
    end
    when 'exemption' then case
      when value is null or value = '' then 'required'
      when value !~ '^3\([0-9]+א?\)$' then 'bad_exemption'
    end
    when 'decision_note' then private.text_problem(value, 2, 2000, 2)
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

create function private.check_engagement_row()
returns trigger language plpgsql set search_path = '' as $$
begin
  if not private.signed_in_write() then return new; end if;
  if tg_op = 'INSERT' or new.subject is distinct from old.subject then
    perform private.raise_rule(private.rule_problem('engagement_subject', new.subject));
  end if;
  if new.estimated_value <= 0 then perform private.raise_rule('bad_amount'); end if;
  if new.requested_exemption is not null then
    perform private.raise_rule(private.rule_problem('exemption', new.requested_exemption));
  end if;
  return new;
end;
$$;

-- Review notes on user profiles and category requests: when one is written, it says something.
create function private.check_review_note()
returns trigger language plpgsql set search_path = '' as $$
declare
  note text := case tg_table_name
    when 'profiles' then to_jsonb(new) ->> 'review_note'
    else to_jsonb(new) ->> 'decision_note' end;
begin
  if private.signed_in_write() and nullif(btrim(note), '') is not null then
    perform private.raise_rule(private.rule_problem('decision_note', btrim(note)));
  end if;
  return new;
end;
$$;

revoke all on function private.check_engagement_row(), private.check_review_note()
  from public, anon;

create trigger check_rules
  before insert or update of subject, estimated_value, requested_exemption
  on public.engagement_requests for each row execute function private.check_engagement_row();
create trigger check_rules before update of review_note on public.profiles
  for each row execute function private.check_review_note();
create trigger check_rules before update of decision_note on public.category_requests
  for each row execute function private.check_review_note();
