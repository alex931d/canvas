// Two app servers, one drawing: someone on each, and everything live has to
// cross between the servers through the realtime bus (REALTIME_BUS=redis or
// postgres; with `local` this test fails, as it should).
//
// Start a second server on the same database (and Redis) first, e.g.
//   PORT=3001 REALTIME_BUS=redis npm start
// then: SECOND_URL=http://localhost:3001 node e2e/test-realtime-bus.mjs
import puppeteer from "puppeteer-core";
import nextEnv from "@next/env";

nextEnv.loadEnvConfig(process.cwd());
const { signUp, sql, sleep } = await import("./helpers.mjs");
const SECOND = process.env.SECOND_URL ?? "http://localhost:3001";
const CHROME = process.env.CHROME_PATH ?? "/usr/bin/google-chrome";

let failures = 0;
function check(label, cond, extra = "") {
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}${extra ? `  (${extra})` : ""}`);
  if (!cond) failures++;
}
async function waitFor(fn, timeout = 8000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    if (await fn()) return true;
    await sleep(120);
  }
  return false;
}

const up = await fetch(`${SECOND}/pricing`).then((r) => r.ok, () => false);
if (!up) {
  console.error(`No second server at ${SECOND}. Start one on the same database first (see the top of this file).`);
  process.exit(1);
}

const launch = () =>
  puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--no-sandbox"], defaultViewport: { width: 1440, height: 900 } });
const browsers = await Promise.all([launch(), launch()]);
const [a, b] = await Promise.all(browsers.map((br) => br.newPage()));

const items = (p) =>
  p
    .$eval("[data-testid=board]", (el) => Number(el.getAttribute("aria-label").match(/with (\d+) items/)[1]))
    .catch(() => -1);
const status = (p) => p.$eval("[data-testid=storage-status]", (el) => el.innerText.replace(/\s+/g, " ")).catch(() => "");
const synced = (p) => waitFor(async () => /Saved here.*Synced/.test(await status(p)), 10_000);
const peers = (p) => p.$eval("[data-testid=peers]", (e) => e.getAttribute("aria-label")).catch(() => "");
const tool = (p, label) => p.click(`aside button[aria-label='${label}']`);
async function drag(p, pts) {
  const r = await p.$eval("[data-testid=board]", (el) => {
    const b = el.getBoundingClientRect();
    return { x: b.x, y: b.y };
  });
  await p.mouse.move(r.x + pts[0][0], r.y + pts[0][1]);
  await p.mouse.down();
  for (const [x, y] of pts.slice(1)) await p.mouse.move(r.x + x, r.y + y, { steps: 6 });
  await p.mouse.up();
}

// Maya on the first server makes a drawing and shares it.
await signUp(a, { name: "Maya Chen" });
await Promise.all([a.waitForNavigation({ waitUntil: "load" }), a.click("main form button[type=submit]")]);
await a.waitForFunction(() => /^\/drawings\/[0-9a-f-]{36}$/.test(location.pathname), { timeout: 15_000 });
const id = a.url().split("/drawings/")[1];
await synced(a);
await a.click("button[aria-label=Share]");
await a.waitForSelector("[role=dialog] [aria-label='Invite with a link']");
await a.click("[aria-label='Invite with a link']");
await a.waitForSelector("[aria-label='Invite link']");
const link = await a.$eval("[aria-label='Invite link']", (i) => i.value);
await a.keyboard.press("Escape");

// Alex joins, then opens it on the second server (cookies are per host, not per port).
await signUp(b, { name: "Alex Kim" });
await b.goto(link, { waitUntil: "networkidle0" });
await Promise.all([b.waitForNavigation({ waitUntil: "load" }), b.click("main form button[type=submit]")]);
await b.goto(`${SECOND}/drawings/${id}`, { waitUntil: "load" });
await synced(b);
check("the second server shows the drawing", new URL(b.url()).origin === SECOND && (await items(b)) === 0);

// changes, both ways
await tool(a, "Rectangle");
await drag(a, [[420, 220], [560, 330]]);
check("a shape drawn on server 1 appears live on server 2", await waitFor(async () => (await items(b)) === 1, 6000));
await tool(b, "Ellipse");
await drag(b, [[700, 220], [820, 330]]);
check("and one drawn on server 2 appears on server 1", await waitFor(async () => (await items(a)) === 2, 6000));

// cursors, both ways
check(
  "cursors cross from server 2 to server 1",
  await waitFor(async () => {
    await b.mouse.move(600 + Math.random() * 60, 620, { steps: 2 });
    return /Alex Kim/.test(await peers(a));
  }, 6000),
);
check(
  "and from server 1 to server 2",
  await waitFor(async () => {
    await a.mouse.move(600 + Math.random() * 60, 640, { steps: 2 });
    return /Maya Chen/.test(await peers(b));
  }, 6000),
);

// the bus drops (Redis subscribers or Postgres LISTEN connections killed) just
// before a change: it still arrives, from the catch-up after reconnecting
const killed = { redis: 0, postgres: 0 };
if (process.env.REDIS_URL) {
  const { default: Redis } = await import("ioredis");
  const r = new Redis(process.env.REDIS_URL);
  killed.redis = await r.client("KILL", "TYPE", "pubsub");
  r.disconnect();
}
killed.postgres = Number(sql(`select count(pg_terminate_backend(pid)) from pg_stat_activity where query ilike 'LISTEN%'`));
await tool(a, "Rectangle");
await drag(a, [[420, 420], [520, 500]]);
check(
  "a change made while the bus reconnects still arrives",
  await waitFor(async () => (await items(b)) === 3, 10_000),
  `dropped ${killed.redis} Redis and ${killed.postgres} Postgres bus connections`,
);

// rename (server 2 → server 1)
await b.click("[aria-label='Drawing title']");
await b.keyboard.down("Control");
await b.keyboard.press("a");
await b.keyboard.up("Control");
await b.keyboard.type("Across servers");
await b.keyboard.press("Enter");
check(
  "a rename on server 2 reaches server 1",
  await waitFor(async () => (await a.$eval("[aria-label='Drawing title']", (i) => i.value)) === "Across servers", 6000),
);

// leaving (server 2 → server 1): their cursor goes at once, not after 30 s
await b.goto(`${SECOND}/`, { waitUntil: "load" });
check("closing the drawing on server 2 removes their cursor on server 1", await waitFor(async () => !/Alex Kim/.test(await peers(a)), 4000));

// removing access (server 1 → server 2) ends their live view
await b.goto(`${SECOND}/drawings/${id}`, { waitUntil: "load" });
await synced(b);
await a.click("button[aria-label=Share]");
await a.waitForSelector("[role=dialog] [aria-label^='Alex Kim:']");
await a.click("[aria-label^='Alex Kim:']");
const [remove] = await a.$$("xpath/.//div[@role='menuitem'][normalize-space()='Remove']");
await remove.click();
await a.keyboard.press("Escape");
check(
  "removing someone on server 1 ends their live view on server 2",
  await waitFor(async () => /no longer have access/.test(await b.$eval("[role=status]", (s) => s.innerText).catch(() => "")), 6000),
);

await Promise.all(browsers.map((br) => br.close()));
process.exit(failures ? 1 : 0);
