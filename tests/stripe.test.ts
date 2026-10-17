import assert from "node:assert/strict";
import test from "node:test";
import {
  appOriginFrom,
  StripeTestConfigurationError,
  stripeTestPriceIdFrom,
  stripeTestSecretKeyFrom,
  stripeTestWebhookSecretFrom,
} from "../lib/stripe/config";
import { toTestPaymentRecord } from "../lib/stripe/payments";

const userId = "123e4567-e89b-42d3-a456-426614174000";

test("Stripe test configuration accepts test keys and rejects live keys", () => {
  assert.equal(stripeTestSecretKeyFrom({ STRIPE_TEST_SECRET_KEY: "sk_test_example123" }), "sk_test_example123");
  assert.equal(stripeTestSecretKeyFrom({ STRIPE_API_KEY: "rk_test_example123" }), "rk_test_example123");
  assert.throws(() => stripeTestSecretKeyFrom({ STRIPE_TEST_SECRET_KEY: "sk_live_example123" }), StripeTestConfigurationError);
  assert.throws(() => stripeTestSecretKeyFrom({}), StripeTestConfigurationError);
});

test("test Price and webhook configuration are validated", () => {
  assert.equal(stripeTestPriceIdFrom({ STRIPE_TEST_PRICE_ID: "price_example123" }), "price_example123");
  assert.throws(() => stripeTestPriceIdFrom({ STRIPE_TEST_PRICE_ID: "prod_example123" }), StripeTestConfigurationError);
  assert.equal(stripeTestWebhookSecretFrom({ STRIPE_TEST_WEBHOOK_SECRET: "whsec_example123" }), "whsec_example123");
  assert.throws(() => stripeTestWebhookSecretFrom({ STRIPE_TEST_WEBHOOK_SECRET: "" }), StripeTestConfigurationError);
});

test("production checkout origin must use HTTPS and remain origin-only", () => {
  assert.equal(appOriginFrom({ APP_URL: "https://gentx.example", NODE_ENV: "production" }), "https://gentx.example");
  assert.throws(() => appOriginFrom({ APP_URL: "http://gentx.example", NODE_ENV: "production" }), StripeTestConfigurationError);
  assert.throws(() => appOriginFrom({ APP_URL: "https://gentx.example/billing", NODE_ENV: "production" }), StripeTestConfigurationError);
});

test("only authenticated, paid, one-time test sessions become payment records", () => {
  const session = {
    id: "cs_test_example123",
    mode: "payment",
    livemode: false,
    payment_status: "paid",
    amount_total: 1299,
    currency: "usd",
    metadata: { supabase_user_id: userId, purpose: "gentx2_test_one_time" },
    client_reference_id: userId,
    payment_intent: "pi_example123",
  } as const;
  assert.deepEqual(toTestPaymentRecord(session, 1_782_000_000), {
    user_id: userId,
    checkout_session_id: "cs_test_example123",
    payment_intent_id: "pi_example123",
    amount_total: 1299,
    currency: "usd",
    livemode: false,
    paid_at: new Date(1_782_000_000 * 1000).toISOString(),
  });
  assert.equal(toTestPaymentRecord({ ...session, livemode: true }, 1_782_000_000), null);
  assert.equal(toTestPaymentRecord({ ...session, payment_status: "unpaid" }, 1_782_000_000), null);
  assert.equal(toTestPaymentRecord({ ...session, mode: "subscription" }, 1_782_000_000), null);
  assert.equal(toTestPaymentRecord({ ...session, client_reference_id: "another-user" }, 1_782_000_000), null);
});
