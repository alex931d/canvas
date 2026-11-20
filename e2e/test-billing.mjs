// Memberships end to end, against the mock Stripe in e2e/mock-stripe.mjs:
// the pricing page for each kind of visitor, joining through Checkout, the billing portal (cancel, renew, end), a lapsed
// membership while the editor is open, failed payments, webhook signatures,
// and complimentary memberships. See README, Tests, for how to start things.
import { execFileSync } from "node:child_process";
import puppeteer from "puppeteer-core";
import Stripe from "stripe";
import nextEnv from "@next/env";

nextEnv.loadEnvConfig(process.cwd());
const { BASE, sleep, sql, signUp, uniqueEmail } = await import("./helpers.mjs");

const CHROME = process.env.CHROME_PATH ?? "/usr/bin/google-chrome";
const MOCK = process.env.MOCK_STRIPE_URL ?? "http://localhost:12111";
const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET ?? "whsec_mock";

let failures = 0;
function check(label, cond, extra = "") {
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}${extra ? `  (${extra})` : ""}`);
  if (!cond) failures++;
}
async function waitFor(fn, timeout = 8000) {
  const t0 = Date.now();
  let value;
  while (Date.now() - t0 < timeout) {
    value = await fn();
    if (value) return value;
    await sleep(150);
  }
  return value;
}
const mockState = () => fetch(`${MOCK}/__test/state`).then((r) => r.json());
const memberStatus = (userId) =>
  sql(`select string_agg(status, ',' order by created_at) from subscriptions where user_id = '${userId}'`);

try {
  await fetch(`${MOCK}/__test/reset`, { method: "POST" });
} catch {
  console.error(`The mock Stripe isn't running at ${MOCK}: start it with  node e2e/mock-stripe.mjs`);
  process.exit(1);
}

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--no-sandbox"] });
const problems = [];
const ctx = await browser.createBrowserContext();
const page = await ctx.newPage();
await page.setViewport({ width: 1280, height: 860 });
page.on("pageerror", (e) => problems.push(e.message));
const h1 = (p = page) => p.$eval("h1", (h) => h.textContent.trim());
const text = (p = page) => p.evaluate(() => document.body.innerText);
async function clickAndWait(p, selector, waitUntil = "networkidle0") {
  // Background tabs are throttled (as in a real browser), so act in the front one.
  await p.bringToFront();
  await Promise.all([p.waitForNavigation({ waitUntil, timeout: 15_000 }), p.click(selector)]).catch(
    (err) => {
      throw new Error(`${selector} didn't navigate (still at ${p.url()}): ${err.message}`);
    },
  );
  // Server Action redirects are client-side; give streamed content a moment.
  await p.waitForSelector("h1", { timeout: 10_000 }).catch(() => {});
}
const button = (label) => `xpath/.//button[normalize-space()='${label}']`;

const path = (p = page) => new URL(p.url()).pathname;
/** Redirects inside streamed pages happen in the browser: wait for them to land. */
const landsOn = (p, pathname, timeout = 10_000) =>
  waitFor(async () => path(p) === pathname && !!(await p.$("h1")), timeout);
const currentStep = (p = page) =>
  p.$eval("li[aria-current=step]", (li) => li.innerText.split("\n")[1] ?? li.innerText).catch(() => "");

// ------------------------------------------------------------ the pricing page, signed out
const visitor = await (await browser.createBrowserContext()).newPage();
await visitor.setViewport({ width: 1280, height: 860 });
visitor.on("pageerror", (e) => problems.push(e.message));
await visitor.goto(BASE, { waitUntil: "networkidle0" });
await clickAndWait(visitor, "header a[href='/pricing']");
const visitorText = await text(visitor);
check(
  "Pricing on the landing page opens /pricing with the plan",
  path(visitor) === "/pricing" && /\$1\s*a month/.test(visitorText) && /Live drawing with other members/.test(visitorText),
);
check(
  "visitors are asked to create an account, or log in and come back",
  (await visitor.$eval("main a[href='/signup']", (a) => a.textContent).catch(() => "")) === "Create account" &&
    !!(await visitor.$("main a[href='/login?next=%2Fpricing']")),
);
check("and the first step is marked as next", (await currentStep(visitor)) === "Create an account", await currentStep(visitor));
await visitor.goto(`${BASE}/welcome`, { waitUntil: "networkidle0" });
await clickAndWait(visitor, "xpath/.//a[normalize-space()='Get membership']");
check("Get membership on the landing page leads there too", path(visitor) === "/pricing");
await visitor.browserContext().close();

// ------------------------------------------------------------ a new account isn't a member yet
const me = await signUp(page, { name: "Mae Member", email: uniqueEmail("mae"), member: false, verify: false });
await page.goto(`${BASE}/pricing`, { waitUntil: "networkidle0" });
check(
  "before confirming the email, the pricing page asks for the code",
  /Confirm your email first/.test(await text()) &&
    !!(await page.$("a[href='/verify-email?next=%2Fpricing']")) &&
    (await currentStep()) === "Confirm your email",
);
// Confirm with the real code, the way a person would.
const { waitForEmail } = await import("./helpers.mjs");
const code = /(\d{4}) (\d{4})/.exec((await waitForEmail(me.email, /is your canvas code/)).text).slice(1).join("");
await page.goto(`${BASE}/verify-email`, { waitUntil: "networkidle0" });
await page.type("#code", code);
await page.click("form:has(#code) button[type=submit]");
const landed = !!(await landsOn(page, "/pricing"));
// The plan card's button streams in after the page itself.
const startButton = await page.waitForSelector(button("Start membership"), { timeout: 10_000 }).catch(() => null);
check("confirming the email goes on to the pricing page", landed && !!startButton, path());
check("it shows the $1 a month price", /\$1\s*a month/.test(await text()));
check("and marks starting the membership as next", (await currentStep()) === "Start your membership", await currentStep());
await page.goto(BASE, { waitUntil: "networkidle0" });
check("the drawings send non-members to /pricing", !!(await landsOn(page, "/pricing")), path());
await page.goto(`${BASE}/membership`, { waitUntil: "networkidle0" });
check("so does /membership, which is for members", !!(await landsOn(page, "/pricing")), path());
const mathStatus = await page.evaluate(() =>
  fetch("/api/check-math", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }).then(
    (r) => r.status,
  ),
);
check("math checks answer 402 for non-members", mathStatus === 402, String(mathStatus));

// ------------------------------------------------------------ leaving checkout without paying
await clickAndWait(page, button("Start membership"));
check("Start membership opens Stripe Checkout", page.url().startsWith(`${MOCK}/c/pay/cs_test_`), page.url());
check(
  "a Stripe customer is linked to the account",
  /^cus_/.test(sql(`select stripe_customer_id from users where id = '${me.id}'`)),
);
await clickAndWait(page, "#back");
check(
  "backing out of Checkout returns to pricing with no charge",
  path() === "/pricing" &&
    new URL(page.url()).searchParams.get("checkout") === "canceled" &&
    /haven.t been charged/.test(await text()),
);
check("and they still aren't a member", memberStatus(me.id) === "");

// ------------------------------------------------------------ paying
await clickAndWait(page, button("Start membership"));
await clickAndWait(page, "#pay");
check("paying returns to a confirmation", (await h1()) === "You're a member", await h1());
check("the membership is stored before Stripe's webhook arrives", memberStatus(me.id) === "active");
const row = sql(
  `select customer_id || '|' || price_id || '|' || round(extract(epoch from current_period_end - now()) / 86400) from subscriptions where user_id = '${me.id}'`,
).split("|");
check(
  "with the customer, price and renewal date",
  /^cus_/.test(row[0]) && row[1] === "price_mock" && Number(row[2]) === 30,
  row.join(" "),
);
const delivered = await waitFor(async () => {
  const s = await mockState();
  return s.deliveries.length >= 3 ? s.deliveries : null;
});
check(
  "Stripe's signed webhooks are accepted",
  delivered?.every((d) => d.status === 200),
  JSON.stringify(delivered),
);
const customersOf = async (userId) => (await mockState()).customers.filter((c) => c.metadata?.userId === userId).length;
check("one Stripe customer for the account", (await customersOf(me.id)) === 1);

await page.goto(`${BASE}/pricing`, { waitUntil: "networkidle0" });
check(
  "members see they're members on the pricing page, with every step done",
  /You're a member/.test(await text()) &&
    !!(await page.$("main a[href='/membership']")) &&
    (await page.$$("li [aria-label=Done]")).length === 3,
);
await page.goto(`${BASE}/membership`, { waitUntil: "networkidle0" });

// ------------------------------------------------------------ drawing as a member
await clickAndWait(page, "xpath/.//a[normalize-space()='Open your drawings']");
check("members get the gallery", (await h1()) === "Drawings");
// The editor keeps a live connection open: wait for "load", not an idle network.
await clickAndWait(page, "main form button[type=submit]", "load");
await page.waitForFunction(() => /^\/drawings\/[0-9a-f-]{36}$/.test(location.pathname), { timeout: 15_000 }); // the redirect is client-side
const drawingId = page.url().split("/drawings/")[1];
const status = () =>
  page.$eval("[data-testid=storage-status]", (n) => n.innerText.replace(/\s+/g, " ")).catch(() => "");
async function stroke(dx) {
  await page.waitForSelector("[data-testid=board]", { timeout: 10_000 });
  const b = await page.$eval("[data-testid=board]", (c) => {
    const r = c.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  });
  await page.click("aside button[aria-label='Pen']");
  await page.mouse.move(b.x + 200 + dx, b.y + 200);
  await page.mouse.down();
  for (let i = 1; i <= 12; i++) await page.mouse.move(b.x + 200 + dx + i * 12, b.y + 200 + (i % 2) * 14, { steps: 2 });
  await page.mouse.up();
}
await stroke(0);
await waitFor(async () => /Synced/.test(await status()));
const elementCount = () =>
  Number(sql(`select jsonb_array_length(data->'elements') from drawings where id = '${drawingId}'`));
check("a member's drawing syncs", elementCount() === 1);

// ------------------------------------------------------------ billing portal: cancel, renew
const billing = await ctx.newPage();
await billing.setViewport({ width: 1280, height: 860 });
billing.on("pageerror", (e) => problems.push(e.message));
await billing.goto(`${BASE}/membership`, { waitUntil: "networkidle0" });
check(
  "the account page shows an active membership",
  (await h1(billing)) === "Your membership" && /Active/.test(await text(billing)),
);
check("with the renewal date", /renewing on/.test(await text(billing)));
await clickAndWait(billing, button("Manage billing"));
check("Manage billing opens Stripe's billing portal", billing.url().startsWith(`${MOCK}/p/session/bps_`));
await clickAndWait(billing, "#cancel-later");
await clickAndWait(billing, "#return");
check(
  "cancelling keeps the membership until the period ends",
  /Ending/.test(await text(billing)) && /ends on/.test(await text(billing)),
);
check(
  "the cancellation date is stored",
  sql(`select cancel_at is not null from subscriptions where user_id = '${me.id}'`) === "t",
);
await page.goto(BASE, { waitUntil: "networkidle0" });
check("and the drawings stay open meanwhile", (await h1()) === "Drawings");
await clickAndWait(billing, button("Manage billing"));
await clickAndWait(billing, "#renew");
await clickAndWait(billing, "#return");
check("renewing in the portal undoes it", /Active/.test(await text(billing)) && /renewing on/.test(await text(billing)));

// ------------------------------------------------------------ the membership ends while the editor is open
await page.bringToFront();
// The editor keeps a live connection open: wait for "load", not an idle network.
await page.goto(`${BASE}/drawings/${drawingId}`, { waitUntil: "load" });
await waitFor(async () => /Synced/.test(await status()));
await clickAndWait(billing, button("Manage billing"));
await clickAndWait(billing, "#cancel-now");
await clickAndWait(billing, "#return");
check(
  "an ended membership goes to pricing to renew",
  !!(await waitFor(async () => path(billing) === "/pricing" && /ended on/.test(await text(billing)), 10_000)) &&
    !!(await billing.$(button("Renew membership"))),
  path(billing),
);
check("the subscription is stored as canceled", memberStatus(me.id) === "canceled");

await page.bringToFront();
await waitFor(async () => /Synced/.test(await status()));
await stroke(220);
const banner = await waitFor(async () => /membership has ended/.test(await text()));
check("the editor says the membership ended", !!banner);
check(
  "and stops syncing, keeping the change in the browser",
  /Renew to sync/.test(await status()) && elementCount() === 1,
  await status(),
);
await page.goto(BASE, { waitUntil: "networkidle0" });
check("the gallery sends them to renew", !!(await landsOn(page, "/pricing")), path());
check("their drawings are kept", Number(sql(`select count(*) from drawings where user_id = '${me.id}'`)) === 1);

// ------------------------------------------------------------ renewing
await clickAndWait(billing, button("Renew membership"));
await clickAndWait(billing, "#pay");
check("renewing works the same way", (await h1(billing)) === "You're a member");
check("with the same Stripe customer", (await customersOf(me.id)) === 1);
check("and a new subscription next to the old one", memberStatus(me.id) === "canceled,active");
await page.bringToFront();
await page.goto(`${BASE}/drawings/${drawingId}`, { waitUntil: "load" });
const synced = await waitFor(() => elementCount() === 2, 10000);
check("the change made while lapsed syncs after renewing", !!synced, `${elementCount()} elements`);

// ------------------------------------------------------------ failed payments
const subId = sql(`select id from subscriptions where user_id = '${me.id}' and status = 'active'`);
const setStatus = (body) =>
  fetch(`${MOCK}/__test/subscriptions/${subId}`, { method: "POST", body: JSON.stringify(body) }).then((r) => r.status);
await setStatus({ status: "past_due" });
await billing.bringToFront();
await billing.goto(`${BASE}/membership`, { waitUntil: "networkidle0" });
await billing.waitForSelector("h1");
check(
  "a failed renewal shows a payment problem",
  /Payment due/.test(await text(billing)) && /didn.t go through/.test(await text(billing)),
);
await page.goto(BASE, { waitUntil: "networkidle0" });
check("while Stripe retries, they keep access", (await h1()) === "Drawings");
await setStatus({ status: "unpaid" });
await page.goto(BASE, { waitUntil: "networkidle0" });
check("once Stripe gives up, access stops", !!(await landsOn(page, "/pricing")), path());

// ------------------------------------------------------------ webhook security
const signer = new Stripe("sk_test_mock");
const post = (body, signature) =>
  fetch(`${BASE}/api/stripe/webhook`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(signature ? { "Stripe-Signature": signature } : {}) },
    body,
  }).then((r) => r.status);
const forged = JSON.stringify({
  id: "evt_forged",
  type: "customer.subscription.created",
  data: { object: { customer: row[0] } },
});
check("webhooks without a signature are refused", (await post(forged)) === 400);
check(
  "webhooks signed with the wrong secret are refused",
  (await post(forged, signer.webhooks.generateTestHeaderString({ payload: forged, secret: "whsec_wrong" }))) === 400,
);
const other = JSON.stringify({ id: "evt_other", type: "customer.created", data: { object: { id: "cus_x" } } });
check(
  "signed events the app doesn't need are acknowledged",
  (await post(other, signer.webhooks.generateTestHeaderString({ payload: other, secret: WEBHOOK_SECRET }))) === 200,
);
const stranger = JSON.stringify({
  id: "evt_stranger",
  type: "customer.subscription.updated",
  data: { object: { customer: "cus_nobody" } },
});
check(
  "events for unknown customers change nothing",
  (await post(stranger, signer.webhooks.generateTestHeaderString({ payload: stranger, secret: WEBHOOK_SECRET }))) ===
    200,
);

// ------------------------------------------------------------ complimentary memberships
const ctxC = await browser.createBrowserContext();
const pc = await ctxC.newPage();
await pc.setViewport({ width: 1280, height: 860 });
const comp = await signUp(pc, { name: "Cam Comp", email: uniqueEmail("cam"), member: false });
const run = (...args) => execFileSync("node", ["scripts/membership.mjs", ...args], { encoding: "utf8" }).trim();
const granted = run("grant", comp.email);
check(
  "npm run membership -- grant gives free access",
  /Granted/.test(granted) && memberStatus(comp.id) === "active",
  granted,
);
await pc.goto(BASE, { waitUntil: "networkidle0" });
check("complimentary members get the gallery", (await h1(pc)) === "Drawings");
await pc.goto(`${BASE}/membership`, { waitUntil: "networkidle0" });
check(
  "and see it on their membership page, with no billing to manage",
  /Complimentary/.test(await text(pc)) && !(await pc.$(button("Manage billing"))),
);
check("show lists it", /active\s+complimentary/.test(run("show", comp.email)));
run("revoke", comp.email);
await pc.goto(BASE, { waitUntil: "networkidle0" });
check("revoke ends it", !!(await landsOn(pc, "/pricing")), path(pc));
await ctxC.close();

console.log("\nproblems:", problems.length ? problems : "none");
check("no page errors", problems.length === 0);
await browser.close();
process.exit(failures ? 1 : 0);
