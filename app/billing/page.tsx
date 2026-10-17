import { redirect } from "next/navigation";
import { AppShell } from "@/components/dashboard/app-shell";
import { Card } from "@/components/ui/card";
import { TestCheckout } from "@/components/billing/test-checkout";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getConfiguredTestPrice } from "@/lib/stripe/server";
import { formatStripeAmount } from "@/lib/stripe/format";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type PaymentRow = {
  id: string;
  checkout_session_id: string;
  amount_total: number;
  currency: string;
  paid_at: string;
};

function setupMessage() {
  if (!process.env.STRIPE_TEST_SECRET_KEY && !process.env.STRIPE_API_KEY) return "Add a server-side STRIPE_TEST_SECRET_KEY to enable test checkout.";
  if (!process.env.STRIPE_TEST_PRICE_ID) return "Add an active one-time test Price ID as STRIPE_TEST_PRICE_ID.";
  return "The configured test Price could not be loaded. Check the Stripe test account and server logs.";
}

export default async function BillingPage({ searchParams }: { searchParams: Promise<{ cancelled?: string }> }) {
  const query = await searchParams;
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  let price: Awaited<ReturnType<typeof getConfiguredTestPrice>> | null = null;
  try { price = await getConfiguredTestPrice(); }
  catch { price = null; }

  const { data, error } = await supabase
    .from("stripe_test_payments")
    .select("id,checkout_session_id,amount_total,currency,paid_at")
    .eq("user_id", user.id)
    .order("paid_at", { ascending: false })
    .limit(20);
  const payments = (data ?? []) as PaymentRow[];

  return <AppShell userEmail={user.email ?? "operator"}>
    <div className="mx-auto w-full max-w-5xl px-4 pb-12 pt-6 sm:px-6 lg:px-8 lg:pt-8">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="eyebrow mb-2 text-[var(--terminal-green)]">ACCOUNT / TEST MODE</div>
          <h1 className="mono text-2xl font-semibold tracking-[-.04em]">One-time payment</h1>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">Stripe-hosted checkout using a configured test Price. Test transactions move no money.</p>
        </div>
        <span className="rounded border border-amber-300/20 bg-amber-300/[0.05] px-2.5 py-1.5 mono text-[8px] text-amber-100">TEST PAYMENTS ONLY</span>
      </div>

      {query.cancelled === "1" && <div role="status" className="mb-4 rounded border border-border/70 bg-white/[0.02] px-3 py-2 text-sm text-muted-foreground">Checkout was canceled. No payment was recorded.</div>}

      <Card className="terminal-panel grid gap-6 p-5 sm:p-7 md:grid-cols-[1fr_auto] md:items-center">
        <div>
          <div className="eyebrow text-muted-foreground">CONFIGURED TEST ITEM</div>
          {price ? <>
            <h2 className="mt-2 mono text-lg font-medium">{price.productName.slice(0, 120)}</h2>
            <div className="mt-2 mono text-2xl text-[var(--terminal-green)]">{formatStripeAmount(price.amount, price.currency)}</div>
            <p className="mt-2 text-xs text-muted-foreground">One-time charge · processed only in Stripe test mode</p>
          </> : <>
            <h2 className="mt-2 mono text-lg font-medium">Test Price not configured</h2>
            <p className="mt-2 max-w-xl text-xs leading-relaxed text-muted-foreground">{setupMessage()} Create the Price in Stripe test mode, then set the server-only environment variable and restart the app.</p>
          </>}
        </div>
        <TestCheckout enabled={price !== null} />
      </Card>

      <section className="mt-7">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="eyebrow text-muted-foreground">YOUR CONFIRMED TEST PAYMENTS</h2>
          <span className="mono text-[8px] text-muted-foreground">TEST MODE</span>
        </div>
        <Card className="terminal-panel overflow-hidden">
          {error ? <p role="status" className="p-4 text-xs text-amber-100">Payment history is temporarily unavailable.</p> : payments.length === 0 ? <div className="grid min-h-24 place-items-center px-4 text-center"><p className="mono text-[9px] text-muted-foreground">NO CONFIRMED TEST PAYMENTS</p></div> : <ul className="divide-y divide-border/55">{payments.map((payment) => <li key={payment.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"><span className="mono text-xs text-[var(--terminal-green)]">{formatStripeAmount(payment.amount_total, payment.currency)}</span><span className="text-xs text-muted-foreground">{new Date(payment.paid_at).toLocaleString()}</span><span className="mono text-[8px] text-muted-foreground">{payment.checkout_session_id}</span></li>)}</ul>}
        </Card>
        <p className="mt-2 text-[10px] text-muted-foreground">History appears after Stripe confirms the payment through the configured webhook.</p>
      </section>
    </div>
  </AppShell>;
}
