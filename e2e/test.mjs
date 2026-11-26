// End-to-end check of the editor against a running production build.
//
//   node e2e/mock-ai.mjs &                                  # stand-in AI on :4010
//   AI_BASE_URL=http://localhost:4010/v1 npm start          # app on :3000
//   node e2e/test.mjs
//
// Uses DATABASE_URL from .env.local (creates a test account and drawings there).
import puppeteer from "puppeteer-core";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import nextEnv from "@next/env";

nextEnv.loadEnvConfig(process.cwd());
const { signUp, localDbName, pickTool } = await import("./helpers.mjs");

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const CHROME = process.env.CHROME_PATH ?? "/usr/bin/google-chrome";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sql = (q) => execSync(`psql "${process.env.DATABASE_URL}" -tA -c "${q}"`).toString().trim();

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
let page = await browser.newPage();
const errors = [];
const watch = (p) => {
  p.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  p.on("console", (m) => m.type() === "error" && errors.push(`console: ${m.text()}`));
};
watch(page);
const me = await signUp(page, { name: "Editor Test" });

// ------------------------------------------------------------ helpers
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
const board = () =>
  page.$eval("[data-testid=board]", (c) => {
    const r = c.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  });
/** Drag through points given in board-relative screen pixels. */
async function drag(pts, { steps = 6, shift = false } = {}) {
  const b = await board();
  if (shift) await page.keyboard.down("Shift");
  await page.mouse.move(b.x + pts[0][0], b.y + pts[0][1]);
  await page.mouse.down();
  for (const [x, y] of pts.slice(1)) await page.mouse.move(b.x + x, b.y + y, { steps });
  await page.mouse.up();
  if (shift) await page.keyboard.up("Shift");
}
const tool = (label) => pickTool(page, label);
const colour = (name) => page.click(`[aria-label='Colour'] button[aria-label='${name}']`);
const elementsIn = (id) => JSON.parse(sql(`select data->'elements' from drawings where id='${id}'`) || "[]");
async function waitFor(fn, timeout = 8000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    if (await fn()) return true;
    await sleep(150);
  }
  return false;
}
/** What this browser holds for a drawing: unsynced batches (op kinds, oldest first) and images. */
async function idbOps(id) {
  return page.evaluate(async (id, name) => {
    const db = await new Promise((res, rej) => {
      const r = indexedDB.open(name);
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    const all = (store) =>
      new Promise((res) => {
        const r = db.transaction(store).objectStore(store).getAll();
        r.onsuccess = () => res(r.result);
      });
    const outbox = (await all("outbox")).filter((r) => r.drawingId === id).sort((a, b) => a.seq - b.seq);
    const assets = await all("assets");
    db.close();
    return {
      outbox: outbox.map((r) => r.ops.map((o) => o.t).join("+")),
      assets: assets.map((a) => ({ id: a.id, uploaded: a.uploaded, size: a.blob.size })),
    };
  }, id, localDbName(me.id));
}
/** Hold back changes on their way to the server (everything else still loads). */
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
async function makePng(text, w = 420, h = 160) {
  return page.evaluateHandle(
    async (text, w, h) => {
      const c = document.createElement("canvas");
      c.width = w;
      c.height = h;
      const x = c.getContext("2d");
      x.fillStyle = "#f2cdac";
      x.fillRect(0, 0, w, h);
      x.fillStyle = "#201f24";
      x.font = "bold 44px sans-serif";
      x.fillText(text, 24, h / 2 + 15);
      const blob = await new Promise((r) => c.toBlob(r, "image/png"));
      const dt = new DataTransfer();
      dt.items.add(new File([blob], "screenshot.png", { type: "image/png" }));
      return dt;
    },
    text,
    w,
    h,
  );
}

// ------------------------------------------------------------ gallery
await page.goto(BASE, { waitUntil: "networkidle0" });
check("gallery renders", (await page.$eval("h1", (h) => h.textContent)) === "Drawings");

// The editor keeps a live connection open, so wait for "load", not an idle network.
await Promise.all([page.waitForNavigation({ waitUntil: "load" }), page.click("main form button[type=submit]")]);
await page.waitForFunction(() => /^\/drawings\/[0-9a-f-]{36}$/.test(location.pathname), { timeout: 15_000 }); // the redirect is client-side
const id = page.url().split("/drawings/")[1];
check("new drawing opens the editor", /^[0-9a-f-]{36}$/.test(id), id);
check("stored as version 2", sql(`select data->>'version' from drawings where id='${id}'`) === "2");
await waitStatus(/Saved here/);

// ------------------------------------------------------------ tools
await tool("Pen");
await drag([[160, 200], [200, 170], [230, 210], [170, 260], [240, 262]]); // ink "2"
await page.click("button[aria-label='Marker']");
await colour("Red");
await drag([[280, 200], [330, 260]]);
await page.click("button[aria-label='Highlighter']");
await colour("Gold");
await drag([[150, 300], [400, 300]], { steps: 12 });
await page.click("button[aria-label='Ink (pressure sensitive)']");
await tool("Rectangle");
await colour("Green");
await drag([[500, 160], [720, 300]], { steps: 8 });
await tool("Ellipse");
await drag([[760, 160], [900, 300]], { steps: 8 });
await tool("Arrow");
await drag([[500, 360], [700, 380]], { shift: true });
await tool("Text");
const b0 = await board();
await page.mouse.click(b0.x + 520, b0.y + 460);
await sleep(150);
await page.keyboard.type("Notes");
await page.keyboard.press("Escape");

await waitStatus(/Saved here.*Synced/);
let els = elementsIn(id);
const types = els.map((e) => `${e.type}${e.brush ? ":" + e.brush : ""}${e.arrow ? ":arrow" : ""}`);
check(
  "every tool produced its element",
  JSON.stringify(types) ===
    JSON.stringify(["stroke:ink", "stroke:marker", "stroke:highlighter", "rect", "ellipse", "line:arrow", "text"]),
  types.join(","),
);
check("shapes are sketchy (rough.js seed saved)", !!els.find((e) => e.type === "rect")?.sketch?.seed);
check("arrow snapped flat with Shift", (() => { const l = els.find((e) => e.type === "line"); return l && l.y1 === l.y2; })());
check("text saved with handwriting font", els.find((e) => e.type === "text")?.text === "Notes" && els.find((e) => e.type === "text")?.font === "hand");
let idb = await idbOps(id);
check("synced changes leave nothing waiting in the browser", idb.outbox.length === 0, idb.outbox.join(","));

// ------------------------------------------------------------ select, move, delete
await tool("Select");
await page.mouse.click(b0.x + 500, b0.y + 230); // left edge of the rectangle
await sleep(200);
const rect0 = els.find((e) => e.type === "rect");
await offline(true);
await drag([[500, 230], [560, 290]], { steps: 10 });
await waitFor(async () => (await idbOps(id)).outbox.length === 1, 4000);
idb = await idbOps(id);
check("a move is kept in the browser as one change to that shape", idb.outbox.join(",") === "set", idb.outbox.join(","));
await page.keyboard.press("Delete");
await waitFor(async () => (await idbOps(id)).outbox.length === 2, 4000);
idb = await idbOps(id);
check("a delete is kept as a removal until the server has it", idb.outbox.at(-1) === "del", idb.outbox.join(","));
await offline(false);
await page.keyboard.down("Control");
await page.keyboard.press("s");
await page.keyboard.up("Control");
await waitFor(async () => (await idbOps(id)).outbox.length === 0, 10_000);
await waitStatus(/Saved here.*Synced/);
els = elementsIn(id);
const moved = JSON.parse(sql(`select ops from drawing_changes where drawing_id='${id}' and ops->0->>'t' = 'set' order by version desc limit 1`) || "[]")[0]?.el;
check("drag moves the selected shape", moved && Math.round(moved.x - rect0.x) === 60 && Math.round(moved.y - rect0.y) === 60, `${rect0?.x},${rect0?.y} -> ${moved?.x},${moved?.y}`);
check("Delete removes it", !els.some((e) => e.type === "rect") && els.length === 6, `${els.length} left`);
check("the outbox empties once the server has the changes", (await idbOps(id)).outbox.length === 0);
await page.keyboard.down("Control");
await page.keyboard.press("z");
await page.keyboard.up("Control");
await waitStatus(/Synced/);
check("undo brings it back", elementsIn(id).some((e) => e.type === "rect"));

// stroke eraser removes whole items it touches
await tool("Eraser");
await drag([[280, 180], [340, 280]], { steps: 10 });
await waitStatus(/Synced/);
check("stroke eraser removes the red stroke", !elementsIn(id).some((e) => e.brush === "marker"));

// ------------------------------------------------------------ infinite canvas
const zoomLabel = () => page.$eval("button[aria-label='Zoom level']", (b) => b.textContent.trim());
const z0 = await zoomLabel();
await page.mouse.move(b0.x + 600, b0.y + 400);
await page.keyboard.down("Control");
await page.mouse.wheel({ deltaY: -200 });
await page.keyboard.up("Control");
await sleep(300);
const z1 = await zoomLabel();
check("Ctrl + wheel zooms", z0 === "100%" && z1 !== z0, `${z0} -> ${z1}`);
await page.click("button[aria-label='Zoom out']");
await page.click("button[aria-label='Zoom out']");
await sleep(200);
check("zoom buttons work", (await zoomLabel()) !== z1, await zoomLabel());

// The view's right edge before panning, in world units.
const camBefore = await page.evaluate((id) => JSON.parse(localStorage.getItem(`canvas-camera:${id}`) ?? "null"), id);
const rightEdgeBefore = camBefore.x + (await board()).w / camBefore.z;
await tool("Pan");
await drag([[900, 500], [100, 500]], { steps: 10 });
await drag([[900, 500], [100, 500]], { steps: 10 });
await tool("Pen");
await drag([[400, 300], [450, 330], [500, 300]]);
await waitStatus(/Synced/);
const far = elementsIn(id).at(-1);
const farX = far?.points?.[0];
const start = await page.evaluate((id) => JSON.parse(localStorage.getItem(`canvas-camera:${id}`) ?? "null"), id);
check("canvas keeps going past the first screen", farX > rightEdgeBefore + 200, `stroke at x=${farX}, view ended at ${Math.round(rightEdgeBefore)}`);
check("view (pan + zoom) remembered per drawing", start && start.x > camBefore.x + 1000 && start.z !== 1, JSON.stringify(start));

// fit everything back in view
await page.keyboard.down("Shift");
await page.keyboard.press("Digit1");
await page.keyboard.up("Shift");
await sleep(300);

// ------------------------------------------------------------ images
const before = elementsIn(id).length;
const dt = await makePng("3 + 4 = 8");
await page.evaluate((dt) => {
  document.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
}, dt);
await waitFor(async () => elementsIn(id).some((e) => e.type === "image"), 10000);
els = elementsIn(id);
const img = els.find((e) => e.type === "image");
check("pasted screenshot becomes an image element", !!img && els.length === before + 1);
idb = await idbOps(id);
check("image bytes kept in IndexedDB", idb.assets.some((a) => a.id === img?.assetId), JSON.stringify(idb.assets));
check("image uploaded to Postgres before the save", sql(`select count(*) from assets where id='${img?.assetId}'`) === "1");
await waitFor(async () => (await idbOps(id)).assets.find((a) => a.id === img?.assetId)?.uploaded === true, 4000);
check("local copy marked as uploaded", (await idbOps(id)).assets.find((a) => a.id === img?.assetId)?.uploaded === true);
const served = await page.evaluate(async (u) => {
  const r = await fetch(u);
  return { status: r.status, type: r.headers.get("content-type"), cache: r.headers.get("cache-control"), size: (await r.blob()).size };
}, `/api/assets/${img?.assetId}`);
check("asset served with long-lived caching", served.status === 200 && /^image\//.test(served.type) && /immutable/.test(served.cache), JSON.stringify(served));

const dt2 = await makePng("dropped", 300, 120);
const bb = await board();
await page.evaluate(
  (dt, x, y) => {
    const target = document.querySelector("[data-testid=board]");
    target.dispatchEvent(new DragEvent("dragover", { dataTransfer: dt, clientX: x, clientY: y, bubbles: true, cancelable: true }));
    target.dispatchEvent(new DragEvent("drop", { dataTransfer: dt, clientX: x, clientY: y, bubbles: true, cancelable: true }));
  },
  dt2,
  bb.x + 300,
  bb.y + 600,
);
await waitFor(async () => elementsIn(id).filter((e) => e.type === "image").length === 2, 10000);
check("dropped image file is added too", elementsIn(id).filter((e) => e.type === "image").length === 2);

// ------------------------------------------------------------ AI math check (lasso)
await page.keyboard.press("Escape"); // nothing selected: the button starts a lasso
await page.click("header button:has(> svg.lucide-sparkles)");
await sleep(200);
const hint = await page.$eval("p.pointer-events-none", (p) => p.textContent).catch(() => "");
check("Check math switches to the lasso", /loop around the math/.test(hint), hint);
// Loop around the pasted screenshot, using the camera the page saved.
await sleep(400);
const target = elementsIn(id).find((e) => e.type === "image");
const camNow = await page.evaluate((id) => JSON.parse(localStorage.getItem(`canvas-camera:${id}`)), id);
const toScreen = (x, y) => [(x - camNow.x) * camNow.z, (y - camNow.y) * camNow.z];
const [ax, ay] = toScreen(target.x - 10, target.y - 10);
const [bx, by] = toScreen(target.x + target.w + 10, target.y + target.h + 10);
await drag([[ax, ay], [bx, ay], [bx, by], [ax, by], [ax, ay + 2]], { steps: 6 });
const card = await page.waitForSelector("section[aria-label='Math check'] [data-ui=badge]", { timeout: 10000 }).then((el) => el.evaluate((n) => n.textContent)).catch(() => "");
check("AI verdict shown for the lassoed math", card === "Mistake found", card);
const cardText = await page.$eval("section[aria-label='Math check']", (s) => s.innerText).catch(() => "");
check("steps and correction rendered", /Step by step/.test(cardText) && /Should be/.test(cardText) && (await page.$$("section[aria-label='Math check'] .katex")).length >= 3);
const sent = JSON.parse(readFileSync("/tmp/mock-ai-last.json", "utf8"));
check("selection sent to the AI as an image", sent.imagePrefix.startsWith("data:image/png;base64,") && sent.imageLength > 2000 && sent.model === (process.env.AI_MODEL ?? "mock-vision"), JSON.stringify(sent));
const n0 = elementsIn(id).length;
await page.click("xpath/.//button[contains(., 'Add note to canvas')]");
await waitStatus(/Synced/);
const note = elementsIn(id).at(-1);
check("verdict can be added to the canvas as a note", elementsIn(id).length === n0 + 1 && note.type === "text" && note.color === "#c94736" && note.text.startsWith("✗"), note?.text?.slice(0, 40));

// ------------------------------------------------------------ offline, then reopen
await page.setRequestInterception(true);
const block = (req) => (req.method() === "POST" ? req.abort() : req.continue());
page.on("request", block);
await tool("Pen");
await drag([[300, 120], [340, 140], [380, 120]]);
await drag([[300, 160], [340, 180], [380, 160]]);
const failed = await waitStatus(/Saved here.*Sync failed/, 8000);
check("offline: still saved in the browser", /Saved here.*Sync failed/.test(failed), failed);
const countBefore = elementsIn(id).length;
page.off("request", block);
await page.setRequestInterception(false);
await page.close();
page = await browser.newPage();
watch(page);
await page.goto(`${BASE}/drawings/${id}`, { waitUntil: "load" });
const toast = await page.waitForSelector("[data-toast]", { timeout: 6000 }).then((t) => t.evaluate((n) => n.innerText)).catch(() => "");
check("reopening restores unsynced changes", /Restored 2 changes/.test(toast), toast);
await waitFor(async () => elementsIn(id).length === countBefore + 2, 8000);
check("restored changes reach Postgres", elementsIn(id).length === countBefore + 2);

// ------------------------------------------------------------ gallery after
// The preview is sent a couple of seconds after the last change settles.
await waitFor(async () => /^data:image/.test(sql(`select left(thumbnail, 22) from drawings where id='${id}'`)), 8000);
const thumb = sql(`select left(thumbnail, 22) from drawings where id='${id}'`);
check("thumbnail saved for the gallery", /^data:image\/(webp|png)/.test(thumb), thumb);
const bad = await page.evaluate(async () => (await fetch("/api/check-math", { method: "POST", body: "{}", headers: { "Content-Type": "application/json" } })).status);
check("check-math rejects a bad request", bad === 400);

// Expected: blocked POSTs while "offline", and the deliberate bad request above.
const real = errors.filter((e) => !/ERR_FAILED|Failed to fetch|net::ERR|400 \(Bad Request\)/.test(e));
console.log("\nerrors:", real.length ? real : "none");
await browser.close();
process.exit(failures ? 1 : 0);
