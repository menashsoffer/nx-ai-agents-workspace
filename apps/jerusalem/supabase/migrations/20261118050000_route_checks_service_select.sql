-- The route-check Edge Function stores each check with the secret key and reads the new
-- id back (`Prefer: return=representation`, an insert ... returning). RETURNING needs
-- SELECT, and 20261112060100 revoked it, so every saved check failed with
-- "permission denied for table route_checks" and the site showed a generic error.
-- The service role already bypasses RLS; this only lets it read what it writes.
grant select on public.route_checks to service_role;
