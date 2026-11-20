// Study buddies, end to end: the panda showing up for members with a
// greeting once a day, its progress card, dragging and arrow keys (and the
// spot being remembered), settings from the account menu (more buddies,
// names, colours, the daily goal), hiding and bringing them back, and
// following progress: flashcard answers, the daily goal, levelling up (a
// scarf), the streak, the end of a round, and to-do cards moved to Done
// (counted once per card). Plus the API's checks. Run against `npm start`.
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
  if (m.type() === "error" && !/status of (401|402|422)/.test(m.text())) errors.push(`console: ${m.text()}`);
});

const buddies = () => page.$$eval("[data-testid=buddy]", (els) => els.map((e) => e.getAttribute("aria-label")));
const bubble = () => page.$$eval(".buddy-bubble", (b) => b.map((x) => x.textContent).join(" / ")).catch(() => "");
const said = (re, timeout = 6000) => waitFor(async () => re.test(await bubble()), timeout);
const boxOf = (sel) =>
  page.$eval(sel, (el) => {
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  });
const settingsOf = (id) => JSON.parse(sql(`select settings from buddy_settings where user_id='${id}'`) || "null");
const events = (id, kind) => Number(sql(`select count(*) from study_events where user_id='${id}' and kind='${kind}'`));
const toastText = () => page.$$eval("[data-toast]", (ts) => ts.map((t) => t.innerText).join(" | ")).catch(() => "");
const api = (path, init) =>
  page.evaluate(
    async (path, init) => {
      const res = await fetch(path, init);
      return { status: res.status, body: await res.json().catch(() => null) };
    },
    path,
    init,
  );

// ------------------------------------------------------------ showing up
const me = await signUp(page, { name: "Priya Patel", buddies: true });
await page.waitForSelector("[data-testid=buddy]", { timeout: 8000 });
let list = await buddies();
check("a member gets one study buddy", list.length === 1 && /^Bao, your study buddy \(level 1\)/.test(list[0]), list.join());
check("it says hello by name", !!(await said(/Priya/)), await bubble());
await page.reload({ waitUntil: "load" });
await page.waitForSelector("[data-testid=buddy]");
await sleep(1800);
check("but only once a day", !(await bubble()));

// Stay put from here on, so the pointer finds them where they were.
sql(
  `insert into buddy_settings (user_id, settings) values ('${me.id}', '{"visible":true,"wander":false,"dailyGoal":20,"buddies":[{"id":"bao","name":"Bao","color":"#277c78","x":null,"y":null}]}') on conflict (user_id) do update set settings = jsonb_set(buddy_settings.settings, '{wander}', 'false')`,
);
await page.reload({ waitUntil: "load" });
await page.waitForSelector("[data-testid=buddy]");
await sleep(500);

// ------------------------------------------------------------ progress card
let b = await boxOf("[data-testid=buddy]");
await page.mouse.click(b.x + b.w / 2, b.y + b.h / 2);
await page.waitForSelector("[role=dialog][aria-label=\"Bao: today's progress\"]", { timeout: 3000 });
const card = await page.$eval("[role=dialog][aria-label=\"Bao: today's progress\"]", (d) => d.innerText);
check("clicking it shows today's progress", /Level 1/.test(card) && /Cards today\s*0 of 20/.test(card) && /0 of 20 points to level 2/.test(card), card.replace(/\s+/g, " "));
await page.keyboard.press("Escape");
check("Escape closes it", !!(await waitFor(async () => !(await page.$("[role=dialog]")), 2000)));

// ------------------------------------------------------------ moving
b = await boxOf("[data-testid=buddy]");
const drop = { x: 700, y: 400 };
await page.mouse.move(b.x + b.w / 2, b.y + b.h / 2);
await page.mouse.down();
await page.mouse.move(b.x + b.w / 2 - 40, b.y + b.h / 2 - 30, { steps: 4 });
check("while dragged it dangles", (await page.$eval("[data-testid=buddy]", (e) => e.dataset.pose)) === "drag");
await page.mouse.move(drop.x, drop.y, { steps: 12 });
await page.mouse.up();
await sleep(900);
let s = settingsOf(me.id);
const savedAt = s && { x: s.buddies[0].x * 1440, y: s.buddies[0].y * 900 };
check(
  "dragging it somewhere keeps it there",
  !!savedAt && Math.abs(savedAt.x - (drop.x - 32)) < 6 && Math.abs(savedAt.y - (drop.y - 36)) < 6,
  JSON.stringify(savedAt),
);
check("and no progress card opened", !(await page.$("[role=dialog]")));
await page.evaluate(() => document.querySelector("[data-testid=buddy]").focus());
await page.keyboard.press("ArrowLeft");
await page.keyboard.down("Shift");
await page.keyboard.press("ArrowUp");
await page.keyboard.up("Shift");
await sleep(900);
s = settingsOf(me.id);
check(
  "arrow keys move it too",
  Math.abs(s.buddies[0].x * 1440 - (savedAt.x - 16)) < 3 && Math.abs(s.buddies[0].y * 900 - (savedAt.y - 64)) < 3,
);
await page.reload({ waitUntil: "load" });
await page.waitForSelector("[data-testid=buddy]");
b = await boxOf("[data-testid=buddy]");
check("after a reload it's where it was put", Math.abs(b.x - (savedAt.x - 16)) < 4 && Math.abs(b.y - (savedAt.y - 64)) < 4, `${b.x},${b.y}`);

// ------------------------------------------------------------ settings
async function openSettings() {
  // The account button at the bottom of the sidebar.
  const trigger = await page.waitForSelector("aside [data-ui=menu-trigger]", { timeout: 5000 });
  await trigger.click();
  const item = await page.waitForSelector("xpath/.//*[@role='menuitem'][contains(., 'Study buddies')]", { timeout: 3000 });
  await item.click();
  await page.waitForSelector("[role=dialog] h2", { timeout: 3000 });
  await sleep(300);
}
await openSettings();
check("the account menu opens buddy settings", (await page.$eval("[role=dialog] h2", (h) => h.textContent)) === "Study buddies");
const [addBuddy] = await page.$$("xpath/.//button[normalize-space()='Add a buddy']");
await addBuddy.click();
await sleep(300);
const names = await page.$$("[role=dialog] input[aria-label=Name]");
const selectAll = async () => {
  await page.keyboard.down("Control");
  await page.keyboard.press("a");
  await page.keyboard.up("Control");
};
await names[1].click();
await selectAll();
await page.keyboard.type("Dumpling Jr");
await page.click("[role=dialog] [aria-label=\"Dumpling Jr's scarf colour\"] [aria-label='Colour #826cb0']");
const goal = await page.$("[role=dialog] input[type=number]");
await goal.click();
await selectAll();
await page.keyboard.type("3");
await sleep(900);
s = settingsOf(me.id);
check(
  "adding, naming and colouring a buddy, and the daily goal, are saved",
  s.buddies.length === 2 && s.buddies[1].name === "Dumpling Jr" && s.buddies[1].color === "#826cb0" && s.dailyGoal === 3,
  JSON.stringify(s).slice(0, 200),
);
await page.keyboard.press("Escape");
await waitFor(async () => !(await page.$("[role=dialog]")), 2000);
await sleep(300);
check("closing settings leaves the page usable", (await page.evaluate(() => getComputedStyle(document.body).pointerEvents)) !== "none");
check("two buddies now", (await buddies()).length === 2);

// ------------------------------------------------------------ hiding
b = await boxOf("[data-buddy=bao]");
await page.mouse.click(b.x + b.w / 2, b.y + b.h / 2);
await page.waitForSelector("xpath/.//button[normalize-space()='Hide buddies']", { timeout: 3000 });
const [hideBtn] = await page.$$("xpath/.//button[normalize-space()='Hide buddies']");
await hideBtn.click();
check("Hide buddies hides them", !!(await waitFor(async () => (await buddies()).length === 0, 3000)));
check("and says where to bring them back", !!(await waitFor(async () => /account menu/.test(await toastText()), 3000)), await toastText());
const [undo] = await page.$$("xpath/.//button[normalize-space()='Undo']");
await undo.click();
check("Undo brings them back", !!(await waitFor(async () => (await buddies()).length === 2, 3000)));
b = await boxOf("[data-buddy=bao]");
await page.mouse.click(b.x + b.w / 2, b.y + b.h / 2);
await page.waitForSelector("xpath/.//button[normalize-space()='Hide buddies']", { timeout: 3000 });
await (await page.$$("xpath/.//button[normalize-space()='Hide buddies']"))[0].click();
await sleep(900);
await page.reload({ waitUntil: "load" });
await sleep(1500);
check("hidden stays hidden after a reload", (await buddies()).length === 0 && settingsOf(me.id).visible === false);
await openSettings();
await page.click("[role=dialog] button[role=switch]");
await page.keyboard.press("Escape");
check("the settings switch shows them again", !!(await waitFor(async () => (await buddies()).length === 2, 3000)));

// ------------------------------------------------------------ following progress: flashcards
// 18 points from yesterday: two more answers reach level 2, three reach today's goal.
sql(`insert into study_events (user_id, kind, at) select '${me.id}', 'review', now() - interval '1 day' from generate_series(1, 18)`);
for (let i = 1; i <= 5; i++) {
  sql(`insert into flashcards (user_id, front, back, deck) values ('${me.id}', 'Valence electrons in group ${i}?', '${i}', 'Chemistry')`);
}
await page.goto(`${BASE}/study`, { waitUntil: "load" });
await page.waitForSelector("[data-testid=buddy]");
await sleep(800);
async function answer(key) {
  await page.keyboard.press("Space");
  await sleep(120);
  await page.keyboard.press(key);
}
await answer("2");
check("the first answer gets a word", !!(await said(/Nice start|One down|Off we go/)), await bubble());
check("and is counted", !!(await waitFor(() => events(me.id, "review") === 19, 3000)));
await answer("1");
check("reaching 20 points is level 2", !!(await said(/Level 2! I got a scarf\./)), await bubble());
check("and they cheer", !!(await waitFor(() => page.$("[data-testid=buddy][data-pose=cheer]"), 2000)));
await sleep(2000);
await answer("2");
check("the third card meets the daily goal of 3", !!(await said(/That's your 3 cards for today!/)), await bubble());
await sleep(1500);
for (let i = 0; i < 3; i++) {
  await answer("2");
  await sleep(1300);
}
check("the last card of the round is noticed", !!(await said(/All caught up: 6 cards this round\./)), await bubble());
await sleep(1200);
b = await boxOf("[data-buddy=bao]");
await page.mouse.click(b.x + b.w / 2, b.y + b.h / 2);
await page.waitForSelector("[data-testid=buddy-reviews]", { timeout: 3000 });
const today = await page.$eval("[data-testid=buddy-reviews]", (e) => e.textContent);
const streak = await page.$eval("[data-testid=buddy-streak]", (e) => e.textContent);
check("the card shows today's answers against the goal", /^6 of 3/.test(today), today);
check("and the streak (yesterday and today)", streak === "2 days", streak);
await page.keyboard.press("Escape");

// ------------------------------------------------------------ following progress: to-do cards
await page.goto(`${BASE}/`, { waitUntil: "load" });
await Promise.all([page.waitForNavigation({ waitUntil: "load" }), page.click("main form button[type=submit]")]);
await page.waitForFunction(() => /^\/drawings\/[0-9a-f-]{36}$/.test(location.pathname), { timeout: 15_000 }); // the redirect is client-side
const drawingId = page.url().split("/drawings/")[1];
await page.waitForSelector("[data-testid=board]");
// The editor saves its view 300 ms after it settles; give a busy machine plenty of time.
const cam = await waitFor(() => page.evaluate((id) => JSON.parse(localStorage.getItem(`canvas-camera:${id}`)), drawingId), 20_000);
if (!cam) {
  const state = await page.evaluate(() => ({
    url: location.href,
    keys: Object.keys(localStorage).filter((k) => k.startsWith("canvas-camera")),
    boards: [...document.querySelectorAll("[data-testid=board]")].map((b) => {
      const r = b.getBoundingClientRect();
      return `${Math.round(r.width)}x${Math.round(r.height)} visible=${b.checkVisibility()}`;
    }),
  }));
  throw new Error(`the editor never saved its view: ${JSON.stringify(state)}`);
}
const rect = await boxOf("[data-testid=board]");
const [todo, doing, done] = [randomUUID(), randomUUID(), randomUUID()];
const cardId = randomUUID();
const board = {
  id: randomUUID(),
  type: "kanban",
  x: Math.round(cam.x + 60),
  y: Math.round(cam.y + 60),
  w: 708,
  scale: 1,
  title: "This week",
  columns: [
    { id: todo, title: "To do", color: "#3f82b2", cards: [{ id: cardId, text: "Lab report" }] },
    { id: doing, title: "Doing", color: "#be6c49", cards: [] },
    { id: done, title: "Done", color: "#277c78", cards: [{ id: randomUUID(), text: "Already done" }] },
  ],
};
await api(`/api/drawings/${drawingId}/changes`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ clientId: "buddy-test-01", batches: [{ id: randomUUID(), ops: [{ t: "add", el: board }] }] }),
});
check("a card put straight into Done doesn't count as a task", events(me.id, "task") === 0);
await sleep(1200);
const at = (wx, wy) => ({ x: rect.x + (wx - cam.x) * cam.z, y: rect.y + (wy - cam.y) * cam.z });
const colW = (708 - 28 - 20) / 3;
const cardPt = at(board.x + 14 + 8 + 40, board.y + 50 + 32 + 17);
const donePt = at(board.x + 14 + 2 * (colW + 10) + colW / 2, board.y + 50 + 32 + 3);
const drag = async (from, to) => {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + 12, from.y + 6, { steps: 3 });
  await page.mouse.move(to.x, to.y, { steps: 10 });
  await page.mouse.up();
};
await page.keyboard.press("v"); // new drawings start with the pen
await drag(cardPt, donePt);
check("moving a to-do card to Done: they cheer", !!(await waitFor(() => page.$("[data-testid=buddy][data-pose=cheer]"), 3000)));
check("and say so", !!(await said(/Task done|Off the list|One less thing/, 6000)), await bubble());
check("and it counts as a task", !!(await waitFor(() => events(me.id, "task") === 1, 4000)));
// Back to To do and into Done again: still one task.
const backPt = at(board.x + 14 + 2 * (colW + 10) + 40, board.y + 50 + 32 + 17);
await drag(backPt, at(board.x + 14 + colW / 2, board.y + 50 + 32 + 3));
await sleep(800);
await drag(cardPt, donePt);
await sleep(2000);
check("moving the same card to Done again doesn't count twice", events(me.id, "task") === 1, String(events(me.id, "task")));

// ------------------------------------------------------------ the API
const got = await api(`/api/buddy?tz=Not/AZone`);
check("an unknown time zone falls back to UTC", got.status === 200 && got.body.progress.today.reviews === 6, JSON.stringify(got.body?.progress));
check("points add up (24 answers, 1 task)", got.body.progress.points === 24 + 5 && got.body.progress.level === 2);
const tooMany = await api(`/api/buddy`, {
  method: "PUT",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ ...got.body.settings, buddies: [1, 2, 3, 4].map((i) => ({ id: `x${i}`, name: "X", color: "#277c78", x: null, y: null })) }),
});
check("more than three buddies are refused", tooMany.status === 422);
const outsider = await (await browser.createBrowserContext()).newPage();
await outsider.goto(`${BASE}/welcome`, { waitUntil: "load" });
const anon = await outsider.evaluate(async () => (await fetch("/api/buddy")).status);
check("signed out: 401", anon === 401, String(anon));
await signUp(outsider, { name: "No Membership", member: false });
const notMember = await outsider.evaluate(async () => (await fetch("/api/buddy")).status);
check("without a membership: 402", notMember === 402, String(notMember));

// ------------------------------------------------------------ the level on their record
const recordLevel = (id) => Number(sql(`select level from users where id='${id}'`));
check("their level is kept on their record", recordLevel(me.id) === 2, String(recordLevel(me.id)));
// Away from the app, so nothing reads their progress in the meantime.
await page.goto(`${BASE}/favicon.ico`, { waitUntil: "load" });
sql(`insert into study_events (user_id, kind, at) select '${me.id}', 'review', now() - interval '2 days' from generate_series(1, 20)`);
check("study events added some other way (49 points) don't change it by themselves", recordLevel(me.id) === 2);
const kept = JSON.parse(sql(`select data from drawings where id='${drawingId}'`)).elements.find((e) => e.id === board.id);
const card2 = randomUUID();
const withCardIn = (col) => ({
  ...kept,
  columns: kept.columns.map((c) => (c.id === col ? { ...c, cards: [...c.cards, { id: card2, text: "Read chapter 4" }] } : c)),
});
const change = (el) =>
  api(`/api/drawings/${drawingId}/changes`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ clientId: "buddy-test-01", batches: [{ id: randomUUID(), ops: [{ t: "set", el }] }] }),
  });
await change(withCardIn(todo));
const moved = await change(withCardIn(done));
check(
  "finishing a to-do card (54 points) puts level 3 on their record straight away",
  moved.status === 200 && events(me.id, "task") === 2 && recordLevel(me.id) === 3,
  `${moved.status} ${events(me.id, "task")} ${recordLevel(me.id)}`,
);
sql(`insert into study_events (user_id, kind, at) select '${me.id}', 'review', now() - interval '2 days' from generate_series(1, 50)`);
const reread = await api("/api/buddy");
check(
  "reading their progress brings the record up to date (104 points: level 4)",
  reread.body?.progress?.level === 4 && recordLevel(me.id) === 4,
  `${reread.body?.progress?.level} ${recordLevel(me.id)}`,
);

check("no page errors", errors.length === 0, errors.slice(0, 3).join(" / "));
await browser.close();
console.log(failures ? `\n${failures} FAILED` : "\nproblems: none");
process.exit(failures ? 1 : 0);
