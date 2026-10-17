import type Stripe from "stripe";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type CheckoutSessionForPayment = Pick<
  Stripe.Checkout.Session,
  "id" | "mode" | "livemode" | "payment_status" | "amount_total" | "currency" | "metadata" | "client_reference_id" | "payment_intent"
>;

export function toTestPaymentRecord(session: CheckoutSessionForPayment, eventCreatedAt: number) {
  const userId = session.metadata?.supabase_user_id;
  if (
    !/^cs_test_[A-Za-z0-9]+$/.test(session.id) ||
    session.mode !== "payment" ||
    session.livemode !== false ||
    session.payment_status !== "paid" ||
    session.metadata?.purpose !== "gentx2_test_one_time" ||
    !userId ||
    !UUID_PATTERN.test(userId) ||
    session.client_reference_id !== userId ||
    !Number.isSafeInteger(session.amount_total) ||
    !session.amount_total ||
    !session.currency ||
    !/^[a-z]{3}$/.test(session.currency) ||
    !Number.isSafeInteger(eventCreatedAt) ||
    eventCreatedAt <= 0
  ) return null;

  const paymentIntentId = typeof session.payment_intent === "string"
    ? session.payment_intent
    : session.payment_intent?.id ?? null;
  if (paymentIntentId && !/^pi_[A-Za-z0-9]+$/.test(paymentIntentId)) return null;

  return {
    user_id: userId,
    checkout_session_id: session.id,
    payment_intent_id: paymentIntentId,
    amount_total: session.amount_total,
    currency: session.currency,
    livemode: false,
    paid_at: new Date(eventCreatedAt * 1000).toISOString(),
  };
}
