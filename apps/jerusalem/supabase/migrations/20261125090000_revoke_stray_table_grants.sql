-- Supabase's default privileges give anon and authenticated TRUNCATE, REFERENCES,
-- TRIGGER and MAINTAIN on every new public table. Most migrations revoke all first,
-- but two objects kept them. RLS does not stop TRUNCATE, so remove them and stop new
-- tables from receiving them at all.

revoke truncate, references, trigger on public.access_change_requests from anon, authenticated;
revoke all on public.access_change_requests from anon;
revoke truncate, references, trigger on public.threshold_coverage from anon, authenticated;

alter default privileges for role postgres in schema public
  revoke all on tables from anon, authenticated;
