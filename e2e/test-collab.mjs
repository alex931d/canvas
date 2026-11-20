// Live collaboration, end to end, with three people in separate browsers:
// sharing by link (members only), live edits both ways, cursors, per-person
// undo, offline edits merging, roles, removal, leaving, deleting, and the
// API refusing people without access. Run against `npm start`.
import puppeteer from "puppeteer-core";
import nextEnv from "@next/env";

nextEnv.loadEnvConfig(process.cwd());
const { signUp, sql, grantMembership, sleep, BASE } = await import("./helpers.mjs");
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

// Separate browsers, so every page is in front (background tabs are throttled).
const launch = () =>
  puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--no-sandbox"], defaultViewport: { width: 1440, height: 900 } });
const browsers = await Promise.all([launch(), launch(), launch()]);
const [a, b, c] = await Promise.all(browsers.map((br) => br.newPage()));
const errors = [];
for (const [name, p] of [["A", a], ["B", b], ["C", c]]) {
  p.on("pageerror", (e) => errors.push(`${name} pageerror: ${e.message}`));
  p.on("console", (m) => m.type() === "error" && errors.push(`${name} console: ${m.text()}`));
}

const items = (p) =>
  p
    .$eval("[data-testid=board]", (el) => Number(el.getAttribute("aria-label").match(/with (\d+) items/)[1]))
    .catch(() => -1);
const status = (p) => p.$eval("[data-testid=storage-status]", (el) => el.innerText.replace(/\s+/g, " ")).catch(() => "");
const synced = (p) => waitFor(async () => /Saved here.*Synced/.test(await status(p)), 10_000);
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
const tool = (p, label) => p.click(`aside button[aria-label='${label}']`);
const elements = (id) => JSON.parse(sql(`select data->'elements' from drawings where id='${id}'`) || "[]");
const openShare = async (p, waitFor) => {
  await p.click("button[aria-label=Share]");
  await p.waitForSelector(waitFor ?? "[role=dialog] [aria-label='Invite with a link'], [role=dialog] form button[type=submit]");
};
const closeDialog = (p) => p.keyboard.press("Escape");
const menuItem = async (p, text) => {
  const [item] = await p.$$(`xpath/.//div[@role='menuitem'][normalize-space()='${text}']`);
  await item.click();
};
/** Status of a request made from the page (with its cookies). */
const fetchStatus = (p, url, init) =>
  p.evaluate(async (url, init) => (await fetch(url, init)).status, url, init ?? {});

// ------------------------------------------------------------ owner starts
await signUp(a, { name: "Maya Chen" });
await Promise.all([a.waitForNavigation({ waitUntil: "load" }), a.click("main form button[type=submit]")]);
await a.waitForFunction(() => /^\/drawings\/[0-9a-f-]{36}$/.test(location.pathname), { timeout: 15_000 }); // the redirect is client-side
const id = a.url().split("/drawings/")[1];
await synced(a);
await tool(a, "Pen");
await drag(a, [[160, 300], [220, 260], [280, 320]]);
await synced(a);

await openShare(a);
check("link sharing starts off", !(await a.$("[aria-label='Invite link']")));
await a.click("[aria-label='Invite with a link']");
await a.waitForSelector("[aria-label='Invite link']");
let link = await a.$eval("[aria-label='Invite link']", (i) => i.value);
check("turning it on gives an invite link", /\/join\/[A-Za-z0-9_-]{32}$/.test(link), link);
check("stored with the editor role", sql(`select share_role from drawings where id='${id}'`) === "editor");
await closeDialog(a);

// ------------------------------------------------------------ a member joins
const alex = await signUp(b, { name: "Alex Kim" });
await b.goto(link, { waitUntil: "networkidle0" });
const joinText = await b.$eval("main", (m) => m.innerText);
check("the join page says who shared what", /Maya Chen shared a drawing with you/.test(joinText) && /Untitled/.test(joinText), joinText.split("\n")[0]);
await Promise.all([b.waitForNavigation({ waitUntil: "load" }), b.click("main form button[type=submit]")]);
check("joining opens the drawing", b.url().endsWith(`/drawings/${id}`));
check("and adds them as an editor", sql(`select role from drawing_members where drawing_id='${id}' and user_id='${alex.id}'`) === "editor");
await synced(b);
check("they see what was already there", (await items(b)) === 1);

// ------------------------------------------------------------ live both ways
await tool(a, "Rectangle");
await drag(a, [[420, 220], [560, 330]]);
check("the owner's new shape appears for the editor, live", await waitFor(async () => (await items(b)) === 2, 5000));
await tool(b, "Ellipse");
await drag(b, [[700, 220], [820, 330]]);
check("and the editor's appears for the owner", await waitFor(async () => (await items(a)) === 3, 5000));

// cursors
await b.mouse.move(700, 600, { steps: 4 });
await b.mouse.move(760, 640, { steps: 4 });
check(
  "the owner sees who else is here",
  await waitFor(async () => /Alex Kim/.test((await a.$eval("[data-testid=peers]", (e) => e.getAttribute("aria-label")).catch(() => "")) ?? ""), 5000),
);
check(
  "and so does the editor",
  await waitFor(async () => {
    await a.mouse.move(600 + Math.random() * 40, 650, { steps: 2 });
    return /Maya Chen/.test((await b.$eval("[data-testid=peers]", (e) => e.getAttribute("aria-label")).catch(() => "")) ?? "");
  }, 5000),
);

// two people moving different things at the same time
await synced(a);
await synced(b);
await tool(a, "Select");
await tool(b, "Select");
const before = elements(id);
const rect0 = before.find((e) => e.type === "rect");
const ell0 = before.find((e) => e.type === "ellipse");
await Promise.all([drag(a, [[490, 220], [490, 220], [530, 260]]), drag(b, [[760, 220], [760, 220], [720, 270]])]);
await Promise.all([synced(a), synced(b)]);
await waitFor(async () => {
  const els = elements(id);
  return els.find((e) => e.type === "rect")?.x !== rect0.x && els.find((e) => e.type === "ellipse")?.x !== ell0.x;
});
let after = elements(id);
check(
  "simultaneous moves of different shapes both stick",
  after.find((e) => e.type === "rect").x === rect0.x + 40 && after.find((e) => e.type === "ellipse").x === ell0.x - 40,
  `rect ${rect0.x}→${after.find((e) => e.type === "rect").x}, ellipse ${ell0.x}→${after.find((e) => e.type === "ellipse").x}`,
);

// undo is per person
await a.keyboard.down("Control");
await a.keyboard.press("z");
await a.keyboard.up("Control");
await synced(a);
await waitFor(async () => elements(id).find((e) => e.type === "rect").x === rect0.x);
after = elements(id);
check(
  "undo takes back only your own change",
  after.find((e) => e.type === "rect").x === rect0.x && after.find((e) => e.type === "ellipse").x === ell0.x - 40,
);
check("everyone ends up with the same drawing", await waitFor(async () => (await items(a)) === (await items(b)) && (await items(b)) === 3));

// rename shows up live
await b.click("[aria-label='Drawing title']");
await b.keyboard.down("Control");
await b.keyboard.press("a");
await b.keyboard.up("Control");
await b.keyboard.type("Chem revision");
await b.keyboard.press("Enter");
check("an editor's rename reaches the owner", await waitFor(async () => (await a.$eval("[aria-label='Drawing title']", (i) => i.value)) === "Chem revision", 5000));

// images: pasted by one, visible to the other
await a.evaluate(async () => {
  const cv = document.createElement("canvas");
  cv.width = 200;
  cv.height = 120;
  const x = cv.getContext("2d");
  x.fillStyle = "#82c9d7";
  x.fillRect(0, 0, 200, 120);
  const blob = await new Promise((r) => cv.toBlob(r, "image/png"));
  const dt = new DataTransfer();
  dt.items.add(new File([blob], "shot.png", { type: "image/png" }));
  document.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
});
await waitFor(async () => elements(id).some((e) => e.type === "image"));
const assetId = elements(id).find((e) => e.type === "image")?.assetId;
check("a pasted image reaches the editor", await waitFor(async () => (await items(b)) === 4, 6000));
check("who can load it from the server", (await fetchStatus(b, `/api/assets/${assetId}`)) === 200);

// ------------------------------------------------------------ offline edits merge
const holdChanges = (req) => (req.method() === "POST" && /\/changes$/.test(req.url()) ? req.abort() : req.continue());
await b.setRequestInterception(true);
b.on("request", holdChanges);
await tool(b, "Pen");
await drag(b, [[300, 520], [340, 560], [380, 520]]);
await drag(b, [[300, 600], [340, 640], [380, 600]]);
await tool(a, "Pen");
await drag(a, [[900, 520], [960, 580]]);
await synced(a);
check("while offline, the editor's strokes wait in their browser", (await items(b)) === 7 && elements(id).length === 5, `${await items(b)} shown, ${elements(id).length} on the server`);
b.off("request", holdChanges);
await b.setRequestInterception(false);
await b.keyboard.down("Control");
await b.keyboard.press("s");
await b.keyboard.up("Control");
check("back online, both people's work is kept", await waitFor(() => elements(id).length === 7, 10_000), `${elements(id).length}`);
check("and both screens agree", await waitFor(async () => (await items(a)) === 7 && (await items(b)) === 7, 6000));

// ------------------------------------------------------------ roles and access
await openShare(a, "[role=dialog] [aria-label^='Alex Kim:']");
await a.click("[aria-label^='Alex Kim:']");
await menuItem(a, "Can view");
await closeDialog(a);
check("making someone view-only takes effect live", await waitFor(async () => /View only/.test(await b.$eval("main header", (h) => h.innerText)), 5000));
check("their drawing tools go away", !(await b.$("aside button[aria-label='Pen']")) && !!(await b.$("aside button[aria-label='Pan']")));
const viewerPost = await b.evaluate(async (id) => {
  const res = await fetch(`/api/drawings/${id}/changes`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ clientId: "test-client-123", batches: [{ id: crypto.randomUUID(), ops: [{ t: "del", id: "x" }] }] }),
  });
  return res.status;
}, id);
check("and the server refuses their changes", viewerPost === 403, String(viewerPost));

// someone with a membership but no invite
const sam = await signUp(c, { name: "Sam Rivera", member: false });
await c.goto(link, { waitUntil: "networkidle0" });
check("joining needs a membership", /part of the membership/.test(await c.$eval("main", (m) => m.innerText)) && !(await c.$("main form button[type=submit]")));
check("the live stream asks non-members to join", (await fetchStatus(c, `/api/drawings/${id}/events?since=0&client=abcdefgh12`)) === 402);
grantMembership(sam.id);
const outsider = {
  doc: await fetchStatus(c, `/api/drawings/${id}/doc`),
  events: await fetchStatus(c, `/api/drawings/${id}/events?since=0&client=abcdefgh12`),
  presence: await fetchStatus(c, `/api/drawings/${id}/presence`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ clientId: "abcdefgh12", cursor: null, selection: [] }) }),
  changes: await fetchStatus(c, `/api/drawings/${id}/changes`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }),
  image: await fetchStatus(c, `/api/assets/${assetId}`),
};
check("members without an invite get nothing", Object.values(outsider).every((s) => s === 404), JSON.stringify(outsider));
await c.goto(`${BASE}/drawings/${id}`, { waitUntil: "networkidle0" });
check("and the page says it doesn't exist", /doesn.t exist/.test(await c.$eval("h1", (h) => h.textContent).catch(() => "")));

// new link: the old one stops working
await openShare(a);
const [newLink] = await a.$$("xpath/.//button[contains(., 'New link')]");
await newLink.click();
await waitFor(async () => (await a.$eval("[aria-label='Invite link']", (i) => i.value)) !== link);
const oldLink = link;
link = await a.$eval("[aria-label='Invite link']", (i) => i.value);
await closeDialog(a);
await c.goto(oldLink, { waitUntil: "networkidle0" });
check("after New link, the old link doesn't work", /doesn.t work/.test(await c.$eval("h1", (h) => h.textContent)));
await c.goto(link, { waitUntil: "networkidle0" });
await Promise.all([c.waitForNavigation({ waitUntil: "load" }), c.click("main form button[type=submit]")]);
await synced(c);
check("the new one does", c.url().endsWith(`/drawings/${id}`) && (await items(c)) === 7);

// a stream that fell behind the kept history is told to reload
sql(`delete from drawing_changes where drawing_id='${id}' and version <= 3`);
const firstEvent = await c.evaluate(async (id) => {
  const res = await fetch(`/api/drawings/${id}/events?since=1&client=resettest1`);
  const reader = res.body.getReader();
  let text = "";
  const t0 = Date.now();
  while (Date.now() - t0 < 3000 && !/event: (reset|change)/.test(text)) text += new TextDecoder().decode((await reader.read()).value);
  reader.cancel();
  return text.match(/event: (\w+)/g)?.join(",");
}, id);
check("a browser too far behind is told to reload the drawing", /event: reset/.test(firstEvent ?? ""), firstEvent);

// gallery
await b.goto(BASE, { waitUntil: "networkidle0" });
check("shared drawings are listed for the people they're shared with", /Shared with you[\s\S]*Chem revision/.test(await b.$eval("main", (m) => m.innerText)));
await a.goto(BASE, { waitUntil: "networkidle0" });
check("and marked as shared for the owner", /2 people/.test(await a.$eval("main", (m) => m.innerText)));
await a.goto(`${BASE}/drawings/${id}`, { waitUntil: "load" });
await synced(a);

// remove, then leave
await b.goto(`${BASE}/drawings/${id}`, { waitUntil: "load" });
await synced(b);
await openShare(a, "[role=dialog] [aria-label^='Alex Kim:']");
await a.click("[aria-label^='Alex Kim:']");
await menuItem(a, "Remove");
await closeDialog(a);
check("removing someone ends their live view", await waitFor(async () => /no longer have access/.test(await b.$eval("[role=status]", (s) => s.innerText).catch(() => "")), 5000));
check("and their access", sql(`select count(*) from drawing_members where drawing_id='${id}' and user_id='${alex.id}'`) === "0" && (await fetchStatus(b, `/api/drawings/${id}/doc`)) === 404);

await openShare(c);
await Promise.all([c.waitForNavigation({ waitUntil: "networkidle0" }), c.click("[role=dialog] form button[type=submit]")]);
check("people can leave a drawing shared with them", new URL(c.url()).pathname === "/" && sql(`select count(*) from drawing_members where drawing_id='${id}' and user_id='${sam.id}'`) === "0");

// owner deletes it while someone is looking
await c.goto(link, { waitUntil: "networkidle0" });
await Promise.all([c.waitForNavigation({ waitUntil: "load" }), c.click("main form button[type=submit]")]);
await synced(c);
await a.goto(BASE, { waitUntil: "networkidle0" });
await a.click(`button[aria-label='More actions for “Chem revision”']`);
await menuItem(a, "Delete drawing");
const [yes] = await a.$$("xpath/.//button[normalize-space()='Yes, delete']");
await yes.click();
check("deleting tells everyone looking", await waitFor(async () => /owner deleted this drawing/.test(await c.$eval("[role=status]", (s) => s.innerText).catch(() => "")), 6000));
check("and takes the history and members with it", sql(`select count(*) from drawing_changes where drawing_id='${id}'`) === "0" && sql(`select count(*) from drawing_members where drawing_id='${id}'`) === "0");

const real = errors.filter((e) => !/ERR_FAILED|Failed to fetch|net::ERR|40[2-4]|status of 40/.test(e));
console.log("\nerrors:", real.length ? real : "none");
await Promise.all(browsers.map((br) => br.close()));
process.exit(failures ? 1 : 0);
