// The tool dock and the tool search: every tool reachable without
// scrolling, groups that remember the last tool and open on a second
// press or their arrow, keys keeping the dock in step, the search finding
// tools by name or by other words (/ and ⌘K, arrows, Enter), commands in
// it, view-only members' three tools, and a phone, where the dock fits and
// a second tap opens a group.
// Run against `npm run build && npm start` (see README, Tests); uses DATABASE_URL.
import puppeteer from "puppeteer-core";
import nextEnv from "@next/env";

nextEnv.loadEnvConfig(process.cwd());
const { sleep, sql, signUp, BASE } = await import("./helpers.mjs");

const CHROME = process.env.CHROME_PATH ?? "/usr/bin/google-chrome";
let failures = 0;
function check(label, cond, extra = "") {
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}${extra ? `  (${extra})` : ""}`);
  if (!cond) failures++;
}
async function waitFor(fn, timeout = 5000) {
  const t0 = Date.now();
  let value;
  while (Date.now() - t0 < timeout) {
    value = await fn().catch(() => null);
    if (value) return value;
    await sleep(100);
  }
  return value;
}

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--no-sandbox"] });
const errors = [];
const DOCK = "[data-testid=tool-dock]";
const active = (p) => p.$eval(`${DOCK} button[aria-pressed=true]`, (b) => b.getAttribute("aria-label")).catch(() => null);
const menuItems = (p) => p.$$eval("[data-ui=menu] [role=menuitem]", (ms) => ms.map((m) => m.innerText.split("\n")[0].trim()));
const searchOpen = (p) => p.$("[data-testid=tool-search]");
const options = (p) => p.$$eval("[data-testid=tool-search-option]", (os) => os.map((o) => o.querySelector("span span").textContent));

const page = await (await browser.createBrowserContext()).newPage();
await page.setViewport({ width: 1280, height: 720 });
page.on("pageerror", (e) => errors.push(e.message));
await signUp(page, { name: "Dock Test" });
await Promise.all([page.waitForNavigation({ waitUntil: "load" }), page.click("main form button[type=submit]")]);
await page.waitForFunction(() => /^\/drawings\/[0-9a-f-]{36}$/.test(location.pathname), { timeout: 15_000 });
const id = page.url().split("/drawings/")[1];
await page.waitForSelector(DOCK);
await sleep(800);

// ------------------------------------------------------------ the dock
// (The gallery's sidebar stays in the page, hidden, for going back.)
check(
  "the editor has no long tool menu any more",
  !(await page.evaluate(() => [...document.querySelectorAll("aside")].some((a) => a.checkVisibility()))),
);
const slots = await page.$$eval(`${DOCK} [data-items]`, (s) => s.map((n) => n.dataset.items));
check("six slots hold every tool", slots.length === 6 && slots.join(",").split(",").length === 16, slots.join(" | "));
check("the pen is on to start with", (await active(page)) === "Pen");
const box = await page.$eval(DOCK, (d) => {
  const r = d.getBoundingClientRect();
  return { w: r.width, h: r.height, scroll: d.scrollWidth > d.clientWidth };
});
check("one row, no scrolling", box.h < 60 && !box.scroll, JSON.stringify(box));

await page.click(`${DOCK} button[aria-label='More shapes']`);
await page.waitForSelector("[data-ui=menu]");
check("a group's arrow lists its tools, with their keys", (await menuItems(page)).join(",") === "Rectangle,Ellipse,Line,Arrow");
const [ellipse] = await page.$$("xpath/.//*[@data-ui='menu']//*[@role='menuitem'][contains(., 'Ellipse')]");
await ellipse.click();
await sleep(150);
check("picking one uses it", (await active(page)) === "Ellipse");
await page.keyboard.press("p");
await sleep(100);
check("the slot remembers the last shape", !!(await page.$(`${DOCK} button[data-tool='Ellipse']`)));
await page.click(`${DOCK} button[data-tool='Ellipse']`);
check("pressing it uses that again", (await active(page)) === "Ellipse");
await page.click(`${DOCK} button[data-tool='Ellipse']`);
check("pressing it again opens the rest", !!(await waitFor(() => page.$("[data-ui=menu]"))));
await page.keyboard.press("Escape");
await sleep(150);

await page.keyboard.press("a");
await sleep(100);
check("keys keep the dock in step", (await active(page)) === "Arrow");

await page.click(`${DOCK} button[aria-label='Insert']`);
await page.waitForSelector("[data-ui=menu]");
check(
  "Insert holds equations, graphs, to-do boards, frames, pictures and tracing",
  (await menuItems(page)).join(",") === "Equation,Graph,To-do board,Frame,Image or video,Trace a picture",
  (await menuItems(page)).join(","),
);
const [graph] = await page.$$("xpath/.//*[@data-ui='menu']//*[@role='menuitem'][contains(., 'Graph')]");
await graph.click();
await sleep(150);
check("and shows what's in use from it", (await active(page)) === "Graph");

// Undo and redo are in the dock too.
await page.keyboard.press("r");
const r = await page.$eval("[data-testid=board]", (el) => el.getBoundingClientRect().toJSON());
await page.mouse.move(r.x + 300, r.y + 200);
await page.mouse.down();
await page.mouse.move(r.x + 420, r.y + 280, { steps: 4 });
await page.mouse.up();
await waitFor(async () => JSON.parse(sql(`select jsonb_array_length(data->'elements') from drawings where id='${id}'`) || "0") === 1, 10_000);
await page.click(`${DOCK} button[aria-label='Undo']`);
check(
  "the dock's Undo takes it back",
  await waitFor(async () => (await page.$eval("[data-testid=board]", (b) => b.getAttribute("aria-label"))).includes("with 0 items")),
);
check("and Redo is there", !(await page.$eval(`${DOCK} button[aria-label='Redo']`, (b) => b.disabled)));

// ------------------------------------------------------------ the search
await page.keyboard.press("/");
await page.waitForSelector("[data-testid=tool-search]");
check("/ opens the tool search", !!(await searchOpen(page)));
check("listing tools first, then commands", (await options(page)).slice(0, 3).join(",") === "Select,Lasso,Pan");
await page.keyboard.type("circle");
await sleep(150);
check("it finds tools by other words too", (await options(page))[0] === "Ellipse", (await options(page)).join(","));
await page.keyboard.press("Enter");
await waitFor(async () => !(await searchOpen(page)));
check("Enter uses it", (await active(page)) === "Ellipse");

await page.keyboard.down("Control");
await page.keyboard.press("k");
await page.keyboard.up("Control");
await page.waitForSelector("[data-testid=tool-search]");
await page.keyboard.type("sl");
await sleep(150);
check("⌘K opens it as well; words starting with what's typed come first", (await options(page))[0] === "Slides", (await options(page)).join(","));
await page.keyboard.press("Enter");
check("and commands work from it", !!(await waitFor(() => page.$("[data-testid=slides-panel]"))));
await page.keyboard.press("Escape");
await page.keyboard.press("Escape");
await sleep(200);

await page.keyboard.press("/");
await page.waitForSelector("[data-testid=tool-search]");
await page.keyboard.type("lin");
await sleep(100);
await page.keyboard.press("ArrowDown");
const second = (await options(page))[1];
await page.keyboard.press("Enter");
await waitFor(async () => !(await searchOpen(page)));
check("↓ chooses the next one", (await active(page)) === second, `${second} / ${await active(page)}`);

await page.keyboard.press("/");
await page.waitForSelector("[data-testid=tool-search]");
await page.keyboard.type("zzzz");
await sleep(100);
check("nothing found says so", /Nothing called/.test(await page.$eval("[data-testid=tool-search]", (d) => d.innerText)));
await page.keyboard.press("Escape");
await waitFor(async () => !(await searchOpen(page)));
check("Esc closes it", !(await searchOpen(page)));

await page.click("[data-testid=tool-search-button]");
check("so does the dock's search button open it", !!(await waitFor(() => searchOpen(page))));
await page.keyboard.press("Escape");

// ------------------------------------------------------------ view only
const viewer = await (await browser.createBrowserContext()).newPage();
await viewer.setViewport({ width: 1280, height: 720 });
viewer.on("pageerror", (e) => errors.push(e.message));
const v = await signUp(viewer, { name: "Dock Viewer" });
sql(`insert into drawing_members (drawing_id, user_id, role) values ('${id}', '${v.id}', 'viewer')`);
await viewer.goto(`${BASE}/drawings/${id}`, { waitUntil: "load" });
await viewer.waitForSelector(DOCK);
await sleep(600);
const viewSlots = await viewer.$$eval(`${DOCK} button[data-tool]`, (bs) => bs.map((b) => b.dataset.tool));
check("view-only members get select, lasso and pan", viewSlots.join(",") === "Select,Lasso,Pan", viewSlots.join(","));
check("and no undo", !(await viewer.$(`${DOCK} button[aria-label='Undo']`)));
await viewer.keyboard.press("/");
await viewer.waitForSelector("[data-testid=tool-search]");
await viewer.keyboard.type("pen");
await sleep(100);
check("their search has no drawing tools", !(await options(viewer)).includes("Pen"));

// ------------------------------------------------------------ phones
const phone = await (await browser.createBrowserContext()).newPage();
await phone.setViewport({ width: 375, height: 740, isMobile: true, hasTouch: true });
phone.on("pageerror", (e) => errors.push(e.message));
const ph = await signUp(phone, { name: "Dock Phone" });
sql(`insert into drawing_members (drawing_id, user_id, role) values ('${id}', '${ph.id}', 'editor')`);
await phone.goto(`${BASE}/drawings/${id}`, { waitUntil: "load" });
await phone.waitForSelector(DOCK);
await sleep(800);
const fits = await phone.$eval(DOCK, (d) => {
  const r = d.getBoundingClientRect();
  return r.left >= 0 && r.right <= window.innerWidth && d.scrollWidth <= d.clientWidth;
});
check("on a phone the dock fits the screen", fits);
const overlap = await phone.evaluate(() => {
  const a = document.querySelector("[data-testid=tool-dock]").getBoundingClientRect();
  const z = document.querySelector("[aria-label='Zoom level']")?.closest("div.absolute")?.getBoundingClientRect();
  return z ? !(a.bottom <= z.top || z.bottom <= a.top || a.right <= z.left || z.right <= a.left) : false;
});
check("clear of the zoom controls", !overlap);
await phone.tap(`${DOCK} button[aria-label='Rectangle']`);
await sleep(150);
await phone.tap(`${DOCK} button[aria-label='Rectangle']`);
check("tapping an active group again opens it", !!(await waitFor(() => phone.$("[data-ui=menu]"))));

check("no page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
await browser.close();
console.log(failures ? `\n${failures} FAILED` : "\nall passed");
process.exit(failures ? 1 : 0);
