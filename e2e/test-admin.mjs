// Roles and the admin dashboard: who can open it, searching, filtering and
// paging with everything kept in the address, editing accounts, what support
// can and can't do (checked on the server, not just hidden), and the history.
// Run against `npm run build && npm start` (see README, Tests); uses DATABASE_URL.
import puppeteer from "puppeteer-core";
import { spawnSync } from "node:child_process";
import nextEnv from "@next/env";

nextEnv.loadEnvConfig(process.cwd());
const { BASE, sleep, sql, signUp, uniqueEmail, waitForEmail } = await import("./helpers.mjs");

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

const role = (...args) => spawnSync("node", ["scripts/role.mjs", ...args], { encoding: "utf8" });
const params = (p) => Object.fromEntries(new URL(p.url()).searchParams);
const text = (p) => p.evaluate(() => document.body.innerText);
const rowIds = (p) => p.$$eval("[data-testid=users-table] tbody tr", (trs) => trs.map((tr) => tr.dataset.userId));
const rowNames = (p) =>
  p.$$eval("[data-testid=users-table] tbody tr td:first-child a", (as) => as.map((a) => a.textContent.trim()));
const shown = (p) => p.$eval("main [aria-live=polite]", (n) => n.textContent.trim()).catch(() => "");
const pagerNumbers = (p) =>
  p.$$eval("nav[aria-label=Pages] a[aria-label^='Page ']", (as) => as.map((a) => Number(a.textContent)));
const currentPage = (p) => p.$eval("nav[aria-label=Pages] [aria-current=page]", (a) => Number(a.textContent)).catch(() => 0);
const button = (label) => `xpath/.//button[normalize-space()='${label}']`;
const panel = "[role=dialog]";
const panelButton = (label) => `xpath/.//*[@role='dialog']//button[normalize-space()='${label}']`;
const panelText = (p) => p.$eval(panel, (d) => d.innerText).catch(() => "");

/** Waits for the address (and the table under it) to match. */
const urlIs = (p, check) =>
  waitFor(async () => check(params(p)) && !(await p.$("[aria-label=Searching]")) && (await p.$("[data-testid=users-table], main [aria-live=polite]")));

/** Clicks a button inside a form that runs a Server Action, and waits for its answer. */
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

async function retype(p, selector, value) {
  await p.click(selector, { clickCount: 1 });
  await p.$eval(selector, (el) => el.select?.());
  await p.keyboard.down("Control");
  await p.keyboard.press("a");
  await p.keyboard.up("Control");
  await p.keyboard.type(value);
}

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ["--no-sandbox"],
  defaultViewport: { width: 1440, height: 1000 },
});
const errors = [];
async function newPage() {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  return page;
}

// 85 accounts that only this run's search finds: 9 pages of 10, newest first.
const TAG = `zed${Date.now().toString(36)}`;
sql(`insert into users (name, email, password_hash, email_verified, created_at)
     select 'Zed ${TAG} ' || lpad(i::text, 2, '0'), 'zed-${TAG}-' || i || '@example.com', 'not-a-hash', true,
            now() - make_interval(mins => i)
     from generate_series(1, 85) i`);
const zedId = (n) => sql(`select id from users where email = 'zed-${TAG}-${n}@example.com'`);

// ================================================================= roles from the command line
const admin = await newPage();
const ada = await signUp(admin, { name: "Ada Admin", email: uniqueEmail("admin") });
const sup = await newPage();
const sam = await signUp(sup, { name: "Sam Support", email: uniqueEmail("support") });
const usr = await newPage();
const uma = await signUp(usr, { name: "Uma User", email: uniqueEmail("user") });
const unconfirmed = await newPage();
const uno = await signUp(unconfirmed, { name: "Uno Confirmed", email: uniqueEmail("unconfirmed"), verify: false });

const madeAdmin = role("set", ada.email, "admin");
role("set", sam.email, "support");
const refused = role("set", uno.email, "admin");
check(
  "npm run role makes admins and support staff",
  madeAdmin.status === 0 &&
    /is now an admin/.test(madeAdmin.stdout) &&
    sql(`select role from users where id = '${ada.id}'`) === "admin" &&
    sql(`select role from users where id = '${sam.id}'`) === "support",
  madeAdmin.stdout.trim(),
);
check(
  "…but not for an unconfirmed email",
  refused.status === 1 && /hasn't confirmed/.test(refused.stderr) && sql(`select role from users where id = '${uno.id}'`) === "user",
);
check(
  "…and records it in the account's history",
  sql(`select details->>'via' from audit_events where user_id = '${ada.id}' and action = 'role.changed'`) === "command line",
);
check("npm run role -- list shows the staff", new RegExp(`admin\\s+Ada Admin <${ada.email}>`).test(role("list").stdout));

// ================================================================= who can open /admin
await usr.goto(`${BASE}/admin`, { waitUntil: "networkidle0" });
await usr.waitForSelector("h1");
const usrH1 = await usr.$eval("h1", (h) => h.textContent);
check(
  "a user gets the 404 page at /admin, with nothing from the dashboard",
  /doesn.t exist/.test(usrH1) && !(await usr.$("[data-testid=users-table]")) && !/Unconfirmed emails/.test(await text(usr)),
  usrH1,
);
await usr.goto(BASE, { waitUntil: "networkidle0" });
await usr.click("aside [data-ui=menu-trigger]");
await usr.waitForSelector("[role=menuitem]");
const userMenu = await usr.$$eval("[role=menuitem]", (els) => els.map((e) => e.textContent.trim()));
check(
  "users have no Admin link in the sidebar or the account menu",
  !(await usr.$("aside a[href='/admin']")) && !userMenu.some((t) => /Admin/.test(t)),
  userMenu.join(", "),
);
await usr.keyboard.press("Escape");

await unconfirmed.goto(`${BASE}/admin`, { waitUntil: "networkidle0" });
await unconfirmed.waitForFunction(() => location.pathname === "/verify-email", { timeout: 5000 }).catch(() => {});
check("an unconfirmed account goes to confirm its email first", new URL(unconfirmed.url()).pathname === "/verify-email");

await admin.goto(BASE, { waitUntil: "networkidle0" });
await admin.waitForSelector("aside a[href='/admin']", { timeout: 5000 }).catch(() => {});
await admin.click("aside [data-ui=menu-trigger]");
await admin.waitForSelector("[role=menuitem]");
const adminMenu = await admin.$$eval("[role=menuitem]", (els) => els.map((e) => e.textContent.trim()));
check(
  "staff get Admin in the sidebar and Admin dashboard in the account menu",
  !!(await admin.$("aside a[href='/admin']")) && adminMenu.includes("Admin dashboard"),
);
await Promise.all([admin.waitForNavigation({ waitUntil: "networkidle0" }), admin.click("xpath/.//a[@role='menuitem'][contains(., 'Admin dashboard')]")]);
await admin.waitForSelector("[data-testid=users-table]");
check("admins get the dashboard", (await admin.$eval("h1", (h) => h.textContent)) === "Admin");
const stats = await admin.$$eval("nav[aria-label='Filter by status'] a", (as) => as.map((a) => a.innerText.replace(/\s+/g, " ")));
check(
  "with totals for accounts, members, unconfirmed emails and staff",
  stats.length === 4 &&
    new RegExp(`Accounts ${sql("select count(*) from users")}`).test(stats[0]) &&
    new RegExp(`Unconfirmed emails ${sql("select count(*) from users where not email_verified")}`).test(stats[2]),
  stats.join(" | "),
);

// ================================================================= search, pages, filters: all in the address
const historyLength = await admin.evaluate(() => history.length);
await admin.type("form[role=search] input[type=search]", TAG);
await urlIs(admin, (q) => q.q === TAG);
check(
  "typing searches as you go and puts the search in the address",
  params(admin).q === TAG && (await shown(admin)) === "Showing 1–10 of 85",
  `${admin.url()} ${await shown(admin)}`,
);
check("…without filling the Back button's history with every keystroke", (await admin.evaluate(() => history.length)) === historyLength);
check(
  "only matching accounts are listed, newest first",
  (await rowNames(admin)).every((n) => n.includes(TAG)) && (await rowNames(admin))[0] === `Zed ${TAG} 01`,
  (await rowNames(admin)).slice(0, 2).join(", "),
);
check(
  "the pager reads ← 1 2 3 4 5 →, on page 1",
  JSON.stringify(await pagerNumbers(admin)) === "[1,2,3,4,5]" &&
    (await currentPage(admin)) === 1 &&
    !!(await admin.$("nav[aria-label=Pages] span[aria-disabled=true][aria-label='Previous page']")),
);

const page1 = await rowIds(admin);
await Promise.all([admin.waitForNavigation(), admin.click("nav[aria-label=Pages] a[aria-label='Page 2']")]).catch(() => {});
await urlIs(admin, (q) => q.page === "2");
const page2 = await rowIds(admin);
check(
  "page 2 is in the address, keeps the search, and shows the next 10",
  params(admin).page === "2" && params(admin).q === TAG && (await shown(admin)) === "Showing 11–20 of 85" && !page2.some((id) => page1.includes(id)),
  admin.url(),
);
await admin.click("nav[aria-label=Pages] a[aria-label='Next page']");
await urlIs(admin, (q) => q.page === "3");
await admin.click("nav[aria-label=Pages] a[aria-label='Page 5']");
await urlIs(admin, (q) => q.page === "5");
check(
  "the numbers slide along: page 5 shows 3 4 5 6 7",
  JSON.stringify(await pagerNumbers(admin)) === "[3,4,5,6,7]" && (await currentPage(admin)) === 5,
  JSON.stringify(await pagerNumbers(admin)),
);
await admin.reload({ waitUntil: "networkidle0" });
await admin.waitForSelector("[data-testid=users-table]");
check(
  "a reload keeps the search and the page",
  (await currentPage(admin)) === 5 &&
    (await admin.$eval("form[role=search] input[type=search]", (i) => i.value)) === TAG &&
    (await shown(admin)) === "Showing 41–50 of 85",
);
await admin.goBack();
await urlIs(admin, (q) => q.page === "3");
check(
  "Back goes to the page before",
  !!(await waitFor(async () => (await currentPage(admin)) === 3 && (await shown(admin)) === "Showing 21–30 of 85")),
);
await admin.goto(`${BASE}/admin?q=${TAG}&page=9`, { waitUntil: "networkidle0" });
check(
  "the last page: 5 6 7 8 9, five accounts, no Next",
  JSON.stringify(await pagerNumbers(admin)) === "[5,6,7,8,9]" &&
    (await rowIds(admin)).length === 5 &&
    !!(await admin.$("nav[aria-label=Pages] span[aria-disabled=true][aria-label='Next page']")),
);
await admin.goto(`${BASE}/admin?q=${TAG}&page=99`, { waitUntil: "networkidle0" });
await urlIs(admin, (q) => q.page === "9");
check("a page past the end goes to the last one, and says so in the address", params(admin).page === "9", admin.url());
await admin.goto(`${BASE}/admin?q=${TAG}-nobody`, { waitUntil: "networkidle0" });
check("no matches says so", /No accounts match/.test(await text(admin)) && !(await admin.$("nav[aria-label=Pages]")));

await admin.goto(`${BASE}/admin`, { waitUntil: "networkidle0" });
await admin.select("form[role=search] select", "support");
await urlIs(admin, (q) => q.role === "support");
const supportRows = await rowIds(admin);
check(
  "the role filter is in the address and lists only that role",
  params(admin).role === "support" &&
    supportRows.includes(sam.id) &&
    Number(sql(`select count(*) from users where role = 'support'`)) >= supportRows.length &&
    !supportRows.includes(ada.id),
);
await admin.goto(`${BASE}/admin`, { waitUntil: "networkidle0" });
await admin.click("nav[aria-label='Filter by status'] a[href='/admin?status=staff']");
await urlIs(admin, (q) => q.status === "staff");
const staffRows = await rowIds(admin);
check(
  "the Staff total filters to staff",
  params(admin).status === "staff" && staffRows.includes(ada.id) && staffRows.includes(sam.id) && !staffRows.includes(uma.id),
);
await admin.click("nav[aria-label='Filter by status'] a[href='/admin?status=unconfirmed']");
await urlIs(admin, (q) => q.status === "unconfirmed");
check("…and Unconfirmed emails to those", (await rowIds(admin)).includes(uno.id) && !(await rowIds(admin)).includes(uma.id));

// ================================================================= editing
const z1 = zedId(1);
await admin.goto(`${BASE}/admin?q=${TAG}`, { waitUntil: "networkidle0" });
await admin.click(`a[aria-label='Edit Zed ${TAG} 01']`);
await urlIs(admin, (q) => q.user === z1);
await admin.waitForSelector(`${panel} #admin-name`);
check(
  "Edit opens the account in a panel, with the account in the address",
  params(admin).user === z1 && params(admin).q === TAG && (await panelText(admin)).includes(`zed-${TAG}-1@example.com`),
);
await admin.reload({ waitUntil: "networkidle0" });
await admin.waitForSelector(`${panel} #admin-name`, { timeout: 10_000 }).catch(() => {});
check("a reload keeps it open", !!(await admin.$(`${panel} #admin-name`)));
// The study level on their record (set straight in the database here).
sql(`update users set level = 4 where id = '${z1}'`);
await admin.reload({ waitUntil: "networkidle0" });
await admin.waitForSelector(`${panel} #admin-name`, { timeout: 10_000 }).catch(() => {});
check("the panel shows the study level on their record", (await panelText(admin)).includes("Study level 4."), await panelText(admin));

await retype(admin, "#admin-name", `Zed ${TAG} Renamed`);
await act(admin, panelButton("Save changes"));
check(
  "saving changes the name",
  sql(`select name from users where id = '${z1}'`) === `Zed ${TAG} Renamed` && /Saved\./.test(await panelText(admin)),
  await panelText(admin).then((t) => t.slice(0, 80)),
);
check(
  "…records who did it",
  sql(`select actor_id || ' ' || (details->>'to') from audit_events where user_id = '${z1}' and action = 'user.updated'`) ===
    `${ada.id} Zed ${TAG} Renamed`,
);
check(
  "…and shows it in the history and the table",
  new RegExp(`Ada Admin changed the name from “Zed ${TAG} 01” to “Zed ${TAG} Renamed”`).test(await panelText(admin)) &&
    (await rowNames(admin)).includes(`Zed ${TAG} Renamed`),
);

const takenEmail = `zed-${TAG}-2@example.com`;
await retype(admin, "#admin-email", takenEmail);
await act(admin, panelButton("Save changes"));
check(
  "an email another account uses is refused, keeping what was typed",
  /Another account already uses this email/.test(await panelText(admin)) &&
    (await admin.$eval("#admin-email", (i) => i.value)) === takenEmail,
);
const newEmail = `zed-${TAG}-moved@example.com`;
await retype(admin, "#admin-email", newEmail);
await act(admin, panelButton("Save changes"));
check("admins can change the email", sql(`select email from users where id = '${z1}'`) === newEmail);

await admin.click(`${panel} button[role=switch]`);
await act(admin, panelButton("Save changes"));
check(
  "switching off Email confirmed sends them back to confirm it",
  sql(`select email_verified from users where id = '${z1}'`) === "f" && /marked the email as unconfirmed/.test(await panelText(admin)),
);

await act(admin, panelButton("Give complimentary membership"));
check(
  "Give complimentary membership",
  sql(`select status from subscriptions where user_id = '${z1}' and id like 'comp\\_%'`) === "active" &&
    /Gave them a complimentary membership/.test(await panelText(admin)),
);
await act(admin, panelButton("End complimentary membership"));
check("…and end it", sql(`select status from subscriptions where user_id = '${z1}' and id like 'comp\\_%'`) === "canceled");

await admin.keyboard.press("Escape");
await urlIs(admin, (q) => !q.user);
await admin.waitForSelector(panel, { hidden: true, timeout: 3000 }).catch(() => {}); // the slide-out
check("closing the panel takes the account out of the address", !params(admin).user && params(admin).q === TAG && !(await admin.$(panel)));

// Roles
await admin.goto(`${BASE}/admin?user=${uma.id}`, { waitUntil: "networkidle0" });
await admin.waitForSelector("#admin-role");
await admin.select("#admin-role", "support");
const supportHint = await admin.$eval("#admin-role-hint", (n) => n.textContent);
await act(admin, panelButton("Save changes"));
check(
  "admins change roles, with what the role allows shown",
  sql(`select role from users where id = '${uma.id}'`) === "support" && /Can't change emails or roles/.test(supportHint),
  supportHint,
);
await usr.goto(`${BASE}/admin`, { waitUntil: "networkidle0" });
check("the new role works on their next page", !!(await usr.waitForSelector("[data-testid=users-table]", { timeout: 10_000 }).catch(() => null)));
await admin.select("#admin-role", "user");
await act(admin, panelButton("Save changes"));
check("…and back", sql(`select role from users where id = '${uma.id}'`) === "user" && /changed the role from Support to User/.test(await panelText(admin)));

await admin.goto(`${BASE}/admin?user=${ada.id}`, { waitUntil: "networkidle0" });
await admin.waitForSelector("#admin-role");
check(
  "admins can't change their own role (so there's always an admin)",
  (await admin.$eval("#admin-role", (s) => s.disabled)) && /can't change your own role/.test(await panelText(admin)),
);

// Signing out and reset emails
const umaSessions = () => Number(sql(`select count(*) from sessions where user_id = '${uma.id}'`));
const before = umaSessions();
await admin.goto(`${BASE}/admin?user=${uma.id}`, { waitUntil: "networkidle0" });
await admin.waitForSelector(button("Sign out everywhere"));
await act(admin, button("Sign out everywhere"));
await usr.goto(BASE, { waitUntil: "networkidle0" });
await usr.waitForFunction(() => location.pathname === "/login", { timeout: 5000 }).catch(() => {});
check(
  "Sign out everywhere ends every session",
  before >= 1 && umaSessions() === 0 && new URL(usr.url()).pathname === "/login" && /Signed them out of/.test(await panelText(admin)),
);
const sentAt = Date.now();
await act(admin, button("Email a password reset link"));
const reset = await waitForEmail(uma.email, /Reset your canvas password/, { after: sentAt - 1000 }).catch(() => null);
check(
  "Email a password reset link sends the same email as Forgot password",
  !!reset && /\/reset-password\//.test(reset.text) && /Sent a reset link/.test(await panelText(admin)),
);

// ================================================================= support
await sup.goto(`${BASE}/admin?q=${TAG}`, { waitUntil: "networkidle0" });
await sup.waitForSelector("[data-testid=users-table]");
check("support can open the dashboard and search", (await shown(sup)) === "Showing 1–10 of 85");
const z3 = zedId(3);
await sup.goto(`${BASE}/admin?user=${z3}`, { waitUntil: "networkidle0" });
await sup.waitForSelector("#admin-name");
check(
  "support can't change emails or roles: those fields are locked",
  (await sup.$eval("#admin-email", (i) => i.disabled)) && (await sup.$eval("#admin-role", (s) => s.disabled)),
);
await retype(sup, "#admin-name", `Zed ${TAG} Helped`);
await act(sup, panelButton("Save changes"));
check("but can fix a name", sql(`select name from users where id = '${z3}'`) === `Zed ${TAG} Helped`);

// Unlock the fields in the browser and try anyway: the server says no.
await sup.$eval("#admin-email", (i) => {
  i.disabled = false;
  i.value = "stolen@example.com";
});
await act(sup, panelButton("Save changes"));
const emailRefusal = await panelText(sup);
await sup.reload({ waitUntil: "networkidle0" });
await sup.waitForSelector("#admin-role");
await sup.$eval("#admin-role", (s) => {
  s.disabled = false;
  s.value = "admin";
});
await act(sup, panelButton("Save changes"));
check(
  "unlocking those fields in the browser doesn't help: the server refuses",
  /Only admins can change email addresses/.test(emailRefusal) &&
    /Only admins can change roles/.test(await panelText(sup)) &&
    sql(`select email || ' ' || role from users where id = '${z3}'`) === `zed-${TAG}-3@example.com user`,
);
await act(sup, panelButton("Give complimentary membership"));
check("support can give complimentary memberships", sql(`select count(*) from subscriptions where user_id = '${z3}' and status = 'active'`) === "1");

await sup.goto(`${BASE}/admin?user=${ada.id}`, { waitUntil: "networkidle0" });
await sup.waitForSelector("#admin-name");
check(
  "support can't edit staff accounts",
  /This is a staff account\. Only admins can edit it\./.test(await panelText(sup)) &&
    (await sup.$eval(panelButton("Save changes"), (b) => b.disabled)) &&
    (await sup.$eval(panelButton("Sign out everywhere"), (b) => b.disabled)),
);
// …even by sending the form for a staff account anyway
await sup.goto(`${BASE}/admin?user=${z3}`, { waitUntil: "networkidle0" });
await sup.waitForSelector("#admin-name");
await sup.$eval(`${panel} form[aria-label='Account details'] input[name=id]`, (i, id) => (i.value = id), ada.id);
await retype(sup, "#admin-name", "Hacked");
await act(sup, panelButton("Save changes"));
check(
  "…even by changing which account the form is for",
  /Only admins can edit staff accounts/.test(await panelText(sup)) && sql(`select name from users where id = '${ada.id}'`) === "Ada Admin",
);

// A role taken away mid-session takes effect on the next action.
await admin.goto(`${BASE}/admin?user=${z3}`, { waitUntil: "networkidle0" });
await admin.waitForSelector("#admin-name");
sql(`update users set role = 'user' where id = '${ada.id}'`);
await retype(admin, "#admin-name", "Too late");
await act(admin, panelButton("Save changes"));
check(
  "an admin whose role is removed can't save anything",
  /don't have access/.test(await panelText(admin)) && sql(`select name from users where id = '${z3}'`) === `Zed ${TAG} Helped`,
);
await admin.goto(`${BASE}/admin`, { waitUntil: "networkidle0" });
await admin.waitForSelector("h1");
check("…and gets the 404 page next time", /doesn.t exist/.test(await admin.$eval("h1", (h) => h.textContent)));
sql(`update users set role = 'admin' where id = '${ada.id}'`);

// ================================================================= wild pandas
sql(`delete from site_settings where key = 'wild_pandas'`);
const wildForm = "[data-testid=wild-rules-form]";
const wildButton = (label) => `xpath/.//form[@data-testid='wild-rules-form']//button[normalize-space()='${label}']`;
const wildText = () => admin.$eval(wildForm, (f) => f.innerText);
const wildSummary = () => admin.$eval("[data-testid=wild-summary]", (p) => p.textContent);
const wildShares = () => admin.$$eval("[data-testid=wild-share]", (s) => s.map((x) => x.textContent).join(", "));
const wildValue = (id) => admin.$eval(`#${id}`, (i) => i.value);
const storedWild = () => JSON.parse(sql(`select value from site_settings where key = 'wild_pandas'`) || "null");
await admin.goto(`${BASE}/admin`, { waitUntil: "networkidle0" });
await admin.waitForSelector(wildForm);
check(
  "admins get the wild pandas' rules, at the defaults",
  /Never changed: the defaults\./.test(await wildText()) &&
    (await wildValue("wild-chance")) === "60" &&
    (await wildValue("wild-rare-catchRate")) === "38" &&
    (await wildSummary()) === "With a drawing open, about one every 6½ minutes, staying 3 minutes.",
  await wildSummary(),
);
check("…with each kind's share at the top level", (await wildShares()) === "58 % of them, 28 % of them, 11 % of them, 3 % of them", await wildShares());
check("Save is off until something changes", await admin.$eval(wildButton("Save wild pandas"), (b) => b.disabled));
await retype(admin, "#wild-chance", "100");
await retype(admin, "#wild-gapMinutes", "2");
check("the summary follows what's typed", (await wildSummary()) === "With a drawing open, about one every 2 minutes, staying 3 minutes.", await wildSummary());
await retype(admin, "#wild-common-weight", "0");
check(
  "…and so do the shares, and who meets them",
  (await wildShares()) === "never, 67 % of them, 26 % of them, 7 % of them" && /for members from level 3\.$/.test(await wildSummary()),
  `${await wildShares()} | ${await wildSummary()}`,
);
await act(admin, wildButton("Save wild pandas"));
let wildSaved = storedWild();
check(
  "saving stores them for everyone",
  wildSaved?.chance === 1 &&
    wildSaved.gapMinutes === 2 &&
    wildSaved.kinds.common.weight === 0 &&
    wildSaved.kinds.rare.catchRate === 0.38 &&
    sql(`select updated_by from site_settings where key = 'wild_pandas'`) === ada.id,
  JSON.stringify(wildSaved),
);
check(
  "…and says what they add up to, and who changed them",
  /Saved\. With a drawing open, wild pandas now turn up about one every 2 minutes\./.test(await wildText()) &&
    /Last changed by Ada Admin/.test(await wildText()),
  await wildText(),
);
await retype(admin, "#wild-superRare-flee", "80");
await act(admin, wildButton("Save wild pandas"));
check(
  "a number out of range is refused, by name",
  /One number needs fixing\./.test(await wildText()) &&
    /From 0 to 50 %\./.test(await wildText()) &&
    (await admin.$eval("#wild-superRare-flee", (i) => i.getAttribute("aria-invalid"))) === "true" &&
    storedWild().kinds.superRare.flee === 0.1,
);
await retype(admin, "#wild-superRare-flee", "10");
for (const r of ["uncommon", "rare", "superRare"]) await retype(admin, `#wild-${r}-weight`, "0");
await act(admin, wildButton("Save wild pandas"));
check(
  "every kind set to never is refused",
  /Give at least one kind a chance to turn up/.test(await wildText()) && storedWild().kinds.uncommon.weight === 28,
);
await retype(admin, "#wild-uncommon-weight", "28");
await admin.click(`${wildForm} [role=switch]`);
await act(admin, wildButton("Save wild pandas"));
wildSaved = storedWild();
check(
  "switching them off for everyone",
  wildSaved.on === false && wildSaved.kinds.uncommon.weight === 28 && /No new wild pandas will turn up/.test(await wildText()),
  JSON.stringify(wildSaved),
);
await act(admin, wildButton("Reset to defaults"));
wildSaved = storedWild();
check(
  "Reset to defaults puts everything back",
  wildSaved.on === true &&
    wildSaved.chance === 0.6 &&
    wildSaved.gapMinutes === 4 &&
    wildSaved.kinds.common.weight === 58 &&
    (await wildValue("wild-chance")) === "60" &&
    (await wildValue("wild-common-weight")) === "58" &&
    /Back to the defaults\./.test(await wildText()),
  JSON.stringify(wildSaved),
);
await sup.goto(`${BASE}/admin`, { waitUntil: "networkidle0" });
check("support staff don't get them", !(await sup.$(wildForm)) && !!(await sup.$("[data-testid=users-table]")));
sql(`delete from site_settings where key = 'wild_pandas'`);

console.log("\nerrors:", errors.length ? errors : "none");
check("no page errors", errors.length === 0);
sql(`delete from users where email like 'zed-${TAG}-%'`);
await browser.close();
process.exit(failures ? 1 : 0);
