// Two-factor sign-in, end to end: setting it up from Settings (QR code and
// key, a wrong code, coming back mid-setup), the recovery codes, other
// devices signed out, logging in with a code and with a recovery code, each
// code working once, the pending login (only the code page, 10 minutes,
// "Not you?"), the rate limit, a password reset still asking for the code,
// new recovery codes, turning it off, staff turning it off, and the emails.
// Run against `npm run build && npm start` (see README, Tests); uses DATABASE_URL.
import puppeteer from "puppeteer-core";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import nextEnv from "@next/env";
import { decodeBase32IgnorePadding } from "@oslojs/encoding";
import { generateHOTP } from "@oslojs/otp";

nextEnv.loadEnvConfig(process.cwd());
const { BASE, PASSWORD, sleep, sql, signUp, logIn, uniqueEmail, waitForEmail, captchaReady } = await import("./helpers.mjs");

const CHROME = process.env.CHROME_PATH ?? "/usr/bin/google-chrome";
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

/** Clicks something that runs a Server Action, and waits for its answer. */
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

/**
 * As if a few minutes had passed for this account's two-factor tries (10,
 * then one every 30 s): this suite enters more codes than a person would.
 * Only possible with Redis; without it, run the suite on a fresh server.
 */
async function restTries(userId) {
  if (!process.env.REDIS_URL) return;
  const { default: Redis } = await import("ioredis");
  const r = new Redis(process.env.REDIS_URL);
  await r.del(`canvas:rl:twoFactorByUser:${createHash("sha256").update(userId).digest("hex").slice(0, 32)}`);
  r.disconnect();
}

const button = (label) => `xpath/.//button[normalize-space()="${label}"]`;
const path = (p) => new URL(p.url()).pathname;
const text = (p) => p.evaluate(() => document.body.innerText);
const alertText = (p) => p.$$eval("[role=alert]", (ns) => ns.map((n) => n.textContent).join(" ")).catch(() => "");

/**
 * An authenticator app: a code for the next 30 s step not used yet. The
 * server takes the current step and one either side, each once, so after two
 * codes in a row this waits for the clock, like a person waiting for a new one.
 */
function authenticator(manualKey) {
  const key = decodeBase32IgnorePadding(manualKey.replace(/\s/g, ""));
  let last = 0;
  return {
    async next() {
      const step = Math.max(Math.floor(Date.now() / 30_000), last + 1);
      const usableAt = (step - 1) * 30_000 + 500;
      if (Date.now() < usableAt) await sleep(usableAt - Date.now());
      last = step;
      return generateHOTP(key, BigInt(step), 6);
    },
    /** A code the server has already accepted. */
    old: () => generateHOTP(key, BigInt(last), 6),
    wrong: () => String((Number(generateHOTP(key, BigInt(Math.floor(Date.now() / 30_000)), 6)) + 500_000) % 1_000_000).padStart(6, "0"),
  };
}

async function typeCode(p, code, submit = "Continue") {
  await p.waitForSelector("#code");
  await p.click("#code", { clickCount: 3 });
  await p.keyboard.press("Backspace");
  await p.type("#code", code);
  const before = p.url();
  await act(p, button(submit));
  // A right code moves on to another page; a wrong one stays with an error.
  await waitFor(async () => p.url() !== before || (await alertText(p)), 5000);
  await p.waitForNetworkIdle({ idleTime: 250 }).catch(() => {});
}

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

// ================================================================ setting it up
const a = await newPage();
const tess = await signUp(a, { name: "Tess Two", email: uniqueEmail("2fa") });
// A second device, signed in before two-factor goes on.
const other = await newPage();
await logIn(other, tess);
check("signed in on a second device", path(other) === "/");

await a.goto(`${BASE}/settings`, { waitUntil: "networkidle0" });
const section = await text(a);
check(
  "Settings has a Signing in section: password set, two-factor off",
  /Signing in/.test(section) && /Password\s*\n*\s*Set\./.test(section) && (await a.$(button("Set up two-factor sign-in"))) !== null,
);

await act(a, button("Set up two-factor sign-in"));
await a.waitForSelector("[data-testid=totp-qr] svg");
const manualKey = await a.$eval("[data-testid=totp-key]", (n) => n.textContent.trim());
check("setup shows a QR code and a key to type in", /^[A-Z2-7]{4}( [A-Z2-7]{1,4})+$/.test(manualKey), manualKey.slice(0, 9) + "…");
check(
  "the QR code is an otpauth link for canvas",
  /^otpauth:\/\/totp\/canvas:/.test(await a.$eval("a[href^='otpauth:']", (l) => l.getAttribute("href"))),
);
check(
  "a setup isn't asked for at login until it's confirmed",
  sql(`select count(*) from user_two_factor where user_id='${tess.id}' and enabled_at is null`) === "1",
);
const app = authenticator(manualKey);

await a.type("#totp-confirm", app.wrong());
await act(a, button("Turn on"));
check("a wrong code doesn't turn it on", /isn't right/.test(await alertText(a)));

await a.reload({ waitUntil: "networkidle0" });
check(
  "coming back to Settings mid-setup shows the same key",
  (await a.$eval("[data-testid=totp-key]", (n) => n.textContent.trim()).catch(() => "")) === manualKey,
);

await a.click("#totp-confirm", { clickCount: 3 });
await a.type("#totp-confirm", await app.next());
await act(a, button("Turn on"));
await a.waitForSelector("[data-testid=recovery-codes]");
const recovery = await a.$$eval("[data-testid=recovery-codes] li", (lis) => lis.map((li) => li.textContent.trim()));
check("turning it on shows 10 recovery codes", recovery.length === 10 && recovery.every((c) => /^[a-z2-9]{5}-[a-z2-9]{5}$/.test(c)), recovery[0]);
const stored = sql(`select length(totp_key) || ' ' || (enabled_at is not null) from user_two_factor where user_id='${tess.id}'`);
check("the key is stored encrypted (IV, tag and 20 bytes) and it's on", stored === "48 true", stored);
check(
  "recovery codes are stored as hashes only",
  sql(`select count(*) from two_factor_recovery_codes where user_id='${tess.id}' and length(code_hash) = 32`) === "10",
);
const onEmail = await waitForEmail(tess.email, /Two-factor sign-in is on/).catch(() => null);
check("an email says it was turned on", !!onEmail && /signed out/.test(onEmail.text));

await other.goto(`${BASE}/settings`, { waitUntil: "networkidle0" });
check("the other device was signed out", path(other) === "/login");

await a.click(button("I've saved them"));
await waitFor(async () => /10 recovery codes left/.test(await text(a)));
check("Settings then says it's on, with 10 recovery codes left", /On since .*10 recovery codes left/s.test(await text(a)));

// ================================================================ logging in
await a.deleteCookie({ name: "session", url: BASE });
await logIn(a, tess, "/settings");
check("the password alone leads to the code page", path(a) === "/login/two-factor", a.url());
await a.waitForSelector("#code");
check("the code page says which account", (await text(a)).includes(tess.email));

await a.goto(`${BASE}/settings`, { waitUntil: "networkidle0" });
check("a login waiting for its code can't open other pages", path(a) === "/login/two-factor");
const apiStatus = await a.evaluate(async () => (await fetch("/api/drawings/00000000-0000-0000-0000-000000000000/events")).status);
check("…or the API", apiStatus === 401 || apiStatus === 403 || apiStatus === 404, String(apiStatus));
check(
  "the waiting session is marked pending in the database",
  sql(`select count(*) from sessions where user_id='${tess.id}' and two_factor_pending`) === "1",
);

await a.goto(`${BASE}/login/two-factor?next=%2Fsettings`, { waitUntil: "networkidle0" });
await typeCode(a, "12ab");
check("something that isn't a code gets a hint", /6-digit code/.test(await alertText(a)));
await typeCode(a, app.wrong());
check("a wrong code is refused", /isn't right/.test(await alertText(a)) && path(a) === "/login/two-factor");
await typeCode(a, await app.next());
check("the right code logs in, on to where they were going", path(a) === "/settings", a.url());
check(
  "with a new session (the waiting one is gone)",
  sql(`select count(*) filter (where two_factor_pending) from sessions where user_id='${tess.id}'`) === "0",
);

// The same code again (someone watching over a shoulder).
const b = await newPage();
await logIn(b, tess);
await typeCode(b, app.old());
check("a code that was just used doesn't work again", path(b) === "/login/two-factor" && /isn't right/.test(await alertText(b)));

// A recovery code instead.
await b.waitForSelector(button("Use a recovery code"));
await b.click(button("Use a recovery code"));
check("Use a recovery code switches the field", (await b.$eval("label[for=code]", (l) => l.textContent)) === "Recovery code");
await typeCode(b, recovery[0].toUpperCase().replace("-", " "));
check("a recovery code logs in (any case, with or without the dash)", path(b) === "/");
const usedEmail = await waitForEmail(tess.email, /recovery code was used/).catch(() => null);
check("an email says a recovery code was used, and how many are left", !!usedEmail && /9 left/.test(usedEmail.text));

const c = await newPage();
await logIn(c, tess);
await c.waitForSelector(button("Use a recovery code"));
await c.click(button("Use a recovery code"));
await typeCode(c, recovery[0]);
check("each recovery code works once", path(c) === "/login/two-factor" && /isn't right/.test(await alertText(c)));

// "Not you?" ends the half-finished login.
await c.waitForSelector(button("Log in with another account"));
await Promise.all([c.waitForNavigation({ waitUntil: "networkidle0" }), c.click(button("Log in with another account"))]);
check(
  "Not you? goes back to the login page and ends the waiting session",
  path(c) === "/login" && sql(`select count(*) from sessions where user_id='${tess.id}' and two_factor_pending`) === "0",
);

// The waiting session expires after 10 minutes.
await logIn(c, tess);
sql(`update sessions set created_at = now() - interval '11 minutes' where user_id='${tess.id}' and two_factor_pending`);
await c.goto(`${BASE}/login/two-factor`, { waitUntil: "networkidle0" });
check("a login left waiting for 10 minutes has to start again", path(c) === "/login");
check("and its session is deleted", sql(`select count(*) from sessions where user_id='${tess.id}' and two_factor_pending`) === "0");

// Too many wrong codes.
const rate = await newPage();
const rita = await signUp(rate, { name: "Rita Rate", email: uniqueEmail("2fa-rate") });
await rate.goto(`${BASE}/settings`, { waitUntil: "networkidle0" });
await act(rate, button("Set up two-factor sign-in"));
await rate.waitForSelector("[data-testid=totp-key]");
const ritaApp = authenticator(await rate.$eval("[data-testid=totp-key]", (n) => n.textContent.trim()));
await rate.type("#totp-confirm", await ritaApp.next());
await act(rate, button("Turn on"));
await rate.waitForSelector("[data-testid=recovery-codes]");
await rate.deleteCookie({ name: "session", url: BASE });
await logIn(rate, rita);
let limited = false;
for (let i = 0; i < 12 && !limited; i++) {
  await typeCode(rate, ritaApp.wrong());
  limited = /Too many tries/.test(await alertText(rate));
}
check("after 10 wrong codes, it's time to wait", limited);

// ================================================================ password reset
const r = await newPage();
await r.goto(`${BASE}/forgot-password`, { waitUntil: "networkidle0" });
const sentAt = Date.now();
await captchaReady(r);
await r.type("#email", tess.email);
await act(r, "form button[type=submit]");
await r.waitForFunction(() => /Check your email/.test(document.querySelector("h1")?.textContent ?? ""), { timeout: 10_000 });
const resetMail = await waitForEmail(tess.email, /Reset your canvas password|password/i, { after: sentAt - 1000 });
const resetLink = resetMail.text.match(/https?:\/\/\S+\/reset-password\/\S+/)?.[0];
await r.goto(resetLink, { waitUntil: "networkidle0" });
const NEW_PASSWORD = `${PASSWORD} again`;
await r.type("#password", NEW_PASSWORD);
await r.type("#confirm", NEW_PASSWORD);
await Promise.all([r.waitForNavigation({ waitUntil: "networkidle0" }), r.click("form button[type=submit]")]);
check("a password reset still asks for the code", path(r) === "/login/two-factor", r.url());
await typeCode(r, await app.next());
check("and the code finishes it", path(r) === "/" || path(r) === "/pricing", r.url());
tess.password = NEW_PASSWORD;

// ================================================================ new codes, turning it off
await restTries(tess.id);
await r.goto(`${BASE}/settings`, { waitUntil: "networkidle0" });
await r.click(button("Make new recovery codes"));
await r.waitForSelector("#totp-current");
await r.type("#totp-current", app.wrong());
await act(r, button("Make new codes"));
check("new recovery codes need a right code", /isn't right/.test(await alertText(r)));
await r.click("#totp-current", { clickCount: 3 });
await r.type("#totp-current", await app.next());
await act(r, button("Make new codes"));
await r.waitForSelector("[data-testid=recovery-codes]");
const fresh = await r.$$eval("[data-testid=recovery-codes] li", (lis) => lis.map((li) => li.textContent.trim()));
check("new recovery codes replace the old ones", fresh.length === 10 && !fresh.includes(recovery[1]));
await r.click(button("I've saved them"));

const d = await newPage();
await logIn(d, tess);
await d.waitForSelector(button("Use a recovery code"));
await d.click(button("Use a recovery code"));
await typeCode(d, recovery[1]);
check("an old recovery code stops working", path(d) === "/login/two-factor");
await typeCode(d, fresh[0]);
check("a new one works", path(d) === "/");

await r.waitForSelector(button("Turn off"));
await r.click(button("Turn off"));
await r.waitForSelector("#totp-current");
await r.type("#totp-current", fresh[1]);
await act(r, `xpath/.//form//button[normalize-space()='Turn off']`);
await waitFor(async () => (await r.$(button("Set up two-factor sign-in"))) !== null);
check("a recovery code can turn it off", (await r.$(button("Set up two-factor sign-in"))) !== null);
check(
  "turning it off deletes the key and the codes",
  sql(`select (select count(*) from user_two_factor where user_id='${tess.id}') + (select count(*) from two_factor_recovery_codes where user_id='${tess.id}')`) === "0",
);
const offEmail = await waitForEmail(tess.email, /Two-factor sign-in is off/).catch(() => null);
check("an email says it was turned off", !!offEmail);

const e = await newPage();
await logIn(e, tess);
check("logging in no longer asks for a code", path(e) === "/");

// ================================================================ staff turn it off
const staff = await newPage();
const adam = await signUp(staff, { name: "Adam Staff", email: uniqueEmail("2fa-admin") });
spawnSync("node", ["scripts/role.mjs", "set", adam.email, "admin"], { encoding: "utf8" });
await staff.goto(`${BASE}/admin?user=${rita.id}`, { waitUntil: "networkidle0" });
check("the admin panel shows two-factor is on", /Two-factor sign-in on/.test(await staff.$eval("[data-testid=signing-in]", (n) => n.innerText)));
await act(staff, button("Turn off two-factor sign-in"));
await waitFor(async () => /Turned off their two-factor/.test(await text(staff)));
check(
  "staff can turn it off for someone locked out",
  sql(`select count(*) from user_two_factor where user_id='${rita.id}'`) === "0",
);
check("it's in the account's history", /turned off their two-factor sign-in/.test(await text(staff)));
const staffEmail = await waitForEmail(rita.email, /Two-factor sign-in is off/).catch(() => null);
check("and they're emailed about it", !!staffEmail && /canvas team/.test(staffEmail.text));

check("no page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
await browser.close();
console.log(failures ? `\n${failures} FAILED` : "\nall passed");
process.exit(failures ? 1 : 0);
