// Drives the browser-storage fallback chain by shrinking the site's quota with
// the Chrome DevTools Protocol: IndexedDB -> evict image copies -> backup slot
// -> server only -> back to IndexedDB. Run against `npm start`; creates test
// drawings.
import puppeteer from "puppeteer-core";
import { execSync } from "node:child_process";
import nextEnv from "@next/env";

nextEnv.loadEnvConfig(process.cwd());
const { signUp, localDbName } = await import("./helpers.mjs");

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const CHROME = process.env.CHROME_PATH ?? "/usr/bin/google-chrome";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sql = (q) =>
  execSync(`psql "${process.env.DATABASE_URL}" -tA -c "${q}"`)
    .toString()
    .trim();
const elementCount = (id) => Number(sql(`select jsonb_array_length(data->'elements') from drawings where id='${id}'`));

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
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
const cdp = await page.createCDPSession();

await page.goto(BASE, { waitUntil: "networkidle0" });
// Clearing also drops cookies, so sign up afterwards. Chrome only enforces a
// quota override on storage created after a clear in the same session.
await cdp.send("Storage.clearDataForOrigin", { origin: BASE, storageTypes: "all" });
const me = await signUp(page, { name: "Quota Test" });

const status = () =>
  page.$eval("[data-testid=storage-status]", (b) => b.innerText.replace(/\s+/g, " ").trim()).catch(() => "");
async function waitStatus(re, timeout = 15000) {
  const t0 = Date.now();
  let s = "";
  while (Date.now() - t0 < timeout) {
    s = await status();
    if (re.test(s)) return s;
    await sleep(150);
  }
  return s;
}
async function scribble(i) {
  const b = await page.$eval("[data-testid=board]", (c) => {
    const r = c.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  });
  // Stay clear of the floating tool-options bar at the top of the board.
  const y = 0.2 + ((i * 0.029) % 0.7);
  const pts = [];
  for (let k = 0; k <= 40; k++) pts.push([0.04 + k * 0.023, y + 0.05 * Math.sin(k * 0.9 + i)]);
  await page.mouse.move(b.x + pts[0][0] * b.w, b.y + pts[0][1] * b.h);
  await page.mouse.down();
  for (const [fx, fy] of pts.slice(1)) await page.mouse.move(b.x + fx * b.w, b.y + fy * b.h, { steps: 3 });
  await page.mouse.up();
}
async function newDrawing() {
  await page.goto(BASE, { waitUntil: "networkidle0" });
  // The editor keeps a live connection open: wait for "load", not an idle network.
  await Promise.all([page.waitForNavigation({ waitUntil: "load" }), page.click("main form button[type=submit]")]);
  await waitStatus(/Saved here/);
  await page.waitForFunction(() => /^\/drawings\/[0-9a-f-]{36}$/.test(location.pathname), { timeout: 15_000 }); // the redirect is client-side
  return page.url().split("/drawings/")[1];
}
const usage = () => page.evaluate(async () => (await navigator.storage.estimate()).usage);
const notice = () => page.$eval("[role=status]", (n) => n.innerText).catch(() => "");
/** What IndexedDB holds: unsynced batches per drawing, and image copies. */
const local = () =>
  page.evaluate(
    (name) =>
      new Promise((res) => {
        const r = indexedDB.open(name);
        r.onsuccess = () => {
          const tx = r.result.transaction(["outbox", "assets"]);
          const out = tx.objectStore("outbox").getAll();
          const assets = tx.objectStore("assets").getAll();
          tx.oncomplete = () => {
            r.result.close();
            res({ outbox: out.result.map((o) => o.drawingId), assets: assets.result.map((a) => ({ drawingId: a.drawingId, uploaded: a.uploaded })) });
          };
        };
      }),
    localDbName(me.id),
  );
async function pasteImage(colour) {
  const dt = await page.evaluateHandle(async (colour) => {
    const c = document.createElement("canvas");
    c.width = 640;
    c.height = 360;
    const x = c.getContext("2d");
    x.fillStyle = colour;
    x.fillRect(0, 0, 640, 360);
    for (let i = 0; i < 400; i++) {
      x.fillStyle = `hsl(${i * 37}, 60%, ${30 + (i % 50)}%)`;
      x.fillRect((i * 53) % 640, (i * 29) % 360, 24, 24);
    }
    const blob = await new Promise((r) => c.toBlob(r, "image/png"));
    const t = new DataTransfer();
    t.items.add(new File([blob], "shot.png", { type: "image/png" }));
    return t;
  }, colour);
  await page.evaluate((dt) => document.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true })), dt);
}
const holdChanges = (req) => (req.method() === "POST" && /\/changes$/.test(req.url()) ? req.abort() : req.continue());
async function offline(on) {
  if (on) {
    await page.setRequestInterception(true);
    page.on("request", holdChanges);
  } else {
    page.off("request", holdChanges);
    await page.setRequestInterception(false);
  }
}

// Another drawing with an image: once uploaded, its local copy can be evicted.
const other = await newDrawing();
await pasteImage("#f2cdac");
await waitStatus(/Saved here.*Synced/);
await page.keyboard.press("p");

const current = await newDrawing();
for (let i = 0; i < 3; i++) await scribble(i + 20);
await waitStatus(/Saved here.*Synced/);
let held = await local();
check("synced drawings leave nothing waiting in the browser", held.outbox.length === 0, JSON.stringify(held.outbox));
check("images stay in the browser after upload", held.assets.some((a) => a.drawingId === other && a.uploaded), JSON.stringify(held.assets));

// ------------------------------------------- squeeze the quota
const used = await usage();
await cdp.send("Storage.overrideQuotaForOrigin", { origin: BASE, quotaSize: used + 1024 });
console.log(`usage ${used} bytes; quota set to ${used + 1024}`);

const seen = new Set();
let drawn = 3;
for (let i = 0; i < 80; i++) {
  // Chrome's usage figure can lag behind deletions; if nothing has failed
  // after a while, squeeze again from the current figure.
  if (i > 0 && i % 20 === 0 && !/Backup slot/.test(await status())) {
    const now = await usage();
    await cdp.send("Storage.overrideQuotaForOrigin", { origin: BASE, quotaSize: Math.max(1024, now - 4096) });
    console.log(`  squeezed again: usage ${now} bytes`);
  }
  await scribble(100 + i);
  drawn++;
  await sleep(120);
  const n = await notice();
  const s = await status();
  const key = `${s} | ${n.split("\n")[0]}`;
  if (!seen.has(key)) {
    seen.add(key);
    console.log(`  after stroke ${drawn}: ${key}`);
  }
  if (/Backup slot/.test(s)) break;
}
held = await local();
check("image copies the server has were removed to make room", !held.assets.some((a) => a.drawingId === other), JSON.stringify(held.assets));
check("fell back to the backup slot", /Backup slot/.test(await status()), await status());
await waitStatus(/Synced/);
check("server still receives every change", elementCount(current) === drawn, `${elementCount(current)} vs ${drawn}`);

// While the server can't be reached, unsynced changes sit in the slot.
await offline(true);
await scribble(200);
drawn++;
const slotKey = `canvas-backup:${me.id}:${current}`;
let slot = null;
for (let t = 0; t < 30 && !slot; t++) {
  await sleep(100);
  slot = await page.evaluate((key) => localStorage.getItem(key), slotKey);
}
check("backup slot holds the unsynced change", !!slot && JSON.parse(slot).encoding === "gzip" && JSON.parse(slot).v === 2, slot ? `${slot.length} chars` : "missing");
await offline(false);
await page.keyboard.down("Control");
await page.keyboard.press("s");
await page.keyboard.up("Control");
await waitStatus(/Synced/);
const t9 = Date.now();
while (Date.now() - t9 < 4000 && (await page.evaluate((key) => localStorage.getItem(key), slotKey))) await sleep(100);
check("and is emptied once the server has it", (await page.evaluate((key) => localStorage.getItem(key), slotKey)) === null && elementCount(current) === drawn);

// ------------------------------------------- fill localStorage too
await page.evaluate(() => {
  // Fill with progressively smaller chunks until not even 8 chars fit.
  let n = 0;
  for (const size of [256 * 1024, 16 * 1024, 1024, 64, 8]) {
    const chunk = "x".repeat(size);
    try {
      for (;;) localStorage.setItem(`junk:${n++}`, chunk);
    } catch {}
  }
});
await scribble(300);
drawn++;
const offStatus = await waitStatus(/Not saved here/, 5000);
check("with no room anywhere, local saving is off", /Not saved here/.test(offStatus), offStatus);
const offBanner = await notice();
check("banner offers a backup download", /Download backup/.test(offBanner), offBanner.replace(/\n/g, " "));
const t0 = Date.now();
while (elementCount(current) !== drawn && Date.now() - t0 < 4000) await sleep(100);
check("server-direct sync is fast", elementCount(current) === drawn, `${Date.now() - t0} ms`);


// A screenshot pasted now lives in memory and goes straight to the server.
const imagesBefore = Number(sql(`select count(*) from assets where drawing_id='${current}'`));
await pasteImage("#82c9d7");
drawn++;
const t1 = Date.now();
while (Number(sql(`select count(*) from assets where drawing_id='${current}'`)) === imagesBefore && Date.now() - t1 < 8000) await sleep(150);
check("image pasted with storage full still reaches the server", Number(sql(`select count(*) from assets where drawing_id='${current}'`)) === imagesBefore + 1);
while (elementCount(current) !== drawn && Date.now() - t1 < 8000) await sleep(150);
check("and the drawing references it", elementCount(current) === drawn, `${elementCount(current)} vs ${drawn}`);

// ------------------------------------------- recover
await page.evaluate(() => {
  for (const k of Object.keys(localStorage)) if (k.startsWith("junk")) localStorage.removeItem(k);
});
await cdp.send("Storage.overrideQuotaForOrigin", { origin: BASE });
await page.click("[data-testid=storage-status]");
await page.waitForSelector("[data-testid=storage-panel]");
const freeBtn = await page.$("xpath/.//button[normalize-space()='Free up space']");
await freeBtn.click();
const back = await waitStatus(/Saved here/, 5000);
check("returns to IndexedDB once space is available", /Saved here/.test(back), back);
const leftover = await page.evaluate((key) => localStorage.getItem(key), `canvas-backup:${me.id}:${current}`);
check("backup slot cleared after recovery", leftover === null);
await page.keyboard.press("Escape");

// Inserting an image switches to Select; go back to the pen.
await page.keyboard.press("p");
await scribble(400);
drawn++;
const t2 = Date.now();
while (elementCount(current) !== drawn && Date.now() - t2 < 8000) await sleep(150);
check("drawing works normally after recovery", elementCount(current) === drawn, `${elementCount(current)} vs ${drawn}`);
await waitStatus(/Saved here.*Synced/);
await page.reload({ waitUntil: "load" });
await waitStatus(/Saved here/);
await sleep(500);
const toastText = await page.$eval("[data-toast]", (t) => t.innerText).catch(() => "");
check("no false restore after reload", !/Restored/.test(toastText), toastText);
check("Postgres has every stroke", elementCount(current) === drawn, `${elementCount(current)} vs ${drawn}`);

console.log("\nerrors:", errors.length ? errors : "none");
await browser.close();
process.exit(failures ? 1 : 0);
