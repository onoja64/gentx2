-- Keep SECURITY DEFINER membership helpers out of the exposed public API schema.
create schema if not exists gentx2_private;
revoke all on schema gentx2_private from public, anon, authenticated, service_role;
grant usage on schema gentx2_private to authenticated;

create or replace function gentx2_private.gentx2_is_project_member(p_project_id uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.projects p
    where p.id = p_project_id and p.owner_id = (select auth.uid())
  ) or exists (
    select 1 from public.project_members pm
    where pm.project_id = p_project_id and pm.user_id = (select auth.uid())
  )
$$;

create or replace function gentx2_private.gentx2_is_project_owner(p_project_id uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.projects p
    where p.id = p_project_id and p.owner_id = (select auth.uid())
  )
$$;

revoke all on function gentx2_private.gentx2_is_project_member(uuid) from public, anon, authenticated, service_role;
revoke all on function gentx2_private.gentx2_is_project_owner(uuid) from public, anon, authenticated, service_role;
grant execute on function gentx2_private.gentx2_is_project_member(uuid) to authenticated;
grant execute on function gentx2_private.gentx2_is_project_owner(uuid) to authenticated;

drop policy projects_read_member on public.projects;
create policy projects_read_member on public.projects for select to authenticated
  using ((select gentx2_private.gentx2_is_project_member(id)));

drop policy members_read_member on public.project_members;
create policy members_read_member on public.project_members for select to authenticated
  using ((select gentx2_private.gentx2_is_project_member(project_id)));

drop policy members_insert_owner on public.project_members;
create policy members_insert_owner on public.project_members for insert to authenticated
  with check ((select gentx2_private.gentx2_is_project_owner(project_id)) and user_id <> (select owner_id from public.projects where id = project_id));

drop policy members_update_owner on public.project_members;
create policy members_update_owner on public.project_members for update to authenticated
  using ((select gentx2_private.gentx2_is_project_owner(project_id)) and user_id <> (select owner_id from public.projects where id = project_id))
  with check ((select gentx2_private.gentx2_is_project_owner(project_id)) and role in ('admin','member') and user_id <> (select owner_id from public.projects where id = project_id));

drop policy members_delete_owner on public.project_members;
create policy members_delete_owner on public.project_members for delete to authenticated
  using ((select gentx2_private.gentx2_is_project_owner(project_id)) and user_id <> (select owner_id from public.projects where id = project_id));

drop policy targets_read_member on public.targets;
create policy targets_read_member on public.targets for select to authenticated
  using ((select gentx2_private.gentx2_is_project_member(project_id)));

drop policy scans_read_member on public.scans;
create policy scans_read_member on public.scans for select to authenticated
  using ((select gentx2_private.gentx2_is_project_member(project_id)));

drop policy agent_runs_read_member on public.agent_runs;
create policy agent_runs_read_member on public.agent_runs for select to authenticated
  using ((select gentx2_private.gentx2_is_project_member(project_id)));

drop policy findings_read_member on public.findings;
create policy findings_read_member on public.findings for select to authenticated
  using ((select gentx2_private.gentx2_is_project_member(project_id)));

drop policy evidence_read_member on public.evidence;
create policy evidence_read_member on public.evidence for select to authenticated
  using ((select gentx2_private.gentx2_is_project_member(project_id)));

drop policy patches_read_member on public.patches;
create policy patches_read_member on public.patches for select to authenticated
  using ((select gentx2_private.gentx2_is_project_member(project_id)));

drop policy verification_read_member on public.verification_runs;
create policy verification_read_member on public.verification_runs for select to authenticated
  using ((select gentx2_private.gentx2_is_project_member(project_id)));

drop policy scan_rounds_read_member on public.scan_rounds;
create policy scan_rounds_read_member on public.scan_rounds for select to authenticated
  using ((select gentx2_private.gentx2_is_project_member(project_id)));

drop policy audit_events_read_member on public.audit_events;
create policy audit_events_read_member on public.audit_events for select to authenticated
  using ((select gentx2_private.gentx2_is_project_member(project_id)));

-- Cache auth.uid() as an init plan in row policies instead of recalculating it per row.
drop policy profile_read_self on public.profiles;
create policy profile_read_self on public.profiles for select to authenticated
  using (id = (select auth.uid()));

drop policy profile_insert_self on public.profiles;
create policy profile_insert_self on public.profiles for insert to authenticated
  with check (id = (select auth.uid()));

drop policy profile_update_self on public.profiles;
create policy profile_update_self on public.profiles for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

drop policy projects_insert_owner on public.projects;
create policy projects_insert_owner on public.projects for insert to authenticated
  with check (owner_id = (select auth.uid()));

drop policy projects_update_owner on public.projects;
create policy projects_update_owner on public.projects for update to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

drop policy projects_delete_owner on public.projects;
create policy projects_delete_owner on public.projects for delete to authenticated
  using (owner_id = (select auth.uid()));

drop policy targets_insert_member on public.targets;
create policy targets_insert_member on public.targets for insert to authenticated
  with check (owner_id = (select auth.uid()) and (select gentx2_private.gentx2_is_project_member(project_id)));

drop policy scans_insert_member on public.scans;
create policy scans_insert_member on public.scans for insert to authenticated
  with check (
    owner_id = (select auth.uid())
    and (select gentx2_private.gentx2_is_project_member(project_id))
    and exists (
      select 1 from public.targets t
      where t.id = scans.target_id and t.project_id = scans.project_id and t.authorization_confirmed
    )
  );

drop function public.gentx2_is_project_member(uuid);
drop function public.gentx2_is_project_owner(uuid);

-- Keep user-owned artifact paths while allowing the auth value to be evaluated once per statement.
drop policy gentx2_artifact_read_member on storage.objects;
create policy gentx2_artifact_read_member on storage.objects for select to authenticated using (
  bucket_id = 'gentx2-artifacts' and (storage.foldername(name))[1] = ((select auth.uid())::text) and exists (
    select 1 from public.project_members pm where pm.project_id::text = (storage.foldername(name))[2] and pm.user_id = (select auth.uid())
  )
);

drop policy gentx2_artifact_upload_member on storage.objects;
create policy gentx2_artifact_upload_member on storage.objects for insert to authenticated with check (
  bucket_id = 'gentx2-artifacts' and (storage.foldername(name))[1] = ((select auth.uid())::text) and exists (
    select 1 from public.project_members pm where pm.project_id::text = (storage.foldername(name))[2] and pm.user_id = (select auth.uid())
  )
);

drop policy gentx2_artifact_delete_member on storage.objects;
create policy gentx2_artifact_delete_member on storage.objects for delete to authenticated using (
  bucket_id = 'gentx2-artifacts' and (storage.foldername(name))[1] = ((select auth.uid())::text) and exists (
    select 1 from public.project_members pm where pm.project_id::text = (storage.foldername(name))[2] and pm.user_id = (select auth.uid())
  )
);

-- Index foreign keys that are not already covered by a suitable leading index.
create index if not exists projects_owner_id_idx on public.projects(owner_id);
create index if not exists project_members_user_id_idx on public.project_members(user_id, project_id);
create index if not exists targets_owner_id_idx on public.targets(owner_id);
create index if not exists scans_owner_id_idx on public.scans(owner_id);
create index if not exists agent_runs_project_started_idx on public.agent_runs(project_id, started_at);
create index if not exists findings_project_created_idx on public.findings(project_id, created_at);
create index if not exists evidence_project_recorded_idx on public.evidence(project_id, recorded_at);
create index if not exists evidence_finding_id_idx on public.evidence(finding_id);
create index if not exists patches_project_created_idx on public.patches(project_id, created_at);
create index if not exists patches_finding_id_idx on public.patches(finding_id);
create index if not exists patches_approved_by_idx on public.patches(approved_by);
create index if not exists verification_project_recorded_idx on public.verification_runs(project_id, recorded_at);
create index if not exists verification_patch_id_idx on public.verification_runs(patch_id);
create index if not exists scan_rounds_project_recorded_idx on public.scan_rounds(project_id, recorded_at);
create index if not exists audit_events_target_id_idx on public.audit_events(target_id);
