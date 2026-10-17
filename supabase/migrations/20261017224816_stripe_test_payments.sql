-- Successful, one-time payments from Stripe's test environment only.
-- The Stripe webhook is the sole writer; authenticated users can only read their own rows.
create table public.stripe_test_payments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  checkout_session_id text not null unique check (checkout_session_id ~ '^cs_test_[A-Za-z0-9]+$'),
  payment_intent_id text unique check (payment_intent_id is null or payment_intent_id ~ '^pi_[A-Za-z0-9]+$'),
  amount_total bigint not null check (amount_total > 0),
  currency text not null check (currency ~ '^[a-z]{3}$'),
  livemode boolean not null default false check (livemode = false),
  paid_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index stripe_test_payments_user_paid_idx
  on public.stripe_test_payments (user_id, paid_at desc);

alter table public.stripe_test_payments enable row level security;

create policy stripe_test_payments_read_own
  on public.stripe_test_payments
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

revoke all on public.stripe_test_payments from anon, authenticated;
grant select on public.stripe_test_payments to authenticated;
grant all on public.stripe_test_payments to service_role;
