// Pen pressure, two-finger pinch/pan, and opening a version-1 drawing.
// Run against `npm start` like the other e2e scripts.
import puppeteer from "puppeteer-core";
import { execSync } from "node:child_process";
import nextEnv from "@next/env";

nextEnv.loadEnvConfig(process.cwd());
const { signUp } = await import("./helpers.mjs");

const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const CHROME = process.env.CHROME_PATH ?? "/usr/bin/google-chrome";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Queries go through stdin so JSON quotes need no shell escaping.
const sql = (q) => execSync(`psql "${process.env.DATABASE_URL}" -tA -q`, { input: q }).toString().trim();

let failures = 0;
function check(label, cond, extra = "") {
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}${extra ? `  (${extra})` : ""}`);
  if (!cond) failures++;
}

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--no-sandbox"] });
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 860, hasTouch: true });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const cdp = await page.createCDPSession();
const me = await signUp(page, { name: "Input Test" });
const status = () => page.$eval("[data-testid=storage-status]", (b) => b.innerText.replace(/\s+/g, " ").trim()).catch(() => "");
async function waitStatus(re, timeout = 15000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout && !re.test(await status())) await sleep(150);
  return status();
}
const board = () => page.$eval("[data-testid=board]", (c) => { const r = c.getBoundingClientRect(); return { x: r.x, y: r.y }; });
const zoom = () => page.$eval("button[aria-label='Zoom level']", (b) => b.textContent.trim());

// ---------------------------------------------------- version 1 drawing
const v1 = { version: 1, width: 1600, height: 1000, background: "#ffffff", elements: [
  { id: "a", type: "stroke", color: "#1c2430", size: 4, points: [100, 100, 200, 150, 300, 120] },
  { id: "b", type: "rect", color: "#d93a34", size: 4, fill: null, x: 400, y: 100, w: 200, h: 120 },
] };
const v1Id = sql(`insert into drawings (title, data, user_id) values ('Old drawing', '${JSON.stringify(v1)}', '${me.id}') returning id`).split("\n")[0];
// The editor keeps a live connection open: wait for "load", not an idle network.
await page.goto(`${BASE}/drawings/${v1Id}`, { waitUntil: "load" });
await waitStatus(/Saved here/);
check("version 1 drawing opens", (await page.$eval("[data-testid=board]", (c) => c.getAttribute("aria-label"))).includes("2 items"));

// ---------------------------------------------------- pen with pressure
const b = await board();
const penEvent = (type, x, y, force) =>
  cdp.send("Input.dispatchMouseEvent", { type, x: b.x + x, y: b.y + y, button: "left", buttons: type === "mouseReleased" ? 0 : 1, clickCount: 1, pointerType: "pen", force });
await penEvent("mousePressed", 200, 400, 0.2);
for (let i = 1; i <= 20; i++) await penEvent("mouseMoved", 200 + i * 15, 400 + Math.sin(i / 3) * 30, Math.min(1, 0.2 + i * 0.04));
await penEvent("mouseReleased", 500, 400, 0);
await waitStatus(/Synced/);
const stroke = JSON.parse(sql(`select data->'elements'->-1 from drawings where id='${v1Id}'`));
check("pen pressure recorded for ink", Array.isArray(stroke.pressures) && stroke.pressures.length === stroke.points.length / 2 && stroke.pressures.at(-1) > stroke.pressures[0], `${stroke.pressures?.[0]} → ${stroke.pressures?.at(-1)}`);
check("saving upgrades the drawing to version 2", sql(`select data->>'version' from drawings where id='${v1Id}'`) === "2");
check("old elements kept as they were", sql(`select data->'elements'->1->>'x' from drawings where id='${v1Id}'`) === "400");

// ---------------------------------------------------- two-finger pinch
const z0 = await zoom();
const touch = (type, pts) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: pts.map(([x, y], i) => ({ x: b.x + x, y: b.y + y, id: i + 1 })) });
await touch("touchStart", [[500, 400], [600, 400]]);
for (let i = 1; i <= 10; i++) await touch("touchMove", [[500 - i * 15, 400], [600 + i * 15, 400]]);
await touch("touchEnd", []);
await sleep(300);
const z1 = await zoom();
check("pinch zooms in", parseInt(z1) > parseInt(z0), `${z0} → ${z1}`);
const before = Number(sql(`select jsonb_array_length(data->'elements') from drawings where id='${v1Id}'`));
await sleep(1500);
check("pinching doesn't draw", Number(sql(`select jsonb_array_length(data->'elements') from drawings where id='${v1Id}'`)) === before);

console.log("\nerrors:", errors.length ? errors : "none");
sql(`delete from drawings where id='${v1Id}'`);
await browser.close();
process.exit(failures ? 1 : 0);
