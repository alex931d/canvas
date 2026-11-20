import type Stripe from "stripe";
import { BillingNotConfiguredError, stripe, webhookSecret } from "@/lib/billing/stripe";
import { syncStripeCustomer } from "@/lib/billing/sync";

/**
 * Stripe calls this when a membership changes: checkout finished, renewed,
 * payment failed, cancelled, ended. The signature proves the request came
 * from Stripe (this is why src/proxy.ts lets it through without an Origin
 * header). Every event re-syncs that customer's subscriptions from Stripe.
 *
 * Point a Stripe webhook endpoint at /api/stripe/webhook with these events.
 */
const EVENTS = new Set<string>([
  "checkout.session.completed",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "customer.subscription.paused",
  "customer.subscription.resumed",
  "invoice.paid",
  "invoice.payment_failed",
]);

function customerOf(event: Stripe.Event): string | null {
  const customer = (event.data.object as { customer?: string | { id: string } | null }).customer;
  if (!customer) return null;
  return typeof customer === "string" ? customer : customer.id;
}

export async function POST(request: Request) {
  const signature = request.headers.get("stripe-signature");
  if (!signature) return new Response("Missing Stripe-Signature header", { status: 400 });

  // The signature covers the exact bytes Stripe sent, so read the raw text.
  const payload = await request.text();
  let event: Stripe.Event;
  try {
    event = stripe().webhooks.constructEvent(payload, signature, webhookSecret());
  } catch (err) {
    if (err instanceof BillingNotConfiguredError) {
      console.error("[billing]", err.message);
      return new Response("Memberships aren't configured", { status: 503 });
    }
    return new Response("Invalid signature", { status: 400 });
  }

  if (!EVENTS.has(event.type)) return Response.json({ received: true, ignored: event.type });
  const customerId = customerOf(event);
  if (!customerId) return Response.json({ received: true, ignored: "no customer" });

  const hintUserId =
    event.type === "checkout.session.completed"
      ? (event.data.object as Stripe.Checkout.Session).client_reference_id
      : null;

  try {
    await syncStripeCustomer(customerId, hintUserId);
  } catch (err) {
    // A 500 makes Stripe retry later.
    console.error(`[billing] couldn't sync ${customerId} after ${event.type}:`, err);
    return new Response("Sync failed", { status: 500 });
  }
  return Response.json({ received: true });
}
