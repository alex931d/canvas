import "server-only";

import Stripe from "stripe";

/**
 * The Stripe client and settings, from the environment:
 *
 *   STRIPE_SECRET_KEY      sk_test_... or sk_live_...
 *   STRIPE_PRICE_ID        price_... for the $5/month membership (npm run stripe:setup)
 *   STRIPE_WEBHOOK_SECRET  whsec_... from `stripe listen` or the Dashboard's webhook endpoint
 *
 * STRIPE_API_BASE is for the e2e tests only: it points the SDK at the local
 * mock in e2e/mock-stripe.mjs.
 */

export class BillingNotConfiguredError extends Error {
  constructor(variable: string) {
    super(`Memberships need ${variable} to be set (see "Memberships" in README.md).`);
    this.name = "BillingNotConfiguredError";
  }
}

function setting(name: "STRIPE_SECRET_KEY" | "STRIPE_PRICE_ID" | "STRIPE_WEBHOOK_SECRET"): string {
  const value = process.env[name];
  if (!value) throw new BillingNotConfiguredError(name);
  return value;
}

const g = globalThis as unknown as { canvasStripe?: Stripe };

export function stripe(): Stripe {
  if (g.canvasStripe) return g.canvasStripe;
  const base = process.env.STRIPE_API_BASE ? new URL(process.env.STRIPE_API_BASE) : null;
  g.canvasStripe = new Stripe(setting("STRIPE_SECRET_KEY"), {
    maxNetworkRetries: 2,
    ...(base
      ? {
          host: base.hostname,
          port: base.port || (base.protocol === "https:" ? 443 : 80),
          protocol: base.protocol === "https:" ? "https" : "http",
        }
      : {}),
  });
  return g.canvasStripe;
}

export const priceId = () => setting("STRIPE_PRICE_ID");
export const webhookSecret = () => setting("STRIPE_WEBHOOK_SECRET");
