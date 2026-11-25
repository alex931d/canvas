// "Continue with Google", end to end against e2e/mock-google.mjs: signing up
// and back in, cancelling, the state check, linking an existing account by a
// confirmed email (and refusing an unconfirmed one), taking over an
// unconfirmed sign-up, a Google-only account's password, connecting and
// disconnecting in Settings, ?next=, and two-factor still applying.
// Run against `npm run build && npm start` with the GOOGLE_* settings from
// README, Tests; uses DATABASE_URL.
import puppeteer from "puppeteer-core";
import { createHash } from "node:crypto";
import nextEnv from "@next/env";
import { decodeBase32IgnorePadding } from "@oslojs/encoding";
import { generateHOTP } from "@oslojs/otp";

nextEnv.loadEnvConfig(process.cwd());
const { BASE, PASSWORD, sleep, sql, signUp, logIn, uniqueEmail, waitForEmail, grantMembership } = await import("./helpers.mjs");

const CHROME = process.env.CHROME_PATH ?? "/usr/bin/google-chrome";
const MOCK = process.env.MOCK_GOOGLE_URL ?? "http://localhost:4040";
let failures = 0;
function check(label, cond, extra = "") {
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}${extra ? `  (${extra})` : ""}`);
  if (!cond) failures++;
}
async function waitFor(fn, timeout = 10_000) {
  const t0 = Date.now();
  let value;
  while (Date.now() - t0 < timeout) {
    value = await fn().catch(() => null);
    if (value) return value;
    await sleep(120);
  }
  return value;
}
async function act(p, selector) {
  const done = new Promise((resolve) => {
    const ended = (req) => {
      if (req.method() !== "POST" || !req.headers()["next-action"]) return;
      p.off("requestfinished", ended);
      p.off("requestfailed", ended);
      resolve();
    };
    p.on("requestfinished", ended);
    p.on("requestfailed", ended);
  });
  await p.click(selector);
  await done;
  await sleep(400);
}

const up = await fetch(`${MOCK}/stats`).then((r) => r.ok, () => false);
if (!up) {
  console.error(`No mock Google at ${MOCK}. Start it: node e2e/mock-google.mjs (README, Tests).`);
  process.exit(1);
}

const button = (label) => `xpath/.//button[normalize-space()="${label}"]`;
const link = (label) => `xpath/.//a[normalize-space()="${label}"]`;
const path = (p) => new URL(p.url()).pathname;
const text = (p) => p.evaluate(() => document.body.innerText);
const alertText = (p) => p.$$eval("[role=alert]", (ns) => ns.map((n) => n.textContent).join(" ")).catch(() => "");
const userId = (email) => sql(`select id from users where email = '${email}'`);
const googleSub = (email) => sql(`select provider_user_id from oauth_accounts where provider='google' and email='${email}'`);

/**
 * Click Continue with Google (or Connect Google), pick an account at the mock
 * Google, and land back on canvas. `decide: "cancel"` presses Cancel instead.
 */
async function viaGoogle(p, start, { email, name = "", verified = true, decide = "continue" }) {
  await Promise.all([p.waitForNavigation({ waitUntil: "networkidle0" }), p.click(start)]);
  await p.waitForSelector("#google-email");
  if (new URL(p.url()).origin !== MOCK) throw new Error(`not at Google: ${p.url()}`);
  await p.type("#google-email", email);
  if (name) await p.type("#google-name", name);
  if (!verified) await p.click("#google-verified");
  await Promise.all([p.waitForNavigation({ waitUntil: "networkidle0" }), p.click(decide === "cancel" ? "#google-cancel" : "#google-continue")]);
  await p.waitForNetworkIdle({ idleTime: 300 }).catch(() => {});
}
const continueButton = link("Continue with Google");

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ["--no-sandbox"],
  defaultViewport: { width: 1280, height: 1000 },
});
const errors = [];
async function newPage() {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  return page;
}

// ================================================================ the buttons
const a = await newPage();
await a.goto(`${BASE}/login`, { waitUntil: "networkidle0" });
check("the login page has Continue with Google", (await a.$(continueButton)) !== null);
await a.goto(`${BASE}/signup`, { waitUntil: "networkidle0" });
check("so does the sign-up page, with the terms", (await a.$(continueButton)) !== null && /By continuing with Google you agree/.test(await text(a)));

// ================================================================ signing up with Google
const gina = { email: uniqueEmail("google"), name: "Gina Google" };
await a.goto(`${BASE}/login`, { waitUntil: "networkidle0" });
await viaGoogle(a, continueButton, gina);
const ginaId = userId(gina.email);
check("a new Google account makes a canvas account", !!ginaId);
check("new accounts see the membership first", path(a) === "/pricing", a.url());
check(
  "with Google's name, the email confirmed, no password, and the link",
  sql(`select name || '|' || email_verified || '|' || (password_hash is null) from users where id='${ginaId}'`) === "Gina Google|true|true" &&
    !!googleSub(gina.email),
);

// Back in with Google: the same account.
grantMembership(ginaId);
await a.deleteCookie({ name: "session", url: BASE });
await a.goto(`${BASE}/login?next=%2Fsettings`, { waitUntil: "networkidle0" });
await viaGoogle(a, continueButton, gina);
check("logging in with Google again opens the same account, then ?next=", path(a) === "/settings", a.url());
check("no second account", sql(`select count(*) from users where email='${gina.email}'`) === "1");

// A Google-only account has no password to log in with.
const pw = await newPage();
await logIn(pw, { email: gina.email, password: PASSWORD });
check("a password login on a Google-only account says to use Google", /signs in with Google/.test(await alertText(pw)));

// Settings: Google connected, can't disconnect without a password.
const settingsText = await text(a);
check(
  "Settings shows Google connected, and no password yet",
  /Connected to/.test(settingsText) && settingsText.includes(gina.email) && /Not set: you log in with Google/.test(settingsText),
);
check(
  "Disconnect is off until there's a password",
  await a.$eval(button("Disconnect Google"), (b) => b.disabled),
);

// Setting a password by email.
const sentAt = Date.now();
await act(a, button("Email me a link to set one"));
check("Email me a link to set one sends a link", /We sent a link/.test(await text(a)));
const mail = await waitForEmail(gina.email, /password/i, { after: sentAt - 1000 });
await a.goto(mail.text.match(/https?:\/\/\S+\/reset-password\/\S+/)[0], { waitUntil: "networkidle0" });
await a.type("#password", PASSWORD);
await a.type("#confirm", PASSWORD);
await Promise.all([a.waitForNavigation({ waitUntil: "networkidle0" }), a.click("form button[type=submit]")]);
await a.goto(`${BASE}/settings`, { waitUntil: "networkidle0" });
check("then the password is set", /Password\s*\n*\s*Set\./.test(await text(a)));
await act(a, button("Disconnect Google"));
check(
  "and Google can be disconnected",
  /Google is disconnected/.test(await text(a)) && !googleSub(gina.email),
);
await logIn(pw, { email: gina.email, password: PASSWORD });
check("the password logs in", path(pw) === "/");

// Connecting it again from Settings.
await a.waitForSelector(link("Connect Google"));
await viaGoogle(a, link("Connect Google"), gina);
check("Connect Google links it again", path(a) === "/settings" && /Google is connected/.test(await text(a)) && !!googleSub(gina.email));
const linkedMail = await waitForEmail(gina.email, /Google sign-in was added/, { after: sentAt }).catch(() => null);
check("and emails about it", !!linkedMail);

// ================================================================ cancelling and tampering
const c = await newPage();
await c.goto(`${BASE}/login`, { waitUntil: "networkidle0" });
await viaGoogle(c, continueButton, { email: uniqueEmail("cancel"), decide: "cancel" });
check("cancelling at Google comes back to the login page", path(c) === "/login" && /was cancelled/.test(await alertText(c)));

await c.goto(`${BASE}/login/google/callback?code=made-up&state=made-up`, { waitUntil: "networkidle0" });
check("a return with no sign-in started here is turned away", path(c) === "/login" && /took too long/.test(await alertText(c)));

// Someone else's code, with this browser's own sign-in started: the state won't match.
await c.goto(`${BASE}/login/google`, { waitUntil: "networkidle0" });
const myState = new URL(c.url()).searchParams.get("state");
await c.goto(`${BASE}/login/google/callback?code=someone-elses&state=${myState}x`, { waitUntil: "networkidle0" });
check("a return whose state doesn't match is refused", path(c) === "/login" && /didn't work/.test(await alertText(c)));

const stats = await (await fetch(`${MOCK}/stats`)).json();
check("Google checked the client secret and PKCE on every exchange", stats.rejected === 0 && stats.exchanged >= 3, JSON.stringify(stats));

// ================================================================ existing accounts
// A password account, then Google with the same (confirmed) address: linked.
const p1 = await newPage();
const pat = await signUp(p1, { name: "Pat Password", email: uniqueEmail("pat") });
const p2 = await newPage();
await p2.goto(`${BASE}/login`, { waitUntil: "networkidle0" });
await viaGoogle(p2, continueButton, { email: pat.email, name: "Someone Else" });
check("Google with an existing account's address logs in to it", path(p2) === "/" && googleSub(pat.email) !== "");
check("keeping its name and password", sql(`select name || '|' || (password_hash is not null) from users where id='${pat.id}'`) === "Pat Password|true");
check("and the owner is emailed", !!(await waitForEmail(pat.email, /Google sign-in was added/).catch(() => null)));

// Unconfirmed at Google: not let in.
const q = await newPage();
const quinn = await signUp(q, { name: "Quinn", email: uniqueEmail("quinn") });
const q2 = await newPage();
await q2.goto(`${BASE}/login`, { waitUntil: "networkidle0" });
await viaGoogle(q2, continueButton, { email: quinn.email, verified: false });
check(
  "an address Google hasn't confirmed doesn't open an existing account",
  path(q2) === "/login" && /hasn't confirmed/.test(await alertText(q2)) && !googleSub(quinn.email),
);

// Someone signed up with an address they don't own and never confirmed it;
// the owner then uses Google: the account is theirs, the squatter's password and session end.
const squat = await newPage();
const victim = uniqueEmail("owner");
await signUp(squat, { name: "Squatter", email: victim, verify: false });
const o = await newPage();
await o.goto(`${BASE}/login`, { waitUntil: "networkidle0" });
await viaGoogle(o, continueButton, { email: victim, name: "Real Owner" });
check("the address's owner gets the unconfirmed account", path(o) !== "/login" && !!googleSub(victim));
check(
  "the earlier sign-up's password stops working",
  sql(`select (password_hash is null) || '|' || email_verified from users where email='${victim}'`) === "true|true",
);
await squat.goto(`${BASE}/verify-email`, { waitUntil: "networkidle0" });
check("and its session ends", path(squat) === "/login");

// Connect a Google account that's already someone else's.
await q.goto(`${BASE}/settings`, { waitUntil: "networkidle0" });
await viaGoogle(q, link("Connect Google"), { email: victim });
check(
  "a Google account linked to another canvas account can't be connected",
  /connected to a different canvas account/.test(await text(q)) && !googleSub(quinn.email),
);

// ================================================================ two-factor still applies
// Pat's Google is linked (above); turn on two-factor for Pat.
const pats = await newPage();
await logIn(pats, pat);
await pats.goto(`${BASE}/settings`, { waitUntil: "networkidle0" });
await act(pats, button("Set up two-factor sign-in"));
await pats.waitForSelector("[data-testid=totp-key]");
const key = decodeBase32IgnorePadding((await pats.$eval("[data-testid=totp-key]", (n) => n.textContent)).replace(/\s/g, ""));
const step = Math.floor(Date.now() / 30_000);
await pats.type("#totp-confirm", generateHOTP(key, BigInt(step), 6));
await act(pats, button("Turn on"));
await pats.waitForSelector("[data-testid=recovery-codes]");
const g = await newPage();
await g.goto(`${BASE}/login`, { waitUntil: "networkidle0" });
await viaGoogle(g, continueButton, { email: pat.email });
check("with two-factor on, Google sign-in still asks for the code", path(g) === "/login/two-factor");
await g.waitForSelector("#code");
await g.type("#code", generateHOTP(key, BigInt(step + 1), 6));
await act(g, button("Continue"));
await waitFor(async () => path(g) === "/");
check("and the code finishes it", path(g) === "/");

// ================================================================ already signed in
await g.goto(`${BASE}/login/google?next=%2Fsettings`, { waitUntil: "networkidle0" });
check("Continue with Google while signed in just goes on", path(g) === "/settings");

check("Google's sub is what's stored, not the email", googleSub(pat.email) === createHash("sha256").update(pat.email).digest("hex").slice(0, 21).replace(/[a-f]/g, (ch) => String(ch.charCodeAt(0) % 10)));
check("no page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
await browser.close();
console.log(failures ? `\n${failures} FAILED` : "\nall passed");
process.exit(failures ? 1 : 0);
