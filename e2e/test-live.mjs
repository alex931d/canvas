// Drawing together, live: the other person's pen stroke and shapes appear
// on your board as they draw them (before they lift the pen), then land as
// ordinary elements without a second entrance; their profile picture (or
// initials) rides along by their cursor. Two people in two browsers.
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
async function waitFor(fn, timeout = 8000) {
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
async function person(name) {
  const page = await (await browser.createBrowserContext()).newPage();
  await page.setViewport({ width: 1280, height: 800 });
  page.on("pageerror", (e) => errors.push(`${name}: ${e.message}`));
  const user = await signUp(page, { name });
  return { page, user };
}

/** Pixels on the board's canvas: ink (the default dark), and the test's magenta profile picture. */
const pixels = (p) =>
  p.$eval("[data-testid=board]", (c) => {
    const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
    let ink = 0;
    let magenta = 0;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] < 200) continue;
      if (d[i] < 60 && d[i + 1] < 60 && d[i + 2] < 70) ink++;
      if (d[i] > 220 && d[i + 1] < 40 && d[i + 2] > 220) magenta++;
    }
    return { ink, magenta };
  });
const items = (p) =>
  p.$eval("[data-testid=board]", (c) => Number(c.getAttribute("aria-label").match(/with (\d+) items/)?.[1] ?? -1));
const boardAt = async (p) =>
  p.$eval("[data-testid=board]", (el) => {
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y };
  });

// ------------------------------------------------------------ two people, one drawing
const { page: a, user: maya } = await person("Maya Chen");
// A magenta profile picture, easy to find among the pixels.
const png = await a.evaluate(() => {
  const c = document.createElement("canvas");
  c.width = c.height = 32;
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#ff00ff";
  ctx.fillRect(0, 0, 32, 32);
  return c.toDataURL("image/png").split(",")[1];
});
sql(
  `insert into user_avatars (user_id, mime_type, bytes, updated_at) values ('${maya.id}', 'image/png', decode('${png}', 'base64'), now());
   update users set avatar_updated_at = now() where id = '${maya.id}'`,
);
await Promise.all([a.waitForNavigation({ waitUntil: "load" }), a.click("main form button[type=submit]")]);
await a.waitForFunction(() => /^\/drawings\/[0-9a-f-]{36}$/.test(location.pathname), { timeout: 15_000 });
const id = a.url().split("/drawings/")[1];

const { page: b, user: sam } = await person("Sam Rivera");
sql(`insert into drawing_members (drawing_id, user_id, role) values ('${id}', '${sam.id}', 'editor')`);
await b.goto(`${BASE}/drawings/${id}`, { waitUntil: "load" });
await b.waitForSelector("[data-testid=board]");
await a.bringToFront();
const companyA = await waitFor(() => a.$("[data-testid=peers][aria-label*='Sam Rivera']"), 10_000);
check("they see each other", !!companyA);
await sleep(500);

// Maya's pointer over the board: Sam sees her picture by it.
const ra = await boardAt(a);
await a.mouse.move(ra.x + 400, ra.y + 300);
await a.mouse.move(ra.x + 420, ra.y + 310, { steps: 3 });
check(
  "her profile picture shows by her cursor on his board",
  !!(await waitFor(async () => (await pixels(b)).magenta > 200)),
  JSON.stringify(await pixels(b)),
);

// ------------------------------------------------------------ a stroke, live
const before = await pixels(b);
const itemsBefore = await items(b);
await a.keyboard.press("p");
await a.mouse.move(ra.x + 200, ra.y + 200);
await a.mouse.down();
for (let i = 1; i <= 12; i++) {
  await a.mouse.move(ra.x + 200 + i * 25, ra.y + 200 + Math.sin(i / 2) * 40, { steps: 3 });
  await sleep(40);
}
// Still holding the pen.
const during = await waitFor(async () => {
  const px = await pixels(b);
  return px.ink > before.ink + 300 ? px : null;
});
check("her stroke appears on his board while she's still drawing", !!during, `${before.ink} → ${during?.ink ?? (await pixels(b)).ink}`);
check("as a preview, not yet part of the drawing", (await items(b)) === itemsBefore);
for (let i = 13; i <= 20; i++) {
  await a.mouse.move(ra.x + 200 + i * 25, ra.y + 260, { steps: 2 });
  await sleep(30);
}
const grown = await waitFor(async () => {
  const px = await pixels(b);
  return px.ink > (during?.ink ?? 0) + 100 ? px : null;
});
check("and grows as she goes", !!grown);
await a.mouse.up();
check("when she lifts the pen it lands for real", !!(await waitFor(async () => (await items(b)) === itemsBefore + 1)));
await sleep(600);
const after = await pixels(b);
check("looking the same, with no gap or double", Math.abs(after.ink - (grown?.ink ?? after.ink)) < (grown?.ink ?? 1) * 0.35, `${grown?.ink} → ${after.ink}`);

// ------------------------------------------------------------ a shape, live
const beforeShape = await pixels(b);
await a.keyboard.press("r");
await a.mouse.move(ra.x + 600, ra.y + 150);
await a.mouse.down();
for (let i = 1; i <= 8; i++) {
  await a.mouse.move(ra.x + 600 + i * 20, ra.y + 150 + i * 15, { steps: 2 });
  await sleep(40);
}
check(
  "her rectangle shows while she drags it",
  !!(await waitFor(async () => (await pixels(b)).ink > beforeShape.ink + 150)),
);
await a.mouse.up();
check("and lands", !!(await waitFor(async () => (await items(b)) === itemsBefore + 2)));

// ------------------------------------------------------------ the other way round
await b.bringToFront();
const rb = await boardAt(b);
const aBefore = await pixels(a);
const aItems = await items(a);
await b.keyboard.press("p");
await b.mouse.move(rb.x + 200, rb.y + 450);
await b.mouse.down();
for (let i = 1; i <= 10; i++) {
  await b.mouse.move(rb.x + 200 + i * 30, rb.y + 450, { steps: 2 });
  await sleep(40);
}
check(
  "and his strokes reach her as he draws",
  !!(await waitFor(async () => (await pixels(a)).ink > aBefore.ink + 200)) && (await items(a)) === aItems,
);
check("with his initials by his cursor (no picture)", (await pixels(a)).magenta === 0);
await b.mouse.up();
check("landing on her board too", !!(await waitFor(async () => (await items(a)) === aItems + 1)));

// Drafts never reach the database: only the finished strokes do.
const saved = JSON.parse(sql(`select data->'elements' from drawings where id='${id}'`) || "[]");
check("only finished elements are saved", saved.length === 3 && saved.every((e) => e.type === "stroke" || e.type === "rect"));

check("no page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
await browser.close();
console.log(failures ? `\n${failures} FAILED` : "\nall passed");
process.exit(failures ? 1 : 0);
