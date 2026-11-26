// Seasonal themes: the calendar (with the browser's date moved to each
// season), the admin's setting, the decorations on the landing page and in
// the menu, hiding them, and reduced motion.
// Run against `npm run build && npm start` (see README, Tests); uses DATABASE_URL.
import puppeteer from "puppeteer-core";
import { spawnSync } from "node:child_process";
import nextEnv from "@next/env";

nextEnv.loadEnvConfig(process.cwd());
const { BASE, sleep, sql, signUp, uniqueEmail } = await import("./helpers.mjs");

const CHROME = process.env.CHROME_PATH ?? "/usr/bin/google-chrome";
let failures = 0;
function check(label, cond, extra = "") {
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}${extra ? `  (${extra})` : ""}`);
  if (!cond) failures++;
}

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ["--no-sandbox"],
  defaultViewport: { width: 1440, height: 900 },
});
const errors = [];

/** A fresh browser whose clock reads `date` (local time), if given. */
async function visitor(date) {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  if (date) {
    await page.evaluateOnNewDocument((iso) => {
      const offset = new Date(iso).getTime() - Date.now();
      const Real = Date;
      class Shifted extends Real {
        constructor(...args) {
          super(...(args.length ? args : [Real.now() + offset]));
        }
        static now() {
          return Real.now() + offset;
        }
      }
      window.Date = Shifted;
    }, date);
  }
  return page;
}

/** What seasonal things are on the page once it has settled. */
async function decor(page) {
  await sleep(800);
  return page.evaluate(() => ({
    decor: [...document.querySelectorAll("[data-season-decor]")].map((e) => e.dataset.seasonDecor),
    effects: document.querySelector("[data-season-effects]")?.dataset.seasonEffects ?? null,
    snow: Number(document.querySelector("[data-season-effects] canvas[data-particles-kind=snow]")?.dataset.particles ?? 0),
    petals: Number(document.querySelector("[data-season-effects] canvas[data-particles-kind=petals]")?.dataset.particles ?? 0),
    bats: document.querySelectorAll("[data-season-effects] .season-bat").length,
    toggle: [...document.querySelectorAll("button")].find((b) => /decorations$/.test(b.textContent))?.textContent ?? null,
  }));
}

// An admin to change the setting.
const adminPage = await visitor();
const ada = await signUp(adminPage, { name: "Ada Seasons", email: uniqueEmail("seasons") });
spawnSync("node", ["scripts/role.mjs", "set", ada.email, "admin"]);
async function setMode(mode) {
  await adminPage.goto(`${BASE}/admin`, { waitUntil: "networkidle0" });
  await adminPage.waitForSelector("#season-title");
  await adminPage.$eval(`input[name=mode][value=${mode}]`, (i) => i.click());
  const button = "xpath/.//button[normalize-space()='Save theme']";
  if (await adminPage.$eval(button, (b) => b.disabled)) return ""; // already set
  await adminPage.click(button);
  await adminPage.waitForFunction(() => /^Saved\./.test(document.querySelector("[role=status]")?.textContent ?? ""), { timeout: 10_000 });
  await adminPage.waitForNetworkIdle({ idleTime: 300 }); // the page fetches the new mode for itself
  return adminPage.$eval("[role=status]", (n) => n.textContent);
}

try {
  // ================================================================= the calendar
  await setMode("auto");
  const seasons = [
    ["2026-12-10T12:00", "christmas"],
    ["2026-10-20T12:00", "halloween"],
    ["2027-03-25T12:00", "easter"], // Easter 2027 is March 28
    ["2026-07-01T12:00", null],
  ];
  for (const [date, want] of seasons) {
    const page = await visitor(date);
    await page.goto(BASE, { waitUntil: "networkidle0" });
    const d = await decor(page);
    const ok = want
      ? d.decor.length === 2 && d.decor.every((t) => t === want) && d.effects === want && !!d.toggle
      : d.decor.length === 0 && d.effects === null && d.toggle === null;
    check(`automatic on ${date.slice(0, 10)}: ${want ?? "no theme"}`, ok, JSON.stringify(d));
    if (want === "christmas") check("Christmas snows on the landing page", d.snow > 20, `${d.snow} flakes`);
    if (want === "halloween") check("Halloween has bats flying", d.bats === 3);
    if (want === "easter") check("Easter has spring petals", d.petals > 5, `${d.petals} petals`);
    await page.browserContext().close();
  }
  const head = await fetch(BASE);
  check(
    "the landing page is still prerendered (the theme is worked out in the browser)",
    /^1\b/.test(head.headers.get("x-nextjs-prerender") ?? ""),
    head.headers.get("x-nextjs-prerender") ?? "",
  );

  // ================================================================= the admin's setting
  const saved = await setMode("christmas");
  check("admins can show a theme now", /Everyone sees the Christmas theme now/.test(saved), saved);
  check(
    "the setting is stored, with who changed it",
    sql(`select value #>> '{}' from site_settings where key = 'seasonal_theme'`) === "christmas" &&
      sql(`select updated_by from site_settings where key = 'seasonal_theme'`) === ada.id &&
      /Last changed by Ada Seasons/.test(await adminPage.evaluate(() => document.body.innerText)),
  );
  const july = await visitor("2026-07-01T12:00");
  await july.goto(BASE, { waitUntil: "networkidle0" });
  const forced = await decor(july);
  check(
    "a chosen theme shows whatever the date, on the prerendered landing page",
    forced.effects === "christmas" && forced.decor.length === 2 && forced.snow > 0,
    JSON.stringify(forced),
  );
  const candyCanes = await july.$$eval("[data-season-decor] svg", (svgs) => svgs.length);
  check("with candy canes in the header and on the board", candyCanes >= 4, `${candyCanes} pieces`);
  await july.goto(`${BASE}/pricing`, { waitUntil: "networkidle0" });
  check("and on the pricing page", (await decor(july)).effects === "christmas");

  // Hiding them
  await july.goto(BASE, { waitUntil: "networkidle0" });
  await sleep(500);
  await july.click("xpath/.//button[normalize-space()='Hide Christmas decorations']");
  const hidden = await decor(july);
  await july.reload({ waitUntil: "networkidle0" });
  const afterReload = await decor(july);
  check(
    "Hide Christmas decorations removes them, and it's remembered",
    hidden.decor.length === 0 && hidden.effects === null && afterReload.decor.length === 0 && afterReload.toggle === "Show Christmas decorations",
    JSON.stringify(afterReload),
  );
  await july.click("xpath/.//button[normalize-space()='Show Christmas decorations']");
  check("Show brings them back", (await decor(july)).effects === "christmas");

  // Reduced motion: decorations stay, nothing falls or flies.
  const calm = await visitor();
  await calm.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "reduce" }]);
  await calm.goto(BASE, { waitUntil: "networkidle0" });
  const still = await decor(calm);
  check("with reduced motion the candy canes stay but nothing falls", still.decor.length === 2 && still.effects === null && still.snow === 0, JSON.stringify(still));
  await calm.browserContext().close();

  // ================================================================= the menu
  await adminPage.goto(BASE, { waitUntil: "networkidle0" });
  await adminPage.waitForSelector("aside[data-season=christmas] [data-season-decor]", { timeout: 10_000 }).catch(() => {});
  const menu = await adminPage.evaluate(() => {
    // Next.js keeps recently visited pages in the document, hidden: look at the one on screen.
    const aside = [...document.querySelectorAll("aside")].find((a) => a.checkVisibility());
    const active = aside?.querySelector("a[aria-current=page]");
    return {
      season: aside?.dataset.season ?? null,
      art: aside?.querySelectorAll("[data-season-decor] svg").length ?? 0,
      snow: Number(aside?.querySelector("canvas[data-particles-kind=snow]")?.dataset.particles ?? 0),
      edge: active ? getComputedStyle(active).borderImageSource : "",
    };
  });
  check(
    "the menu gets snow, candy canes and a candy-striped tab",
    menu.season === "christmas" && menu.art >= 1 && menu.snow > 0 && /repeating-linear-gradient/.test(menu.edge),
    JSON.stringify({ ...menu, edge: menu.edge.slice(0, 40) }),
  );

  // The editor: decorations but nothing moving next to the drawing.
  await adminPage.click("main form button[type=submit]");
  await adminPage.waitForSelector("[data-testid=board]", { timeout: 15_000 });
  await sleep(800);
  const editorMenu = await adminPage.evaluate(() => ({
    menu: [...document.querySelectorAll("aside")].some((a) => a.checkVisibility()),
    moving: [...document.querySelectorAll("canvas[data-particles-kind], .season-bat")].filter((n) => n.checkVisibility()).length,
  }));
  check("the editor has no menu, so nothing seasonal falls next to the drawing", !editorMenu.menu && editorMenu.moving === 0, JSON.stringify(editorMenu));

  // Hiding them from the account menu.
  await adminPage.goto(BASE, { waitUntil: "networkidle0" });
  await adminPage.click("aside [data-ui=menu-trigger]");
  await adminPage.waitForSelector("[role=menuitem]");
  await adminPage.click("xpath/.//*[@role='menuitem'][contains(., 'Hide Christmas decorations')]");
  await sleep(500);
  const menuHidden = await adminPage.evaluate(() => ({
    season: [...document.querySelectorAll("aside")].find((a) => a.checkVisibility())?.dataset.season ?? null,
    decor: [...document.querySelectorAll("[data-season-decor]")].filter((e) => e.checkVisibility()).length,
  }));
  check("the account menu hides them for this browser", menuHidden.season === null && menuHidden.decor === 0, JSON.stringify(menuHidden));
  await adminPage.click("aside [data-ui=menu-trigger]");
  await adminPage.waitForSelector("[role=menuitem]");
  await adminPage.click("xpath/.//*[@role='menuitem'][contains(., 'Show Christmas decorations')]");
  await sleep(500);
  check(
    "…and shows them again",
    (await adminPage.evaluate(() => [...document.querySelectorAll("aside")].find((a) => a.checkVisibility())?.dataset.season ?? null)) ===
      "christmas",
  );

  // Halloween and Easter in the menu
  for (const [mode, want] of [
    ["halloween", "bats"],
    ["easter", "petals"],
  ]) {
    await setMode(mode);
    await adminPage.goto(BASE, { waitUntil: "networkidle0" });
    await sleep(800);
    const m = await adminPage.evaluate(() => {
      const aside = [...document.querySelectorAll("aside")].find((a) => a.checkVisibility());
      return {
        season: aside?.dataset.season ?? null,
        bats: aside?.querySelectorAll(".season-bat").length ?? 0,
        petals: Number(aside?.querySelector("canvas[data-particles-kind=petals]")?.dataset.particles ?? 0),
      };
    });
    check(`${mode} in the menu, with ${want}`, m.season === mode && (want === "bats" ? m.bats === 2 : m.petals > 0), JSON.stringify(m));
  }

  // Off
  await setMode("off");
  const december = await visitor("2026-12-10T12:00");
  await december.goto(BASE, { waitUntil: "networkidle0" });
  const off = await decor(december);
  check("Off shows nothing, even in December", off.decor.length === 0 && off.effects === null && off.toggle === null, JSON.stringify(off));

  // Only admins
  const support = await visitor();
  const sam = await signUp(support, { name: "Sam Seasons", email: uniqueEmail("seasons-support") });
  spawnSync("node", ["scripts/role.mjs", "set", sam.email, "support"]);
  await support.goto(`${BASE}/admin`, { waitUntil: "networkidle0" });
  await support.waitForSelector("[data-testid=users-table]");
  check("support staff don't get the setting", !(await support.$("#season-title")));
  await adminPage.goto(`${BASE}/admin`, { waitUntil: "networkidle0" });
  await adminPage.waitForSelector("#season-title");
  sql(`update users set role = 'support' where id = '${ada.id}'`);
  await adminPage.$eval("input[name=mode][value=christmas]", (i) => i.click());
  await adminPage.click("xpath/.//button[normalize-space()='Save theme']");
  await adminPage.waitForSelector("[role=alert]", { timeout: 10_000 }).catch(() => {});
  check(
    "and the server refuses it from anyone who isn't an admin",
    /don't have access/.test(await adminPage.$eval("[role=alert]", (n) => n.textContent).catch(() => "")) &&
      sql(`select value #>> '{}' from site_settings where key = 'seasonal_theme'`) === "off",
  );
  sql(`update users set role = 'admin' where id = '${ada.id}'`);
} finally {
  await setMode("auto").catch((err) => console.error("couldn't put the theme back to automatic:", err.message));
}

console.log("\nerrors:", errors.length ? errors : "none");
check("no page errors", errors.length === 0);
await browser.close();
process.exit(failures ? 1 : 0);
