import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, CheckCircle2, Clock3, ShieldCheck } from "lucide-react";
import { AppShell } from "@/components/dashboard/app-shell";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { formatStripeAmount } from "@/lib/stripe/format";
import { getStripeTestClient } from "@/lib/stripe/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function TestPaymentSuccessPage({ searchParams }: { searchParams: Promise<{ session_id?: string }> }) {
  const query = await searchParams;
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  let paidSession: { amount: number; currency: string } | null = null;
  let isPending = false;
  const sessionId = query.session_id ?? "";
  if (/^cs_test_[A-Za-z0-9]+$/.test(sessionId)) {
    try {
      const session = await getStripeTestClient().checkout.sessions.retrieve(sessionId);
      const belongsToUser = session.client_reference_id === user.id &&
        session.metadata?.supabase_user_id === user.id &&
        session.metadata?.purpose === "gentx2_test_one_time";
      if (!session.livemode && session.mode === "payment" && belongsToUser) {
        if (session.payment_status === "paid" && session.amount_total && session.currency) {
          paidSession = { amount: session.amount_total, currency: session.currency };
        } else {
          isPending = true;
        }
      }
    } catch {
      // Do not disclose Stripe errors or another user's checkout session.
    }
  }

  return <AppShell userEmail={user.email ?? "operator"}>
    <div className="mx-auto w-full max-w-3xl px-4 pb-12 pt-8 sm:px-6 lg:px-8 lg:pt-12">
      <Card className="terminal-panel p-6 sm:p-8">
        {paidSession ? <>
          <div className="flex size-10 items-center justify-center rounded-full border border-[var(--terminal-green)]/25 bg-[var(--terminal-green)]/[0.06] text-[var(--terminal-green)]"><CheckCircle2 className="size-5" /></div>
          <div className="eyebrow mt-5 text-[var(--terminal-green)]">TEST PAYMENT CONFIRMED</div>
          <h1 className="mt-2 mono text-2xl font-semibold">Checkout complete</h1>
          <p className="mt-3 text-sm text-muted-foreground">Stripe confirmed a one-time test payment of <span className="mono text-foreground">{formatStripeAmount(paidSession.amount, paidSession.currency)}</span>. No money moved.</p>
        </> : isPending ? <>
          <div className="flex size-10 items-center justify-center rounded-full border border-amber-300/25 bg-amber-300/[0.06] text-amber-100"><Clock3 className="size-5" /></div>
          <div className="eyebrow mt-5 text-amber-100">PAYMENT PENDING</div>
          <h1 className="mt-2 mono text-2xl font-semibold">Waiting for confirmation</h1>
          <p className="mt-3 text-sm text-muted-foreground">This test payment has not been confirmed yet. Refresh this page after Stripe completes processing.</p>
        </> : <>
          <div className="flex size-10 items-center justify-center rounded-full border border-rose-300/20 bg-rose-300/[0.04] text-rose-100"><ShieldCheck className="size-5" /></div>
          <div className="eyebrow mt-5 text-muted-foreground">NO VERIFIED PAYMENT</div>
          <h1 className="mt-2 mono text-2xl font-semibold">Checkout could not be confirmed</h1>
          <p className="mt-3 text-sm text-muted-foreground">The session is missing, incomplete, or does not belong to this signed-in account.</p>
        </>}
        <Button asChild variant="outline" className="mt-6"><Link href="/billing"><ArrowLeft className="size-3.5" />Back to billing</Link></Button>
      </Card>
    </div>
  </AppShell>;
}
