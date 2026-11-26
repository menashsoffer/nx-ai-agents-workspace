-- Security Advisor: an event-trigger function must not be callable through the API.
revoke execute on function public.rls_auto_enable() from public, anon, authenticated;

-- Performance Advisor: foreign keys without a covering index.
create index suppliers_created_by_idx on public.suppliers (created_by);
create index activity_events_actor_idx on public.activity_events (actor_id, created_at);
