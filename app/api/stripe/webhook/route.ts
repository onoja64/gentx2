import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { stripeTestWebhookSecretFrom } from "@/lib/stripe/config";
import { toTestPaymentRecord } from "@/lib/stripe/payments";
import { getStripeTestClient } from "@/lib/stripe/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const signature = request.headers.get("stripe-signature");
  if (!signature) return NextResponse.json({ error: "Stripe signature is required." }, { status: 400 });

  let event: Stripe.Event;
  try {
    const [stripe, webhookSecret, rawBody] = await Promise.all([
      Promise.resolve(getStripeTestClient()),
      Promise.resolve(stripeTestWebhookSecretFrom()),
      request.text(),
    ]);
    event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
  } catch {
    return NextResponse.json({ error: "Webhook signature is invalid or test-mode configuration is missing." }, { status: 400 });
  }

  if (event.livemode) return NextResponse.json({ received: true, ignored: true });
  if (event.type !== "checkout.session.completed" && event.type !== "checkout.session.async_payment_succeeded") {
    return NextResponse.json({ received: true });
  }

  const session = event.data.object as Stripe.Checkout.Session;
  const payment = toTestPaymentRecord(session, event.created);
  if (!payment) return NextResponse.json({ received: true, ignored: true });

  try {
    const admin = createSupabaseAdminClient();
    const { error } = await admin
      .from("stripe_test_payments")
      .upsert(payment, { onConflict: "checkout_session_id", ignoreDuplicates: true });
    if (error) return NextResponse.json({ error: "Payment record could not be saved." }, { status: 500 });
    return NextResponse.json({ received: true });
  } catch {
    return NextResponse.json({ error: "Payment record could not be saved." }, { status: 500 });
  }
}
