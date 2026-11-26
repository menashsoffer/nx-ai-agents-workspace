-- The pre-12.11 suppliers table and its hand-made backup schema are no longer used: every
-- row was copied into the new model on 12.11. Both were exported and checked (row counts
-- and md5) on 25.11 before this drop, with the owner's approval.

drop table if exists public.legacy_suppliers;
drop schema if exists backup cascade;
