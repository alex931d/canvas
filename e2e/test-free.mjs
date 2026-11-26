// The free plan and the move into an account, end to end: a visitor draws
// with no account (saved in the browser, nothing sent to the server), the
// member features offer the membership instead, the browser's gallery, one
// tab editing at a time, then signing up and paying moves the browser's
// drawings into the account with their pictures. A member who still finds
// drawings in a browser moves them from the editor or the home page, and a
// membership that ends keeps the account's drawings.
// Needs the app, e2e/mock-stripe.mjs and e2e/mock-mail.mjs running.
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import puppeteer from "puppeteer-core";
import nextEnv from "@next/env";

nextEnv.loadEnvConfig(process.cwd());
const { BASE, sleep, sql, signUp, uniqueEmail, pickTool, chooseFile } = await import("./helpers.mjs");

const CHROME = process.env.CHROME_PATH ?? "/usr/bin/google-chrome";
const MOCK = process.env.MOCK_STRIPE_URL ?? "http://localhost:12111";

let failures = 0;
function check(label, cond, extra = "") {
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}${extra ? `  (${extra})` : ""}`);
  if (!cond) failures++;
}
async function waitFor(fn, timeout = 8000) {
  const t0 = Date.now();
  let value;
  while (Date.now() - t0 < timeout) {
    value = await fn().catch(() => null);
    if (value) return value;
    await sleep(150);
  }
  return value;
}

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
// What the free editor asks the server for: nothing about the drawing itself.
const drawingRequests = [];
page.on("request", (r) => {
  const p = new URL(r.url()).pathname;
  if (/^\/api\/(drawings|assets)\//.test(p)) drawingRequests.push(`${r.method()} ${p}`);
});

const path = (p = page) => new URL(p.url()).pathname;
const text = (p = page) => p.evaluate(() => document.body.innerText);
const items = (p = page) =>
  p.$eval("[data-testid=board]", (el) => Number(el.getAttribute("aria-label").match(/with (\d+) items/)[1])).catch(() => -1);
const saveState = (p = page) => p.$eval("[data-testid=storage-status]", (b) => b.dataset.state).catch(() => "");
const ready = (p = page) => p.waitForSelector("[data-testid=tool-dock]:not([aria-disabled=true])", { timeout: 15_000 });
const upgradeFeature = (p = page) =>
  p.$eval("[data-testid=upgrade-dialog]", (d) => d.dataset.feature).catch(() => null);
async function closeDialog(p = page) {
  await p.keyboard.press("Escape");
  await waitFor(async () => !(await p.$("[role=dialog]")), 3000);
}
async function stroke(p, dx = 0, dy = 0) {
  const b = await p.$eval("[data-testid=board]", (c) => {
    const r = c.getBoundingClientRect();
    return { x: r.x, y: r.y };
  });
  await pickTool(p, "Pen");
  await p.mouse.move(b.x + 220 + dx, b.y + 220 + dy);
  await p.mouse.down();
  for (let i = 1; i <= 12; i++) await p.mouse.move(b.x + 220 + dx + i * 12, b.y + 220 + dy + (i % 2) * 14, { steps: 2 });
  await p.mouse.up();
}
/** The browser's library (src/lib/local-store/library.ts), read straight from IndexedDB. */
const library = (p = page) =>
  p.evaluate(
    () =>
      new Promise((resolve) => {
        const req = indexedDB.open("canvas-browser");
        req.onsuccess = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains("drawings")) return resolve({ drawings: [], assets: [] });
          const tx = db.transaction(["drawings", "assets"]);
          const out = {};
          tx.objectStore("drawings").getAll().onsuccess = (e) => (out.drawings = e.target.result);
          tx.objectStore("assets").getAll().onsuccess = (e) =>
            (out.assets = e.target.result.map((a) => ({ id: a.id, drawingId: a.drawingId, type: a.mimeType })));
          tx.oncomplete = () => {
            db.close();
            resolve(out);
          };
        };
        req.onerror = () => resolve({ drawings: [], assets: [] });
      }),
  );

// A small PNG to put on the board.
const dir = mkdtempSync(join(tmpdir(), "canvas-free-"));
const pngFile = join(dir, "photo.png");
{
  const p = await ctx.newPage();
  await p.goto(`${BASE}/terms`, { waitUntil: "domcontentloaded" });
  const base64 = await p.evaluate(async () => {
    const c = document.createElement("canvas");
    c.width = 320;
    c.height = 200;
    const x = c.getContext("2d");
    x.fillStyle = "#f2cdac";
    x.fillRect(0, 0, 320, 200);
    x.fillStyle = "#201f24";
    x.font = "bold 40px sans-serif";
    x.fillText("x² + 1", 40, 110);
    return c.toDataURL("image/png").split(",")[1];
  });
  writeFileSync(pngFile, Buffer.from(base64, "base64"));
  await p.close();
}

// ------------------------------------------------------------ a visitor starts drawing, no account
await page.goto(`${BASE}/welcome`, { waitUntil: "networkidle0" });
check("the landing page offers to start drawing", !!(await page.$("main a[href='/local/new']")));
check("and the header opens this browser's drawings", !!(await page.$("header a[href='/local']")));
await page.click("main a[href='/local/new']");
await waitFor(async () => /^\/local\/[0-9a-f-]{36}$/.test(path()), 15_000);
const firstId = path().split("/").pop();
check("Start drawing opens a new drawing, without an account", /^[0-9a-f-]{36}$/.test(firstId), path());
await ready();
check("it says it's saved in this browser", /Saved in this browser/.test(await text()) || (await saveState()) === "saved");
check("with the guest menu instead of an account", !!(await page.$("button[aria-label=Account]")));

await stroke(page);
await waitFor(async () => (await items()) === 1);
check("drawing works", (await items()) === 1);
check("and the change is saved in the browser", !!(await waitFor(async () => (await saveState()) === "saved")));
await page.click("input[aria-label='Drawing title']", { count: 3 });
await page.type("input[aria-label='Drawing title']", "Free notes");
await page.keyboard.press("Enter");
await sleep(300);

// A picture, kept in the browser too.
const chooser = await chooseFile(page, () => pickTool(page, "Image or video"));
await chooser.accept([pngFile]);
await waitFor(async () => (await items()) === 2, 10_000);
check("a picture goes on the board", (await items()) === 2);
const lib1 = await waitFor(async () => {
  const l = await library();
  return l.assets.length === 1 && l.drawings[0]?.items === 2 ? l : null;
});
check(
  "the drawing, its title and its picture are in the browser's library",
  lib1?.drawings.length === 1 && lib1.drawings[0].title === "Free notes" && lib1.assets[0]?.drawingId === firstId,
  JSON.stringify(lib1?.drawings.map((d) => [d.title, d.items])),
);

await page.reload({ waitUntil: "load" });
await ready();
await waitFor(async () => (await items()) === 2);
check("reloading brings it all back from the browser", (await items()) === 2);
check(
  "title included",
  (await page.$eval("input[aria-label='Drawing title']", (i) => i.value)) === "Free notes",
);
check(
  "nothing about the drawing went to the server",
  drawingRequests.length === 0,
  drawingRequests.slice(0, 3).join(", "),
);
check("no server copy exists", sql(`select count(*) from drawings where id = '${firstId}'`) === "0");

// ------------------------------------------------------------ member features offer the membership
await page.click("button[aria-label='Check math']");
await waitFor(upgradeFeature);
check("Check math offers the membership", (await upgradeFeature()) === "math-check");
check(
  "with a way to the pricing page",
  !!(await page.$("[data-testid=upgrade-dialog] a[href='/pricing']")) && /\$5/.test(await text()),
);
check("and no lasso starts", !(await page.$("[data-tool=Lasso][aria-pressed=true]")));
await closeDialog();
await page.click("button[aria-label=Chemistry]");
await waitFor(upgradeFeature);
check("the chemistry tools offer it too", (await upgradeFeature()) === "chemistry");
check("and the chemistry panel stays shut", !(await page.$("[data-testid=molar-mass]")));
await closeDialog();
await page.click("button[aria-label=Share]");
await waitFor(upgradeFeature);
check("so does Share", (await upgradeFeature()) === "sharing");
await closeDialog();
// Through the tool search.
await page.keyboard.press("/");
await page.waitForSelector("[data-testid=tool-search] input", { timeout: 5000 });
await page.type("[data-testid=tool-search] input", "chemistry");
await sleep(200);
check("the tool search marks member features", /Part of the membership/.test(await page.$eval("[data-testid=tool-search]", (d) => d.innerText)));
await page.keyboard.press("Enter");
await waitFor(upgradeFeature);
check("and choosing one offers the membership", (await upgradeFeature()) === "chemistry");
await closeDialog();
// The selection's own Check math button.
await pickTool(page, "Select");
await page.keyboard.down("Control");
await page.keyboard.press("a");
await page.keyboard.up("Control");
const toolbarCheck = await page.waitForSelector("[role=toolbar][aria-label=Selection] button[data-locked]", { timeout: 5000 }).catch(() => null);
check("the selection's Check math shows it's for members", !!toolbarCheck);
await toolbarCheck?.click();
await waitFor(upgradeFeature);
check("and offers the membership", (await upgradeFeature()) === "math-check");
await closeDialog();
await page.keyboard.press("Escape");
const apiStatus = (url, body = "{}") =>
  page.evaluate(
    (url, body) => fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body }).then((r) => r.status),
    url,
    body,
  );
check("the math check API needs an account", (await apiStatus("/api/check-math")) === 401);
check("so does moving a drawing into an account", (await apiStatus("/api/drawings/import")) === 401);

// ------------------------------------------------------------ one tab edits at a time
const second = await ctx.newPage();
await second.setViewport({ width: 1280, height: 860 });
await second.goto(`${BASE}/local/${firstId}`, { waitUntil: "load" });
await waitFor(async () => /open in another tab/i.test(await text(second)), 10_000);
check("a second tab opens it to look at, not to edit", /open in another tab/i.test(await text(second)));
check("and shows the drawing", (await items(second)) === 2);
check("with only the tools for looking", !(await second.$("[data-tool=Pen]")) && !!(await second.$("[data-tool=Select]")));
// Once the first tab leaves the drawing, the second one takes over.
await page.goto(`${BASE}/local`, { waitUntil: "networkidle0" });
await second.bringToFront();
const tookOver = await waitFor(async () => (await saveState(second)) === "saved" && !!(await second.$("[data-tool=Pen]")), 10_000);
check("and takes over once the first tab leaves", !!tookOver && !/open in another tab/i.test(await text(second)));
await stroke(second, 0, 120);
await waitFor(async () => (await items(second)) === 3 && (await saveState(second)) === "saved");
check("drawing there saves as usual", (await items(second)) === 3);
await second.keyboard.down("Control");
await second.keyboard.press("z");
await second.keyboard.up("Control");
await waitFor(async () => (await items(second)) === 2 && (await saveState(second)) === "saved");
await second.close();
await page.bringToFront();

// ------------------------------------------------------------ the browser's gallery
await page.goto(`${BASE}/local`, { waitUntil: "networkidle0" });
await page.waitForSelector("[data-testid=browser-drawings]", { timeout: 10_000 });
check("/local lists the drawings in this browser", /Free notes/.test(await text()));
check("linking to the browser editor", !!(await page.$(`a[href='/local/${firstId}']`)));
await page.click("xpath/.//main//button[contains(normalize-space(), 'New')]");
await waitFor(async () => /^\/local\/[0-9a-f-]{36}$/.test(path()), 10_000);
const secondId = path().split("/").pop();
check("New Drawing makes another one", secondId !== firstId && /^[0-9a-f-]{36}$/.test(secondId));
await ready();
await page.goto(`${BASE}/local`, { waitUntil: "networkidle0" });
await page.waitForSelector("[data-testid=browser-drawings]", { timeout: 10_000 });
await page.click(`xpath/.//li[.//a[@href='/local/${secondId}']]//button[starts-with(@aria-label, 'More actions')]`);
await page.click("xpath/.//*[@role='menuitem'][contains(., 'Delete drawing')]");
await page.click("xpath/.//*[@role='alertdialog']//button[normalize-space()='Yes, delete']");
await waitFor(async () => !(await page.$(`a[href='/local/${secondId}']`)));
check("and deleting one removes it from the browser", (await library()).drawings.length === 1);
await page.goto(`${BASE}/local/${secondId}`, { waitUntil: "networkidle0" });
await page.waitForSelector("[data-testid=not-in-browser]", { timeout: 10_000 });
check("a drawing that isn't here says so", /isn.t in this browser/.test(await text()));

// ------------------------------------------------------------ the pricing page shows both plans
await page.goto(`${BASE}/pricing`, { waitUntil: "networkidle0" });
check(
  "pricing shows the free plan, with Start drawing",
  !!(await page.$("[data-testid=plan-free] a[href='/local/new']")) && /no account needed/i.test(await text()),
);
check("and the membership, with Create account", !!(await page.$("[data-testid=plan-member] a[href='/signup']")));

// ------------------------------------------------------------ signing up keeps the free plan until paying
const me = await signUp(page, { name: "Fern Free", email: uniqueEmail("fern"), member: false });
await page.goto(BASE, { waitUntil: "networkidle0" });
await page.waitForSelector("[data-testid=free-plan]", { timeout: 10_000 });
check("a signed-in non-member's home is the free plan", path() === "/" && /You're on the free plan/.test(await text()));
await page.waitForSelector("[data-testid=browser-drawings]", { timeout: 10_000 });
check("with this browser's drawings", /Free notes/.test(await text()));
await page.click("main header form button[type=submit]");
await waitFor(async () => /^\/local\/[0-9a-f-]{36}$/.test(path()), 15_000);
const theirsId = path().split("/").pop();
check("their New Drawing makes one in the browser", /^[0-9a-f-]{36}$/.test(theirsId) && theirsId !== firstId, path());
await ready();
check("not on the server", sql(`select count(*) from drawings where id = '${theirsId}'`) === "0");
await page.goto(`${BASE}/local/${firstId}`, { waitUntil: "load" });
await ready();
check("their editor shows their account menu", !!(await page.$("button[aria-label^='Account: Fern']")));
await page.click("button[aria-label='Check math']");
await waitFor(upgradeFeature);
check("and member features still offer the membership", (await upgradeFeature()) === "math-check");
await closeDialog();

// ------------------------------------------------------------ without a membership, settings stay in the browser
const local = (key) => page.evaluate((k) => localStorage.getItem(k), key);
await page.goto(`${BASE}/settings`, { waitUntil: "networkidle0" });
await page.waitForSelector("[data-testid=avatar-input]", { timeout: 10_000 });
await (await page.$("[data-testid=avatar-input]")).uploadFile(pngFile);
const kept = await waitFor(async () => /^data:image\//.test((await local(`canvas-avatar:${me.id}`)) ?? ""), 10_000);
check("a non-member's profile picture is kept in the browser", !!kept);
check("and nothing is stored on the server", sql(`select count(*) from user_avatars where user_id = '${me.id}'`) === "0");
const menuPicture = () =>
  page.$eval("button[aria-label^='Account: Fern'] img", (img) => img.getAttribute("src")).catch(() => "");
check("the account menu shows it", /^data:image\//.test(await menuPicture()));
check("the page says where it's kept", /kept in this browser/.test(await text()));
await page.click("label:has(input[name=drawEffect][value=trace])");
await waitFor(async () => /Saved in this browser/.test(await page.$eval("[data-testid=prefs-status]", (n) => n.textContent)));
check(
  "effect choices are saved in the browser",
  JSON.parse((await local("canvas-preferences")) ?? "{}").drawEffect === "trace",
);
check("not on the server", sql(`select count(*) from user_preferences where user_id = '${me.id}'`) === "0");
await page.reload({ waitUntil: "networkidle0" });
await waitFor(async () => page.$eval("input[name=drawEffect][value=trace]", (i) => i.checked));
check("and still chosen after a reload", await page.$eval("input[name=drawEffect][value=trace]", (i) => i.checked));

// ------------------------------------------------------------ paying moves the browser's drawings
await page.goto(`${BASE}/pricing`, { waitUntil: "networkidle0" });
await page.waitForSelector("xpath/.//button[normalize-space()='Start membership']", { timeout: 10_000 });
await Promise.all([page.waitForNavigation({ waitUntil: "networkidle0" }), page.click("xpath/.//button[normalize-space()='Start membership']")]);
await Promise.all([page.waitForNavigation({ waitUntil: "load" }), page.click("#pay")]);
await page.waitForSelector("h1", { timeout: 10_000 });
check("paying lands on the welcome", /You're a member/.test(await page.$eval("h1", (h) => h.textContent)));
const moved = await waitFor(async () => /Moved 2 drawings/.test(await text()), 20_000);
check("the browser's drawings move into the account by themselves", !!moved, (await text()).slice(0, 300));
const row = sql(
  `select user_id || '|' || title || '|' || jsonb_array_length(data->'elements') from drawings where id = '${firstId}'`,
).split("|");
check(
  "the account has it, same id, title and contents",
  row[0] === me.id && row[1] === "Free notes" && row[2] === "2",
  row.join(" "),
);
check(
  "with its picture",
  sql(`select count(*) from assets where drawing_id = '${firstId}' and mime_type = 'image/png'`) === "1",
);
check("and the browser's copy is gone", (await library()).drawings.length === 0 && (await library()).assets.length === 0);
check("the other one moved too", sql(`select user_id from drawings where id = '${theirsId}'`) === me.id);
await waitFor(async () => sql(`select count(*) from user_avatars where user_id = '${me.id}'`) === "1", 10_000);
check("so does the profile picture", sql(`select count(*) from user_avatars where user_id = '${me.id}'`) === "1");
check(
  "and the effect choices",
  JSON.parse(sql(`select preferences from user_preferences where user_id = '${me.id}'`) || "{}").drawEffect === "trace",
);
check(
  "leaving the browser's copies behind",
  !(await local(`canvas-avatar:${me.id}`)) && !(await local("canvas-preferences")),
);

await page.goto(BASE, { waitUntil: "networkidle0" });
check("the member's gallery lists it", !!(await page.$(`main a[href='/drawings/${firstId}']`)));
await page.goto(`${BASE}/drawings/${firstId}`, { waitUntil: "load" });
await ready();
await waitFor(async () => (await items()) === 2);
check("and it opens from the account", (await items()) === 2);
const assetId = sql(`select id from assets where drawing_id = '${firstId}'`);
check(
  "its picture comes from the server now",
  (await page.evaluate((id) => fetch(`/api/assets/${id}`).then((r) => r.status), assetId)) === 200,
);
await page.goto(`${BASE}/local/${firstId}`, { waitUntil: "networkidle0" });
await page.waitForSelector("[data-testid=not-in-browser]", { timeout: 10_000 });
check(
  "the old browser address points members to their account",
  !!(await page.$(`[data-testid=not-in-browser] a[href='/drawings/${firstId}']`)),
);

// ------------------------------------------------------------ a member moving one from the editor
await page.goto(`${BASE}/local/new`, { waitUntil: "load" });
await waitFor(async () => /^\/local\/[0-9a-f-]{36}$/.test(path()), 10_000);
const thirdId = path().split("/").pop();
await ready();
await stroke(page);
await waitFor(async () => (await saveState()) === "saved" && (await items()) === 1);
await page.click("button[aria-label=Share]");
await page.waitForSelector("xpath/.//*[@role='alertdialog']//button[normalize-space()='Move it']", { timeout: 5000 });
check("Share on a browser drawing offers members the move", /Move this drawing to your account/.test(await text()));
await page.click("xpath/.//*[@role='alertdialog']//button[normalize-space()='Move it']");
await waitFor(async () => path() === `/drawings/${thirdId}`, 15_000);
check("Move it moves it and opens it from the account", path() === `/drawings/${thirdId}`, path());
check("where it's stored", sql(`select user_id from drawings where id = '${thirdId}'`) === me.id);

// ------------------------------------------------------------ and from the home page
await page.goto(`${BASE}/local/new`, { waitUntil: "load" });
await waitFor(async () => /^\/local\/[0-9a-f-]{36}$/.test(path()), 10_000);
const fourthId = path().split("/").pop();
await ready();
await stroke(page);
await waitFor(async () => (await saveState()) === "saved" && (await items()) === 1);
await page.goto(BASE, { waitUntil: "networkidle0" });
const notice = await page.waitForSelector("[data-testid=move-notice]", { timeout: 10_000 }).catch(() => null);
check("a member's home offers to move drawings left in the browser", !!notice && /saved only in this browser/.test(await text()));
await page.click("xpath/.//*[@data-testid='move-notice']//button");
await waitFor(async () => sql(`select count(*) from drawings where id = '${fourthId}'`) === "1", 15_000);
check("one click moves it", sql(`select user_id from drawings where id = '${fourthId}'`) === me.id);
await waitFor(async () => !!(await page.$(`main a[href='/drawings/${fourthId}']`)), 10_000);
check("and the gallery shows it", !!(await page.$(`main a[href='/drawings/${fourthId}']`)));

// ------------------------------------------------------------ moving is safe to retry, and only for your own ids
const again = await page.evaluate(async (id) => {
  const res = await fetch("/api/drawings/import", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id, title: "Again", data: { version: 2, background: "#ffffff", elements: [] } }),
  });
  return { status: res.status, body: await res.json() };
}, firstId);
check(
  "importing a drawing that's already yours leaves it as it is",
  again.status === 200 && again.body.existed === true && sql(`select title from drawings where id = '${firstId}'`) === "Free notes",
  JSON.stringify(again),
);

// ------------------------------------------------------------ when the membership ends
// The test server sweeps every couple of seconds (STORAGE_SWEEP_SECONDS); in production it's hourly.
const { waitForEmail } = await import("./helpers.mjs");
const schedule = () => sql(`select coalesce(round(extract(epoch from delete_after - now()) / 86400), -1) from storage_deletions where user_id = '${me.id}'`);
const endedAt = Date.now();
sql(`update subscriptions set status = 'canceled', ended_at = now() where user_id = '${me.id}'`);
await page.goto(BASE, { waitUntil: "networkidle0" });
await page.waitForSelector("[data-testid=free-plan]", { timeout: 10_000 });
check(
  "after it ends, home says when the account's drawings will be deleted",
  /Your membership has ended/.test(await text()) &&
    /4 drawings in your account will be deleted on/.test(await text()) &&
    !!(await page.$("[data-testid=delete-on] time")),
  (await text()).slice(0, 400),
);
check("in 30 days", schedule() === "30", schedule());
check("and offers to renew", !!(await page.$("[data-testid=free-plan] a[href='/pricing']")));
const ended = await waitForEmail(me.email, /membership has ended/, { after: endedAt, timeout: 15_000 }).catch(() => null);
check(
  "an email says so, with the date and both ways to keep them",
  !!ended && /4 drawings/.test(ended.subject) && /Renew/.test(ended.text) && /move them into your browser/.test(ended.text),
  ended?.subject,
);
check("the account's drawings are listed to move", (await page.$$("[data-testid=kept-drawings] li")).length === 4);

// Moving one into the browser frees its server copy.
await page.click(`[data-testid=kept-drawings] li[data-drawing='${firstId}'] button`);
await waitFor(async () => sql(`select count(*) from drawings where id = '${firstId}'`) === "0", 15_000);
check("Move here takes a drawing into this browser", sql(`select count(*) from drawings where id = '${firstId}'`) === "0");
const back = await waitFor(async () => {
  const l = await library();
  return l.drawings.some((d) => d.id === firstId) && l.assets.some((a) => a.drawingId === firstId) ? l : null;
});
check("with its title and its picture", back?.drawings.find((d) => d.id === firstId)?.title === "Free notes" && !!back);
check("its files are gone from the server too", sql(`select count(*) from assets where drawing_id = '${firstId}'`) === "0");
await page.goto(`${BASE}/local/${firstId}`, { waitUntil: "load" });
await ready();
await waitFor(async () => (await items()) === 2);
check("and it opens from the browser, all there", (await items()) === 2);

// Renewing clears the date; ending again sets a new one.
sql(`insert into subscriptions (id, user_id, status) values ('comp_' || gen_random_uuid(), '${me.id}', 'active')`);
await waitFor(async () => schedule() === "", 10_000);
check("renewing clears the date", schedule() === "");
sql(`update subscriptions set status = 'canceled' where user_id = '${me.id}' and status = 'active'`);
await waitFor(async () => schedule() === "30", 10_000);
check("ending again starts a new 30 days", schedule() === "30", schedule());

// A week before, a reminder.
const remindFrom = Date.now();
sql(`update storage_deletions set delete_after = now() + interval '6 days', reminded_at = null where user_id = '${me.id}'`);
const reminder = await waitForEmail(me.email, /^Your 3 drawings on canvas will be deleted on/, { after: remindFrom, timeout: 15_000 }).catch(() => null);
check("a week before, a reminder", !!reminder && /Renew to keep everything/.test(reminder.text), reminder?.subject);

// The day comes: all of it goes.
await page.goto(BASE, { waitUntil: "networkidle0" });
sql(`update storage_deletions set delete_after = now() - interval '1 minute' where user_id = '${me.id}'`);
const deleted = await waitFor(async () => sql(`select count(*) from drawings where user_id = '${me.id}'`) === "0", 15_000);
check("on the day, the account's drawings are deleted", !!deleted);
check(
  "and its picture, settings and the schedule",
  sql(`select count(*) from user_avatars where user_id = '${me.id}'`) === "0" &&
    sql(`select count(*) from user_preferences where user_id = '${me.id}'`) === "0" &&
    sql(`select avatar_updated_at is null from users where id = '${me.id}'`) === "t" &&
    schedule() === "",
);
check("the account itself stays", sql(`select count(*) from users where id = '${me.id}'`) === "1");
check("the drawing in this browser is untouched", (await library()).drawings.some((d) => d.id === firstId));
await page.goto(BASE, { waitUntil: "networkidle0" });
await page.waitForSelector("[data-testid=free-plan]", { timeout: 10_000 });
check("home is the free plan again", !(await page.$("[data-testid=delete-on]")) && !(await page.$("[data-testid=kept-drawings]")));

check("no page errors", problems.length === 0, problems.slice(0, 3).join(" | "));
await browser.close();
console.log(failures ? `\n${failures} failed` : "\nall passed");
process.exit(failures ? 1 : 0);
