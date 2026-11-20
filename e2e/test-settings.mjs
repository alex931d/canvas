// The settings page and what it changes: your name, your profile picture
// (cropped and uploaded, served only to signed-in people, shown in menus,
// shared drawings and to staff, removable by you or an admin), and the
// drawing and to-do board effects (saved, and seen on a canvas: a trace
// replays a drawing as it opens, "off" shows it at once, cards glide).
// Also the scroll reveal on the landing page.
// Run against `npm run build && npm start` (see README, Tests); uses DATABASE_URL.
import puppeteer from "puppeteer-core";
import { writeFileSync } from "node:fs";
import nextEnv from "@next/env";

nextEnv.loadEnvConfig(process.cwd());
const { BASE, sleep, sql, signUp } = await import("./helpers.mjs");

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
    value = await Promise.resolve().then(fn).catch(() => null);
    if (value) return value;
    await sleep(100);
  }
  return value;
}
const toastText = (p) => p.$$eval("[data-toast]", (ts) => ts.map((t) => t.innerText).join(" | ")).catch(() => "");
const status = (p) => p.$eval("[data-testid=prefs-status]", (n) => n.textContent).catch(() => "");
const sidebarAvatar = (p) =>
  p.$eval("aside [aria-label^='Account:'] [data-ui=avatar]", (a) => ({
    photo: a.hasAttribute("data-photo"),
    src: a.querySelector("img")?.getAttribute("src") ?? null,
    text: a.textContent,
  }));

/** Non-transparent pixels on the board, sampled every 4th pixel: how much is drawn right now. */
const inked = (p) =>
  p.evaluate(() => {
    const c = document.querySelector("canvas[data-testid=board]");
    if (!c || c.width === 0) return 0;
    const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    for (let i = 3; i < d.length; i += 16) if (d[i] > 0) n++;
    return n;
  });

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ["--no-sandbox"],
  defaultViewport: { width: 1360, height: 900, deviceScaleFactor: 1 },
});
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));

try {
  const me = await signUp(page, { name: "Maya Chen" });

  // ------------------------------------------------------------ reaching it
  await page.click("aside [aria-label^='Account:']");
  const [item] = await page.$$("xpath/.//a[@role='menuitem'][contains(., 'Settings')]");
  check("the account menu has Settings", !!item);
  await Promise.all([page.waitForNavigation({ waitUntil: "networkidle0" }), item.click()]);
  check("…which opens /settings", new URL(page.url()).pathname === "/settings");
  await page.waitForSelector("input[name=drawEffect]");
  check("it shows Profile and Effects", /Profile[\s\S]*Effects/.test(await page.evaluate(() => document.querySelector("main").innerText)));
  check("the default effect is Pop", await page.$eval("input[name=drawEffect][value=pop]", (i) => i.checked));

  // ------------------------------------------------------------ name
  await page.$eval("#settings-name", (i) => (i.value = ""));
  await page.type("#settings-name", "   ");
  await page.click("xpath/.//button[normalize-space()='Save name']");
  const nameError = await waitFor(() => page.$eval("#settings-name-note[role=alert]", (n) => n.textContent));
  check("a blank name is refused", nameError === "Enter your name.", nameError);
  await page.$eval("#settings-name", (i) => (i.value = ""));
  await page.type("#settings-name", "Maya Okafor-Chen");
  await page.click("xpath/.//button[normalize-space()='Save name']");
  const saved = await waitFor(() => page.$eval("#settings-name-note[role=status]", (n) => (n.textContent === "Name saved." ? n.textContent : null)));
  check("a new name saves", saved === "Name saved.");
  check("…in the database", sql(`select name from users where id = '${me.id}'`) === "Maya Okafor-Chen");
  const menuName = await waitFor(() =>
    page.$eval("aside [aria-label^='Account:']", (b) => (b.getAttribute("aria-label").includes("Okafor") ? b.getAttribute("aria-label") : null)),
  );
  check("…and the account menu shows it straight away", menuName === "Account: Maya Okafor-Chen", menuName);
  check("initials follow the new name", (await sidebarAvatar(page)).text === "MO");

  // ------------------------------------------------------------ picture
  const png = await page.evaluate(() => {
    const c = document.createElement("canvas");
    c.width = 800;
    c.height = 500; // not square: the middle is kept
    const x = c.getContext("2d");
    x.fillStyle = "#c94736";
    x.fillRect(0, 0, 800, 500);
    x.fillStyle = "#277c78";
    x.fillRect(150, 0, 500, 500);
    return c.toDataURL("image/png").split(",")[1];
  });
  writeFileSync("/tmp/settings-photo.png", Buffer.from(png, "base64"));
  writeFileSync("/tmp/settings-not-a-photo.png", "this is not an image");

  const input = await page.$("[data-testid=avatar-input]");
  await input.uploadFile("/tmp/settings-not-a-photo.png");
  const bad = await waitFor(async () => ((await toastText(page)).includes("isn't a picture") ? toastText(page) : null));
  check("a file that isn't a picture is turned away in the browser", !!bad, bad);
  check("…and nothing is stored", sql(`select count(*) from user_avatars where user_id = '${me.id}'`) === "0");

  await input.uploadFile("/tmp/settings-photo.png");
  const good = await waitFor(async () => ((await toastText(page)).includes("Profile picture updated") ? true : null), 15_000);
  check("a photo uploads", !!good);
  const row = sql(`select mime_type, length(bytes) from user_avatars where user_id = '${me.id}'`).split("|");
  check("it's stored as a small square WebP", row[0] === "image/webp" && Number(row[1]) < 20_000, row.join(" "));
  check("users.avatar_updated_at is set", sql(`select avatar_updated_at is not null from users where id = '${me.id}'`) === "t");
  const avatar = await waitFor(async () => {
    const a = await sidebarAvatar(page);
    return a.photo ? a : null;
  });
  check("the account menu shows the picture", !!avatar?.src?.startsWith(`/api/avatars/${me.id}?v=`), avatar?.src);
  const middle = await page.evaluate(async (src) => {
    const img = new Image();
    img.src = src;
    await img.decode();
    const c = document.createElement("canvas");
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
    const x = c.getContext("2d");
    x.drawImage(img, 0, 0);
    const at = (px, py) => Array.from(x.getImageData(px, py, 1, 1).data.slice(0, 3));
    return { w: img.naturalWidth, h: img.naturalHeight, corner: at(4, 4), centre: at(128, 128) };
  }, avatar.src);
  check("it's a 256 px square", middle.w === 256 && middle.h === 256, `${middle.w}×${middle.h}`);
  check("…cut from the middle of the photo (teal there, no red edge)", middle.corner[1] > middle.corner[0] && middle.centre[1] > middle.centre[0], JSON.stringify(middle));

  const served = await page.evaluate(async (src) => {
    const r = await fetch(src);
    return { status: r.status, type: r.headers.get("content-type"), cache: r.headers.get("cache-control"), nosniff: r.headers.get("x-content-type-options") };
  }, avatar.src);
  check("the picture is served with its type, nosniff, and cached privately for good", served.status === 200 && served.type === "image/webp" && served.nosniff === "nosniff" && served.cache.includes("private") && served.cache.includes("immutable"), JSON.stringify(served));
  const stale = await page.evaluate(async (id) => (await fetch(`/api/avatars/${id}?v=old`)).headers.get("cache-control"), me.id);
  check("an old version's URL isn't cached for good", stale === "private, no-cache", stale);
  const anon = await fetch(`${BASE}${avatar.src}`);
  check("signed out, pictures aren't served", anon.status === 401, String(anon.status));

  // ------------------------------------------------------------ preferences
  await page.click("label:has(input[name=drawEffect][value=trace])");
  await waitFor(async () => ((await status(page)) === "Saved" ? true : null));
  check("choosing Trace saves it", JSON.parse(sql(`select preferences from user_preferences where user_id = '${me.id}'`)).drawEffect === "trace");
  await page.click("#board-effects");
  await waitFor(async () => (JSON.parse(sql(`select preferences from user_preferences where user_id = '${me.id}'`) || "{}").boardEffects === false ? true : null));
  check("turning off to-do board effects saves it", JSON.parse(sql(`select preferences from user_preferences where user_id = '${me.id}'`)).boardEffects === false);
  await page.reload({ waitUntil: "networkidle0" });
  check("both are still set after a reload", (await page.$eval("input[name=drawEffect][value=trace]", (i) => i.checked)) && (await page.$eval("#board-effects", (s) => s.getAttribute("aria-checked"))) === "false");
  await page.click("#board-effects");
  await waitFor(async () => (JSON.parse(sql(`select preferences from user_preferences where user_id = '${me.id}'`)).boardEffects ? true : null));

  // ------------------------------------------------------------ effects on a canvas
  const wave = [];
  for (let i = 0; i <= 120; i++) wave.push(80 + i * 6, Math.round(160 + Math.sin(i / 6) * 60));
  const ring = [];
  for (let i = 0; i <= 80; i++) ring.push(Math.round(300 + Math.cos((i / 80) * Math.PI * 2) * 90), Math.round(420 + Math.sin((i / 80) * Math.PI * 2) * 90));
  const elements = [
    { id: crypto.randomUUID(), type: "stroke", brush: "ink", color: "#201f24", size: 6, points: wave },
    { id: crypto.randomUUID(), type: "stroke", brush: "marker", color: "#c94736", size: 6, points: ring },
    { id: crypto.randomUUID(), type: "rect", x: 480, y: 330, w: 260, h: 180, color: "#277c78", size: 4, fill: null },
    {
      id: "41e5c2a6-7c1c-4d0e-9a52-1f1f7a3c0b01",
      type: "kanban",
      x: 560,
      y: 60,
      w: 360,
      scale: 1,
      title: "This week",
      columns: [
        { id: "41e5c2a6-7c1c-4d0e-9a52-1f1f7a3c0b02", title: "To do", color: "#3f82b2", cards: [{ id: "41e5c2a6-7c1c-4d0e-9a52-1f1f7a3c0b03", text: "Read chapter 4" }] },
        { id: "41e5c2a6-7c1c-4d0e-9a52-1f1f7a3c0b04", title: "Done", color: "#277c78", cards: [] },
      ],
    },
  ];
  const data = JSON.stringify({ version: 2, background: "#ffffff", elements }).replace(/'/g, "''");
  const drawingId = sql(`insert into drawings (user_id, title, data) values ('${me.id}', 'Effects', '${data}'::jsonb) returning id`);
  // Open at a known view: world (0, 0) at the canvas's top-left, 100 %.
  await page.evaluate((id) => localStorage.setItem(`canvas-camera:${id}`, JSON.stringify({ x: 0, y: 0, z: 1 })), drawingId);

  /** Open the drawing and sample how much is drawn, every ~40 ms for `ms`. */
  const openAndSample = async (ms) => {
    await page.goto(`${BASE}/drawings/${drawingId}`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector("canvas[data-testid=board]");
    const samples = [];
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      samples.push(await inked(page));
      await sleep(40);
    }
    return samples;
  };
  const between = (samples) => {
    const full = samples.at(-1);
    return samples.filter((n) => n > full * 0.05 && n < full * 0.95).length;
  };

  const traced = await openAndSample(2600);
  check("Trace: the drawing draws itself in as it opens (many part-drawn frames)", between(traced) >= 4, `${between(traced)} of ${traced.length}`);
  check("…and ends fully drawn", traced.at(-1) > 2000 && Math.abs(traced.at(-1) - traced.at(-2)) < traced.at(-1) * 0.01, String(traced.at(-1)));

  sql(`update user_preferences set preferences = '{"drawEffect":"off","boardEffects":true}' where user_id = '${me.id}'`);
  const instant = await openAndSample(1600);
  check("Off: it's all there at once (no part-drawn frames)", between(instant) <= 1, `${between(instant)} of ${instant.length}`);
  check("…the same picture as the trace ends on", Math.abs(instant.at(-1) - traced.at(-1)) < traced.at(-1) * 0.02, `${instant.at(-1)} vs ${traced.at(-1)}`);

  // A card dragged to Done glides and gets crossed out: the board keeps changing for a moment after the drop.
  const box = await page.$eval("canvas[data-testid=board]", (c) => {
    const r = c.getBoundingClientRect();
    return { x: r.left, y: r.top };
  });
  const snapshot = () => page.$eval("canvas[data-testid=board]", (c) => c.toDataURL());
  // The board's first card sits at world (582, 142), 145 × 35; Done starts at x 745 (scale 1, at 100 %).
  const drag = async (fromX, toX) => {
    await page.keyboard.press("v");
    const y = box.y + 159;
    await page.mouse.move(box.x + fromX, y);
    await page.mouse.down();
    for (let i = 1; i <= 10; i++) await page.mouse.move(box.x + fromX + ((toX - fromX) * i) / 10, y + 16);
    await sleep(60);
    await page.mouse.up();
  };
  const kanbanOf = () => JSON.parse(sql(`select data from drawings where id = '${drawingId}'`)).elements.find((e) => e.type === "kanban");
  await drag(654, 825);
  await sleep(40);
  const just = await snapshot();
  await sleep(900);
  const later = await snapshot();
  const landed = await waitFor(async () => (kanbanOf().columns[1].cards.length === 1 ? true : null));
  check("the card lands in Done", !!landed);
  check("with board effects on, it's still moving just after the drop", just !== later);

  // Board effects off: drag it back, and the board is settled straight away.
  sql(`update user_preferences set preferences = '{"drawEffect":"off","boardEffects":false}' where user_id = '${me.id}'`);
  await page.evaluate((id) => localStorage.setItem(`canvas-camera:${id}`, JSON.stringify({ x: 0, y: 0, z: 1 })), drawingId);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector("canvas[data-testid=board]");
  await sleep(1000);
  await drag(825, 654);
  await sleep(60);
  const settledAt = await snapshot();
  await sleep(700);
  const returned = await waitFor(async () => (kanbanOf().columns[0].cards.length === 1 ? true : null));
  check("…and back in To do", !!returned);
  check("with board effects off, the board is settled straight after the drop", settledAt === (await snapshot()));

  // ------------------------------------------------------------ the picture elsewhere
  sql(`update users set role = 'admin' where id = '${me.id}'`);
  await page.goto(`${BASE}/admin?user=${me.id}`, { waitUntil: "networkidle0" });
  check("staff see the picture in the dashboard", await page.$eval(`tr[data-user-id='${me.id}'] [data-ui=avatar]`, (a) => a.hasAttribute("data-photo")).catch(() => false));
  const [takeDown] = await page.$$("xpath/.//button[normalize-space()='Remove profile picture']");
  check("…and can remove it", !!takeDown);
  await takeDown.click();
  await waitFor(() => (sql(`select avatar_updated_at is null from users where id = '${me.id}'`) === "t" ? true : null));
  check("removed by staff: gone from the database", sql(`select count(*) from user_avatars where user_id = '${me.id}'`) === "0");
  check("…and written in the history", sql(`select action from audit_events where user_id = '${me.id}' order by created_at desc limit 1`) === "avatar.removed");
  const gone = await page.evaluate(async (src) => (await fetch(src, { cache: "no-store" })).status, avatar.src);
  check("the server stops serving it", gone === 404, String(gone));

  // You can remove your own too.
  await page.goto(`${BASE}/settings`, { waitUntil: "networkidle0" });
  await (await page.$("[data-testid=avatar-input]")).uploadFile("/tmp/settings-photo.png");
  await waitFor(async () => (sql(`select count(*) from user_avatars where user_id = '${me.id}'`) === "1" ? true : null), 15_000);
  const [removeOwn] = await waitFor(() => page.$$("xpath/.//button[contains(., 'Remove picture')]").then((b) => (b.length ? b : null)));
  await removeOwn.click();
  await waitFor(() => (sql(`select count(*) from user_avatars where user_id = '${me.id}'`) === "0" ? true : null));
  check("you can remove your own picture", sql(`select avatar_updated_at is null from users where id = '${me.id}'`) === "t");
  const back = await waitFor(async () => {
    const a = await sidebarAvatar(page);
    return !a.photo ? a : null;
  });
  check("…and initials come back", back?.text === "MO", JSON.stringify(back));

  // ------------------------------------------------------------ landing page reveal
  const visitor = await browser.createBrowserContext();
  const v = await visitor.newPage();
  await v.setViewport({ width: 1360, height: 900 });
  await v.goto(`${BASE}/welcome`, { waitUntil: "networkidle0" });
  const opacity = () => v.$eval("#start-title", (h) => Number(getComputedStyle(h.closest("[style]") ?? h).opacity));
  const html = await (await fetch(`${BASE}/welcome`)).text();
  check("the landing page's HTML doesn't hide anything (reveals start after load)", !/opacity:\s*0/.test(html));
  const before = await opacity();
  await v.$eval("#start-title", (h) => h.scrollIntoView({ block: "center" }));
  const after = await waitFor(async () => ((await opacity()) > 0.99 ? opacity() : null), 3000);
  check("a section below the fold waits out of sight, then slides in when scrolled to", before < 0.05 && after > 0.99, `${before} → ${after}`);
  await v.evaluate(() => window.scrollTo(0, 0));
  const offAgain = await waitFor(async () => ((await opacity()) < 0.05 ? true : null), 3000);
  check("…and slides back out when scrolled away", !!offAgain);
  await visitor.close();

  check("no page errors", errors.length === 0, errors.join(" | "));
} catch (err) {
  console.error(err);
  failures++;
} finally {
  await browser.close();
}

console.log(failures ? `\n${failures} FAILED` : "\nall passed");
process.exit(failures ? 1 : 0);
