// Shared helpers for the e2e scripts.
import { execSync } from "node:child_process";

export const BASE = process.env.BASE_URL ?? "http://localhost:3000";
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Run SQL against DATABASE_URL (through stdin, so quotes need no escaping). */
export const sql = (q) => execSync(`psql "${process.env.DATABASE_URL}" -tA -q`, { input: q }).toString().trim();

export const uniqueEmail = (tag = "test") => `${tag}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}@example.com`;
export const PASSWORD = "correct horse battery staple 42";

/** Gives the account a complimentary membership (what `npm run membership -- grant` does). */
export const grantMembership = (userId) =>
  sql(`insert into subscriptions (id, user_id, status) values ('comp_' || gen_random_uuid(), '${userId}', 'active')`);

/** Study buddies float over the page and could catch a test's clicks, so tests start with them hidden. */
export const hideBuddies = (userId) =>
  sql(
    `insert into buddy_settings (user_id, settings) values ('${userId}', '${JSON.stringify({
      visible: false,
      wander: true,
      dailyGoal: 20,
      buddies: [{ id: "bao", name: "Bao", color: "#277c78", x: null, y: null }],
    })}') on conflict (user_id) do nothing`,
  );

/** Messages the app has sent to this address (e2e/mock-mail.mjs), oldest first. */
export const INBOX = process.env.MOCK_INBOX_URL ?? "http://localhost:2526";
export async function inbox(to) {
  return (await fetch(`${INBOX}/messages?to=${encodeURIComponent(to)}`)).json();
}

/** Waits for an email to this address matching `subject`, and returns the newest one. */
export async function waitForEmail(to, subject = /./, { after = 0, timeout = 10_000 } = {}) {
  const deadline = Date.now() + timeout;
  for (;;) {
    const found = (await inbox(to)).filter((m) => subject.test(m.subject) && Date.parse(m.at) >= after);
    if (found.length) return found.at(-1);
    if (Date.now() > deadline) throw new Error(`no email to ${to} matching ${subject}`);
    await sleep(100);
  }
}

/** Resolves once the form's CAPTCHA token is in (or right away when the CAPTCHA is off). */
export const captchaReady = (page) =>
  page.waitForFunction(() => {
    const field = document.querySelector("input[name='cf-turnstile-response']");
    return !field || field.value !== "";
  });

/**
 * Create an account through the sign-up form, which lands on /verify-email.
 * The email is then marked confirmed directly in the database (e2e/test-account.mjs
 * covers the real code). With `member` (the default) the account gets a
 * complimentary membership and the page goes on to the gallery; otherwise to
 * the pricing page, where non-members start one. Study buddies start hidden unless `buddies` is true.
 * With `verify: false` the account stays unconfirmed, on /verify-email.
 */
export async function signUp(
  page,
  { name = "Test Person", email = uniqueEmail(), password = PASSWORD, member = true, buddies = false, verify = true } = {},
) {
  // Sign-ups are limited to 3 per IP with one more every 10 s; suites run
  // back to back can hit that, so wait it out like a person would.
  for (let attempt = 0; attempt < 4; attempt++) {
    await page.goto(`${BASE}/signup`, { waitUntil: "networkidle0" });
    await page.type("#name", name);
    await page.type("#email", email);
    await page.type("#password", password);
    await Promise.all([
      Promise.race([page.waitForNavigation({ waitUntil: "networkidle0" }), page.waitForSelector("[role=alert]")]).catch(() => {}),
      page.click("form button[type=submit]"),
    ]);
    if (new URL(page.url()).pathname !== "/signup") break;
    const alert = await page.$eval("[role=alert]", (n) => n.textContent).catch(() => "");
    if (!/Too many sign-ups/.test(alert)) throw new Error(`sign-up failed: ${alert}`);
    await sleep(10_500);
  }
  const id = sql(`select id from users where email = '${email}'`);
  if (!id) throw new Error("sign-up didn't create a user");
  if (!buddies) hideBuddies(id);
  if (!verify) {
    await page.waitForSelector("#code", { timeout: 10_000 });
    return { name, email, password, id };
  }
  sql(`update users set email_verified = true where id = '${id}'`);
  if (member) {
    grantMembership(id);
    await page.goto(`${BASE}/`, { waitUntil: "networkidle0" });
  } else {
    await page.goto(`${BASE}/pricing`, { waitUntil: "networkidle0" });
    await page.waitForSelector("xpath/.//button[normalize-space()='Start membership']", { timeout: 10_000 });
  }
  return { name, email, password, id };
}

export async function logIn(page, { email, password = PASSWORD }, next) {
  await page.goto(`${BASE}/login${next ? `?next=${encodeURIComponent(next)}` : ""}`, { waitUntil: "networkidle0" });
  await page.type("#email", email);
  await page.type("#password", password);
  await Promise.all([page.waitForNavigation({ waitUntil: "networkidle0" }).catch(() => {}), page.click("form button[type=submit]")]);
}

/** Name of the signed-in user's IndexedDB database. */
export const localDbName = (userId) => `canvas-local:${userId}`;

/**
 * Pick a tool (or Image or video, Trace a picture) from the editor's dock by
 * name: its own button, or from the group it's tucked into, opening that
 * group's list the way a person would (its arrow, or pressing it again).
 */
export async function pickTool(page, label) {
  const dock = "[data-testid=tool-dock]";
  // The dock comes alive once the drawing has loaded.
  await page.waitForSelector(`${dock}:not([aria-disabled=true])`, { timeout: 15_000 });
  const direct = await page.$(`${dock} button[data-tool="${label}"]`);
  if (direct) {
    const pressed = await direct.evaluate((b) => b.getAttribute("aria-pressed") === "true");
    if (!pressed) await direct.click();
    return;
  }
  const slots = await page.$$(`${dock} [data-items]`);
  let slot = null;
  for (const s of slots) {
    const items = await s.evaluate((n) => n.dataset.items.split(","));
    if (items.includes(label)) slot = s;
  }
  if (!slot) throw new Error(`no tool called ${label} in the dock`);
  const opened = () => page.$("[data-ui=menu] [role=menuitem]");
  const arrow = await slot.$("button[aria-label^='More']");
  if (arrow && (await arrow.boundingBox())) await arrow.click();
  else {
    const main = await slot.$("button[aria-pressed]");
    await main.click();
    await sleep(150);
    if (!(await opened())) await main.click();
  }
  const item = await page.waitForSelector(`xpath/.//*[@data-ui='menu']//*[@role='menuitem'][.//span[normalize-space()="${label}"]]`, {
    timeout: 5000,
  });
  await item.click();
  await sleep(100);
}

/**
 * The file chooser that `act` opens. Puppeteer turns on catching the chooser
 * over the protocol, and a key press sent straight after can get there first
 * (the page opens its picker, nobody catches it); a moment's head start makes
 * that a non-issue.
 */
export async function chooseFile(page, act, timeout = 10_000) {
  const chooser = page.waitForFileChooser({ timeout });
  await sleep(150);
  await act();
  return chooser;
}
