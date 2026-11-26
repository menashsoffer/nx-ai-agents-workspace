-- Legacy JWT claims alone survive profile suspension or role revocation. Keep the
-- existing claim requirement and additionally require the current database admin.
alter policy supplier_admin_select on public.legacy_suppliers
  using (
    ((select auth.jwt()) -> 'app_metadata' ->> 'role') = 'supplier_admin'
    and (select private.is_admin())
  );

alter policy supplier_admin_insert on public.legacy_suppliers
  with check (
    ((select auth.jwt()) -> 'app_metadata' ->> 'role') = 'supplier_admin'
    and (select private.is_admin())
    and created_by = (select auth.uid())
  );

alter policy supplier_admin_update on public.legacy_suppliers
  using (
    ((select auth.jwt()) -> 'app_metadata' ->> 'role') = 'supplier_admin'
    and (select private.is_admin())
  )
  with check (
    ((select auth.jwt()) -> 'app_metadata' ->> 'role') = 'supplier_admin'
    and (select private.is_admin())
  );
