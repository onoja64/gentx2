create extension if not exists pgcrypto;

-- Keep the platform's RLS auto-enable event trigger active without exposing
-- its SECURITY DEFINER function through PostgREST RPC.
do $block$
begin
  if to_regprocedure('public.rls_auto_enable()') is not null then
    execute 'revoke execute on function public.rls_auto_enable() from public, anon, authenticated';
  end if;
end
$block$;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text check (display_name is null or length(display_name) <= 120),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete restrict,
  name text not null check (length(trim(name)) between 1 and 120),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.project_members (
  project_id uuid not null references public.projects(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member' check (role in ('admin', 'member')),
  created_at timestamptz not null default now(),
  primary key (project_id, user_id)
);

create table public.targets (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete restrict,
  kind text not null check (kind in ('archive', 'github', 'url')),
  label text not null check (length(label) between 1 and 160),
  origin text,
  scope_paths jsonb not null check (jsonb_typeof(scope_paths) = 'array' and jsonb_array_length(scope_paths) between 1 and 50),
  access_mode text not null check (access_mode in ('source', 'url-only')),
  source_hash text check (source_hash is null or source_hash ~ '^[a-f0-9]{64}$'),
  source_reference text,
  authorization_confirmed boolean not null check (authorization_confirmed),
  authorization_phrase text not null check (authorization_phrase = 'I AM AUTHORIZED'),
  authorized_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  check ((kind = 'url' and access_mode = 'url-only' and origin is not null) or (kind in ('archive','github') and access_mode = 'source'))
);
create index targets_project_created_idx on public.targets(project_id, created_at desc);

create table public.scans (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  target_id uuid not null references public.targets(id) on delete restrict,
  owner_id uuid not null references auth.users(id) on delete restrict,
  status text not null default 'ready' check (status in ('ready','running','blocked','stopped','completed','failed')),
  workflow_state text not null default 'INTAKE' check (workflow_state in ('INTAKE','BASELINE','ATTACK','VERIFY','PATCH','REGRESSION','RETEST','RECORD','CONTINUE_OR_STOP')),
  round integer not null default 0 check (round between 0 and 10),
  consecutive_clean_rounds integer not null default 0 check (consecutive_clean_rounds between 0 and 3),
  hard_round_limit integer not null default 10 check (hard_round_limit between 1 and 10),
  sandbox_id text,
  stop_reason text check (stop_reason is null or length(stop_reason) <= 500),
  final_report jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, project_id)
);
create index scans_project_created_idx on public.scans(project_id, created_at desc);
create index scans_target_idx on public.scans(target_id);

create table public.agent_runs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  scan_id uuid not null references public.scans(id) on delete cascade,
  agent_role text not null check (agent_role in ('blackhat','whitehat','sentinel','auditor','orchestrator')),
  status text not null check (status in ('queued','running','completed','failed','inconclusive','cancelled')),
  model text,
  input_hash text check (input_hash is null or input_hash ~ '^[a-f0-9]{64}$'),
  output_hash text check (output_hash is null or output_hash ~ '^[a-f0-9]{64}$'),
  input_tokens integer check (input_tokens is null or input_tokens >= 0),
  output_tokens integer check (output_tokens is null or output_tokens >= 0),
  cost_usd numeric(12,6) check (cost_usd is null or cost_usd >= 0),
  error_code text check (error_code is null or length(error_code) <= 80),
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  result jsonb
);
create index agent_runs_scan_idx on public.agent_runs(scan_id, started_at);

create table public.findings (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  scan_id uuid not null references public.scans(id) on delete cascade,
  title text not null check (length(title) between 1 and 240),
  severity text not null check (severity in ('critical','high','medium','low','info')),
  confidence text not null check (confidence in ('confirmed','high','medium','low','unknown')),
  status text not null check (status in ('verified','unverified','inconclusive','resolved')),
  summary text not null check (length(summary) between 1 and 4000),
  target_path text check (target_path is null or length(target_path) <= 2048),
  evidence_ids uuid[] not null default '{}',
  round integer not null check (round between 1 and 10),
  verifier_version text,
  created_at timestamptz not null default now()
);
create index findings_scan_created_idx on public.findings(scan_id, created_at);

create table public.evidence (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  scan_id uuid not null references public.scans(id) on delete cascade,
  finding_id uuid references public.findings(id) on delete set null,
  kind text not null check (kind in ('scanner','poc','regression','replay','verifier','build','lint','diff')),
  verified boolean not null default false,
  command_hash text not null check (command_hash ~ '^[a-f0-9]{64}$'),
  stdout_hash text not null check (stdout_hash ~ '^[a-f0-9]{64}$'),
  stderr_hash text not null check (stderr_hash ~ '^[a-f0-9]{64}$'),
  exit_code integer check (exit_code between -255 and 255),
  elapsed_ms integer not null check (elapsed_ms between 0 and 3600000),
  bounded_output text not null default '' check (length(bounded_output) <= 16384),
  storage_path text,
  retention_expires_at timestamptz not null default (now() + interval '30 days'),
  recorded_at timestamptz not null default now()
);
create index evidence_scan_idx on public.evidence(scan_id, recorded_at);

create table public.patches (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  scan_id uuid not null references public.scans(id) on delete cascade,
  finding_id uuid references public.findings(id) on delete set null,
  file_path text not null check (length(file_path) between 1 and 2048),
  diff text not null check (length(diff) <= 24000),
  patch_hash text not null check (patch_hash ~ '^[a-f0-9]{64}$'),
  status text not null default 'proposed' check (status in ('proposed','approved','applied','rejected','rolled-back')),
  approval_required boolean not null default true,
  approved_by uuid references auth.users(id) on delete set null,
  approved_at timestamptz,
  created_at timestamptz not null default now()
);
create index patches_scan_created_idx on public.patches(scan_id, created_at);

create table public.verification_runs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  scan_id uuid not null references public.scans(id) on delete cascade,
  patch_id uuid references public.patches(id) on delete set null,
  check_type text not null check (check_type in ('independent-verification','build','lint','regression','exploit-replay','legitimate-access','security-test')),
  status text not null check (status in ('pass','fail','inconclusive','not-run')),
  verifier_version text not null,
  evidence_ids uuid[] not null default '{}',
  detail text not null default '' check (length(detail) <= 4000),
  recorded_at timestamptz not null default now()
);
create index verification_scan_idx on public.verification_runs(scan_id, recorded_at);

create table public.scan_rounds (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  scan_id uuid not null references public.scans(id) on delete cascade,
  round_number integer not null check (round_number between 1 and 10),
  checks jsonb not null check (jsonb_typeof(checks) = 'object'),
  clean boolean not null default false,
  verified_finding_count integer not null default 0 check (verified_finding_count >= 0),
  summary text not null check (length(summary) <= 4000),
  evidence_hash text not null check (evidence_hash ~ '^[a-f0-9]{64}$'),
  recorded_at timestamptz not null default now(),
  unique (scan_id, round_number)
);

create table public.audit_heads (
  project_id uuid primary key references public.projects(id) on delete cascade,
  last_sequence bigint not null default 0 check (last_sequence >= 0),
  last_hash text check (last_hash is null or last_hash ~ '^[a-f0-9]{64}$'),
  updated_at timestamptz not null default now()
);

create table public.audit_events (
  event_id bigint generated always as identity primary key,
  project_id uuid not null references public.projects(id) on delete cascade,
  sequence bigint not null check (sequence > 0),
  scan_id uuid references public.scans(id) on delete set null,
  target_id uuid references public.targets(id) on delete set null,
  actor text not null check (length(actor) between 1 and 80),
  type text not null check (type ~ '^[A-Z][A-Z0-9_]{1,63}$'),
  payload jsonb not null check (octet_length(payload::text) <= 65536),
  created_at timestamptz not null,
  previous_hash text check (previous_hash is null or previous_hash ~ '^[a-f0-9]{64}$'),
  event_hash text not null check (event_hash ~ '^[a-f0-9]{64}$'),
  unique (project_id, sequence)
);
create index audit_events_scan_sequence_idx on public.audit_events(scan_id, sequence);

create or replace function public.gentx2_is_project_member(p_project_id uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp
as $$ select exists (select 1 from public.projects p where p.id = p_project_id and p.owner_id = auth.uid()) or exists (select 1 from public.project_members pm where pm.project_id = p_project_id and pm.user_id = auth.uid()) $$;

create or replace function public.gentx2_is_project_owner(p_project_id uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp
as $$ select exists (select 1 from public.projects p where p.id = p_project_id and p.owner_id = auth.uid()) $$;

revoke all on function public.gentx2_is_project_member(uuid) from public;
revoke all on function public.gentx2_is_project_owner(uuid) from public;
revoke all on function public.gentx2_is_project_member(uuid) from anon, authenticated;
revoke all on function public.gentx2_is_project_owner(uuid) from anon, authenticated;
grant execute on function public.gentx2_is_project_member(uuid) to authenticated;
grant execute on function public.gentx2_is_project_owner(uuid) to authenticated;

create or replace function public.gentx2_add_project_owner_member()
returns trigger language plpgsql security definer set search_path = public, pg_temp
as $$ begin insert into public.project_members(project_id, user_id, role) values (new.id, new.owner_id, 'admin') on conflict do nothing; insert into public.audit_heads(project_id) values (new.id) on conflict do nothing; return new; end $$;
revoke all on function public.gentx2_add_project_owner_member() from public, anon, authenticated;
create trigger gentx2_project_owner_member after insert on public.projects for each row execute function public.gentx2_add_project_owner_member();

create or replace function public.gentx2_create_profile()
returns trigger language plpgsql security definer set search_path = public, pg_temp
as $$ begin insert into public.profiles(id, display_name) values (new.id, nullif(new.raw_user_meta_data ->> 'name', '')) on conflict (id) do nothing; return new; end $$;
revoke all on function public.gentx2_create_profile() from public, anon, authenticated;
create trigger gentx2_auth_profile after insert on auth.users for each row execute function public.gentx2_create_profile();

create or replace function public.gentx2_canonical_jsonb(value jsonb)
returns text language plpgsql immutable strict set search_path = public, pg_temp
as $$
declare result text;
begin
  case jsonb_typeof(value)
    when 'object' then select '{' || coalesce(string_agg(to_json(key)::text || ':' || public.gentx2_canonical_jsonb(val), ',' order by key), '') || '}' into result from jsonb_each(value) as e(key,val); return result;
    when 'array' then select '[' || coalesce(string_agg(public.gentx2_canonical_jsonb(val), ',' order by ord), '') || ']' into result from jsonb_array_elements(value) with ordinality as e(val,ord); return result;
    else return value::text;
  end case;
end $$;

create or replace function public.gentx2_append_audit_event(
  p_project_id uuid, p_scan_id uuid, p_target_id uuid, p_actor text, p_type text, p_payload jsonb
) returns public.audit_events language plpgsql security definer set search_path = public, extensions, pg_temp
as $$
declare v_head public.audit_heads; v_seq bigint; v_created timestamptz; v_unsigned jsonb; v_hash text; v_event public.audit_events;
begin
  if (auth.jwt() ->> 'role') is distinct from 'service_role' then raise exception 'trusted server role required' using errcode = '42501'; end if;
  if length(p_actor) not between 1 and 80 or p_type !~ '^[A-Z][A-Z0-9_]{1,63}$' or octet_length(p_payload::text) > 65536 then raise exception 'invalid audit event'; end if;
  insert into public.audit_heads(project_id) values (p_project_id) on conflict do nothing;
  select * into v_head from public.audit_heads where project_id = p_project_id for update;
  v_seq := v_head.last_sequence + 1;
  v_created := clock_timestamp();
  v_unsigned := jsonb_build_object(
    'sequence', v_seq,
    'sessionId', p_scan_id,
    'targetId', p_target_id,
    'actor', p_actor,
    'type', p_type,
    'payload', p_payload,
    'createdAt', to_char(v_created at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'previousHash', v_head.last_hash
  );
  v_hash := encode(digest(convert_to(public.gentx2_canonical_jsonb(v_unsigned), 'UTF8'), 'sha256'), 'hex');
  insert into public.audit_events(project_id, sequence, scan_id, target_id, actor, type, payload, created_at, previous_hash, event_hash)
    values (p_project_id, v_seq, p_scan_id, p_target_id, p_actor, p_type, p_payload, v_created, v_head.last_hash, v_hash) returning * into v_event;
  update public.audit_heads set last_sequence = v_seq, last_hash = v_hash, updated_at = v_created where project_id = p_project_id;
  return v_event;
end $$;
revoke all on function public.gentx2_append_audit_event(uuid,uuid,uuid,text,text,jsonb) from public, anon, authenticated;
grant execute on function public.gentx2_append_audit_event(uuid,uuid,uuid,text,text,jsonb) to service_role;

create or replace function public.gentx2_reject_audit_mutation()
returns trigger language plpgsql set search_path = public, pg_temp
as $$ begin raise exception 'audit events are immutable' using errcode = '55000'; end $$;
create trigger gentx2_audit_immutable before update or delete on public.audit_events for each row execute function public.gentx2_reject_audit_mutation();

alter table public.profiles enable row level security;
alter table public.projects enable row level security;
alter table public.project_members enable row level security;
alter table public.targets enable row level security;
alter table public.scans enable row level security;
alter table public.agent_runs enable row level security;
alter table public.findings enable row level security;
alter table public.evidence enable row level security;
alter table public.patches enable row level security;
alter table public.verification_runs enable row level security;
alter table public.scan_rounds enable row level security;
alter table public.audit_heads enable row level security;
alter table public.audit_events enable row level security;

create policy profile_read_self on public.profiles for select to authenticated using (id = auth.uid());
create policy profile_insert_self on public.profiles for insert to authenticated with check (id = auth.uid());
create policy profile_update_self on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());
create policy projects_read_member on public.projects for select to authenticated using (public.gentx2_is_project_member(id));
create policy projects_insert_owner on public.projects for insert to authenticated with check (owner_id = auth.uid());
create policy projects_update_owner on public.projects for update to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy projects_delete_owner on public.projects for delete to authenticated using (owner_id = auth.uid());
create policy members_read_member on public.project_members for select to authenticated using (public.gentx2_is_project_member(project_id));
create policy members_insert_owner on public.project_members for insert to authenticated with check (public.gentx2_is_project_owner(project_id) and user_id <> (select owner_id from public.projects where id = project_id));
create policy members_update_owner on public.project_members for update to authenticated using (public.gentx2_is_project_owner(project_id) and user_id <> (select owner_id from public.projects where id = project_id)) with check (public.gentx2_is_project_owner(project_id) and role in ('admin','member') and user_id <> (select owner_id from public.projects where id = project_id));
create policy members_delete_owner on public.project_members for delete to authenticated using (public.gentx2_is_project_owner(project_id) and user_id <> (select owner_id from public.projects where id = project_id));
create policy targets_read_member on public.targets for select to authenticated using (public.gentx2_is_project_member(project_id));
create policy targets_insert_member on public.targets for insert to authenticated with check (owner_id = auth.uid() and public.gentx2_is_project_member(project_id));
create policy scans_read_member on public.scans for select to authenticated using (public.gentx2_is_project_member(project_id));
create policy scans_insert_member on public.scans for insert to authenticated with check (owner_id = auth.uid() and public.gentx2_is_project_member(project_id) and exists (select 1 from public.targets t where t.id = scans.target_id and t.project_id = scans.project_id and t.authorization_confirmed));
create policy agent_runs_read_member on public.agent_runs for select to authenticated using (public.gentx2_is_project_member(project_id));
create policy findings_read_member on public.findings for select to authenticated using (public.gentx2_is_project_member(project_id));
create policy evidence_read_member on public.evidence for select to authenticated using (public.gentx2_is_project_member(project_id));
create policy patches_read_member on public.patches for select to authenticated using (public.gentx2_is_project_member(project_id));
create policy verification_read_member on public.verification_runs for select to authenticated using (public.gentx2_is_project_member(project_id));
create policy scan_rounds_read_member on public.scan_rounds for select to authenticated using (public.gentx2_is_project_member(project_id));
create policy audit_events_read_member on public.audit_events for select to authenticated using (public.gentx2_is_project_member(project_id));

revoke all on public.profiles, public.projects, public.project_members, public.targets, public.scans, public.agent_runs, public.findings, public.evidence, public.patches, public.verification_runs, public.scan_rounds, public.audit_heads, public.audit_events from anon, authenticated;
grant select, insert, update on public.profiles to authenticated;
grant select, insert, update, delete on public.projects, public.project_members to authenticated;
grant select, insert on public.targets, public.scans to authenticated;
grant select on public.agent_runs, public.findings, public.evidence, public.patches, public.verification_runs, public.scan_rounds, public.audit_events to authenticated;
grant all on public.profiles, public.projects, public.project_members, public.targets, public.scans, public.agent_runs, public.findings, public.evidence, public.patches, public.verification_runs, public.scan_rounds, public.audit_heads, public.audit_events to service_role;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('gentx2-artifacts', 'gentx2-artifacts', false, 10485760, array['application/json','text/plain','application/zip','text/x-diff'])
on conflict (id) do nothing;
create policy gentx2_artifact_read_member on storage.objects for select to authenticated using (
  bucket_id = 'gentx2-artifacts' and (storage.foldername(name))[1] = auth.uid()::text and exists (
    select 1 from public.project_members pm where pm.project_id::text = (storage.foldername(name))[2] and pm.user_id = auth.uid()
  )
);
create policy gentx2_artifact_upload_member on storage.objects for insert to authenticated with check (
  bucket_id = 'gentx2-artifacts' and (storage.foldername(name))[1] = auth.uid()::text and exists (
    select 1 from public.project_members pm where pm.project_id::text = (storage.foldername(name))[2] and pm.user_id = auth.uid()
  )
);
create policy gentx2_artifact_delete_member on storage.objects for delete to authenticated using (
  bucket_id = 'gentx2-artifacts' and (storage.foldername(name))[1] = auth.uid()::text and exists (
    select 1 from public.project_members pm where pm.project_id::text = (storage.foldername(name))[2] and pm.user_id = auth.uid()
  )
);
