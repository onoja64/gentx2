select plan(22);

-- Inspect RLS, policy definitions, and grants without inserting sample or user records.
select is(
  (
    select count(*)::integer
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname in (
        'profiles', 'projects', 'project_members', 'targets', 'scans',
        'agent_runs', 'findings', 'evidence', 'patches', 'verification_runs',
        'scan_rounds', 'audit_heads', 'audit_events', 'stripe_test_payments'
      )
      and c.relrowsecurity
  ),
  14,
  'RLS is enabled on every protected public table'
);

select is(
  (
    select count(distinct tablename)::integer
    from pg_policies
    where schemaname = 'public'
      and tablename in (
        'profiles', 'projects', 'project_members', 'targets', 'scans',
        'agent_runs', 'findings', 'evidence', 'patches', 'verification_runs',
        'scan_rounds', 'audit_events', 'stripe_test_payments'
      )
  ),
  13,
  'all user-readable tables have explicit policies'
);

select ok(
  (
    select bool_and(coalesce(qual, '') like '%gentx2_is_project_member%')
    from pg_policies
    where schemaname = 'public'
      and tablename in (
        'projects', 'project_members', 'targets', 'scans', 'agent_runs',
        'findings', 'evidence', 'patches', 'verification_runs', 'scan_rounds',
        'audit_events'
      )
      and cmd = 'SELECT'
  ),
  'project-scoped read policies use the membership check'
);

select ok(
  (
    select bool_and(coalesce(with_check, '') like '%auth.uid()%')
    from pg_policies
    where schemaname = 'public'
      and policyname in (
        'profile_insert_self', 'profile_update_self', 'projects_insert_owner',
        'projects_update_owner', 'targets_insert_member', 'scans_insert_member'
      )
  ),
  'user write policies bind ownership to the authenticated identity'
);

select ok(not has_table_privilege('anon', 'public.projects', 'SELECT'), 'anonymous users cannot read projects');
select ok(has_table_privilege('authenticated', 'public.projects', 'SELECT'), 'authenticated users can read authorized projects');
select ok(has_table_privilege('authenticated', 'public.stripe_test_payments', 'SELECT'), 'signed-in users can read their own payment rows through RLS');
select ok(not has_table_privilege('authenticated', 'public.stripe_test_payments', 'INSERT'), 'signed-in users cannot write payment rows');
select ok(has_table_privilege('service_role', 'public.stripe_test_payments', 'INSERT'), 'the webhook service role can record payments');
select ok(
  exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'stripe_test_payments'
      and policyname = 'stripe_test_payments_read_own'
      and cmd = 'SELECT' and coalesce(qual, '') like '%auth.uid()%'
  ),
  'payment history is restricted to the authenticated owner'
);
select ok(not has_table_privilege('authenticated', 'public.agent_runs', 'INSERT'), 'authenticated users cannot create agent runs');
select ok(not has_table_privilege('authenticated', 'public.findings', 'UPDATE'), 'authenticated users cannot rewrite findings');
select ok(not has_table_privilege('authenticated', 'public.audit_events', 'UPDATE'), 'authenticated users cannot rewrite audit events');
select ok(not has_table_privilege('authenticated', 'public.audit_events', 'DELETE'), 'authenticated users cannot delete audit events');
select ok(not has_function_privilege('authenticated', 'public.gentx2_append_audit_event(uuid,uuid,uuid,text,text,jsonb)', 'EXECUTE'), 'authenticated users cannot call the privileged audit writer');
select ok(has_function_privilege('service_role', 'public.gentx2_append_audit_event(uuid,uuid,uuid,text,text,jsonb)', 'EXECUTE'), 'the trusted service role can append audit events');
select ok(
  not exists (
    select 1 from pg_proc p
    where p.oid = to_regprocedure('public.rls_auto_enable()')
      and has_function_privilege('anon', p.oid, 'EXECUTE')
  ),
  'anonymous users cannot execute the RLS event-trigger function as RPC'
);
select ok(not has_schema_privilege('anon', 'gentx2_private', 'USAGE'), 'the private helper schema is not accessible to anonymous users');
select ok(has_schema_privilege('authenticated', 'gentx2_private', 'USAGE'), 'authenticated policies can resolve private helpers');
select ok(has_function_privilege('authenticated', 'gentx2_private.gentx2_is_project_member(uuid)', 'EXECUTE'), 'authenticated policies can execute the private membership helper');
select ok(to_regprocedure('public.gentx2_is_project_member(uuid)') is null, 'membership helpers are no longer exposed in the public API schema');
select ok(
  exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'audit_heads'
      and policyname = 'audit_heads_service_role_all'
      and cmd = 'ALL' and roles = array['service_role']::name[]
  ) and not has_table_privilege('authenticated', 'public.audit_heads', 'SELECT'),
  'audit heads are reserved for the trusted service role'
);

select * from finish();
