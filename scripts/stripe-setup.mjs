// Creates the membership's product and $5/month price in your Stripe account
// (what `npm run stripe:setup` runs), then prints the STRIPE_PRICE_ID to use.
//
// The product gets a tax code (Software as a service, personal use), which
// Stripe requires for Checkout when Managed Payments is on, as it is by
// default on new accounts. An existing product without one gets it too.
//
// Safe to run again: it finds the price by its lookup key instead of making
// another. Uses STRIPE_SECRET_KEY from .env.local: run it once with your test
// key and once with your live key.
import nextEnv from "@next/env";
import Stripe from "stripe";

nextEnv.loadEnvConfig(process.cwd(), false, { info: () => {}, error: console.error });

// Keep in step with MEMBERSHIP in src/lib/billing/plan.ts.
const PLAN = {
  productName: "canvas membership",
  unitAmount: 500,
  currency: "usd",
  interval: "month",
  lookupKey: "canvas_membership_monthly",
  // https://docs.stripe.com/payments/managed-payments/eligibility#product-tax-code-requirements
  taxCode: "txcd_10103000",
};

const key = process.env.STRIPE_SECRET_KEY;
if (!key) {
  console.error("STRIPE_SECRET_KEY is not set. Add your Stripe secret key (sk_test_...) to .env.local and try again.");
  process.exit(1);
}

const base = process.env.STRIPE_API_BASE ? new URL(process.env.STRIPE_API_BASE) : null;
const stripe = new Stripe(
  key,
  base ? { host: base.hostname, port: base.port, protocol: base.protocol.replace(":", "") } : {},
);
const mode = key.startsWith("sk_live_") ? "live" : "test";

try {
  const existing = await stripe.prices.list({ lookup_keys: [PLAN.lookupKey], active: true, limit: 1 });
  let price = existing.data[0];

  if (
    price &&
    (price.unit_amount !== PLAN.unitAmount ||
      price.currency !== PLAN.currency ||
      price.recurring?.interval !== PLAN.interval)
  ) {
    // The plan changed: make a new price and move the lookup key over to it.
    console.log(
      `Found ${price.id}, but it isn't ${PLAN.unitAmount / 100} ${PLAN.currency.toUpperCase()}/${PLAN.interval}; making a new price.`,
    );
    price = undefined;
  }

  if (!price) {
    price = await stripe.prices.create({
      unit_amount: PLAN.unitAmount,
      currency: PLAN.currency,
      recurring: { interval: PLAN.interval },
      lookup_key: PLAN.lookupKey,
      transfer_lookup_key: true,
      product_data: { name: PLAN.productName, tax_code: PLAN.taxCode },
    });
    console.log(`Created ${price.id} in ${mode} mode.`);
  } else {
    console.log(`Found ${price.id} in ${mode} mode.`);
  }

  // Older setups made the product without a tax code; Checkout refuses it under Managed Payments.
  const productId = typeof price.product === "string" ? price.product : price.product.id;
  const product = await stripe.products.retrieve(productId);
  const current = typeof product.tax_code === "string" ? product.tax_code : product.tax_code?.id;
  if (current !== PLAN.taxCode) {
    await stripe.products.update(productId, { tax_code: PLAN.taxCode });
    console.log(`Set ${productId}'s tax code to ${PLAN.taxCode} (Software as a service, personal use).`);
  }

  console.log(
    `\nAdd this to .env.local (and to your host's environment for ${mode} mode):\n\nSTRIPE_PRICE_ID=${price.id}\n`,
  );
} catch (err) {
  console.error(`Stripe said: ${err.message}`);
  if (err.type === "StripeAuthenticationError") console.error("Check STRIPE_SECRET_KEY in .env.local.");
  process.exit(1);
}
