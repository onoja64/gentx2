export class StripeTestConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StripeTestConfigurationError";
  }
}

type Environment = Record<string, string | undefined>;

export function stripeTestSecretKeyFrom(env: Environment = process.env): string {
  const secretKey = env.STRIPE_TEST_SECRET_KEY?.trim() || env.STRIPE_API_KEY?.trim();
  if (!secretKey) throw new StripeTestConfigurationError("Stripe test secret key is not configured.");
  if (!/^(sk|rk)_test_[A-Za-z0-9]+$/.test(secretKey)) {
    throw new StripeTestConfigurationError("Stripe test checkout requires a test-mode secret key.");
  }
  return secretKey;
}

export function stripeTestPriceIdFrom(env: Environment = process.env): string {
  const priceId = env.STRIPE_TEST_PRICE_ID?.trim();
  if (!priceId) throw new StripeTestConfigurationError("Stripe test Price is not configured.");
  if (!/^price_[A-Za-z0-9]+$/.test(priceId)) {
    throw new StripeTestConfigurationError("Stripe test Price ID is invalid.");
  }
  return priceId;
}

export function stripeTestWebhookSecretFrom(env: Environment = process.env): string {
  const secret = env.STRIPE_TEST_WEBHOOK_SECRET?.trim();
  if (!secret) throw new StripeTestConfigurationError("Stripe test webhook signing secret is not configured.");
  if (!/^whsec_[A-Za-z0-9]+$/.test(secret)) {
    throw new StripeTestConfigurationError("Stripe test webhook signing secret is invalid.");
  }
  return secret;
}

export function appOriginFrom(env: Environment = process.env): string {
  const configured = env.APP_URL?.trim() || "http://localhost:3000";
  let url: URL;
  try { url = new URL(configured); }
  catch { throw new StripeTestConfigurationError("APP_URL must be a valid app origin."); }
  if (!(["http:", "https:"].includes(url.protocol)) || url.pathname !== "/" || url.search || url.hash || url.username || url.password) {
    throw new StripeTestConfigurationError("APP_URL must be an origin without a path or credentials.");
  }
  if (env.NODE_ENV === "production" && url.protocol !== "https:") {
    throw new StripeTestConfigurationError("APP_URL must use HTTPS in production.");
  }
  return url.origin;
}
