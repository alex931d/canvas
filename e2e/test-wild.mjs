// Tricks, roaming and wild pandas, end to end: settings defaults and switches
// (buddy settings and the Settings page), a buddy's trick from its card (a
// sprint across the screen and back, a dance on the spot, reduced motion),
// walking all over a drawing, a wild panda turning up on a drawing, a battle
// played on the server and a catch that walks with you for good, running
// away (and closing mid-battle), wandering off when its time is up, the
// real chance of one turning up, a full party, the buddies page, and the
// API's checks. Run against `npm start`.
import puppeteer from "puppeteer-core";
import nextEnv from "@next/env";
import { randomUUID } from "node:crypto";

nextEnv.loadEnvConfig(process.cwd());
const { BASE, signUp, sql, sleep } = await import("./helpers.mjs");
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
    value = await fn();
    if (value) return value;
    await sleep(120);
  }
  return value;
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
page.on("console", (m) => {
  if (m.type() === "error" && !/status of (401|402|404|409|410|422|429)/.test(m.text())) errors.push(`console: ${m.text()}`);
});
// No hello bubble in the way.
await page.evaluateOnNewDocument(() => localStorage.setItem("buddy-greeted", new Date().toLocaleDateString("en-CA")));

const api = (path, init, p = page) =>
  p.evaluate(
    async (path, init) => {
      const res = await fetch(path, init);
      return { status: res.status, body: await res.json().catch(() => null) };
    },
    path,
    init,
  );
const post = (path, body, p = page) =>
  api(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }, p);
const put = (path, body) => api(path, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const settingsOf = (id) => JSON.parse(sql(`select settings from buddy_settings where user_id='${id}'`) || "null");
const setSettings = (id, s) =>
  sql(
    `insert into buddy_settings (user_id, settings) values ('${id}', '${JSON.stringify(s)}') on conflict (user_id) do update set settings = excluded.settings`,
  );
const newEncounter = (userId, { name = "Tofu", rarity = "common", ability = "nap", level = 6, stay = "3 minutes" } = {}) =>
  sql(
    `insert into buddy_encounters (user_id, name, rarity, ability, level, expires_at) values ('${userId}', '${name}', '${rarity}', '${ability}', ${level}, now() + interval '${stay}') returning id`,
  );
const encounterRow = (id) => sql(`select status, state->>'turn', state->'wild'->>'hp', state->'wild'->>'maxHp' from buddy_encounters where id='${id}'`).split("|");
const boxOf = (sel) =>
  page.$eval(sel, (el) => {
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  });
const attr = (sel, name) => page.$eval(sel, (el, name) => el.getAttribute(name), name).catch(() => null);
const bubble = () => page.$$eval(".buddy-bubble", (b) => b.map((x) => x.textContent).join(" / ")).catch(() => "");
const message = () => page.$eval("[data-testid=battle-message]", (e) => e.textContent).catch(() => "");
const clickButton = async (scope, label) => {
  const ok = await page.evaluate(
    (scope, label) => {
      const b = [...document.querySelectorAll(`${scope} button`)].find((x) => x.innerText.trim().startsWith(label));
      if (!b || b.disabled) return false;
      b.click();
      return true;
    },
    scope,
    label,
  );
  if (!ok) throw new Error(`no "${label}" button to press in ${scope}`);
};
/** Skip through the battle's steps until it wants a choice (or is over). */
async function settle(timeout = 30_000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    const state = await page.evaluate(() => {
      const m = document.querySelector("[data-testid=battle-message]")?.textContent ?? "";
      if (document.querySelector("[data-testid=battle-over]")) return "over";
      if (/^What will .* do\?$/.test(m) && document.querySelector("[data-testid=battle] [aria-label='Skip ahead']") === null) return "menu";
      if (m === "Who's next?" && !document.querySelector("[aria-label='Skip ahead']")) return "switch";
      document.querySelector("[aria-label='Skip ahead']")?.click();
      return null;
    });
    if (state) return state;
    await sleep(120);
  }
  return "timeout";
}
/** Put the wild panda on its last legs and your buddy back to full (server side), between turns. */
const wearDown = (id) =>
  sql(
    `update buddy_encounters set state = jsonb_set(jsonb_set(state, '{wild,hp}', '1'), array['you', state->>'active', 'hp'], state->'you'->(state->>'active')::int->'maxHp') where id='${id}'`,
  );
async function openDrawing() {
  await page.goto(`${BASE}/`, { waitUntil: "load" });
  await Promise.all([page.waitForNavigation({ waitUntil: "load" }), page.click("main form button[type=submit]")]);
  await page.waitForFunction(() => /^\/drawings\/[0-9a-f-]{36}$/.test(location.pathname), { timeout: 15_000 });
  await page.waitForSelector("[data-testid=board]");
  return page.url();
}
const inside = (b, a, pad = 1) => b.x >= a.x - pad && b.y >= a.y - pad && b.x + b.w <= a.x + a.w + pad && b.y + b.h <= a.y + a.h + pad;

// ------------------------------------------------------------ settings and defaults
const me = await signUp(page, { name: "Wren Okoye", buddies: true });
// A settings row from before tricks, roaming and wild pandas existed.
setSettings(me.id, { visible: true, wander: false, dailyGoal: 20, buddies: [{ id: "bao", name: "Bao", color: "#277c78", x: null, y: null }] });
let got = await api("/api/buddy");
check(
  "older settings get the new defaults: no roaming, tricks on, wild pandas on",
  got.body.settings.roam === false && got.body.settings.tricks === true && got.body.settings.wild === true,
  JSON.stringify(got.body.settings),
);
check("a new member starts with 5 bamboo", got.body.bamboo === 5, String(got.body.bamboo));
sql(`insert into study_events (user_id, kind, at) select '${me.id}', 'review', now() - interval '1 day' from generate_series(1, 300)`);
got = await api("/api/buddy");
check("300 points: level 6 and 35 bamboo", got.body.progress.level === 6 && got.body.bamboo === 35, `${got.body.progress.level} / ${got.body.bamboo}`);
check("level 6 is on their record too", sql(`select level from users where id='${me.id}'`) === "6");

// A caught rare panda that dances, out with Bao.
const juniper = sql(
  `insert into buddy_collection (user_id, name, rarity, ability, level) values ('${me.id}', 'Juniper', 'rare', 'dance', 5) returning id`,
);
const juniperId = `c${juniper.slice(0, 8)}`;
const party = [
  { id: "bao", name: "Bao", color: "#277c78", x: null, y: null },
  { id: juniperId, name: "Juniper", color: "#826cb0", x: null, y: null, catchId: juniper },
];
let saved = await put("/api/buddy", { ...got.body.settings, wander: false, buddies: party });
check("a caught panda can join the party", saved.status === 200, JSON.stringify(saved.body));

// ------------------------------------------------------------ tricks from the card
await page.goto(`${BASE}/`, { waitUntil: "load" });
await page.waitForSelector(`[data-buddy=${juniperId}]`, { timeout: 8000 });
check("a caught panda keeps its rarity", (await attr(`[data-buddy=${juniperId}]`, "data-rarity")) === "rare");
check("one you made yourself is common", (await attr("[data-buddy=bao]", "data-rarity")) === "common");
const home = await boxOf("[data-buddy=bao]");
await page.focus("[data-buddy=bao]");
await page.keyboard.press("Enter");
await page.waitForSelector("[role=dialog][aria-label=\"Bao: today's progress\"]", { timeout: 3000 });
const card = await page.$eval("[data-testid=buddy-kind]", (e) => e.innerText);
check("Bao's card shows its trick and rarity", /Sprint/.test(card) && /Common/.test(card) && /dashes across/.test(card), card.replace(/\s+/g, " "));
check("and the bamboo you have", (await page.$eval("[data-testid=buddy-bamboo]", (e) => e.textContent)) === "35");
await page.click("[data-testid=buddy-trick]");
check(
  "Show me: Bao breaks into a run",
  !!(await waitFor(async () => (await attr("[data-buddy=bao]", "data-pose")) === "run" && (await attr("[data-buddy=bao]", "data-moving")) === "run", 1500)),
);
await sleep(2300);
const across = await boxOf("[data-buddy=bao]");
check("…all the way to the other side of the screen", home.x > 1000 && across.x < 200, `${Math.round(home.x)} → ${Math.round(across.x)}`);
check("…then walks back", !!(await waitFor(async () => (await attr("[data-buddy=bao]", "data-moving")) === "walk", 6000)));
const back = await waitFor(async () => {
  const b = await boxOf("[data-buddy=bao]");
  return Math.abs(b.x - home.x) < 4 && Math.abs(b.y - home.y) < 4 && (await attr("[data-buddy=bao]", "data-moving")) === null ? b : null;
}, 16_000);
check("…to its own spot (it doesn't wander, so exactly there)", !!back, JSON.stringify(back));

await page.focus(`[data-buddy=${juniperId}]`);
await page.keyboard.press("Enter");
await page.waitForSelector("[role=dialog][aria-label=\"Juniper: today's progress\"]", { timeout: 3000 });
check("Juniper's card: Dance, Rare", /Dance[\s\S]*Rare/.test(await page.$eval("[data-testid=buddy-kind]", (e) => e.innerText)));
const jBefore = await boxOf(`[data-buddy=${juniperId}]`);
await page.click("[data-testid=buddy-trick]");
check("Show me: Juniper dances on the spot", !!(await waitFor(async () => (await attr(`[data-buddy=${juniperId}]`, "data-pose")) === "dance", 1500)));
const jDuring = await boxOf(`[data-buddy=${juniperId}]`);
check("…without going anywhere", Math.abs(jDuring.x - jBefore.x) < 2 && Math.abs(jDuring.y - jBefore.y) < 2);
check("…and stops after a few seconds", !!(await waitFor(async () => (await attr(`[data-buddy=${juniperId}]`, "data-pose")) === "idle", 6000)));

await page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "reduce" }]);
await page.focus("[data-buddy=bao]");
await page.keyboard.press("Enter");
await page.waitForSelector("[data-testid=buddy-trick]", { timeout: 3000 });
await page.click("[data-testid=buddy-trick]");
await sleep(700);
const still = await boxOf("[data-buddy=bao]");
check(
  "with reduced motion, a sprint is shown on the spot",
  (await attr("[data-buddy=bao]", "data-pose")) === "run" && Math.abs(still.x - home.x) < 2,
  `${await attr("[data-buddy=bao]", "data-pose")} at ${Math.round(still.x)}`,
);
await page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "no-preference" }]);
await sleep(1200);

// ------------------------------------------------------------ the switches
async function openBuddySettings() {
  const trigger = await page.waitForSelector("aside [data-ui=menu-trigger]", { timeout: 5000 });
  await trigger.click();
  const item = await page.waitForSelector("xpath/.//*[@role='menuitem'][contains(., 'Study buddies')]", { timeout: 3000 });
  await item.click();
  await page.waitForSelector("[role=dialog] h2", { timeout: 3000 });
  await sleep(300);
}
const switchByLabel = (label) =>
  page.evaluateHandle(
    (label) => [...document.querySelectorAll("[role=dialog] label")].find((l) => l.innerText.trim().startsWith(label))?.querySelector("[role=switch]"),
    label,
  );
await openBuddySettings();
const labels = await page.$$eval("[role=dialog] label", (ls) => ls.map((l) => l.innerText.split("\n")[0].trim()));
check(
  "buddy settings: show, wander, walk on drawings, tricks, wild pandas, then the goal",
  labels.slice(0, 6).join(" / ") === "Show study buddies / Let them wander about / Walk on drawings / Do their tricks / Wild pandas on drawings / Daily goal",
  labels.join(" / "),
);
check("walking on drawings needs wandering", await (await switchByLabel("Walk on drawings")).evaluate((s) => s.disabled));
await (await switchByLabel("Let them wander about")).click();
await sleep(200);
await (await switchByLabel("Walk on drawings")).click();
await sleep(900);
let s = settingsOf(me.id);
check("turning on wandering and walking on drawings is saved", s.wander === true && s.roam === true, JSON.stringify(s).slice(0, 120));
await page.keyboard.press("Escape");
await waitFor(async () => !(await page.$("[role=dialog]")), 2000);

// ------------------------------------------------------------ out on the canvas
await openDrawing();
await page.waitForSelector("[data-buddy-stage] [data-testid=buddy]", { timeout: 8000 });
check(
  "with Walk on drawings, they climb onto the canvas itself (inside the board, not over the app)",
  (await page.$$("[data-buddy-stage] [data-testid=buddy]")).length === 2 && (await page.$$(".buddy-layer [data-testid=buddy]")).length === 0,
);
const stage = await boxOf("[data-buddy-stage]");
/** Each panda as drawn (its visual box), where its feet are on the drawing, its pose and whether it's moving. */
const pandas = () =>
  page.$$eval("[data-buddy-stage] [data-testid=buddy]", (els) =>
    els.map((e) => {
      const r = e.querySelector(".buddy-fit").getBoundingClientRect();
      const [fx, fy] = e.dataset.feet.split(",").map(Number);
      return { id: e.dataset.buddy, x: r.x, y: r.y, w: r.width, h: r.height, fx, fy, pose: e.dataset.pose, moving: e.dataset.moving ?? null };
    }),
  );
const firstFeet = Object.fromEntries((await pandas()).map((b) => [b.id, { x: b.fx, y: b.fy }]));
let walked = false;
let roamed = 0;
let outside = 0;
let clashes = 0;
for (let i = 0; i < 40 && !(walked && roamed > 0 && i > 20); i++) {
  await sleep(400);
  for (const b of await pandas()) {
    if (b.moving === "walk") walked = true;
    if (b.moving && b.moving !== "instant" && !["walk", "run", "roll"].includes(b.pose)) clashes++;
    if (!inside(b, stage, 2)) outside++;
    if (Math.hypot(b.fx - firstFeet[b.id].x, b.fy - firstFeet[b.id].y) > 120) roamed++;
  }
}
check("they walk about on the drawing", walked && roamed > 0, `walked ${walked}, roamed ${roamed}`);
check("…staying on the part in view", outside === 0, String(outside));
check("…and never nap, snack or dance on the move", clashes === 0, String(clashes));

// Touched mid-walk: it stops, and its trick happens standing still.
const mover = await waitFor(async () => (await pandas()).find((b) => b.moving === "walk" && b.id === juniperId), 15_000);
if (mover) {
  await page.focus(`[data-buddy=${juniperId}]`);
  await page.keyboard.press("Enter");
  await sleep(100);
  check("pressing a walking panda stops it", (await attr(`[data-buddy=${juniperId}]`, "data-moving")) === null);
  await page.waitForSelector("[data-testid=buddy-trick]", { timeout: 3000 });
  await page.click("[data-testid=buddy-trick]");
  await sleep(300);
  const d1 = (await pandas()).find((b) => b.id === juniperId);
  await sleep(1200);
  const d2 = (await pandas()).find((b) => b.id === juniperId);
  check(
    "its dance happens on the spot",
    d1.pose === "dance" && d2.pose === "dance" && d2.moving === null && Math.abs(d1.x - d2.x) < 1 && Math.abs(d1.y - d2.y) < 1,
    `${d1.pose}/${d2.pose} ${Math.round(d1.x)}→${Math.round(d2.x)}`,
  );
} else check("pressing a walking panda stops it", false, "Juniper never walked");

// Part of the drawing: standing still (reduced motion), they pan and zoom with it and keep their spots.
await page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "reduce" }]);
await sleep(4500);
const board = await boxOf("[data-testid=board]");
await page.mouse.move(board.x + board.w / 2, board.y + board.h / 2);
const zoomNow = () => page.$eval("[data-testid=buddy-world]", (el) => new DOMMatrixReadOnly(getComputedStyle(el).transform).a);
const sameFeet = (a, b) => a.every((x, i) => x.fx === b[i].fx && x.fy === b[i].fy);
/** How far (px) any panda is drawn from where its spot on the drawing is on screen, with the camera as it is. */
const offSpot = () =>
  page.evaluate(() => {
    const world = document.querySelector("[data-testid=buddy-world]");
    const m = new DOMMatrixReadOnly(getComputedStyle(world).transform);
    const stageRect = document.querySelector("[data-buddy-stage]").getBoundingClientRect();
    return Math.max(
      ...[...document.querySelectorAll("[data-buddy-stage] [data-testid=buddy]")].map((e) => {
        const [fx, fy] = e.dataset.feet.split(",").map(Number);
        const r = e.querySelector(".buddy-fit").getBoundingClientRect();
        const sx = stageRect.left + fx * m.a + m.e;
        const sy = stageRect.top + fy * m.a + m.f;
        return Math.hypot(r.x + r.width / 2 - sx, r.y + r.height - sy);
      }),
    );
  });
const wheelZoom = async (delta, times) => {
  await page.keyboard.down("Control");
  for (let i = 0; i < times; i++) await page.mouse.wheel({ deltaY: delta });
  await page.keyboard.up("Control");
  await sleep(400);
};
const p0 = await pandas();
await page.mouse.wheel({ deltaY: 150 });
await sleep(400);
const p1 = await pandas();
const z1 = await zoomNow();
check(
  "scrolling the drawing carries them with it",
  p0.every((b, i) => Math.abs(b.y - p1[i].y - 150) < 2 && Math.abs(b.x - p1[i].x) < 2) && sameFeet(p0, p1),
  p0.map((b, i) => `${Math.round(b.y)}→${Math.round(p1[i].y)}`).join(" "),
);
await wheelZoom(-60, 2);
const p2 = await pandas();
const z2 = await zoomNow();
check(
  "zooming in makes them exactly as much bigger as the drawing, on the same spot",
  z2 > z1 * 1.3 && p2.every((b, i) => Math.abs(b.w / p1[i].w - z2 / z1) < 0.03) && sameFeet(p1, p2),
  `zoom ×${(z2 / z1).toFixed(2)}, pandas ×${p2.map((b, i) => (b.w / p1[i].w).toFixed(2)).join(" ×")}`,
);
await wheelZoom(60, 6);
const p3 = await pandas();
const z3 = await zoomNow();
check(
  "zooming far out makes them just as much smaller (no minimum size)",
  z3 < z1 * 0.6 && p3.every((b, i) => Math.abs(b.w / p1[i].w - z3 / z1) < 0.03) && sameFeet(p1, p3),
  `zoom ×${(z3 / z1).toFixed(2)}, pandas ×${p3.map((b, i) => (b.w / p1[i].w).toFixed(2)).join(" ×")}`,
);
await sleep(3000);
check("left there a while, they don't go anywhere", sameFeet(p1, await pandas()));
await wheelZoom(-60, 4);
const off1 = await offSpot();
check("zooming back in, each is drawn right on its spot", sameFeet(p1, await pandas()) && off1 < 2.5, `${off1.toFixed(2)} px off`);
for (let i = 0; i < 8; i++) await page.mouse.wheel({ deltaX: 400 });
await sleep(3000);
check("panning far away leaves them in their spots on the drawing", sameFeet(p1, await pandas()) && (await pandas()).every((b) => !inside(b, stage)));
for (let i = 0; i < 8; i++) await page.mouse.wheel({ deltaX: -400 });
await sleep(400);
const off2 = await offSpot();
check("…still there when you pan back, right on their spots", sameFeet(p1, await pandas()) && off2 < 2.5, `${off2.toFixed(2)} px off`);
await sleep(600);
await page.reload({ waitUntil: "load" });
await page.waitForSelector("[data-buddy-stage] [data-testid=buddy]", { timeout: 8000 });
await sleep(1200);
check("and after a reload, each is where you left it", sameFeet(p1, await pandas()), JSON.stringify((await pandas()).map((b) => [b.fx, b.fy])));
await page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "no-preference" }]);
// Back to the usual view for what follows.
await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith("canvas-camera:")).forEach((k) => localStorage.removeItem(k)));

// ------------------------------------------------------------ keeping off the drawing
await page.reload({ waitUntil: "load" });
await page.waitForSelector("[data-buddy-stage] [data-testid=buddy]", { timeout: 8000 });
await sleep(1500);
const drawingId = page.url().split("/drawings/")[1];
/** The camera, read off the layer the pandas live in. */
const camera = () =>
  page.$eval("[data-testid=buddy-world]", (el) => {
    const m = new DOMMatrixReadOnly(getComputedStyle(el).transform);
    return { z: m.a, x: -m.e / m.a, y: -m.f / m.a };
  });
const stageBox = await boxOf("[data-buddy-stage]");
const cam0 = await camera();
const toWorld = (cam, sx, sy) => ({ x: cam.x + (sx - stageBox.x) / cam.z, y: cam.y + (sy - stageBox.y) / cam.z });
const viewW = stageBox.w / cam0.z;
const viewH = stageBox.h / cam0.z;
const shape = (type, x, y, w, h) => ({ id: randomUUID(), type, color: "#201f24", size: 3, fill: null, x, y, w, h });
// A big box in the middle and an ellipse to the right, with paper round them.
const drawn = [
  shape("rect", cam0.x + viewW * 0.3, cam0.y + viewH * 0.25, viewW * 0.25, viewH * 0.45),
  shape("ellipse", cam0.x + viewW * 0.66, cam0.y + viewH * 0.2, viewW * 0.16, viewH * 0.3),
];
const addShapes = (els) =>
  api(`/api/drawings/${drawingId}/changes`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ clientId: "wild-test-keepoff", batches: [{ id: randomUUID(), ops: els.map((el) => ({ t: "add", el })) }] }),
  });
const added = await addShapes(drawn);
check("shapes drawn on the drawing", added.status === 200, String(added.status));
await sleep(1200);
/** Pandas whose body (a little inside their box, as they plan it) is over one of `shapes`, right now. */
const overDrawing = async (shapes) => {
  const cam = await camera();
  const bodies = await page.$$eval("[data-buddy-stage] [data-testid=buddy]", (els) =>
    els.map((e) => {
      const r = e.querySelector(".buddy-fit").getBoundingClientRect();
      return { id: e.dataset.buddy, x: r.x + r.width * 0.11, y: r.y + r.height * 0.08, x2: r.x + r.width * 0.89, y2: r.y + r.height };
    }),
  );
  return bodies.filter((b) => {
    const a = toWorld(cam, b.x + 1, b.y + 1);
    const c = toWorld(cam, b.x2 - 1, b.y2 - 1);
    return shapes.some((s) => a.x < s.x + s.w + 2.5 && s.x - 2.5 < c.x && a.y < s.y + s.h + 2.5 && s.y - 2.5 < c.y);
  }).map((b) => b.id);
};
check("buddies standing on new shapes step off them", !!(await waitFor(async () => (await overDrawing(drawn)).length === 0, 9000)), (await overDrawing(drawn)).join());
let over = 0;
let wandered = false;
for (let i = 0; i < 40; i++) {
  await sleep(350);
  if ((await overDrawing(drawn)).length) over++;
  if ((await pandas()).some((b) => b.moving === "walk")) wandered = true;
}
check("walking about, they never set foot on what's drawn", over === 0 && wandered, `over ${over}, walked ${wandered}`);
// A sprint across: the way round, never over the shapes.
await page.focus("[data-buddy=bao]");
await page.keyboard.press("Enter");
await page.waitForSelector("[data-testid=buddy-trick]", { timeout: 3000 });
await page.click("[data-testid=buddy-trick]");
let ran = false;
let overWhileRunning = 0;
for (let i = 0; i < 30; i++) {
  await sleep(100);
  if ((await attr("[data-buddy=bao]", "data-moving")) === "run") ran = true;
  if ((await overDrawing(drawn)).includes("bao")) overWhileRunning++;
}
check("Bao's sprint goes round the shapes", ran && overWhileRunning === 0, `ran ${ran}, over ${overWhileRunning}`);
// Draw a box right where a panda stands: it steps aside.
await waitFor(async () => (await pandas()).every((b) => !b.moving), 12_000);
const target = (await pandas())[0];
const cam1 = await camera();
const feetAt = toWorld(cam1, target.x + target.w / 2, target.y + target.h);
const onTop = shape("rect", feetAt.x - 60 / cam1.z, feetAt.y - 110 / cam1.z, 120 / cam1.z, 140 / cam1.z);
await addShapes([onTop]);
check(
  "drawing over a panda makes it step aside",
  !!(await waitFor(async () => !(await overDrawing([onTop])).includes(target.id), 8000)),
  target.id,
);
drawn.push(onTop);
// Put one down on a shape: it hops off.
const boxShape = drawn[0];
// After all that panning and zooming, Bao's patch may be partly out of view (it
// stays on its spot on the drawing): pan so Bao and the shape are both well in view.
{
  await waitFor(async () => !(await attr("[data-buddy=bao]", "data-moving")), 12_000);
  const b = await boxOf("[data-buddy=bao] .buddy-fit");
  const c = await camera();
  const shapeAt = { x: stageBox.x + (boxShape.x + boxShape.w / 2 - c.x) * c.z, y: stageBox.y + (boxShape.y + boxShape.h / 2 - c.y) * c.z };
  const mid = { x: (b.x + b.w / 2 + shapeAt.x) / 2, y: (b.y + b.h / 2 + shapeAt.y) / 2 };
  const centre = { x: stageBox.x + stageBox.w / 2, y: stageBox.y + stageBox.h / 2 + 40 };
  await page.mouse.move(centre.x, centre.y);
  await page.mouse.wheel({ deltaX: mid.x - centre.x, deltaY: mid.y - centre.y });
  await sleep(600);
}
// Grab Bao when it's standing still, by a part of it nothing's in front of
// (it may be standing partly under the board's tool bars).
const grab = await waitFor(
  () =>
    page.evaluate(() => {
      const el = document.querySelector("[data-buddy=bao]");
      if (!el || el.dataset.moving) return null;
      const r = el.querySelector(".buddy-fit").getBoundingClientRect();
      for (const fy of [0.6, 0.75, 0.45, 0.9, 0.3]) {
        for (const fx of [0.5, 0.35, 0.65]) {
          const x = r.x + r.width * fx;
          const y = r.y + r.height * fy;
          if (document.elementFromPoint(x, y)?.closest("[data-buddy]") === el) return { x, y };
        }
      }
      return null;
    }),
  15_000,
);
const camD = await camera();
const dropAt = { x: stageBox.x + (boxShape.x + boxShape.w / 2 - camD.x) * camD.z, y: stageBox.y + (boxShape.y + boxShape.h * 0.6 - camD.y) * camD.z };
const baoBox = await boxOf("[data-buddy=bao] .buddy-fit");
const from = grab ?? { x: baoBox.x + baoBox.w / 2, y: baoBox.y + baoBox.h / 2 };
await page.mouse.move(from.x, from.y);
await page.mouse.down();
await page.mouse.move(from.x + 10, from.y + 4, { steps: 2 });
await page.mouse.move(dropAt.x, dropAt.y, { steps: 12 });
await page.mouse.up();
await sleep(200);
const afterDrop = await boxOf("[data-buddy=bao] .buddy-fit");
check(
  "a panda put down on a shape…",
  (await overDrawing(drawn)).includes("bao"),
  `from ${Math.round(baoBox.x)},${Math.round(baoBox.y)} to ${Math.round(dropAt.x)},${Math.round(dropAt.y)}: at ${Math.round(afterDrop.x)},${Math.round(afterDrop.y)} ${afterDrop.w}x${afterDrop.h}; shape ${JSON.stringify([boxShape.x, boxShape.y, boxShape.w, boxShape.h].map(Math.round))} cam ${JSON.stringify(camD)} pose ${await attr("[data-buddy=bao]", "data-pose")}`,
);
check("…hops off it", !!(await waitFor(async () => !(await overDrawing(drawn)).includes("bao"), 8000)));
// Clear the drawing for what follows.
await api(`/api/drawings/${drawingId}/changes`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ clientId: "wild-test-keepoff", batches: [{ id: randomUUID(), ops: drawn.map((el) => ({ t: "del", id: el.id })) }] }),
});

// ------------------------------------------------------------ a wild panda turns up
const tofu = newEncounter(me.id, { name: "Tofu", rarity: "common", ability: "nap", level: 6 });
await page.reload({ waitUntil: "load" });
await page.waitForSelector("[data-testid=board]");
const wildEl = await page.waitForSelector("[data-testid=wild-panda]", { timeout: 10_000 }).catch(() => null);
check("a wild panda turns up on the drawing", !!wildEl);
check(
  "it says what it is, not who",
  (await attr("[data-testid=wild-panda]", "aria-label")) === "A panda is wandering on your drawing (level 6). Press to battle it.",
  await attr("[data-testid=wild-panda]", "aria-label"),
);
check("a buddy points it out", !!(await waitFor(async () => /wild panda|visitor|wandered onto/i.test(await bubble()), 4000)), await bubble());
await sleep(2500);
check("it's on the canvas too, wandering about the part in view", !!(await page.$("[data-buddy-stage] [data-testid=wild-panda]")) && inside(await boxOf("[data-testid=wild-panda] .buddy-fit"), await boxOf("[data-buddy-stage]"), 2));

// ------------------------------------------------------------ the battle
await page.$eval("[data-testid=wild-panda]", (b) => b.click());
await page.waitForSelector("[data-testid=battle]", { timeout: 5000 });
check("pressing it starts a battle", !!(await waitFor(async () => /wanders up: it's Tofu!/.test(await message()), 4000)), await message());
check("the server keeps the battle", encounterRow(tofu)[0] === "battle");
check("Bao goes first", (await settle()) === "menu" && (await message()) === "What will Bao do?", await message());
const wildCard = await page.$eval("[data-testid=wild-status]", (e) => e.innerText);
check("the wild panda's card: name and level", /Tofu/.test(wildCard) && /Lv\. 6/.test(wildCard), wildCard.replace(/\s+/g, " "));
check("yours shows energy as numbers", /^\d+ \/ \d+$/.test(await page.$eval("[data-testid=your-status-hp]", (e) => e.textContent)));
await clickButton("[data-testid=battle]", "Fight");
const moveNames = await page.$$eval("[aria-label=Moves] button", (bs) => bs.map((b) => b.innerText.split("\n")[0].trim()));
check("four moves, the last Bao's own (Dash)", moveNames.join(",") === "Bump,Paw swipe,Stare,Dash", moveNames.join(","));
await clickButton("[aria-label=Moves]", "Bump");
check("Bao used Bump", !!(await waitFor(async () => /Bao used Bump!|Tofu used/.test(await message()), 4000)), await message());
await settle();
// (Tofu may nap the bump off again, so the energy left is whatever the server says.)
let [, turn, hp, maxHp] = encounterRow(tofu);
check("the turn was played on the server", turn === "1" && Number(hp) <= Number(maxHp), `turn ${turn}, ${hp}/${maxHp}`);
const meterHp = await page.$eval("[data-testid=wild-status] [role=meter]", (m) => m.getAttribute("aria-valuenow"));
check("…and the energy bar shows what the server says", meterHp === hp, `${meterHp} vs ${hp}`);
let r = await post("/api/buddy/battle", { id: tofu, turn: 0, action: { type: "move", move: "bump" } });
check("a turn already played is refused (another tab)", r.status === 409, `${r.status} ${r.body?.error}`);
r = await post("/api/buddy/battle", { id: tofu, turn: 1, action: { type: "switch", to: 0 } });
check("sending out the buddy already out is refused", r.status === 422, `${r.status} ${r.body?.error}`);
r = await post("/api/buddy/battle", { id: tofu, turn: 1, action: { type: "fly" } });
check("something that isn't a battle action is refused", r.status === 422);

const bambooBefore = (await api("/api/buddy")).body.bamboo;
let offers = 0;
let outcome = "menu";
for (let i = 0; i < 12 && outcome !== "over"; i++) {
  wearDown(tofu);
  await clickButton("[data-testid=battle]", "Bamboo");
  offers++;
  if (i === 0) check("offering bamboo", !!(await waitFor(async () => /You offer Tofu some bamboo/.test(await message()), 4000)), await message());
  outcome = await settle();
}
const result = await attr("[data-testid=battle-over]", "data-outcome");
check("a worn-out panda takes the bamboo", result === "caught", `${result} after ${offers}`);
check("…and says it's walking with you", /Walking with you now/.test(await page.$eval("[data-testid=battle-over]", (e) => e.innerText)));
const kept = sql(`select name, rarity, ability, level from buddy_collection where user_id='${me.id}' and name='Tofu'`);
check("it's in your collection for good", kept === "Tofu|common|nap|6", kept);
s = settingsOf(me.id);
const tofuBuddy = s.buddies.find((b) => b.catchId && b.name === "Tofu");
check("and out with you (there was room)", s.buddies.length === 3 && !!tofuBuddy, JSON.stringify(s.buddies.map((b) => b.name)));
check("the bamboo offered is spent", (await api("/api/buddy")).body.bamboo === bambooBefore - offers);
check("caught counted", sql(`select caught from buddy_stats where user_id='${me.id}'`) === "1");
check("the encounter is over", encounterRow(tofu)[0] === "caught");
await clickButton("[data-testid=battle-over]", "Done");
check("Done closes the battle", !!(await waitFor(async () => !(await page.$("[data-testid=battle]")), 3000)));
check("the wild panda is gone from the drawing", !(await page.$("[data-testid=wild-panda]")));
check("Tofu walks with you now", !!(await waitFor(() => page.$(`[data-buddy=${tofuBuddy.id}][data-rarity=common]`), 4000)));
check("and says hello", !!(await waitFor(async () => /Hi, I'm Tofu!/.test(await bubble()), 4000)), await bubble());

// ------------------------------------------------------------ running away
const pip = newEncounter(me.id, { name: "Pip", rarity: "rare", ability: "roll", level: 7 });
await page.reload({ waitUntil: "load" });
await page.waitForSelector("[data-testid=wild-panda][data-rarity=rare]", { timeout: 10_000 });
check("a rare one says so", /^A rare panda is wandering/.test(await attr("[data-testid=wild-panda]", "aria-label")));
await page.$eval("[data-testid=wild-panda]", (b) => b.click());
await page.waitForSelector("[data-testid=battle]", { timeout: 5000 });
check("its card says Rare", !!(await waitFor(async () => /Rare/.test(await page.$eval("[data-testid=wild-status]", (e) => e.innerText).catch(() => "")), 3000)));
await settle();
await clickButton("[data-testid=battle]", "Run");
await settle();
check("Run: you slip away", (await attr("[data-testid=battle-over]", "data-outcome")) === "ran" && (await message()) === "You slipped away.");
await clickButton("[data-testid=battle-over]", "Done");
check("…and it wanders off the drawing", !!(await waitFor(async () => !(await page.$("[data-testid=wild-panda]")), 14_000)));
check("the server agrees", encounterRow(pip)[0] === "ran");

const maple = newEncounter(me.id, { name: "Maple", rarity: "uncommon", ability: "cheer", level: 6 });
await page.reload({ waitUntil: "load" });
await page.waitForSelector("[data-testid=wild-panda][data-rarity=uncommon]", { timeout: 10_000 });
await page.$eval("[data-testid=wild-panda]", (b) => b.click());
await page.waitForSelector("[data-testid=battle]", { timeout: 5000 });
await settle();
await page.keyboard.press("Escape");
check("closing a battle part-way is running away", !!(await waitFor(() => encounterRow(maple)[0] === "ran", 4000)), encounterRow(maple)[0]);

// ------------------------------------------------------------ wandering off
const fig = newEncounter(me.id, { name: "Fig", stay: "7 seconds" });
await page.reload({ waitUntil: "load" });
check("one that isn't battled…", !!(await page.waitForSelector("[data-testid=wild-panda]", { timeout: 8000 }).catch(() => null)));
check("…wanders off when its time is up", !!(await waitFor(async () => !(await page.$("[data-testid=wild-panda]")), 20_000)));
r = await post("/api/buddy/wild", {});
check("and the server tidies it away", r.status === 200 && r.body.wild === null && encounterRow(fig)[0] === "gone", `${r.status} ${JSON.stringify(r.body)} ${encounterRow(fig)[0]}`);

// ------------------------------------------------------------ the real chance
// Off the drawing, so the page itself isn't asking too.
await page.goto(`${BASE}/buddies`, { waitUntil: "load" });
let found = null;
let tries = 0;
for (; tries < 14 && !found; tries++) {
  sql(`update buddy_stats set last_wild_at = now() - interval '10 minutes' where user_id='${me.id}'`);
  const res = await post("/api/buddy/wild", {});
  if (res.status === 429) {
    await sleep(10_500); // asked a lot today: wait for the next go
    tries--;
    continue;
  }
  found = res.body?.wild ?? null;
}
check("with the wait over, one turns up now and then", !!found, `${tries} tries`);
check("…of a rarity you can meet at level 6", !!found && ["common", "uncommon", "rare"].includes(found.rarity), found?.rarity);
const stay = found ? new Date(found.expiresAt).getTime() - Date.now() : 0;
check("…staying about three minutes", stay > 170_000 && stay <= 181_000, String(stay));
r = await post("/api/buddy/wild", {});
check("asking again finds the same one", r.body?.wild?.id === found?.id);
sql(`update buddy_encounters set status = 'gone' where user_id='${me.id}' and status in ('wild', 'battle')`);
sql(`update buddy_stats set last_wild_at = now() where user_id='${me.id}'`);
r = await post("/api/buddy/wild", {});
check("none again until the wait is over", r.body?.wild === null);

// ------------------------------------------------------------ the rules admins set
const setRules = (rules) =>
  rules
    ? sql(
        `insert into site_settings (key, value) values ('wild_pandas', '${JSON.stringify(rules)}') on conflict (key) do update set value = excluded.value`,
      )
    : sql(`delete from site_settings where key = 'wild_pandas'`);
/** Asks the server for a wild panda, waiting out the rate limit if need be. */
async function askWild() {
  for (let i = 0; i < 4; i++) {
    const res = await post("/api/buddy/wild", {});
    if (res.status !== 429) return res;
    await sleep(10_500);
  }
  return { status: 429, body: null };
}
setRules({ on: false });
sql(`update buddy_stats set last_wild_at = now() - interval '10 minutes' where user_id='${me.id}'`);
r = await askWild();
check("switched off for everyone: none turn up", r.status === 200 && r.body?.wild === null, JSON.stringify(r.body));
check(
  "…without using up the wait",
  sql(`select last_wild_at < now() - interval '9 minutes' from buddy_stats where user_id='${me.id}'`) === "t",
);
check("…and the buddies are told", (await api("/api/buddy")).body?.wild?.on === false);
// Only golden pandas, from level 1, every time, for a minute; easy to catch and never running off.
setRules({
  chance: 1,
  gapMinutes: 2,
  stayMinutes: 1,
  kinds: { common: { weight: 0 }, uncommon: { weight: 0 }, rare: { weight: 0 }, superRare: { minLevel: 1, catchRate: 0.9, flee: 0 } },
});
sql(`update buddy_stats set last_wild_at = now() - interval '90 seconds' where user_id='${me.id}'`);
r = await askWild();
check("a 2-minute wait isn't over after 90 seconds", r.body?.wild === null, JSON.stringify(r.body));
sql(`update buddy_stats set last_wild_at = now() - interval '3 minutes' where user_id='${me.id}'`);
r = await askWild();
const golden = r.body?.wild ?? null;
check("at a 100 % chance, one turns up as soon as the wait is over", !!golden, JSON.stringify(r.body));
check("…of the only kind set to turn up", golden?.rarity === "superRare", golden?.rarity);
const goldenStay = golden ? new Date(golden.expiresAt).getTime() - Date.now() : 0;
check("…staying the minute it's set to", goldenStay > 50_000 && goldenStay <= 61_000, String(goldenStay));
const goldenBattle = golden ? await post("/api/buddy/battle", { id: golden.id, action: "start" }) : null;
check(
  "a battle with it plays by the numbers set",
  goldenBattle?.status === 200 && goldenBattle.body.battle.rates?.catchRate === 0.9 && goldenBattle.body.battle.rates?.flee === 0,
  JSON.stringify(goldenBattle?.body?.battle?.rates),
);
await page.reload({ waitUntil: "load" });
await page.waitForSelector("[data-testid=guide-rarity]");
const guideNow = await page.$$eval("[data-testid=guide-rarity]", (els) =>
  els.map((e) => (e.textContent.trim().endsWith("Not turning up for now") ? "never" : e.dataset.open === "true" ? "open" : "later")),
);
const catching = await page.$eval("#guide-title", (h) => h.closest("section").textContent);
check(
  "the field guide follows them",
  guideNow.join() === "never,never,never,open" && catching.includes("It stays a minute; press it to battle."),
  `${guideNow.join(" | ")} | ${catching.match(/Now and then[^.]*\.[^.]*\./)?.[0]}`,
);
sql(`update buddy_encounters set status = 'gone' where user_id='${me.id}' and status in ('wild', 'battle')`);
setRules(null);
sql(`update buddy_stats set last_wild_at = now() where user_id='${me.id}'`);

// ------------------------------------------------------------ a full party
const soba = newEncounter(me.id, { name: "Soba", rarity: "common", ability: "snack", level: 5 });
let reply = await post("/api/buddy/battle", { id: soba, action: "start" });
check("the API starts a battle", reply.status === 200 && reply.body.battle.turn === 0 && reply.body.steps.length === 2, String(reply.status));
r = await post("/api/buddy/battle", { id: soba, action: "start" });
check("…once", r.status === 409, String(r.status));
let caughtReply = null;
for (let i = 0; i < 12 && !caughtReply; i++) {
  wearDown(soba);
  const t = Number(encounterRow(soba)[1]);
  reply = await post("/api/buddy/battle", { id: soba, turn: t, action: { type: "bamboo" } });
  if (reply.body?.battle?.mustSwitch) {
    const to = reply.body.battle.you.findIndex((f, i) => f.hp > 0 && i !== reply.body.battle.active);
    await post("/api/buddy/battle", { id: soba, turn: reply.body.battle.turn, action: { type: "switch", to } });
  }
  if (reply.body?.caught) caughtReply = reply.body.caught;
}
check("with three out already, a new catch waits at home", caughtReply?.walking === false, JSON.stringify(caughtReply));
check("…in your collection", sql(`select count(*) from buddy_collection where user_id='${me.id}'`) === "3");
check("…and the party stays at three", settingsOf(me.id).buddies.length === 3);

// ------------------------------------------------------------ the API's checks
r = await post("/api/buddy/battle", { id: randomUUID(), action: "start" });
check("an unknown panda: 404", r.status === 404);
const gone = newEncounter(me.id, { name: "Kiwi", stay: "-1 minutes" });
r = await post("/api/buddy/battle", { id: gone, action: "start" });
check("one that has wandered off: 410", r.status === 410 && /wandered off/.test(r.body.error), `${r.status} ${r.body?.error}`);
const fresh = newEncounter(me.id, { name: "Hazel" });
r = await post("/api/buddy/battle", { id: fresh, turn: 0, action: { type: "run" } });
check("a turn before the battle starts: 410", r.status === 410 && /Start the battle first/.test(r.body.error));
r = await post("/api/buddy/battle", { id: "not-a-panda", action: "start" });
check("a bad request: 422", r.status === 422);
await post("/api/buddy/battle", { id: fresh, action: "start" });
const spent = sql(`select bamboo_spent from buddy_stats where user_id='${me.id}'`);
sql(`update buddy_stats set bamboo_spent = 100000 where user_id='${me.id}'`);
r = await post("/api/buddy/battle", { id: fresh, turn: 0, action: { type: "bamboo" } });
check("no bamboo left: 422", r.status === 422 && /out of bamboo/.test(r.body.error), `${r.status} ${r.body?.error}`);
sql(`update buddy_stats set bamboo_spent = ${spent} where user_id='${me.id}'`);
await post("/api/buddy/battle", { id: fresh, turn: 0, action: { type: "run" } });
const current = (await api("/api/buddy")).body.settings;
r = await put("/api/buddy", { ...current, buddies: [...current.buddies.slice(0, 2), { id: "cfake", name: "Fake", color: "#cab361", x: null, y: null, catchId: randomUUID() }] });
check("a panda that isn't yours can't join the party", r.status === 422 && /isn't one of yours/.test(r.body.error), `${r.status} ${r.body?.error}`);
r = await put("/api/buddy", {
  ...current,
  buddies: [current.buddies[0], { ...current.buddies[1] }, { ...current.buddies[1], id: "ctwice" }],
});
check("…nor the same one twice", r.status === 422 && /only come along once/.test(r.body.error), `${r.status} ${r.body?.error}`);

const otherCtx = await browser.createBrowserContext();
const other = await otherCtx.newPage();
await other.goto(`${BASE}/welcome`, { waitUntil: "load" });
r = await post("/api/buddy/wild", {}, other);
const r2 = await post("/api/buddy/battle", { id: fresh, action: "start" }, other);
check("signed out: 401", r.status === 401 && r2.status === 401, `${r.status} ${r2.status}`);
const someone = await signUp(other, { name: "Theo Marsh", buddies: true });
const theirs = newEncounter(me.id, { name: "Udon" });
r = await post("/api/buddy/battle", { id: theirs, action: "start" }, other);
check("someone else's wild panda: 404", r.status === 404, String(r.status));
check("a new member is level 1 on their record", sql(`select level from users where id='${someone.id}'`) === "1");
r = await post("/api/buddy/wild", {}, other);
check(
  "at level 1, the first look starts the clock (none straight away)",
  r.status === 200 &&
    r.body.wild === null &&
    sql(`select count(*) from buddy_stats where user_id='${someone.id}' and last_wild_at is not null`) === "1",
  JSON.stringify(r.body),
);
let firstWild = null;
for (let i = 0; i < 14 && !firstWild; i++) {
  sql(`update buddy_stats set last_wild_at = now() - interval '10 minutes' where user_id='${someone.id}'`);
  const res = await post("/api/buddy/wild", {}, other);
  if (res.status === 429) {
    await sleep(10_500); // asked a lot: wait for the next go
    i--;
    continue;
  }
  firstWild = res.body?.wild ?? null;
}
check(
  "…then they turn up at level 1 too: common ones, level 1 or 2",
  !!firstWild && firstWild.rarity === "common" && firstWild.level >= 1 && firstWild.level <= 2,
  JSON.stringify(firstWild),
);
sql(`insert into study_events (user_id, kind, at) select '${someone.id}', 'review', now() from generate_series(1, 30)`);
const theoSettings = (await api("/api/buddy", undefined, other)).body.settings;
setSettings(someone.id, { ...theoSettings, wild: false });
newEncounter(someone.id, { name: "Lychee" });
r = await post("/api/buddy/wild", {}, other);
check("with wild pandas switched off, none show", r.status === 200 && r.body.wild === null, JSON.stringify(r.body));
const nonMemberPage = await (await browser.createBrowserContext()).newPage();
await signUp(nonMemberPage, { name: "No Membership", member: false });
r = await post("/api/buddy/wild", {}, nonMemberPage);
check("without a membership: 402", r.status === 402, String(r.status));

// ------------------------------------------------------------ the buddies page
await page.goto(`${BASE}/buddies`, { waitUntil: "load" });
await page.waitForSelector("[data-testid=guide-rarity]");
// The switches work once the page has hydrated (React has its props on them).
await page.waitForFunction(
  () => Object.keys(document.querySelector("[data-testid=caught-buddy] [role=switch]") ?? {}).some((k) => k.startsWith("__reactProps")),
  { timeout: 10_000 },
);
check("the buddies page shows who's out", (await page.$$("[data-testid=party-slot]")).length === 3);
const cards = await page.$$eval("[data-testid=caught-buddy]", (cs) =>
  cs.map((c) => `${c.querySelector("[data-testid=caught-name]")?.textContent}:${c.dataset.rarity}`),
);
check("and every panda caught", cards.length === 3 && cards.includes("Juniper:rare") && cards.includes("Tofu:common") && cards.includes("Soba:common"), cards.join(" "));
const guide = await page.$$eval("[data-testid=guide-rarity]", (gs) => gs.map((g) => g.dataset.open));
check("the field guide: rare and below at level 6, super rare from level 7", guide.join() === "true,true,true,false", guide.join());
check("…saying when", /From level 7/.test(await page.$eval("[data-testid=guide-rarity]:last-child", (e) => e.innerText)));
check("the bamboo count matches", (await page.$eval("[data-testid=bamboo]", (e) => e.innerText)).includes(`You have ${(await api("/api/buddy")).body.bamboo}.`));
const toggle = async (name) => {
  await page.evaluate((name) => {
    const card = [...document.querySelectorAll("[data-testid=caught-buddy]")].find((c) => c.innerText.includes(name));
    card.querySelector("[role=switch]").click();
  }, name);
  await sleep(900);
};
await toggle("Tofu");
check("Out with you, off: Tofu stays home", !settingsOf(me.id).buddies.some((b) => b.name === "Tofu"));
await toggle("Soba");
s = settingsOf(me.id);
check("…and Soba comes along instead", s.buddies.some((b) => b.name === "Soba" && b.catchId) && s.buddies.length === 3, s.buddies.map((b) => b.name).join());
check("while three are out, the others can't be switched on", await page.evaluate(() => [...document.querySelectorAll("[data-testid=caught-buddy]")].find((c) => c.innerText.includes("Tofu")).querySelector("[role=switch]").disabled));

// ------------------------------------------------------------ the Settings page
await page.goto(`${BASE}/settings`, { waitUntil: "load" });
await page.waitForSelector("#buddy-tricks");
await page.$eval("#buddy-tricks", (el) => el.scrollIntoView({ block: "center" }));
await sleep(400);
check("Settings has the buddy switches", (await page.$$("section[aria-labelledby=buddies-title] [role=switch]")).length === 5);
await page.click("#buddy-tricks");
check("turning tricks off there saves it", !!(await waitFor(() => settingsOf(me.id).tricks === false, 4000)));
await page.reload({ waitUntil: "load" });
await page.waitForSelector("#buddy-tricks");
check("…and it stays off", (await attr("#buddy-tricks", "aria-checked")) === "false");
const menu = await page.waitForSelector("aside [data-ui=menu-trigger]");
await menu.click();
const item = await page.waitForSelector("xpath/.//*[@role='menuitem'][contains(., 'Study buddies')]", { timeout: 3000 });
await item.click();
check(
  "where no buddies are out, the account menu's Study buddies opens the buddies page",
  !!(await waitFor(() => new URL(page.url()).pathname === "/buddies", 8000)),
  page.url(),
);

check("no page errors", errors.length === 0, errors.slice(0, 3).join(" / "));
await browser.close();
console.log(failures ? `\n${failures} FAILED` : "\nproblems: none");
process.exit(failures ? 1 : 0);
