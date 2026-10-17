import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { appOriginFrom } from "@/lib/stripe/config";
import { getConfiguredTestPrice, getStripeTestClient } from "@/lib/stripe/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let appOrigin: string;
  try { appOrigin = appOriginFrom(); }
  catch { return NextResponse.json({ error: "Test checkout is not configured." }, { status: 503 }); }

  const originHeader = request.headers.get("origin");
  try {
    if (!originHeader || new URL(originHeader).origin !== appOrigin) {
      return NextResponse.json({ error: "Request origin is not allowed." }, { status: 403 });
    }
  } catch {
    return NextResponse.json({ error: "Request origin is not allowed." }, { status: 403 });
  }

  const requestId = request.headers.get("idempotency-key") ?? "";
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId)) {
    return NextResponse.json({ error: "A valid checkout request ID is required." }, { status: 400 });
  }

  try {
    const supabase = await createSupabaseServerClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Authentication required." }, { status: 401 });

    const stripe = getStripeTestClient();
    const price = await getConfiguredTestPrice();
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      allowed_payment_method_types: ["card"],
      line_items: [{ price: price.id, quantity: 1 }],
      client_reference_id: user.id,
      customer_email: user.email ?? undefined,
      metadata: {
        supabase_user_id: user.id,
        purpose: "gentx2_test_one_time",
      },
      success_url: `${appOrigin}/billing/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${appOrigin}/billing?cancelled=1`,
    }, { idempotencyKey: `gentx2-test-checkout-${user.id}-${requestId}` });

    if (!session.url || session.livemode) {
      return NextResponse.json({ error: "Stripe did not create a test-mode checkout session." }, { status: 502 });
    }
    return NextResponse.json({ url: session.url }, { headers: { "cache-control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Test checkout could not be prepared. Confirm the test key and active one-time test Price." }, { status: 503 });
  }
}
