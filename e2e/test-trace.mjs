// "Trace a picture", end to end: a photo of a math equation and a blackboard
// chemistry equation go through the dialog (the box starts around the
// writing, can be dragged, resized and moved with the keyboard; the preview
// and count follow it; Whole picture; Detail), then onto the canvas as pen
// strokes in the pen colour, the shape of the original, selected, saved, and
// gone with one undo. Plus the U key, phones, and a file that isn't a picture.
// Run against `npm run build && npm start` (see README, Tests); uses DATABASE_URL.
import puppeteer from "puppeteer-core";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import nextEnv from "@next/env";

nextEnv.loadEnvConfig(process.cwd());
const { sleep, sql, signUp, pickTool, chooseFile } = await import("./helpers.mjs");

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

// ---------------------------------------------------------------- pictures
// Drawn in a browser, so they're real PNGs: a photo of a page (shaded paper,
// grain, a fraction and a square root, with empty paper around), a blackboard
// with chalk chemistry, and a file that isn't a picture at all.
const dir = mkdtempSync(join(tmpdir(), "canvas-trace-"));
const maker = await browser.newPage();
const pictures = await maker.evaluate(() => {
  const png = (w, h, draw) => {
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    draw(c.getContext("2d"), w, h);
    return c.toDataURL("image/png").split(",")[1];
  };
  const grain = (ctx, w, h, amount) => {
    const img = ctx.getImageData(0, 0, w, h);
    let r = 11;
    for (let i = 0; i < img.data.length; i += 4) {
      r = (r * 1103515245 + 12345) & 0x7fffffff;
      const n = ((r / 0x7fffffff) - 0.5) * amount;
      img.data[i] += n;
      img.data[i + 1] += n;
      img.data[i + 2] += n;
    }
    ctx.putImageData(img, 0, 0);
  };
  return {
    math: png(1200, 800, (ctx, w, h) => {
      const g = ctx.createLinearGradient(0, 0, w, h);
      g.addColorStop(0, "#f6f3ec");
      g.addColorStop(1, "#9c968a");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = ctx.strokeStyle = "#23232e";
      ctx.lineWidth = 7;
      ctx.lineCap = "round";
      ctx.font = "84px serif";
      ctx.fillText("x + 1", 330, 330);
      ctx.beginPath();
      ctx.moveTo(300, 362);
      ctx.lineTo(560, 362);
      ctx.stroke();
      ctx.fillText("2", 410, 450);
      ctx.fillText("=", 600, 390);
      ctx.beginPath();
      ctx.moveTo(690, 380);
      ctx.lineTo(712, 368);
      ctx.lineTo(735, 450);
      ctx.lineTo(770, 300);
      ctx.lineTo(900, 300);
      ctx.stroke();
      ctx.fillText("y²", 785, 400);
      grain(ctx, w, h, 36);
    }),
    chem: png(900, 300, (ctx, w, h) => {
      ctx.fillStyle = "#243a30";
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = "#eef0e6";
      ctx.font = "70px sans-serif";
      ctx.fillText("CH₄ + 2O₂ → CO₂", 120, 180);
      grain(ctx, w, h, 24);
    }),
  };
});
await maker.close();
const mathFile = join(dir, "math-photo.png");
const chemFile = join(dir, "blackboard.png");
const textFile = join(dir, "notes.png");
writeFileSync(mathFile, Buffer.from(pictures.math, "base64"));
writeFileSync(chemFile, Buffer.from(pictures.chem, "base64"));
writeFileSync(textFile, "this is not a picture");

// ---------------------------------------------------------------- the editor
const page = await (await browser.createBrowserContext()).newPage();
await page.setViewport({ width: 1280, height: 900 });
page.on("pageerror", (e) => errors.push(e.message));
await signUp(page, { name: "Trace Test" });
await Promise.all([page.waitForNavigation({ waitUntil: "load" }), page.click("main form button[type=submit]")]);
await page.waitForFunction(() => /^\/drawings\/[0-9a-f-]{36}$/.test(location.pathname), { timeout: 15_000 });
const drawingId = page.url().split("/drawings/")[1];
const status = () => page.$eval("[data-testid=storage-status]", (b) => b.innerText.replace(/\s+/g, " ")).catch(() => "");
await waitFor(async () => /Saved here/.test(await status()), 15_000);
const items = () => page.$eval("[data-testid=board]", (el) => Number(el.getAttribute("aria-label").match(/with (\d+) items/)[1]));
const dialogOpen = () => page.$("[role=dialog] [data-testid=trace-picture]");
const statusText = () => page.$eval("[role=dialog] [role=status]", (n) => n.textContent).catch(() => "");
const strokeCount = async () => Number((await statusText()).match(/^(\d+) strokes?/)?.[1] ?? NaN);
const settled = () => waitFor(async () => /^\d+ strokes?|No writing/.test(await statusText()), 10_000);
const boxRect = () => page.$eval("[data-testid=trace-box]", (b) => { const r = b.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
const pictureRect = () => page.$eval("[data-testid=trace-picture]", (b) => { const r = b.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
const button = (label) => `xpath/.//*[@role='dialog']//button[normalize-space()="${label}"]`;

// A blue pen first: the strokes come out in the pen colour.
await page.keyboard.press("p");
await page.click("[role=group][aria-label=Colour] button[aria-label=Blue]");

check("the dock has Trace a picture", (await page.$("[data-testid=tool-dock] [data-items*='Trace a picture']")) !== null);
const chooser = await chooseFile(page, () => page.keyboard.press("u"));
check("U opens the picture chooser, for pictures only", !chooser.isMultiple() && (await page.$eval("[data-testid=trace-input]", (i) => i.accept)) === "image/*");
await chooser.accept([mathFile]);
await page.waitForSelector("[data-testid=trace-box]", { timeout: 10_000 });
await settled();
const pic = await pictureRect();
const box0 = await boxRect();
check("the dialog shows the picture", !!(await dialogOpen()) && pic.w > 300, `${Math.round(pic.w)}×${Math.round(pic.h)}`);
check(
  "the box starts around the writing, not the whole photo",
  box0.w < pic.w * 0.8 && box0.h < pic.h * 0.6 && box0.x > pic.x + 10,
  `${Math.round(box0.w)}×${Math.round(box0.h)} of ${Math.round(pic.w)}×${Math.round(pic.h)}`,
);
const n0 = await strokeCount();
check("it says how many strokes the writing makes", n0 >= 8 && n0 < 200, String(n0));
const previewInk = await page.$eval("[data-testid=trace-preview]", (c) => {
  const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
  let blue = 0;
  for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 200 && d[i + 2] > d[i] + 40) blue++;
  return blue;
});
check("the preview draws them in the pen colour", previewInk > 500, String(previewInk));
check("light writing on dark is off for paper", (await page.$eval("[role=dialog] [role=switch]", (s) => s.getAttribute("aria-checked"))) === "false");

// Drag the right edge in, past the square root: fewer strokes.
const right = await page.$("[data-testid=trace-box] [data-handle=e]");
const rb = await right.boundingBox();
await page.mouse.move(rb.x + rb.width / 2, rb.y + rb.height / 2);
await page.mouse.down();
await page.mouse.move(box0.x + box0.w * 0.45, rb.y + rb.height / 2, { steps: 8 });
await page.mouse.up();
await sleep(300);
await settled();
const n1 = await strokeCount();
const box1 = await boxRect();
check("dragging an edge resizes the box, and the strokes follow", box1.w < box0.w * 0.6 && n1 < n0, `${n0} → ${n1}`);

// Move it with the keyboard.
await page.focus("[data-testid=trace-box]");
for (let i = 0; i < 5; i++) await page.keyboard.press("ArrowRight");
const box2 = await boxRect();
check("arrow keys move the box", box2.x > box1.x + 5 && Math.abs(box2.w - box1.w) < 1, `${Math.round(box1.x)} → ${Math.round(box2.x)}`);
await page.keyboard.down("Shift");
for (let i = 0; i < 5; i++) await page.keyboard.press("ArrowRight");
await page.keyboard.up("Shift");
check("Shift and arrow keys resize it", (await boxRect()).w > box2.w + 5);

// Draw a new box around the left half (the fraction) by dragging outside the current one.
await page.mouse.move(pic.x + 3, pic.y + 3);
await page.mouse.down();
await page.mouse.move(box0.x + box0.w * 0.42, box0.y + box0.h + 2, { steps: 10 });
await page.mouse.up();
await sleep(300);
await settled();
const fraction = await boxRect();
check("dragging outside the box draws a new one", fraction.x < pic.x + 8 && fraction.y < pic.y + 8);

await page.click(button("Whole picture"));
await settled();
check("Whole picture boxes everything", Math.abs((await boxRect()).w - pic.w) < 2);
// Back to just the writing, for adding.
await page.mouse.move(box0.x, box0.y);
await page.mouse.down();
await page.mouse.move(box0.x + box0.w, box0.y + box0.h, { steps: 10 });
await page.mouse.up();
await sleep(300);
await settled();

const nAdd = await strokeCount();
const before = await items();
await page.click(button("Add to canvas"));
await page.waitForFunction(() => !document.querySelector("[role=dialog] [data-testid=trace-picture]"), { timeout: 5000 });
const after = await waitFor(async () => ((await items()) > before ? items() : null));
check("Add to canvas puts every stroke on the board", after - before === nAdd, `${before} + ${nAdd} → ${after}`);
check("…and says so", await waitFor(async () => /Added \d+ strokes/.test(await page.evaluate(() => document.body.innerText))));
check("they're selected, ready to move", (await page.$("button[aria-label='Delete selection']")) !== null);

await waitFor(async () => /Synced/.test(await status()), 15_000);
const saved = JSON.parse(sql(`select coalesce(jsonb_agg(e), '[]') from drawings, jsonb_array_elements(data->'elements') e where id = '${drawingId}' and e->>'type' = 'stroke'`));
check(
  "saved as marker strokes in the pen colour (Blue)",
  saved.length === nAdd && saved.every((s) => s.color === "#3f82b2" && s.brush === "marker" && s.size >= 0.5),
  `${saved.length} strokes`,
);
const xs = saved.flatMap((s) => s.points.filter((_, i) => i % 2 === 0));
const ys = saved.flatMap((s) => s.points.filter((_, i) => i % 2 === 1));
const w = Math.max(...xs) - Math.min(...xs);
const h = Math.max(...ys) - Math.min(...ys);
// The writing in the picture is about 600 × 200 (from x+1 to the end of the root's bar).
check("the strokes have the writing's shape", w / h > 2.2 && w / h < 3.8, `${Math.round(w)}×${Math.round(h)}`);

await page.keyboard.down("Control");
await page.keyboard.press("z");
await page.keyboard.up("Control");
check("one undo takes them all off again", await waitFor(async () => (await items()) === before), String(await items()));
await page.keyboard.down("Control");
await page.keyboard.press("y");
await page.keyboard.up("Control");
await waitFor(async () => (await items()) === after);

// ---------------------------------------------------------------- blackboard chemistry
const chooser2 = await chooseFile(page, () => pickTool(page, "Trace a picture"));
await chooser2.accept([chemFile]);
await page.waitForSelector("[data-testid=trace-box]");
await settled();
check("a blackboard is read as light writing on a dark background", (await page.$eval("[role=dialog] [role=switch]", (s) => s.getAttribute("aria-checked"))) === "true");
const chemStrokes = await strokeCount();
check("chalk chemistry traces too", chemStrokes >= 10, String(chemStrokes));
await page.click("[role=dialog] [role=switch]");
await settled();
check("turning it off reads the board as ink instead", /No writing|too much/.test(await statusText()) || (await strokeCount()) !== chemStrokes);
await page.click("[role=dialog] [role=switch]");
await settled();
await page.$eval("#trace-detail", (s) => {
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
  set.call(s, "0");
  s.dispatchEvent(new Event("input", { bubbles: true }));
});
await settled();
check("Detail changes what's found", (await strokeCount()) <= chemStrokes);

// Choose another picture, from inside the dialog.
const chooser3 = await chooseFile(page, () => page.click(button("Choose another picture")));
await chooser3.accept([textFile]);
check(
  "a file that isn't a picture says so and closes",
  await waitFor(async () => /isn't a picture this browser can open/.test(await page.evaluate(() => document.body.innerText))),
);
check("…without adding anything", !(await dialogOpen()) && (await items()) === after);

// Cancel adds nothing.
const chooser4 = await chooseFile(page, () => page.keyboard.press("u"));
await chooser4.accept([mathFile]);
await page.waitForSelector("[data-testid=trace-box]");
await page.click(button("Cancel"));
await sleep(300);
check("Cancel adds nothing", !(await dialogOpen()) && (await items()) === after);

// ---------------------------------------------------------------- a phone
const phone = await (await browser.createBrowserContext()).newPage();
await phone.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
phone.on("pageerror", (e) => errors.push(e.message));
await signUp(phone, { name: "Trace Phone" });
await Promise.all([phone.waitForNavigation({ waitUntil: "load" }), phone.click("main form button[type=submit]")]);
await phone.waitForFunction(() => /^\/drawings\//.test(location.pathname), { timeout: 15_000 });
await phone.waitForSelector("[data-testid=tool-dock]", { timeout: 10_000 });
const chooser5 = await chooseFile(phone, () => pickTool(phone, "Trace a picture"));
await chooser5.accept([mathFile]);
await phone.waitForSelector("[data-testid=trace-box]");
await waitFor(async () => /^\d+ strokes?/.test(await phone.$eval("[role=dialog] [role=status]", (n) => n.textContent)));
const fits = await phone.evaluate(() => {
  const d = document.querySelector("[role=dialog]").getBoundingClientRect();
  const p = document.querySelector("[data-testid=trace-picture]").getBoundingClientRect();
  return d.right <= innerWidth + 1 && p.right <= d.right && document.documentElement.scrollWidth <= innerWidth;
});
check("on a phone the dialog and picture fit the screen", fits);
const addBtn = await phone.$("xpath/.//*[@role='dialog']//button[normalize-space()='Add to canvas']");
await addBtn.tap();
check("and Add to canvas works there too", await waitFor(async () => !(await phone.$("[role=dialog] [data-testid=trace-picture]"))));

check("no page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
await browser.close();
console.log(failures ? `\n${failures} FAILED` : "\nall passed");
process.exit(failures ? 1 : 0);
