// Frames and presenting, end to end: the Frame tool (F) in each shape, a
// click for a view-sized frame, New slide around a selection; frames carry
// what's inside them when moved (Alt: alone), the eraser leaves them be;
// the Slides panel (rename, reorder, delete, double-click a title), the
// style, stage and numbers saved and sent live to another tab; presenting
// (keys, the end, Esc, fade, fly with the canvas showing mid-flight, reduced
// motion), view-only members, and phones.
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
async function waitFor(fn, timeout = 10_000) {
  const t0 = Date.now();
  let value;
  while (Date.now() - t0 < timeout) {
    value = await fn().catch(() => null);
    if (value) return value;
    await sleep(120);
  }
  return value;
}

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--no-sandbox"] });
const errors = [];

const status = (p) => p.$eval("[data-testid=storage-status]", (el) => el.innerText.replace(/\s+/g, " ")).catch(() => "");
const synced = (p) => waitFor(async () => /Saved here.*Synced/.test(await status(p)), 15_000);
const boardBox = (p) =>
  p.$eval("[data-testid=board]", (el) => {
    const b = el.getBoundingClientRect();
    return { x: b.x, y: b.y, w: b.width, h: b.height };
  });
async function drag(p, pts, { alt = false } = {}) {
  const r = await boardBox(p);
  if (alt) await p.keyboard.down("Alt");
  await p.mouse.move(r.x + pts[0][0], r.y + pts[0][1]);
  await p.mouse.down();
  for (const [x, y] of pts.slice(1)) await p.mouse.move(r.x + x, r.y + y, { steps: 6 });
  await p.mouse.up();
  if (alt) await p.keyboard.up("Alt");
}
async function click(p, x, y, opts) {
  const r = await boardBox(p);
  await p.mouse.click(r.x + x, r.y + y, opts);
}
const elements = (id) => JSON.parse(sql(`select data->'elements' from drawings where id='${id}'`) || "[]");
const frames = (id) => elements(id).filter((e) => e.type === "frame");
const byId = (id, elId) => elements(id).find((e) => e.id === elId);
const presentation = (id) => JSON.parse(sql(`select coalesce(presentation, 'null') from drawings where id='${id}'`) || "null");
const panelOpen = (p) => p.$("[data-testid=slides-panel]");
/** Open the Slides panel and let it finish sliding in. */
async function openSlides(p) {
  if (!(await panelOpen(p))) await p.click("[data-testid=slides-button]");
  await p.waitForSelector("[data-testid=slides-panel]");
  await sleep(400);
}
const rows = (p) => p.$$eval("[data-testid=slide-row] [data-testid=slide-title]", (ins) => ins.map((i) => i.value)).catch(() => []);
const checked = (p, sel) => p.$eval(sel, (b) => b.getAttribute("aria-checked") === "true").catch(() => false);
const presenter = (p) => p.$("[data-testid=presenter]");
const slideNo = (p) => p.$eval("[data-testid=presenter]", (el) => el.dataset.slide).catch(() => null);
/** RGB of a pixel on the presenter's canvas, in CSS pixels. */
const pixel = (p, x, y) =>
  p.$eval(
    "[data-testid=presenter-canvas]",
    (c, x, y) => {
      const d = window.devicePixelRatio || 1;
      return [...c.getContext("2d").getImageData(Math.round(x * d), Math.round(y * d), 1, 1).data.slice(0, 3)];
    },
    x,
    y,
  );
/** Where a world point is on the board now (the view moves when slides are shown). */
async function toScreen(p, drawingId, x, y) {
  await sleep(400); // the camera is saved a moment after it moves
  const cam = await p.evaluate((key) => JSON.parse(localStorage.getItem(key)), `canvas-camera:${drawingId}`);
  return [(x - cam.x) * cam.z, (y - cam.y) * cam.z];
}
const near = (a, b, tol = 6) => a.every((v, i) => Math.abs(v - b[i]) <= tol);
const DARK = [32, 31, 36];

// ---------------------------------------------------------------- the editor
const page = await (await browser.createBrowserContext()).newPage();
await page.setViewport({ width: 1280, height: 900 });
page.on("pageerror", (e) => errors.push(e.message));
await signUp(page, { name: "Frame Test" });
await Promise.all([page.waitForNavigation({ waitUntil: "load" }), page.click("main form button[type=submit]")]);
await page.waitForFunction(() => /^\/drawings\/[0-9a-f-]{36}$/.test(location.pathname), { timeout: 15_000 });
const id = page.url().split("/drawings/")[1];
await synced(page);

check("the dock has the Frame tool", (await page.$("[data-testid=tool-dock] [data-items*='Frame']")) !== null);

// Something to show: a squiggle and a box on the left, a circle on the right.
await page.keyboard.press("p");
await drag(page, [[120, 200], [170, 160], [220, 230], [270, 160], [320, 220]]);
await page.keyboard.press("r");
await drag(page, [[140, 300], [300, 400]]);
await page.keyboard.press("o");
await drag(page, [[640, 200], [800, 400]]);
await synced(page);
const [squiggle, box, circle] = elements(id);

await page.keyboard.press("f");
const shapes = await page.$$eval("[role=toolbar][aria-label='Tool options'] [role=radio]", (bs) => bs.map((b) => b.textContent));
check("F picks the Frame tool, with its shapes", shapes.join(",") === "16:9,4:3,Square,Any", shapes.join(","));
check("16:9 to start with", await checked(page, "[data-testid=frame-aspect-16\\:9]"));

// Drag around the left-hand things.
await drag(page, [[90, 130], [420, 460]]);
await synced(page);
let fs = frames(id);
check("dragging makes a frame", fs.length === 1);
const f1 = fs[0];
check("named and numbered as the first slide", f1?.title === "Slide 1" && f1?.order === 1, JSON.stringify(f1));
check("in 16:9, around everything dragged over", Math.abs(f1.w / f1.h - 16 / 9) < 0.01 && f1.h >= 329 && f1.w >= 329, `${f1.w}×${f1.h}`);
check("then it's selected, with the select tool back", await page.$eval("[data-testid=tool-dock] button[data-tool='Select']", (b) => b.getAttribute("aria-pressed") === "true"));
check("and offers Present", (await page.$$("xpath/.//*[@role='toolbar'][@aria-label='Selection']//button[normalize-space()='Present']")).length === 1);

// A click with the tool: a frame the size of most of the view, numbered next.
await page.keyboard.press("Escape");
await page.keyboard.press("f");
const bb = await boardBox(page);
await click(page, bb.w * 0.72, bb.h * 0.72);
await synced(page);
fs = frames(id);
const f2 = fs.find((f) => f.id !== f1.id);
check("a click makes a second, view-sized frame", fs.length === 2 && f2.title === "Slide 2" && f2.order === 2 && Math.abs(f2.w - bb.w * 0.6) < 2, f2 && `${f2.w} vs ${bb.w * 0.6}`);

// Square, by shape.
await page.keyboard.press("f");
await page.click("[data-testid=frame-aspect-1\\:1]");
await drag(page, [[500, 520], [620, 560]]);
await synced(page);
fs = frames(id);
const f3 = fs.find((f) => f.id !== f1.id && f.id !== f2.id);
check("Square makes square frames", f3 && f3.w === f3.h && f3.w >= 120, f3 && `${f3.w}×${f3.h}`);
await page.keyboard.press("f");
await page.click("[data-testid=frame-aspect-16\\:9]");
await page.keyboard.press("v");

// ------------------------------------------------------------ moving frames
// Grab the first frame by its title, just above its top-left corner.
const cam0 = { x: f1.x, y: f1.y };
const titleAt = [90 + 12, 130 - 12];
await drag(page, [titleAt, [titleAt[0] + 60, titleAt[1] + 40]]);
await synced(page);
let moved = byId(id, f1.id);
const dx = moved.x - cam0.x;
const dy = moved.y - cam0.y;
check("a frame moves by its title", Math.abs(dx - 60) < 2 && Math.abs(dy - 40) < 2, `${dx},${dy}`);
const sq = byId(id, squiggle.id);
const bx = byId(id, box.id);
check("and takes what's inside along", Math.abs(sq.points[0] - squiggle.points[0] - dx) < 0.5 && Math.abs(bx.y - box.y - dy) < 0.5);
check("but not what's only partly or not at all inside", byId(id, circle.id).x === circle.x);

// Alt: the frame alone.
const titleNow = [titleAt[0] + 60, titleAt[1] + 40];
await drag(page, [titleNow, [titleNow[0] - 60, titleNow[1] - 40]], { alt: true });
await synced(page);
moved = byId(id, f1.id);
check("with Alt the frame moves alone", Math.abs(moved.x - cam0.x) < 2 && Math.abs(byId(id, box.id).y - bx.y) < 0.5);

// Clicking inside a frame picks what's drawn there, not the frame.
await click(page, 220 + 60 - 60, 400 + 40 - 40);
await sleep(150);
check("inside a frame, things drawn there stay clickable", (await page.$$("xpath/.//*[@role='toolbar'][@aria-label='Selection']//button[normalize-space()='Present']")).length === 0);
await page.keyboard.press("Escape");

// The whole-stroke eraser doesn't take frames.
await page.keyboard.press("e");
const fBefore = frames(id).length;
await drag(page, [[400, 600], [700, 600]]);
await page.keyboard.press("v");
await synced(page);
check("the eraser leaves frames alone", frames(id).length === fBefore);

// ------------------------------------------------------------ the Slides panel
await openSlides(page);
check("Slides opens the panel with a row per frame", (await rows(page)).join(",") === "Slide 1,Slide 2,Slide 3", (await rows(page)).join(","));
check("each with a picture", (await page.$$("[data-testid=slide-row] canvas")).length === 3);

const titles = await page.$$("[data-testid=slide-title]");
await titles[0].click();
await page.keyboard.down("Control");
await page.keyboard.press("a");
await page.keyboard.up("Control");
await page.keyboard.type("Photosynthesis");
await page.keyboard.press("Enter");
await synced(page);
check("renaming a slide saves its title", byId(id, f1.id).title === "Photosynthesis");

const moveDown = await page.$$("[data-testid=slide-row] button[aria-label='Move down']");
await moveDown[0].click();
await synced(page);
check("Move down reorders", (await rows(page)).join(",") === "Slide 2,Photosynthesis,Slide 3", (await rows(page)).join(","));
check("by renumbering the frames", byId(id, f2.id).order === 1 && byId(id, f1.id).order === 2);

const del = await page.$$("[data-testid=slide-row] button[aria-label^='Delete slide']");
await del[2].click();
await synced(page);
check("deleting a slide removes its frame only", frames(id).length === 2 && elements(id).length === 5);

// Double-clicking a frame's title shows it in the panel, ready to rename.
await page.click("[data-testid=slides-button]");
await waitFor(async () => !(await panelOpen(page)));
const f1now = byId(id, f1.id);
await click(page, titleAt[0], titleAt[1], { count: 2 });
await page.waitForSelector("[data-testid=slides-panel]");
const focused = await waitFor(() => page.evaluate(() => document.activeElement?.getAttribute("data-testid") === "slide-title" && document.activeElement.value));
check("double-clicking a frame's title opens it in the panel", focused === f1now.title, String(focused));
await page.keyboard.press("Escape");

// ------------------------------------------------------------ style, live to another tab
const page2 = await page.browserContext().newPage();
await page2.setViewport({ width: 1280, height: 900 });
await page2.goto(`${BASE}/drawings/${id}`, { waitUntil: "load" });
await synced(page2);
await openSlides(page2);
await page.bringToFront(); // background tabs don't paint, so clicks there would wait forever

check("Fade to start with", await checked(page, "[data-testid=style-fade]"));
await page.click("[data-testid=style-journey]");
await page.click("[data-testid=stage-paper]");
await page.click("[data-testid=slide-numbers]");
await waitFor(async () => presentation(id)?.numbers === false);
const saved = presentation(id);
check("the style is saved with the drawing", saved?.style === "journey" && saved?.stage === "paper" && saved?.numbers === false, JSON.stringify(saved));
check("and reaches others looking at it", await waitFor(() => checked(page2, "[data-testid=style-journey]"), 8000));
check("stage and numbers too", (await checked(page2, "[data-testid=stage-paper]")) && !(await checked(page2, "[data-testid=slide-numbers]")));
await page2.close();
await page.reload({ waitUntil: "load" });
await synced(page);
await openSlides(page);
check("and it's there after reloading", await checked(page, "[data-testid=style-journey]"));

// ------------------------------------------------------------ presenting
await page.click("[data-testid=style-fade]");
await page.click("[data-testid=stage-dark]");
await page.click("[data-testid=slide-numbers]");
await waitFor(async () => presentation(id)?.numbers === true && presentation(id)?.style === "fade");
await page.click("[data-testid=present]");
await page.waitForSelector("[data-testid=presenter]");
check("Present shows the first slide", (await slideNo(page)) === "1");
await sleep(300);
check("on a dark stage", near(await pixel(page, 4, 4), DARK));
const bg = sql(`select data->>'background' from drawings where id='${id}'`);
const bgRgb = [1, 3, 5].map((i) => parseInt(bg.slice(i, i + 2), 16));
check("with the drawing's background inside the slide", near(await pixel(page, 640, 150), bgRgb, 4), `${await pixel(page, 640, 150)} vs ${bg}`);
check("frames themselves don't show", await page.$eval("[data-testid=presenter-canvas]", (c) => {
  // The dashed grey of a frame outline, anywhere along the slide's edge row, would be #b3b3b3.
  const ctx = c.getContext("2d");
  const d = ctx.getImageData(0, 0, c.width, c.height).data;
  let grey = 0;
  for (let i = 0; i < d.length; i += 4) if (Math.abs(d[i] - 179) < 3 && Math.abs(d[i + 1] - 179) < 3 && Math.abs(d[i + 2] - 179) < 3) grey++;
  return grey < 20;
}));
await page.keyboard.press("ArrowRight");
await waitFor(async () => (await slideNo(page)) === "2", 3000);
check("→ goes to the next slide", (await slideNo(page)) === "2");
await page.mouse.move(10, 10);
await sleep(2900);
check("numbers in the corner once the controls tuck away", (await page.$eval("[data-testid=presenter-count]", (n) => n.textContent).catch(() => "")) === "2 / 2");
await page.keyboard.press("ArrowRight");
await waitFor(async () => (await slideNo(page)) === "end", 3000);
check("past the last slide: the end", (await slideNo(page)) === "end" && /End of the slides/.test(await page.$eval("[data-testid=presenter]", (n) => n.innerText)));
await page.keyboard.press("ArrowLeft");
await waitFor(async () => (await slideNo(page)) === "2", 3000);
await page.keyboard.press("Home");
await waitFor(async () => (await slideNo(page)) === "1", 3000);
check("← and Home go back", (await slideNo(page)) === "1");
const before = elements(id).length;
await page.keyboard.press("Delete");
await page.keyboard.press("p");
await sleep(200);
check("keys don't reach the board underneath", elements(id).length === before && (await presenter(page)) !== null);
await page.keyboard.press("Escape");
await waitFor(async () => !(await presenter(page)));
check("Esc stops presenting", !(await presenter(page)));
check(
  "and the board shows the slide you were on, selected",
  (await page.$$("xpath/.//*[@role='toolbar'][@aria-label='Selection']//button[normalize-space()='Present']")).length === 1,
);

// Fly: the canvas shows mid-flight, then the stage closes around the next slide.
await page.click("[data-testid=style-journey]");
await waitFor(async () => presentation(id)?.style === "journey");
const rowPresent = await page.$$("[data-testid=slide-row] button[aria-label^='Present from slide']");
await rowPresent[0].click();
await page.waitForSelector("[data-testid=presenter]");
await sleep(300);
check("presenting from a row starts there", (await slideNo(page)) === "1");
await page.keyboard.press("ArrowRight");
await sleep(Math.round(280));
const mid = await pixel(page, 4, 4);
check("mid-flight the canvas shows through the stage", !near(mid, DARK, 10), mid.join(","));
await sleep(1800);
check("and settles on the next slide, on the stage", (await slideNo(page)) === "2" && near(await pixel(page, 4, 4), DARK));
await page.click("[data-testid=presenter-exit]");
await waitFor(async () => !(await presenter(page)));

// Reduced motion: no transitions at all.
await page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "reduce" }]);
await page.click("[data-testid=present]");
await page.waitForSelector("[data-testid=presenter]");
await sleep(200);
await page.keyboard.press("ArrowRight");
await waitFor(async () => (await slideNo(page)) === "2", 2000);
const calm = [];
for (let i = 0; i < 4; i++) {
  calm.push(await pixel(page, 4, 4));
  await sleep(70);
}
// Flying, the corner would show the canvas within a frame or two; with reduced motion it stays stage.
check("with reduced motion, slides change at once", calm.every((px) => near(px, DARK)) && (await slideNo(page)) === "2", calm.map((p) => p.join(",")).join(" "));
await page.keyboard.press("Escape");
await page.emulateMediaFeatures([]);

// ------------------------------------------------------------ New slide around a selection
await page.keyboard.press("Escape"); // close the panel
await waitFor(async () => !(await panelOpen(page)));
const circleNow = byId(id, circle.id);
const [cx, cy] = await toScreen(page, id, circleNow.x + 2, circleNow.y + circleNow.h / 2);
await click(page, cx, cy); // the circle's edge
await sleep(150);
await openSlides(page);
await (await page.$$("xpath/.//*[@data-testid='slides-panel']//button[normalize-space()='New slide']"))[0].click();
await synced(page);
const around = frames(id).find((f) => f.id !== f1.id && f.id !== f2.id);
const c = byId(id, circle.id);
check(
  "New slide frames what's selected",
  around && around.x < c.x && around.y < c.y && around.x + around.w > c.x + c.w && around.y + around.h > c.y + c.h,
  JSON.stringify(around),
);
check("and adds it as the last slide", (await rows(page)).length === 3 && around.title === "Slide 3");

// Undo takes a new frame away again.
await page.keyboard.press("Escape");
await page.click("[data-testid=board]").catch(() => {});
await page.keyboard.down("Control");
await page.keyboard.press("z");
await page.keyboard.up("Control");
await synced(page);
check("undo removes a frame like anything else", frames(id).length === 2);


// ------------------------------------------------------------ view only
const viewerPage = await (await browser.createBrowserContext()).newPage();
await viewerPage.setViewport({ width: 1280, height: 900 });
const viewer = await signUp(viewerPage, { name: "Frame Viewer" });
sql(`insert into drawing_members (drawing_id, user_id, role) values ('${id}', '${viewer.id}', 'viewer')`);
await viewerPage.goto(`${BASE}/drawings/${id}`, { waitUntil: "load" });
await synced(viewerPage);
check("view-only members don't get the Frame tool", (await viewerPage.$("[data-testid=tool-dock] [data-items*='Frame']")) === null);
await openSlides(viewerPage);
check(
  "they see the slides but can't change them",
  (await rows(viewerPage)).length === 2 &&
    (await viewerPage.$eval("[data-testid=style-fade]", (b) => b.disabled)) &&
    (await viewerPage.$eval("[data-testid=slide-title]", (i) => i.readOnly)) &&
    !(await viewerPage.$("[data-testid=slide-row] button[aria-label='Move down']")),
);
await viewerPage.click("[data-testid=present]");
await viewerPage.waitForSelector("[data-testid=presenter]");
check("and can present them", (await slideNo(viewerPage)) === "1");
await viewerPage.keyboard.press("Escape");

// ------------------------------------------------------------ phones
const phone = await (await browser.createBrowserContext()).newPage();
await phone.setViewport({ width: 390, height: 780, isMobile: true, hasTouch: true });
const phoneUser = await signUp(phone, { name: "Frame Phone" });
sql(`insert into drawing_members (drawing_id, user_id, role) values ('${id}', '${phoneUser.id}', 'editor')`);
await phone.goto(`${BASE}/drawings/${id}`, { waitUntil: "load" });
await synced(phone);
await phone.click("button[aria-label=More]");
const [slidesItem] = await phone.$$("xpath/.//div[@role='menuitem'][contains(normalize-space(), 'Slides')]");
check("on phones, Slides is in the More menu", !!slidesItem);
await slidesItem.click();
await phone.waitForSelector("[data-testid=slides-panel]");
await sleep(500);
await phone.tap("[data-testid=present]");
await phone.waitForSelector("[data-testid=presenter]");
await sleep(300);
const touch = await phone.$("[data-testid=presenter-canvas]");
const tb = await touch.boundingBox();
await phone.touchscreen.touchStart(tb.x + 300, tb.y + 400);
await phone.touchscreen.touchMove(tb.x + 120, tb.y + 405);
await phone.touchscreen.touchEnd();
await waitFor(async () => (await slideNo(phone)) === "2", 3000);
check("a swipe moves to the next slide", (await slideNo(phone)) === "2");
await sleep(3400); // the controls tuck away (2.5 s, then a 0.3 s fade)
check("the controls tuck away", await phone.$eval("[data-testid=presenter-exit]", (b) => getComputedStyle(b.parentElement).opacity === "0"));
await phone.touchscreen.tap(tb.x + tb.width / 2, tb.y + tb.height / 2);
await sleep(400);
check("a tap in the middle brings them back, staying on the slide", (await slideNo(phone)) === "2" && (await phone.$eval("[data-testid=presenter-exit]", (b) => getComputedStyle(b.parentElement).opacity === "1")));
await phone.tap("[data-testid=presenter-exit]");
await waitFor(async () => !(await presenter(phone)));
check("and there's a way out", !(await presenter(phone)));

check("no page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
await browser.close();
console.log(failures ? `\n${failures} FAILED` : "\nall passed");
process.exit(failures ? 1 : 0);
