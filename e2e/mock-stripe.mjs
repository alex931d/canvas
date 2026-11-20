// A stand-in for the parts of Stripe the app uses, for the e2e tests:
// the API calls (customers, Checkout Sessions, subscriptions, billing portal
// sessions, prices), simple hosted "checkout" and "billing portal" pages, and
// webhooks signed exactly like Stripe's (with the stripe package's own helper).
//
//   node e2e/mock-stripe.mjs        # http://localhost:12111
//
// Start the app with STRIPE_API_BASE=http://localhost:12111 STRIPE_SECRET_KEY=sk_test_mock
// STRIPE_WEBHOOK_SECRET=whsec_mock STRIPE_PRICE_ID=price_mock (see README, Tests).
import http from "node:http";
import { randomBytes } from "node:crypto";
import Stripe from "stripe";

const PORT = Number(process.env.MOCK_STRIPE_PORT ?? 12111);
const SELF = `http://localhost:${PORT}`;
const WEBHOOK_URL = process.env.WEBHOOK_URL ?? "http://localhost:3000/api/stripe/webhook";
const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET ?? "whsec_mock";
/** Real Stripe's webhooks race the redirect back to the site; so do these. */
const WEBHOOK_DELAY_MS = Number(process.env.MOCK_WEBHOOK_DELAY_MS ?? 400);

const signer = new Stripe("sk_test_mock");
const now = () => Math.floor(Date.now() / 1000);
const newId = (prefix) => `${prefix}_${randomBytes(12).toString("hex")}`;

let customers, sessions, subscriptions, portals, prices, idempotent, deliveries;
function reset() {
  customers = new Map();
  sessions = new Map();
  subscriptions = new Map();
  portals = new Map();
  prices = new Map();
  idempotent = new Map();
  deliveries = [];
}
reset();

/** Stripe's form encoding: a[b][0][c]=v → { a: { b: [{ c: "v" }] } } */
function parseParams(str) {
  const out = {};
  for (const [rawKey, value] of new URLSearchParams(str)) {
    const parts = rawKey.replace(/\]/g, "").split("[");
    let cur = out;
    parts.forEach((part, i) => {
      const key = part === "" ? String(Array.isArray(cur) ? cur.length : Object.keys(cur).length) : part;
      if (i === parts.length - 1) {
        cur[key] = value;
        return;
      }
      const nextIsIndex = parts[i + 1] === "" || /^\d+$/.test(parts[i + 1]);
      cur[key] ??= nextIsIndex ? [] : {};
      cur = cur[key];
    });
  }
  return out;
}

async function deliver(type, object) {
  const event = {
    id: newId("evt"),
    object: "event",
    api_version: "2026-10-28.endive",
    created: now(),
    livemode: false,
    type,
    data: { object: structuredClone(object) },
  };
  const payload = JSON.stringify(event);
  const header = signer.webhooks.generateTestHeaderString({ payload, secret: WEBHOOK_SECRET });
  try {
    const res = await fetch(WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Stripe-Signature": header },
      body: payload,
    });
    deliveries.push({ type, status: res.status });
  } catch (err) {
    deliveries.push({ type, error: String(err) });
  }
}
const deliverLater = (...events) =>
  setTimeout(async () => {
    for (const [type, object] of events) await deliver(type, object);
  }, WEBHOOK_DELAY_MS);

function subscriptionFor(session) {
  const start = now();
  const sub = {
    id: newId("sub"),
    object: "subscription",
    customer: session.customer,
    status: "active",
    cancel_at_period_end: false,
    cancel_at: null,
    canceled_at: null,
    ended_at: null,
    created: start,
    metadata: session.subscription_data?.metadata ?? {},
    items: {
      object: "list",
      data: [
        {
          id: newId("si"),
          object: "subscription_item",
          price: { id: session.line_items?.[0]?.price ?? "price_mock", object: "price" },
          quantity: 1,
          current_period_start: start,
          current_period_end: start + 30 * 86400,
        },
      ],
    },
  };
  subscriptions.set(sub.id, sub);
  return sub;
}

/** What the API returns for a session (the line items and subscription data stay private). */
const PRIVATE_SESSION_FIELDS = new Set(["line_items", "subscription_data"]);
const publicSession = (session) =>
  Object.fromEntries(Object.entries(session).filter(([key]) => !PRIVATE_SESSION_FIELDS.has(key)));

const json = (res, status, body) => {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
};
const notFound = (res, what) =>
  json(res, 404, { error: { type: "invalid_request_error", message: `No such ${what}` } });
const redirect = (res, url) => {
  res.writeHead(303, { Location: url });
  res.end();
};
const page = (res, title, body) => {
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(`<!doctype html><title>${title}</title><body style="font-family:sans-serif;max-width:32rem;margin:4rem auto">
<p style="color:#888">Mock Stripe (tests only)</p><h1>${title}</h1>${body}</body>`);
};
const button = (action, id, label) =>
  `<form method="post" action="${action}"><button id="${id}" style="font-size:1rem;padding:.6rem 1rem;margin:.3rem 0">${label}</button></form>`;

async function readBody(req) {
  let body = "";
  for await (const chunk of req) body += chunk;
  return body;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, SELF);
  const path = url.pathname;
  const raw = req.method === "GET" ? "" : await readBody(req);
  const params = req.method === "GET" ? parseParams(url.search.slice(1)) : parseParams(raw);
  let m;

  // ------------------------------------------------------------ API
  if (req.method === "POST" && path === "/v1/customers") {
    const key = req.headers["idempotency-key"];
    if (key && idempotent.has(key)) return json(res, 200, idempotent.get(key));
    const customer = {
      id: newId("cus"),
      object: "customer",
      email: params.email,
      name: params.name,
      metadata: params.metadata ?? {},
    };
    customers.set(customer.id, customer);
    if (key) idempotent.set(key, customer);
    return json(res, 200, customer);
  }

  if (req.method === "POST" && path === "/v1/checkout/sessions") {
    if (!customers.has(params.customer)) return notFound(res, "customer");
    const session = {
      id: newId("cs_test"),
      object: "checkout.session",
      mode: params.mode,
      status: "open",
      payment_status: "unpaid",
      customer: params.customer,
      client_reference_id: params.client_reference_id ?? null,
      subscription: null,
      success_url: params.success_url,
      cancel_url: params.cancel_url,
      line_items: params.line_items,
      subscription_data: params.subscription_data,
      url: null,
    };
    session.url = `${SELF}/c/pay/${session.id}`;
    sessions.set(session.id, session);
    return json(res, 200, publicSession(session));
  }

  if (req.method === "GET" && (m = path.match(/^\/v1\/checkout\/sessions\/([^/]+)$/))) {
    const session = sessions.get(m[1]);
    if (!session) return notFound(res, "checkout session");
    return json(res, 200, publicSession(session));
  }

  if (req.method === "GET" && path === "/v1/subscriptions") {
    const data = [...subscriptions.values()]
      .filter((s) => !params.customer || s.customer === params.customer)
      .filter((s) => params.status === "all" || (params.status ? s.status === params.status : s.status !== "canceled"))
      .sort((a, b) => b.created - a.created);
    return json(res, 200, { object: "list", data, has_more: false, url: "/v1/subscriptions" });
  }

  if (req.method === "GET" && (m = path.match(/^\/v1\/subscriptions\/([^/]+)$/))) {
    const sub = subscriptions.get(m[1]);
    return sub ? json(res, 200, sub) : notFound(res, "subscription");
  }

  if (req.method === "POST" && path === "/v1/billing_portal/sessions") {
    if (!customers.has(params.customer)) return notFound(res, "customer");
    const portal = {
      id: newId("bps"),
      object: "billing_portal.session",
      customer: params.customer,
      return_url: params.return_url,
    };
    portal.url = `${SELF}/p/session/${portal.id}`;
    portals.set(portal.id, portal);
    return json(res, 200, portal);
  }

  if (req.method === "GET" && path === "/v1/prices") {
    const keys = Object.values(params.lookup_keys ?? {});
    const data = [...prices.values()].filter((p) => keys.length === 0 || keys.includes(p.lookup_key));
    return json(res, 200, { object: "list", data, has_more: false, url: "/v1/prices" });
  }

  if (req.method === "POST" && path === "/v1/prices") {
    if (params.transfer_lookup_key === "true")
      for (const p of prices.values()) if (p.lookup_key === params.lookup_key) p.lookup_key = null;
    const price = {
      id: newId("price"),
      object: "price",
      active: true,
      currency: params.currency,
      unit_amount: Number(params.unit_amount),
      recurring: { interval: params.recurring?.interval },
      lookup_key: params.lookup_key ?? null,
      product: newId("prod"),
    };
    prices.set(price.id, price);
    return json(res, 200, price);
  }

  // ------------------------------------------------------------ hosted checkout
  if ((m = path.match(/^\/c\/pay\/([^/]+)$/)) && req.method === "GET") {
    const session = sessions.get(m[1]);
    if (!session) return page(res, "Checkout expired", "");
    const customer = customers.get(session.customer);
    return page(
      res,
      "Subscribe to canvas membership",
      `<p>US$1.00 per month, for ${customer?.email ?? "you"}.</p>
       ${button(`/c/pay/${session.id}/complete`, "pay", "Subscribe")}
       <p><a id="back" href="${session.cancel_url}">Back to canvas</a></p>`,
    );
  }

  if ((m = path.match(/^\/c\/pay\/([^/]+)\/complete$/)) && req.method === "POST") {
    const session = sessions.get(m[1]);
    if (!session || session.status !== "open") return page(res, "Checkout expired", "");
    const sub = subscriptionFor(session);
    Object.assign(session, { status: "complete", payment_status: "paid", subscription: sub.id });
    deliverLater(
      ["customer.subscription.created", sub],
      ["checkout.session.completed", publicSession(session)],
      ["invoice.paid", { id: newId("in"), object: "invoice", customer: session.customer, status: "paid" }],
    );
    return redirect(res, session.success_url.replace("{CHECKOUT_SESSION_ID}", session.id));
  }

  // ------------------------------------------------------------ hosted billing portal
  if ((m = path.match(/^\/p\/session\/([^/]+)$/)) && req.method === "GET") {
    const portal = portals.get(m[1]);
    if (!portal) return page(res, "Session expired", "");
    const sub = [...subscriptions.values()].find((s) => s.customer === portal.customer && s.status !== "canceled");
    const state = sub
      ? sub.cancel_at_period_end
        ? "Your plan is set to cancel at the end of the period."
        : "Your plan renews monthly at US$1.00."
      : "You have no active plan.";
    return page(
      res,
      "Manage your canvas billing",
      `<p id="state">${state}</p>
       ${sub && !sub.cancel_at_period_end ? button(`/p/session/${portal.id}/cancel-later`, "cancel-later", "Cancel plan") : ""}
       ${sub && sub.cancel_at_period_end ? button(`/p/session/${portal.id}/renew`, "renew", "Renew plan") : ""}
       ${sub ? button(`/p/session/${portal.id}/cancel-now`, "cancel-now", "Cancel immediately (test)") : ""}
       <p><a id="return" href="${portal.return_url}">Return to canvas</a></p>`,
    );
  }

  if ((m = path.match(/^\/p\/session\/([^/]+)\/(cancel-later|renew|cancel-now)$/)) && req.method === "POST") {
    const portal = portals.get(m[1]);
    const sub =
      portal && [...subscriptions.values()].find((s) => s.customer === portal.customer && s.status !== "canceled");
    if (!sub) return page(res, "Session expired", "");
    if (m[2] === "cancel-later") Object.assign(sub, { cancel_at_period_end: true, canceled_at: now() });
    if (m[2] === "renew") Object.assign(sub, { cancel_at_period_end: false, canceled_at: null });
    if (m[2] === "cancel-now") Object.assign(sub, { status: "canceled", canceled_at: now(), ended_at: now() });
    await deliver(m[2] === "cancel-now" ? "customer.subscription.deleted" : "customer.subscription.updated", sub);
    return redirect(res, `${SELF}/p/session/${portal.id}`);
  }

  // ------------------------------------------------------------ test controls
  if (req.method === "POST" && (m = path.match(/^\/__test\/subscriptions\/([^/]+)$/))) {
    const sub = subscriptions.get(m[1]);
    if (!sub) return notFound(res, "subscription");
    const change = JSON.parse(raw || "{}");
    Object.assign(sub, change);
    if (change.status === "canceled") Object.assign(sub, { ended_at: now() });
    await deliver(sub.status === "canceled" ? "customer.subscription.deleted" : "customer.subscription.updated", sub);
    return json(res, 200, sub);
  }
  if (req.method === "GET" && path === "/__test/state") {
    return json(res, 200, {
      customers: [...customers.values()],
      subscriptions: [...subscriptions.values()],
      deliveries,
    });
  }
  if (req.method === "POST" && path === "/__test/reset") {
    reset();
    return json(res, 200, { ok: true });
  }

  json(res, 404, {
    error: { type: "invalid_request_error", message: `Mock Stripe doesn't handle ${req.method} ${path}` },
  });
});

server.listen(PORT, () => console.log(`Mock Stripe on ${SELF}, webhooks to ${WEBHOOK_URL}`));
