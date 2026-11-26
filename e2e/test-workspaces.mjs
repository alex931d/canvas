// Team workspaces, end to end, with four people in four browsers: making
// one (and a nameless one refused), a drawing made in it, the invite link
// (members only), an emailed invitation (its link, the in-app list, the
// wrong account, cancelling), what each role may do (editors draw, viewers
// can't, enforced by the server; admins manage editors and viewers but not
// the owner), role changes and removal reaching open drawings live, moving
// drawings in and out, renaming, leaving, outsiders getting 404s, and
// deleting the workspace giving drawings back to the people who made them.
// Run against `npm run build && npm start` (see README, Tests); uses DATABASE_URL.
import { createHash } from "node:crypto";
import puppeteer from "puppeteer-core";
import nextEnv from "@next/env";

nextEnv.loadEnvConfig(process.cwd());
const { sleep, sql, signUp, uniqueEmail, waitForEmail, BASE } = await import("./helpers.mjs");

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
    value = await fn().catch(() => null);
    if (value) return value;
    await sleep(150);
  }
  return value;
}

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--no-sandbox"] });
const errors = [];
async function person(name, opts = {}) {
  const page = await (await browser.createBrowserContext()).newPage();
  await page.setViewport({ width: 1280, height: 900 });
  page.on("pageerror", (e) => {
    errors.push(`${name}: ${e.message}`);
    console.log(`  (page error for ${name} at ${page.url()})`);
  });
  const user = await signUp(page, { name, ...opts });
  return { page, user };
}

const status = (p) => p.$eval("[data-testid=storage-status]", (el) => el.innerText.replace(/\s+/g, " ")).catch(() => "");
const synced = (p) => waitFor(async () => /Saved here.*Synced/.test(await status(p)), 15_000);
const elements = (id) => JSON.parse(sql(`select data->'elements' from drawings where id='${id}'`) || "[]");
async function drawBox(p, x = 300, y = 220) {
  const r = await p.$eval("[data-testid=board]", (el) => {
    const b = el.getBoundingClientRect();
    return { x: b.x, y: b.y };
  });
  await p.keyboard.press("r");
  await p.mouse.move(r.x + x, r.y + y);
  await p.mouse.down();
  await p.mouse.move(r.x + x + 120, r.y + y + 80, { steps: 5 });
  await p.mouse.up();
}
const button = (label) => `xpath/.//button[normalize-space()="${label}"]`;
const clickButton = async (p, label) => (await p.waitForSelector(button(label), { timeout: 5000 })).click();
const text = (p, sel = "main") => p.$eval(sel, (n) => n.innerText).catch(() => "");
const httpStatus = (p, path) => p.evaluate(async (u) => (await fetch(u, { redirect: "manual" })).status, path);
const memberRole = (ws, userId) => sql(`select role from workspace_members where workspace_id='${ws}' and user_id='${userId}'`);
const roleSelect = (p, name) => `[data-testid=workspace-members] select[aria-label="${name}'s role"]`;
async function openMenuItem(p, trigger, item) {
  await p.click(trigger);
  const [it] = await p.$$(`xpath/.//div[@role='menuitem'][contains(normalize-space(), "${item}")]`);
  if (!it) throw new Error(`no menu item ${item}`);
  await it.click();
}

// ------------------------------------------------------------ making one
const { page: a, user: maya } = await person("Maya Chen");
check("the sidebar links to Workspaces", (await a.$("aside a[href='/workspaces']")) !== null);
check("the gallery introduces them", /Team workspaces/.test(await text(a)));
await a.goto(`${BASE}/workspaces`, { waitUntil: "networkidle0" });
check("/workspaces starts empty", /No workspaces yet/.test(await text(a)));
await clickButton(a, "Create workspace");
await a.waitForSelector("#workspace-name-error");
check("a workspace needs a name", /Give the workspace a name/.test(await text(a, "#workspace-name-error")));
await a.type("#workspace-name", "Biology 101");
await clickButton(a, "Create workspace");
await a.waitForSelector("[data-testid=workspace-name]", { timeout: 15_000 });
const ws = a.url().split("/workspaces/")[1];
check("making one opens it", /^[0-9a-f-]{36}$/.test(ws) && (await a.$eval("[data-testid=workspace-name]", (i) => i.value)) === "Biology 101");
check("with you as its owner", memberRole(ws, maya.id) === "owner");

// A drawing made in it.
await Promise.all([a.waitForNavigation({ waitUntil: "load" }), clickButton(a, "New Drawing")]);
await a.waitForFunction(() => /^\/drawings\//.test(location.pathname));
const d1 = a.url().split("/drawings/")[1];
check("New Drawing in a workspace puts it there", sql(`select workspace_id from drawings where id='${d1}'`) === ws);
await synced(a);
await drawBox(a);
await synced(a);
await a.click("button[aria-label=Share]");
await a.waitForSelector("[data-testid=share-workspace]");
check("the share dialog says it's in the workspace", /Biology 101/.test(await text(a, "[data-testid=share-workspace]")));
await a.keyboard.press("Escape");

// ------------------------------------------------------------ the invite link
await a.goto(`${BASE}/workspaces/${ws}`, { waitUntil: "networkidle0" });
check("it lists its drawings", (await a.$$("[data-testid=workspace-drawings] li")).length === 1);
await a.click("[aria-label='Invite with a link']");
await a.waitForSelector("[aria-label='Workspace invite link']");
const link = await a.$eval("[aria-label='Workspace invite link']", (i) => i.value);
check("turning the link on gives one", /\/join\/workspace\/[A-Za-z0-9_-]{32}$/.test(link), link);

const { page: b, user: sam } = await person("Sam Rivera");
await b.goto(link, { waitUntil: "networkidle0" });
check("the join page names the workspace", /Biology 101/.test(await text(b)) && /draw on them together/.test(await text(b)));
await clickButton(b, "Join workspace");
await b.waitForSelector("[data-testid=workspace-members]", { timeout: 15_000 });
check("joining opens it", b.url().endsWith(`/workspaces/${ws}`) && memberRole(ws, sam.id) === "editor");
check("they see its drawings", (await b.$$("[data-testid=workspace-drawings] li")).length === 1);
check("but not the invite controls", !(await b.$("[aria-label='Invite with a link']")) && !(await b.$("#invite-email")));
check("nor email addresses", !(await text(b, "[data-testid=workspace-members]")).includes("@"));
await b.goto(`${BASE}/drawings/${d1}`, { waitUntil: "load" });
await synced(b);
await drawBox(b, 520, 300);
await synced(b);
check("editors in the workspace can draw on its drawings", elements(d1).length === 2);

// Joining needs a membership.
const { page: n } = await person("Nora Park", { member: false });
await n.goto(link, { waitUntil: "networkidle0" });
check("without a membership, the link asks for one", /part of the membership/.test(await text(n)) && !(await n.$(button("Join workspace"))));

// ------------------------------------------------------------ an emailed invitation
const alexEmail = uniqueEmail("alex");
const sentAt = Date.now();
await a.goto(`${BASE}/workspaces/${ws}`, { waitUntil: "networkidle0" });
await a.type("#invite-email", alexEmail);
await a.select("select[aria-label='They can']", "viewer");
await clickButton(a, "Send invite");
await a.waitForSelector("[data-testid=pending-invites]");
check("an invitation shows as waiting", (await text(a, "[data-testid=pending-invites]")).includes(alexEmail));
const mail = await waitForEmail(alexEmail, /invited you to Biology 101/, { after: sentAt - 1000 });
const mailLink = mail.text.match(/https?:\/\/\S+\/join\/workspace\/[A-Za-z0-9_-]+/)?.[0];
check("and is emailed, with a link", !!mailLink && /Maya Chen/.test(mail.subject), mail.subject);
const sentToken = mailLink.split("/").pop();
const sentHash = createHash("sha256").update(sentToken).digest("hex");
check("only its hash is stored", sql(`select count(*) from workspace_invites where encode(token_hash, 'hex') = '${sentHash}'`) === "1");

// Someone else signed in can't use it.
await n.goto(mailLink, { waitUntil: "networkidle0" });
check("someone with another address can't use it", /for another email address/.test(await text(n)));

const { page: c, user: alex } = await person("Alex Kim", { email: alexEmail });
await c.goto(`${BASE}/workspaces`, { waitUntil: "networkidle0" });
check("it's also waiting on their Workspaces page", /invited you/.test(await text(c, "[data-testid=invitations]")));
await c.goto(mailLink, { waitUntil: "networkidle0" });
await clickButton(c, "Join workspace");
await c.waitForSelector("[data-testid=workspace-members]", { timeout: 15_000 });
check("the emailed link joins them with its role", memberRole(ws, alex.id) === "viewer");
check("and is used up", sql(`select count(*) from workspace_invites where workspace_id='${ws}'`) === "0");

// Viewers: read, not write, and the server agrees.
await c.goto(`${BASE}/drawings/${d1}`, { waitUntil: "load" });
await synced(c);
check("viewers open its drawings view-only", /View only/.test(await text(c, "header")));
const refused = await c.evaluate(async (id) => {
  const res = await fetch(`/api/drawings/${id}/changes`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ client: "viewerclient0000000000000", batches: [] }),
  });
  return res.status;
}, d1);
check("and the server refuses their changes", refused === 403, String(refused));

// A cancelled invitation stops working.
const joEmail = uniqueEmail("jo");
await a.type("#invite-email", joEmail);
await clickButton(a, "Send invite");
const joMail = await waitForEmail(joEmail, /invited you/);
const joLink = joMail.text.match(/https?:\/\/\S+\/join\/workspace\/[A-Za-z0-9_-]+/)?.[0];
await a.waitForSelector(`[aria-label="Cancel the invitation to ${joEmail}"]`);
await a.click(`[aria-label="Cancel the invitation to ${joEmail}"]`);
await waitFor(async () => sql(`select count(*) from workspace_invites where email='${joEmail}'`) === "0");
await n.goto(joLink, { waitUntil: "networkidle0" });
check("a cancelled invitation doesn't work", /doesn.t work/.test(await text(n)));

// ------------------------------------------------------------ roles, live
// Alex is looking at the drawing; making them an editor reaches it at once.
await a.select(roleSelect(a, "Alex Kim"), "editor");
await waitFor(async () => memberRole(ws, alex.id) === "editor");
check("the owner changes roles", memberRole(ws, alex.id) === "editor");
check("and an open drawing becomes editable at once", await waitFor(async () => !/View only/.test(await text(c, "header")), 8000));

await a.select(roleSelect(a, "Sam Rivera"), "admin");
await waitFor(async () => memberRole(ws, sam.id) === "admin");
await b.goto(`${BASE}/workspaces/${ws}`, { waitUntil: "networkidle0" });
check("admins get the invite controls", !!(await b.$("#invite-email")) && !!(await b.$("[aria-label='Invite with a link']")));
check("and see email addresses", (await text(b, "[data-testid=workspace-members]")).includes(alexEmail));
const samsOptions = await b.$$eval(`${roleSelect(b, "Alex Kim")} option`, (os) => os.map((o) => o.value).sort().join(","));
check("admins manage editors and viewers, but can't make admins", samsOptions === "editor,viewer", samsOptions);
check("nor change the owner", !(await b.$(roleSelect(b, "Maya Chen"))));

// Removing someone closes the drawing they have open.
await c.goto(`${BASE}/drawings/${d1}`, { waitUntil: "load" });
await synced(c);
await b.click(`[aria-label="Remove Alex Kim"]`);
await waitFor(async () => memberRole(ws, alex.id) === "");
check("admins can remove people", memberRole(ws, alex.id) === "");
check("and their open drawing says they've lost access", await waitFor(async () => /no longer have access/.test(await text(c)), 8000));
await c.goto(`${BASE}/workspaces/${ws}`, { waitUntil: "networkidle0" });
check("the workspace is closed to them now", /isn.t open to you/.test(await text(c, "main")) && !(await c.$("[data-testid=workspace-drawings]")));

// ------------------------------------------------------------ outsiders
check("and its drawings are a 404, like a drawing that doesn't exist", (await httpStatus(c, `/api/drawings/${d1}/doc`)) === 404);
const missing = "00000000-0000-4000-8000-000000000000";
await c.goto(`${BASE}/workspaces/${missing}`, { waitUntil: "networkidle0" });
check("a workspace that doesn't exist looks the same", /isn.t open to you/.test(await text(c, "main")));

// ------------------------------------------------------------ moving drawings
await a.goto(`${BASE}/`, { waitUntil: "networkidle0" });
await Promise.all([a.waitForNavigation({ waitUntil: "load" }), a.click("main form button[type=submit]")]);
await a.waitForFunction(() => /^\/drawings\//.test(location.pathname));
const d2 = a.url().split("/drawings/")[1];
await synced(a);
await a.goto(`${BASE}/`, { waitUntil: "networkidle0" });
check("a new drawing from the gallery is your own", sql(`select coalesce(workspace_id::text, 'none') from drawings where id='${d2}'`) === "none");
check("drawings in a workspace say so", (await text(a, "section[aria-label='All drawings']")).includes("Biology 101"));
const untitledMenu = await a.$$("section[aria-label='All drawings'] button[aria-label^='More actions']");
// The newest first: d2.
await untitledMenu[0].click();
const [moveItem] = await a.$$(`xpath/.//div[@role='menuitem'][contains(normalize-space(), "Move to Biology 101")]`);
await moveItem.click();
await waitFor(async () => sql(`select workspace_id from drawings where id='${d2}'`) === ws);
check("the ⋯ menu moves one of yours into a workspace", sql(`select workspace_id from drawings where id='${d2}'`) === ws);
check("where its people can open it", (await httpStatus(b, `/api/drawings/${d2}/doc`)) === 200);

// An admin takes it out again: it goes back to Maya alone.
await b.goto(`${BASE}/workspaces/${ws}`, { waitUntil: "networkidle0" });
await waitFor(async () => (await b.$$("[data-testid=workspace-drawings] li")).length === 2);
const menus = await b.$$("[data-testid=workspace-drawings] button[aria-label^='More actions']");
await menus[0].click();
const [takeOut] = await b.$$(`xpath/.//div[@role='menuitem'][contains(normalize-space(), "Take out of Biology 101")]`);
check("admins can take drawings out of the workspace", !!takeOut);
await takeOut.click();
await waitFor(async () => sql(`select coalesce(workspace_id::text, 'none') from drawings where id='${d2}'`) === "none");
check("which gives it back to its owner", sql(`select user_id from drawings where id='${d2}'`) === maya.id && (await httpStatus(b, `/api/drawings/${d2}/doc`)) === 404);

// ------------------------------------------------------------ renaming, leaving
await a.goto(`${BASE}/workspaces/${ws}`, { waitUntil: "networkidle0" });
await a.click("[data-testid=workspace-name]", { count: 3 });
await a.keyboard.down("Control");
await a.keyboard.press("a");
await a.keyboard.up("Control");
await a.keyboard.type("Biology 101, spring");
await a.keyboard.press("Enter");
await waitFor(async () => sql(`select name from workspaces where id='${ws}'`) === "Biology 101, spring");
check("owners and admins rename it in place", sql(`select name from workspaces where id='${ws}'`) === "Biology 101, spring");

await openMenuItem(a, "[aria-label='Workspace actions']", "Delete workspace");
await a.waitForSelector("[data-ui=confirm]");
check("the owner can't leave, only delete", !(await a.$("xpath/.//div[@role='menuitem'][contains(., 'Leave workspace')]")));
await a.keyboard.press("Escape");

await b.goto(`${BASE}/workspaces/${ws}`, { waitUntil: "networkidle0" });
await openMenuItem(b, "[aria-label='Workspace actions']", "Leave workspace");
await b.waitForSelector("[data-ui=confirm]");
await clickButton(b, "Leave");
await b.waitForFunction(() => location.pathname === "/workspaces", { timeout: 15_000 });
check("others can leave", b.url().endsWith("/workspaces") && memberRole(ws, sam.id) === "");

// ------------------------------------------------------------ deleting it
await a.goto(`${BASE}/workspaces/${ws}`, { waitUntil: "networkidle0" });
await openMenuItem(a, "[aria-label='Workspace actions']", "Delete workspace");
await a.waitForSelector("[data-ui=confirm]");
await (await a.waitForSelector("xpath/.//*[@data-ui='confirm']//button[normalize-space()='Delete workspace']")).click();
await a.waitForFunction(() => location.pathname === "/workspaces", { timeout: 15_000 });
check("the owner deletes it", sql(`select count(*) from workspaces where id='${ws}'`) === "0" && a.url().endsWith("/workspaces"));
check("its drawings go back to the people who made them", sql(`select coalesce(workspace_id::text, 'none') || ' ' || user_id from drawings where id='${d1}'`) === `none ${maya.id}`);
check("with nothing lost", elements(d1).length === 2);

check("no page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
await browser.close();
console.log(failures ? `\n${failures} FAILED` : "\nall passed");
process.exit(failures ? 1 : 0);
