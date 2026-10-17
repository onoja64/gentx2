import "server-only";
import Stripe from "stripe";
import { stripeTestPriceIdFrom, stripeTestSecretKeyFrom } from "@/lib/stripe/config";

let stripeClient: Stripe | undefined;
let cachedSecretKey: string | undefined;

export function getStripeTestClient(): Stripe {
  const secretKey = stripeTestSecretKeyFrom();
  if (!stripeClient || cachedSecretKey !== secretKey) {
    stripeClient = new Stripe(secretKey, { maxNetworkRetries: 1, telemetry: false });
    cachedSecretKey = secretKey;
  }
  return stripeClient;
}

export async function getConfiguredTestPrice() {
  const stripe = getStripeTestClient();
  const priceId = stripeTestPriceIdFrom();
  const price = await stripe.prices.retrieve(priceId, { expand: ["product"] });
  if (!price.active || price.livemode || price.recurring || !Number.isSafeInteger(price.unit_amount) || !price.unit_amount || !/^[a-z]{3}$/.test(price.currency)) {
    throw new Error("Configured Stripe Price must be an active, fixed-amount, one-time test Price.");
  }

  const product = typeof price.product === "string"
    ? await stripe.products.retrieve(price.product)
    : price.product;
  if ("deleted" in product || !product.active) {
    throw new Error("Configured Stripe Price must belong to an active product.");
  }

  return {
    id: price.id,
    amount: price.unit_amount,
    currency: price.currency,
    productName: product.name,
  };
}
