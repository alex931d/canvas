// Sign-up, login, sessions, sign-out and per-user data isolation.
// (Email codes, password resets and the CAPTCHA: e2e/test-account.mjs.)
// Run against `npm run build && npm start` (see README); uses DATABASE_URL.
import puppeteer from "puppeteer-core";
import { createHash } from "node:crypto";
import nextEnv from "@next/env";

nextEnv.loadEnvConfig(process.cwd());
const { BASE, sleep, sql, signUp, logIn, uniqueEmail, PASSWORD, localDbName, grantMembership, waitForEmail } = await import(
  "./helpers.mjs"
);

const CHROME = process.env.CHROME_PATH ?? "/usr/bin/google-chrome";
let failures = 0;
function check(label, cond, extra = "") {
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}${extra ? `  (${extra})` : ""}`);
  if (!cond) failures++;
}

const usersBefore = Number(sql("select count(*) from users"));
const unownedBefore = Number(sql("select count(*) from drawings where user_id is null"));

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--no-sandbox"], defaultViewport: { width: 1280, height: 860 } });
const ctxA = await browser.createBrowserContext();
const page = await ctxA.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));

// ------------------------------------------------------------ signed out
await page.goto(BASE, { waitUntil: "networkidle0" });
check(
  "signed-out visitors get the landing page at /",
  new URL(page.url()).pathname === "/" && /Sketch it/.test(await page.$eval("h1", (h) => h.textContent)),
);
await page.goto(`${BASE}/drawings/new-idea`, { waitUntil: "networkidle0" });
check("app pages send signed-out visitors to the login page", new URL(page.url()).pathname === "/login");

// ------------------------------------------------------------ sign-up validation
await page.goto(`${BASE}/signup`, { waitUntil: "networkidle0" });
await page.type("#email", "not-an-email");
await page.type("#password", "short");
await page.click("form button[type=submit]");
await page.waitForSelector("#name-error", { timeout: 5000 }).catch(() => {});
const fieldErrors = await page.$$eval("[id$='-error']", (els) => els.map((e) => e.textContent));
check("sign-up explains each invalid field", fieldErrors.length === 3 && fieldErrors.some((t) => /8 characters/.test(t)), fieldErrors.join(" | "));

// ------------------------------------------------------------ sign up A
const a = await signUp(page, { name: "Ada Lovelace", email: uniqueEmail("ada"), verify: false });
check(
  "sign-up asks for the code it emailed",
  new URL(page.url()).pathname === "/verify-email" && (await page.$eval("h1", (h) => h.textContent)) === "Check your email",
);
const codeMail = await waitForEmail(a.email, /is your canvas code/);
await page.type("#code", /(\d{4}) (\d{4})/.exec(codeMail.text).slice(1).join(""));
await page.click("form:has(#code) button[type=submit]");
// The redirect is a client-side navigation: wait for the pricing page itself.
const START = "xpath/.//button[normalize-space()='Start membership']";
await page
  .waitForFunction(() => location.pathname === "/pricing", { timeout: 15_000 })
  .then(() => page.waitForSelector(START, { timeout: 10_000 }))
  .catch(() => {});
check(
  "the right code leads on to the pricing page, ready to start the membership",
  new URL(page.url()).pathname === "/pricing" && !!(await page.$(START)),
  new URL(page.url()).pathname,
);
await page.goto(BASE, { waitUntil: "networkidle0" });
await page.waitForSelector("[data-testid=free-plan]", { timeout: 10_000 }).catch(() => {});
check(
  "without a membership, home is the free plan (drawings in this browser)",
  new URL(page.url()).pathname === "/" && !!(await page.$("[data-testid=free-plan] a[href='/pricing']")),
);
grantMembership(a.id);
await page.goto(BASE, { waitUntil: "networkidle0" });
check("members get the gallery", (await page.$eval("h1", (h) => h.textContent)) === "Drawings");
check("user row created", !!a.id, a.email);
const hash = sql(`select password_hash from users where id = '${a.id}'`);
check("password stored as an Argon2id hash", hash.startsWith("$argon2id$v=19$m=19456,t=2,p=1$") && !hash.includes(PASSWORD));

const cookies = await page.cookies();
const sessionCookie = cookies.find((c) => c.name === "session");
check(
  "session cookie is HttpOnly, SameSite=Lax, Secure",
  sessionCookie?.httpOnly === true && sessionCookie?.sameSite === "Lax" && sessionCookie?.secure === true,
  JSON.stringify({ httpOnly: sessionCookie?.httpOnly, sameSite: sessionCookie?.sameSite, secure: sessionCookie?.secure }),
);
const [sid, secret] = (sessionCookie?.value ?? "").split(".");
check("token is <id>.<secret>, 24 chars each from the 32-letter alphabet", /^[a-km-np-z2-9]{24}$/.test(sid ?? "") && /^[a-km-np-z2-9]{24}$/.test(secret ?? ""));
const stored = sql(`select encode(secret_hash, 'hex') from sessions where id = '${sid}'`);
check("database holds SHA-256(secret), never the secret", stored === createHash("sha256").update(secret ?? "").digest("hex") && !sql(`select count(*) from sessions where id = '${secret}'`).startsWith("1"));
check("session belongs to the new user", sql(`select user_id from sessions where id = '${sid}'`) === a.id);

if (usersBefore === 0 && unownedBefore > 0) {
  check("first account adopts drawings made before sign-in", Number(sql("select count(*) from drawings where user_id is null")) === 0 && Number(sql(`select count(*) from drawings where user_id = '${a.id}'`)) >= unownedBefore);
} else {
  check("later accounts adopt nothing", Number(sql(`select count(*) from drawings where user_id = '${a.id}'`)) === 0);
}

// duplicate email
const ctxDup = await browser.createBrowserContext();
const dup = await ctxDup.newPage();
let dupErr = "";
for (let attempt = 0; attempt < 3 && !dupErr; attempt++) {
  await dup.goto(`${BASE}/signup`, { waitUntil: "networkidle0" });
  await dup.type("#name", "Someone");
  await dup.type("#email", a.email.toUpperCase());
  await dup.type("#password", PASSWORD);
  await dup.click("form button[type=submit]");
  await dup.waitForSelector("#email-error, [role=alert]", { timeout: 5000 }).catch(() => {});
  dupErr = await dup.$eval("#email-error", (n) => n.textContent).catch(() => "");
  if (!dupErr) await sleep(10_500); // sign-up rate limit from earlier runs
}
check("email is unique (case-insensitive)", /already exists/.test(dupErr), dupErr);
await ctxDup.close();

// ------------------------------------------------------------ A makes a drawing with an image
// The editor keeps a live connection open: wait for "load", not an idle network.
await Promise.all([page.waitForNavigation({ waitUntil: "load" }), page.click("main form button[type=submit]")]);
await page.waitForFunction(() => /^\/drawings\/[0-9a-f-]{36}$/.test(location.pathname), { timeout: 15_000 }); // the redirect is client-side
const drawingId = page.url().split("/drawings/")[1];
check("new drawing is owned by its creator", sql(`select user_id from drawings where id = '${drawingId}'`) === a.id);
await page.waitForFunction(() => /Saved here/.test(document.querySelector("[data-testid=storage-status]")?.innerText ?? ""));
const dt = await page.evaluateHandle(async () => {
  const c = document.createElement("canvas");
  c.width = 200;
  c.height = 100;
  c.getContext("2d").fillRect(0, 0, 200, 100);
  const blob = await new Promise((r) => c.toBlob(r, "image/png"));
  const t = new DataTransfer();
  t.items.add(new File([blob], "a.png", { type: "image/png" }));
  return t;
});
await page.evaluate((dt) => document.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true })), dt);
let assetId = "";
for (let i = 0; i < 40 && !assetId; i++) {
  await sleep(250);
  assetId = sql(`select a.id from assets a where a.drawing_id = '${drawingId}' limit 1`);
}
check("A's image uploaded", !!assetId);
await page.waitForFunction(() => /Synced/.test(document.querySelector("[data-testid=storage-status]")?.innerText ?? ""), { timeout: 10000 });
const dbNames = await page.evaluate(async () => (await indexedDB.databases()).map((d) => d.name));
check("browser storage is namespaced per user", dbNames.includes(localDbName(a.id)), dbNames.join(","));

// ------------------------------------------------------------ sign out
await page.click(`button[aria-label^='Account:']`);
await page.waitForSelector("[role=menuitem]");
await Promise.all([page.waitForNavigation({ waitUntil: "networkidle0" }), page.click("xpath/.//div[@role='menuitem'][contains(., 'Sign out')]")]);
check("sign-out returns to the login page", new URL(page.url()).pathname === "/login");
check("sign-out deletes the session row", sql(`select count(*) from sessions where id = '${sid}'`) === "0");
check("sign-out clears the cookie", !(await page.cookies()).some((c) => c.name === "session" && c.value));
const namesAfter = await page.evaluate(async () => (await indexedDB.databases()).map((d) => d.name));
check("synced local copies removed from this browser", !namesAfter.includes(localDbName(a.id)), namesAfter.join(","));
await page.goto(`${BASE}/drawings/${drawingId}`, { waitUntil: "networkidle0" });
check("drawing URL needs sign-in again", new URL(page.url()).pathname === "/login" && new URL(page.url()).searchParams.get("next") === `/drawings/${drawingId}`);

// ------------------------------------------------------------ login
await page.type("#email", a.email);
await page.type("#password", "wrong password");
await page.click("form button[type=submit]");
const loginErr = await page.waitForSelector("[role=alert]", { timeout: 5000 }).then((e) => e.evaluate((n) => n.textContent)).catch(() => "");
check("wrong password is refused with a generic message", /don't match an account/.test(loginErr), loginErr);
await sleep(1100); // the per-account throttle allows the next try after 1 s
await page.$eval("#password", (el) => (el.value = ""));
await page.type("#password", PASSWORD);
await Promise.all([page.waitForNavigation({ waitUntil: "networkidle0" }), page.click("form button[type=submit]")]);
check("login honours ?next=", new URL(page.url()).pathname === `/drawings/${drawingId}`, page.url());
await page.goto(`${BASE}/login`, { waitUntil: "networkidle0" });
await sleep(300);
check("signed-in users skip the login page", new URL(page.url()).pathname === "/");

// open-redirect protection
const ctxR = await browser.createBrowserContext();
const pr = await ctxR.newPage();
await logIn(pr, a, "//evil.example/steal");
check("?next= can't send people to another site", new URL(pr.url()).host === new URL(BASE).host && new URL(pr.url()).pathname === "/", pr.url());
await ctxR.close();

// throttling
const ctxT = await browser.createBrowserContext();
const pt = await ctxT.newPage();
await pt.goto(`${BASE}/login`, { waitUntil: "networkidle0" });
let throttled = "";
for (let i = 0; i < 4 && !throttled; i++) {
  await pt.$eval("#email", (el) => (el.value = ""));
  await pt.type("#email", a.email);
  await pt.$eval("#password", (el) => (el.value = ""));
  await pt.type("#password", `nope-${i}`);
  await pt.click("form button[type=submit]");
  await sleep(250);
  const t = await pt.$eval("[role=alert]", (n) => n.textContent).catch(() => "");
  if (/Too many attempts/.test(t)) throttled = t;
}
check("rapid wrong passwords for one account are throttled", !!throttled, throttled);
await ctxT.close();

// ------------------------------------------------------------ user B can't see A's things
const ctxB = await browser.createBrowserContext();
const pb = await ctxB.newPage();
const b = await signUp(pb, { name: "Grace Hopper", email: uniqueEmail("grace") });
const listed = await pb.$$eval("ul a[href^='/drawings/']", (as) => as.map((a) => a.getAttribute("href")));
check("B's gallery doesn't list A's drawings", !listed.includes(`/drawings/${drawingId}`));
await pb.goto(`${BASE}/drawings/${drawingId}`, { waitUntil: "networkidle0" });
check("B opening A's drawing gets 'doesn't exist'", /doesn.t exist/.test(await pb.$eval("h1", (h) => h.textContent).catch(() => "")));
const probe = await pb.evaluate(async (assetId, drawingId) => {
  const img = await fetch(`/api/assets/${assetId}`);
  const form = new FormData();
  form.set("id", crypto.randomUUID());
  form.set("width", "1");
  form.set("height", "1");
  form.set("file", new Blob([new Uint8Array([137, 80, 78, 71])], { type: "image/png" }));
  const up = await fetch(`/api/drawings/${drawingId}/assets`, { method: "POST", body: form });
  return { img: img.status, up: up.status };
}, assetId, drawingId);
check("B can't fetch A's image or upload into A's drawing", probe.img === 404 && probe.up === 404, JSON.stringify(probe));

// ------------------------------------------------------------ session lifetime
const bSid = (await pb.cookies()).find((c) => c.name === "session").value.split(".")[0];
sql(`update sessions set last_verified_at = now() - interval '2 hours' where id = '${bSid}'`);
await pb.goto(BASE, { waitUntil: "networkidle0" });
const bumped = Number(sql(`select extract(epoch from now() - last_verified_at) from sessions where id = '${bSid}'`));
check("activity refreshes last_verified_at (at most hourly)", bumped < 60, `${Math.round(bumped)} s ago`);

const bCookie = (await pb.cookies()).find((c) => c.name === "session");
await pb.setCookie({ ...bCookie, value: bCookie.value.split(".")[0] + ".aaaaaaaaaaaaaaaaaaaaaaaa" });
await pb.goto(BASE, { waitUntil: "networkidle0" });
check("a tampered secret is rejected", /\/login/.test(pb.url()));
await pb.setCookie(bCookie);

sql(`update sessions set last_verified_at = now() - interval '31 days' where id = '${bSid}'`);
await pb.goto(BASE, { waitUntil: "networkidle0" });
check("sessions idle for 30 days expire", /\/login/.test(pb.url()) && sql(`select count(*) from sessions where id = '${bSid}'`) === "0");

// ------------------------------------------------------------ API protection
await logIn(pb, b);
const statuses = await pb.evaluate(async () => {
  const out = [];
  for (let i = 0; i < 12; i++) {
    const r = await fetch("/api/check-math", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ image: "data:image/png;base64,iVBORw0KGgo=" }) });
    out.push(r.status);
  }
  return out;
});
check("AI checks are rate limited per user", statuses.slice(0, 10).every((s) => s !== 429) && statuses.slice(10).every((s) => s === 429), statuses.join(","));

// Cross-site requests are refused before they reach any handler.
const cookie = (await pb.cookies()).map((c) => `${c.name}=${c.value}`).join("; ");
// (an empty upload to a drawing that doesn't exist: a 4xx from the route once past the CSRF check)
const post = (headers) => fetch(`${BASE}/api/drawings/00000000-0000-4000-8000-000000000000/assets`, { method: "POST", headers: { cookie, ...headers }, body: new FormData() }).then((r) => r.status);
const csrf = {
  otherOrigin: await post({ Origin: "https://evil.example" }),
  crossSiteFetch: await post({ Origin: BASE, "Sec-Fetch-Site": "cross-site" }),
  sameOrigin: await post({ Origin: BASE, "Sec-Fetch-Site": "same-origin" }),
};
check("cross-site POSTs get 403, same-origin ones get through", csrf.otherOrigin === 403 && csrf.crossSiteFetch === 403 && csrf.sameOrigin !== 403 && csrf.sameOrigin < 500, JSON.stringify(csrf));
await ctxB.close();

// ------------------------------------------------------------ limits kept in Redis (when REDIS_URL is set)
if (process.env.REDIS_URL) {
  const { default: Redis } = await import("ioredis");
  const r = new Redis(process.env.REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 1 });
  const keys = await r.keys("canvas:rl:*").catch(() => []);
  await r.quit().catch(() => {});
  check(
    "with REDIS_URL, the rate limits are kept in Redis, under hashed keys",
    ["signupByIp", "loginByIp"].every((n) => keys.some((k) => k.startsWith(`canvas:rl:${n}:`))) &&
      !keys.some((k) => /@|\d+\.\d+\.\d+\.\d+/.test(k)),
    `${keys.length} keys`,
  );
}

console.log("\nerrors:", errors.length ? errors : "none");
await browser.close();
process.exit(failures ? 1 : 0);
