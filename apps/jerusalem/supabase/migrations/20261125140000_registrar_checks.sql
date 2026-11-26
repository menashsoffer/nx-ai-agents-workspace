-- Stage B of the alignment review (25.11): the registry functions now also ask data.gov.il
-- for a nonprofit's registrar status, this year's proper-management certificate and the
-- registrar events of the last 12 months, and store which checks ran (registry_details).
-- The nonprofit registrar writes "נמחקה", which the inactive rule did not know yet.

create or replace function private.registry_inactive(status text)
returns boolean language sql immutable set search_path = '' as $$
  select coalesce(status ~ 'מחוק|מחיקה|נמחק|מחוסל|פירוק|פורק|לא פעיל|בוטל|לא נמצא', false);
$$;

-- Verified numbers are asked again by the daily recheck, now with the new checks, instead of
-- waiting 30 days from their last answer.
update public.supplier_identifiers set checked_at = null
where review_status = 'verified' and scheme in ('company', 'nonprofit');
