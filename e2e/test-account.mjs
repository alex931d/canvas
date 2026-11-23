// Email confirmation codes, password reset links and the CAPTCHA.
// Run against `npm run build && npm start` with e2e/mock-mail.mjs and
// e2e/mock-turnstile.mjs running (see README, Tests); uses DATABASE_URL.
import puppeteer from "puppeteer-core";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import nextEnv from "@next/env";

nextEnv.loadEnvConfig(process.cwd());
const { BASE, sleep, sql, signUp, logIn, uniqueEmail, PASSWORD, grantMembership, inbox, waitForEmail, captchaReady } =
  await import("./helpers.mjs");

const CHROME = process.env.CHROME_PATH ?? "/usr/bin/google-chrome";
const SITE_KEY = process.env.TURNSTILE_SITE_KEY ?? "1x00000000000000000000AA";
let failures = 0;
function check(label, cond, extra = "") {
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}${extra ? `  (${extra})` : ""}`);
  if (!cond) failures++;
}

const sha256hex = (s) => createHash("sha256").update(s).digest("hex");
const codeFrom = (mail) => /(\d{4}) (\d{4})/.exec(mail.text)?.slice(1).join("") ?? "";
const linkFrom = (mail, path) => new RegExp(`https?://\\S+${path}\\S*`).exec(mail.text)?.[0] ?? "";
const otherCode = (code) => String((Number(code) + 1) % 100_000_000).padStart(8, "0");
const path = (page) => new URL(page.url()).pathname;
const text = (page, sel) => page.$eval(sel, (n) => n.textContent.trim()).catch(() => "");
const alertText = (page) => text(page, "[role=alert]");
const waitForPath = (page, p) => page.waitForFunction((p) => location.pathname === p, { timeout: 15_000 }, p);

/**
 * Click something that sends a Server Action and wait for its answer to be
 * shown. (The router stops reading the action's response once it has the
 * result, so the request ends as "failed" as often as "finished".)
 */
async function act(page, selector) {
  const done = new Promise((resolve) => {
    const ended = (req) => {
      if (req.method() !== "POST" || !req.headers()["next-action"]) return;
      page.off("requestfinished", ended);
      page.off("requestfailed", ended);
      resolve();
    };
    page.on("requestfinished", ended);
    page.on("requestfailed", ended);
  });
  await page.click(selector);
  await done;
  await sleep(250);
}

async function typeInto(page, selector, value) {
  await page.$eval(selector, (el) => (el.value = ""));
  await page.type(selector, value);
}

const VERIFY = "form:has(#code) button[type=submit]";
const RESEND = "xpath/.//button[contains(., 'a new code') or contains(., 'Sending')]";
const SIGN_OUT = "xpath/.//button[normalize-space()='Sign out']";

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ["--no-sandbox"],
  defaultViewport: { width: 1280, height: 860 },
});
const errors = [];
async function newPage() {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  return page;
}

// ================================================================= CAPTCHA
const p = await newPage();

for (const [where, url] of [["sign-up", "/signup"], ["login", "/login"], ["forgot password", "/forgot-password"]]) {
  await p.goto(`${BASE}${url}`, { waitUntil: "networkidle0" });
  await captchaReady(p);
  const shown = await p.$eval("[data-testid=captcha]", (el) => el.getAttribute("data-mock-turnstile")).catch(() => null);
  const token = await p.$eval("input[name='cf-turnstile-response']", (el) => el.value).catch(() => "");
  check(`the ${where} form runs the CAPTCHA`, shown === SITE_KEY && token.startsWith("mock."), `${shown} ${token.slice(0, 12)}`);
}

// A login token, kept unused for the sign-up test below.
await p.goto(`${BASE}/login`, { waitUntil: "networkidle0" });
await captchaReady(p);
const loginToken = await p.$eval("input[name='cf-turnstile-response']", (el) => el.value);

/** Fill the sign-up form, swap in `token` (or drop the field), and send it. */
async function signUpWithToken(page, email, token) {
  // Sign-ups are limited per network before the CAPTCHA is checked; wait that out like signUp() does.
  for (let attempt = 0; attempt < 4; attempt++) {
    await page.goto(`${BASE}/signup`, { waitUntil: "networkidle0" });
    await captchaReady(page);
    await page.type("#name", "Forger");
    await page.type("#email", email);
    await page.type("#password", PASSWORD);
    // Rename the field to send no token at all.
    await page.$eval(
      "input[name='cf-turnstile-response']",
      (el, token) => (token === null ? (el.name = "renamed") : (el.value = token)),
      token,
    );
    await act(page, "form button[type=submit]");
    const alert = await alertText(page);
    if (!/Too many sign-ups/.test(alert)) return alert;
    await sleep(10_500);
  }
  return "still rate limited";
}

const forgedEmail = uniqueEmail("forged");
const forged = await signUpWithToken(p, forgedEmail, "mock.made-up-by-a-bot");
const missing = await signUpWithToken(p, forgedEmail, null);
check(
  "sign-up refuses a made-up CAPTCHA token or none at all",
  /didn't pass/.test(forged) && /Wait for the check/.test(missing) && sql(`select count(*) from users where email = '${forgedEmail}'`) === "0",
  `${forged} | ${missing}`,
);
const crossForm = await signUpWithToken(p, forgedEmail, loginToken);
check("a token from the login form can't be used to sign up", /didn't pass/.test(crossForm), crossForm);

// Tokens work once.
await p.goto(`${BASE}/login`, { waitUntil: "networkidle0" });
await captchaReady(p);
const once = await p.$eval("input[name='cf-turnstile-response']", (el) => el.value);
await p.type("#email", uniqueEmail("nobody"));
await p.type("#password", "wrong password");
await act(p, "form button[type=submit]");
const first = await alertText(p);
// Wait for the next token, then send the spent one instead.
await p.waitForFunction((once) => {
  const v = document.querySelector("input[name='cf-turnstile-response']").value;
  return v && v !== once;
}, {}, once);
await p.$eval("input[name='cf-turnstile-response']", (el, t) => (el.value = t), once);
await act(p, "form button[type=submit]");
const replay = await alertText(p);
check("a CAPTCHA token works only once", /don't match/.test(first) && /didn't pass/.test(replay), `${first} | ${replay}`);

// Pressing the button before the check is done waits for it, then sends the form.
const slow = await newPage();
await slow.evaluateOnNewDocument(() => (window.__mockTurnstileDelay = 2500));
await slow.goto(`${BASE}/login`, { waitUntil: "networkidle0" });
await slow.type("#email", uniqueEmail("early"));
await slow.type("#password", "wrong password");
await slow.click("form button[type=submit]");
await sleep(300);
const waitingLabel = await text(slow, "form button[type=submit]");
await slow.waitForSelector("[role=alert]", { timeout: 10_000 }).catch(() => {});
check(
  "pressing Login before the check is done waits, then sends the form",
  /Checking you're human/.test(waitingLabel) && /don't match/.test(await alertText(slow)),
  waitingLabel,
);
await slow.browserContext().close();

// ================================================================= email codes
const ada = await signUp(p, { name: "Ada Byron", email: uniqueEmail("code"), verify: false });
const first8 = await waitForEmail(ada.email, /is your canvas code/);
const adaCode = codeFrom(first8);
const verifyLink = linkFrom(first8, "/verify-email");
check(
  "sign-up emails an 8-digit code and a link that fills it in (text and HTML)",
  /^\d{8}$/.test(adaCode) &&
    verifyLink === `${BASE}/verify-email?code=${adaCode}` &&
    first8.html.includes(`${adaCode.slice(0, 4)} ${adaCode.slice(4)}`) &&
    first8.html.includes(`href="${verifyLink}"`) &&
    // quotes inside a style attribute would end it early and drop the styles
    !/style="[^"]*:\s*"/.test(first8.html),
  first8.subject,
);
check(
  "only SHA-256 of the code is stored, and it expires in 15 minutes",
  sql(`select encode(code_hash, 'hex') from email_verification_codes where user_id = '${ada.id}'`) === sha256hex(adaCode) &&
    Math.abs(Number(sql(`select extract(epoch from expires_at - now()) from email_verification_codes where user_id = '${ada.id}'`)) - 900) < 30,
);
check("the page says where the code went", (await text(p, "main p")).includes(ada.email));

const blocked = [];
for (const url of ["/", "/study", "/membership", "/drawings/00000000-0000-4000-8000-000000000000"]) {
  await p.goto(`${BASE}${url}`, { waitUntil: "networkidle0" });
  await p.waitForFunction(() => location.pathname === "/verify-email", { timeout: 5000 }).catch(() => {});
  blocked.push(path(p));
}
const api = await p.evaluate(async () => [
  (await fetch("/api/flashcards", { method: "POST", body: new FormData() })).status,
]);
check(
  "until it's confirmed, the account can't open the app or use its API",
  blocked.every((x) => x === "/verify-email") && api.every((s) => s === 402 || s === 403),
  `${blocked.join(",")} api ${api}`,
);

await p.goto(verifyLink, { waitUntil: "networkidle0" });
await p.waitForSelector("#code");
check(
  "the email's link only fills the code in",
  (await p.$eval("#code", (el) => el.value)) === adaCode && sql(`select email_verified from users where id = '${ada.id}'`) === "f",
);

await typeInto(p, "#code", otherCode(adaCode));
await act(p, VERIFY);
check(
  "a wrong code is refused, with the tries left",
  /isn't right.*4 tries left/.test(await alertText(p)) &&
    sql(`select attempts from email_verification_codes where user_id = '${ada.id}'`) === "1",
  await alertText(p),
);

const resendLabel = await text(p, RESEND);
check(
  "a new code can't be sent for a minute",
  /Send a new code in \d+ s/.test(resendLabel) && (await p.$eval(RESEND, (b) => b.disabled)),
  resendLabel,
);
sql(`update email_verification_codes set sent_at = now() - interval '2 minutes' where user_id = '${ada.id}'`);
await p.reload({ waitUntil: "networkidle0" });
await p.waitForSelector(RESEND);
const before = Date.now();
await act(p, RESEND);
const second = await waitForEmail(ada.email, /is your canvas code/, { after: before - 1000 });
const newCode = codeFrom(second);
check(
  "Send a new code emails a different code and starts the wait again",
  /We sent a new code/.test(await text(p, "[role=status]")) &&
    newCode !== adaCode &&
    /Send a new code in \d+ s/.test(await text(p, RESEND)),
  newCode,
);

await typeInto(p, "#code", adaCode);
await act(p, VERIFY);
check("the old code stops working", /isn't right/.test(await alertText(p)), await alertText(p));

sql(`update email_verification_codes set expires_at = now() - interval '1 second' where user_id = '${ada.id}'`);
await typeInto(p, "#code", newCode);
await act(p, VERIFY);
check("an expired code is refused", /expired/.test(await alertText(p)), await alertText(p));

sql(`update email_verification_codes set expires_at = now() + interval '15 minutes' where user_id = '${ada.id}'`);
await typeInto(p, "#code", `${newCode.slice(0, 4)} ${newCode.slice(4)}`);
await Promise.all([waitForPath(p, "/pricing"), p.click(VERIFY)]);
check(
  "the right code (spaces allowed) confirms the email and goes on to the pricing page",
  sql(`select email_verified from users where id = '${ada.id}'`) === "t" &&
    sql(`select count(*) from email_verification_codes where user_id = '${ada.id}'`) === "0",
);
await p.goto(`${BASE}/verify-email`, { waitUntil: "networkidle0" });
await p.waitForFunction(() => location.pathname !== "/verify-email", { timeout: 5000 }).catch(() => {});
check("confirmed accounts skip /verify-email", path(p) !== "/verify-email", path(p));

// Five wrong codes use a code up.
const q = await newPage();
const bea = await signUp(q, { name: "Bea", email: uniqueEmail("tries"), verify: false });
const beaCode = codeFrom(await waitForEmail(bea.email, /is your canvas code/));
let lastWrong = "";
for (let i = 0; i < 5; i++) {
  await typeInto(q, "#code", String((Number(beaCode) + 1 + i) % 100_000_000).padStart(8, "0"));
  await act(q, VERIFY);
  lastWrong = await alertText(q);
}
await typeInto(q, "#code", beaCode);
await act(q, VERIFY);
check(
  "after 5 wrong codes even the right one needs a new email",
  /Too many wrong codes/.test(lastWrong) && /Too many wrong codes/.test(await alertText(q)) && path(q) === "/verify-email",
  lastWrong,
);

const grant = spawnSync("node", ["scripts/membership.mjs", "grant", bea.email], { encoding: "utf8" });
check(
  "npm run membership won't grant an unconfirmed account",
  grant.status === 1 && /hasn't confirmed/.test(grant.stderr) && sql(`select count(*) from subscriptions where user_id = '${bea.id}'`) === "0",
  grant.stderr.trim(),
);

// Logging in to an unconfirmed account.
await Promise.all([q.waitForNavigation({ waitUntil: "networkidle0" }), q.click(SIGN_OUT)]);
check("Sign out on the confirm page signs out", path(q) === "/login" && !(await q.cookies()).some((c) => c.name === "session" && c.value));
const mailsBefore = (await inbox(bea.email)).length;
// (Codes can be re-sent once a minute, automatic ones included.)
sql(`update email_verification_codes set sent_at = now() - interval '2 minutes' where user_id = '${bea.id}'`);
await logIn(q, bea);
await q.waitForFunction(() => location.pathname === "/verify-email", { timeout: 10_000 }).catch(() => {});
await sleep(500);
check(
  "logging in to an unconfirmed account goes to the code page and emails a new code when the old one is used up",
  path(q) === "/verify-email" && (await inbox(bea.email)).length === mailsBefore + 1,
  `${path(q)} ${(await inbox(bea.email)).length - mailsBefore} new`,
);
const beaCode2 = codeFrom((await inbox(bea.email)).at(-1));

await Promise.all([q.waitForNavigation({ waitUntil: "networkidle0" }), q.click(SIGN_OUT)]);
await logIn(q, bea);
await q.waitForFunction(() => location.pathname === "/verify-email", { timeout: 10_000 }).catch(() => {});
await sleep(500);
check("…but not while the last code still works", (await inbox(bea.email)).length === mailsBefore + 1);

// The email's link, opened while signed out, works after logging in, and ?next= survives confirming.
grantMembership(bea.id);
await Promise.all([q.waitForNavigation({ waitUntil: "networkidle0" }), q.click(SIGN_OUT)]);
await q.goto(`${BASE}/verify-email?code=${beaCode2}`, { waitUntil: "networkidle0" });
const loginNext = new URL(q.url()).searchParams.get("next");
await q.type("#email", bea.email);
await q.type("#password", PASSWORD);
await Promise.all([q.waitForNavigation({ waitUntil: "networkidle0" }).catch(() => {}), q.click("form button[type=submit]")]);
await q.waitForSelector("#code");
check(
  "the email's link, opened signed out, fills the code in after logging in",
  loginNext === `/verify-email?code=${beaCode2}` && (await q.$eval("#code", (el) => el.value)) === beaCode2,
  loginNext,
);
await Promise.all([q.waitForNavigation({ waitUntil: "networkidle0" }), q.click(SIGN_OUT)]);
await logIn(q, bea, "/study");
await q.waitForSelector("#code");
const carried = new URL(q.url()).searchParams.get("next");
await typeInto(q, "#code", beaCode2);
await Promise.all([waitForPath(q, "/study"), q.click(VERIFY)]).catch(() => {});
check("where they were headed (?next=) survives confirming", carried === "/study" && path(q) === "/study", `${carried} → ${path(q)}`);
await q.browserContext().close();

// ================================================================= password reset
const r = await newPage();
const cleo = await signUp(r, { name: "Cleo", email: uniqueEmail("reset") }); // one session…
const other = await newPage(); // …and another, both to be signed out by the reset
await logIn(other, cleo);
const otherSid = (await other.cookies()).find((c) => c.name === "session").value.split(".")[0];

/** Fill in the forgot-password form and send it; returns the page's text. */
async function askForReset(page, email) {
  // 10 requests per network, then one every 30 s: wait it out like a person would.
  for (let attempt = 0; attempt < 6; attempt++) {
    await page.goto(`${BASE}/forgot-password`, { waitUntil: "networkidle0" });
    await page.waitForSelector("#email");
    await page.type("#email", email);
    await act(page, "form button[type=submit]");
    if (!/Too many requests/.test(await alertText(page))) break;
    await sleep(31_000);
  }
  await page.waitForFunction(() => /Check your email/.test(document.querySelector("h1")?.textContent ?? ""), { timeout: 10_000 });
  return page.$eval("main section", (s) => s.innerText);
}

const anon = await newPage();
await anon.goto(`${BASE}/login`, { waitUntil: "networkidle0" });
const forgotLink = await text(anon, "a[href='/forgot-password']");
await Promise.all([anon.waitForNavigation({ waitUntil: "networkidle0" }), anon.click("a[href='/forgot-password']")]);
check(
  "the login page links to Forgot password",
  forgotLink === "Forgot password?" && (await text(anon, "h1")) === "Reset your password",
  forgotLink,
);

const unknown = uniqueEmail("nobody");
const unknownPage = await askForReset(anon, unknown);
const knownPage = await askForReset(anon, cleo.email);
await sleep(1500);
check(
  "Forgot password answers the same whether or not an account uses the address",
  unknownPage.replace(unknown, "@") === knownPage.replace(cleo.email, "@"),
);
check("…and only emails real accounts", (await inbox(unknown)).length === 0);

const resetMail = await waitForEmail(cleo.email, /Reset your canvas password/);
const resetLink = linkFrom(resetMail, "/reset-password/");
const token = resetLink.split("/reset-password/")[1] ?? "";
check(
  "the reset email links to a 256-bit token, stored only as SHA-256 for 1 hour",
  /^[A-Za-z0-9_-]{43}$/.test(token) &&
    sql(`select count(*) from password_reset_tokens where token_hash = decode('${sha256hex(token)}', 'hex')`) === "1" &&
    Math.abs(Number(sql(`select extract(epoch from max(expires_at) - now()) from password_reset_tokens where user_id = '${cleo.id}'`)) - 3600) < 30,
  token.length,
);

await anon.goto(resetLink, { waitUntil: "networkidle0" });
await anon.waitForSelector("#confirm");
check(
  "the link opens a new-password form for that account, and the page sends no Referer",
  (await text(anon, "main p")).includes(cleo.email) &&
    (await anon.$eval("meta[name=referrer]", (m) => m.content).catch(() => "")) === "no-referrer",
);

await anon.type("#password", "short");
await anon.type("#confirm", "different");
await act(anon, "form button[type=submit]");
const weak = await anon.$$eval("[id$='-error']", (els) => els.map((e) => e.textContent).join(" | "));
check("a weak or mismatched new password is refused", /8 characters/.test(weak) && /don't match/.test(weak), weak);

const NEW_PASSWORD = "a brand new password for cleo 7";
await typeInto(anon, "#password", NEW_PASSWORD);
await typeInto(anon, "#confirm", NEW_PASSWORD);
await Promise.all([waitForPath(anon, "/"), anon.click("form button[type=submit]")]);
check(
  "saving the new password signs this browser in",
  path(anon) === "/" && sql(`select count(*) from sessions where user_id = '${cleo.id}'`) === "1",
);
await other.goto(BASE, { waitUntil: "networkidle0" });
check(
  "…and signs the account out everywhere else",
  path(other) === "/login" && sql(`select count(*) from sessions where id = '${otherSid}'`) === "0",
);
check(
  "…and stores the new password's Argon2id hash",
  sql(`select password_hash from users where id = '${cleo.id}'`).startsWith("$argon2id$"),
);
const changed = await waitForEmail(cleo.email, /password was changed/);
check("a 'password changed' email goes to the account", changed.text.includes(`${BASE}/forgot-password`));

await other.goto(`${BASE}/login`, { waitUntil: "networkidle0" });
await other.type("#email", cleo.email);
await other.type("#password", PASSWORD); // the old password
await act(other, "form button[type=submit]");
check("the old password stops working", /don't match/.test(await alertText(other)), await alertText(other));
await sleep(1100); // per-account login throttle
await logIn(other, { email: cleo.email, password: NEW_PASSWORD });
check("the new password works", path(other) === "/", path(other));

await anon.goto(resetLink, { waitUntil: "networkidle0" });
check("a used link doesn't work again", /doesn't work anymore/.test(await text(anon, "h1")));

await askForReset(anon, cleo.email);
const second2 = await waitForEmail(cleo.email, /Reset your canvas password/, { after: Date.parse(resetMail.at) + 1 });
const expiring = linkFrom(second2, "/reset-password/");
sql(`update password_reset_tokens set expires_at = now() - interval '1 second' where user_id = '${cleo.id}'`);
await anon.goto(expiring, { waitUntil: "networkidle0" });
check("an expired link doesn't work", /doesn't work anymore/.test(await text(anon, "h1")) && (await text(anon, "a[href='/forgot-password']")) === "Send a new link");

// Squatted addresses: a reset proves the inbox, so it also confirms the email.
const s = await newPage();
const squat = await signUp(s, { name: "Squatter", email: uniqueEmail("squat"), verify: false });
const owner = await newPage();
await askForReset(owner, squat.email);
const squatLink = linkFrom(await waitForEmail(squat.email, /Reset your canvas password/), "/reset-password/");
await owner.goto(squatLink, { waitUntil: "networkidle0" });
await owner.waitForSelector("#confirm");
await owner.type("#password", NEW_PASSWORD);
await owner.type("#confirm", NEW_PASSWORD);
await Promise.all([waitForPath(owner, "/pricing"), owner.click("form button[type=submit]")]).catch(() => {});
await s.goto(BASE, { waitUntil: "networkidle0" });
check(
  "resetting an unconfirmed account's password confirms the email and signs the squatter out",
  path(owner) === "/pricing" && sql(`select email_verified from users where id = '${squat.id}'`) === "t" && path(s) === "/login",
  `${path(owner)} ${path(s)}`,
);

// At most 3 reset emails per address (then one per 20 minutes).
const flood = uniqueEmail("flood");
const floodUser = await signUp(await newPage(), { email: flood });
for (let i = 0; i < 4; i++) await askForReset(anon, flood);
await sleep(1500);
check(
  "an inbox gets at most 3 reset emails in a row",
  (await inbox(flood)).filter((m) => /Reset your canvas password/.test(m.subject)).length === 3 &&
    sql(`select count(*) from password_reset_tokens where user_id = '${floodUser.id}'`) === "3",
);

console.log("\nerrors:", errors.length ? errors : "none");
await browser.close();
process.exit(failures ? 1 : 0);
