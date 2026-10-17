create policy audit_heads_service_role_all on public.audit_heads
for all to service_role
using (true)
with check (true);
