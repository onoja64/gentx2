-- Record opt-in source sharing and the exact regression script reviewed with
-- each WhiteHat patch proposal. Existing rows remain non-consenting by default.
alter table public.scans
  add column if not exists source_analysis_consented boolean not null default false,
  add column if not exists source_hash text check (source_hash is null or source_hash ~ '^[a-f0-9]{64}$');

alter table public.patches
  add column if not exists rationale text not null default ''
  check (length(rationale) <= 1200),
  add column if not exists regression_test text not null default ''
  check (length(regression_test) <= 5000),
  add column if not exists sandbox_run_status text not null default 'not-run'
  check (sandbox_run_status in ('not-run', 'running', 'pass', 'fail', 'inconclusive'));

alter table public.evidence drop constraint if exists evidence_kind_check;
alter table public.evidence
  add constraint evidence_kind_check
  check (kind in ('scanner', 'poc', 'regression', 'replay', 'verifier', 'build', 'lint', 'diff', 'source'));
