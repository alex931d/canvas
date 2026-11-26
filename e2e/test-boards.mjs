// To-do boards, GIFs and videos, end to end: placing a board, adding,
// opening, editing, dragging and deleting cards, columns, moving cards
// between boards, undo, resizing; GIF animation and pausing; video upload,
// play and pause, byte-range streaming, size and type limits, refused
// uploads being undone, and a view-only collaborator playing a video with
// reduced motion on. Run against `npm start`.
import puppeteer from "puppeteer-core";
import nextEnv from "@next/env";
import { randomUUID } from "node:crypto";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

nextEnv.loadEnvConfig(process.cwd());
const { signUp, sql, sleep } = await import("./helpers.mjs");
const CHROME = process.env.CHROME_PATH ?? "/usr/bin/google-chrome";
const FIXTURES = new URL("./fixtures/", import.meta.url).pathname;

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

const launch = () =>
  puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--no-sandbox"], defaultViewport: { width: 1440, height: 900 } });
const [browserA, browserB] = await Promise.all([launch(), launch()]);
const a = await browserA.newPage();
const errors = [];
const watch = (name, p) => {
  p.on("pageerror", (e) => errors.push(`${name} pageerror: ${e.message}`));
  p.on("console", (m) => {
    // Refused uploads, bad ranges and a bad board are part of the test.
    if (m.type() === "error" && !/status of (413|415|416|422)/.test(m.text())) errors.push(`${name} console: ${m.text()}`);
  });
};
watch("A", a);

const status = (p) => p.$eval("[data-testid=storage-status]", (el) => el.innerText.replace(/\s+/g, " ")).catch(() => "");
const synced = (p) => waitFor(async () => /Saved here.*Synced/.test(await status(p)), 10_000);
const elements = (id) => JSON.parse(sql(`select data->'elements' from drawings where id='${id}'`) || "[]");
const boards = (id) => elements(id).filter((e) => e.type === "kanban");
const cards = (board) => board.columns.map((c) => c.cards.map((k) => k.text).join(",")).join(" | ");
const dialog = (p, label) => p.waitForSelector(`[role=dialog][aria-label='${label}']`, { timeout: 5000 });
const noDialog = (p) => waitFor(async () => !(await p.$("[role=dialog]")), 4000);
/** The dialog puts the cursor in its field a frame after it opens; wait for that, then select what's there. */
const selectField = async (p, sel) => {
  await p.waitForFunction((sel) => document.activeElement === document.querySelector(sel), { timeout: 3000 }, sel).catch(() => {});
  await p.$eval(sel, (t) => t.select());
};
const button = (label) => `xpath/.//button[normalize-space()='${label}']`;
const toolbar = (label) => `[role=toolbar][aria-label=Selection] button[aria-label='${label}']`;
const toastText = (p) => p.$$eval("[data-toast]", (ts) => ts.map((t) => t.innerText).join(" | ")).catch(() => "");

// ------------------------------------------------------------ screen <-> world

async function view(p, id) {
  const rect = await p.$eval("[data-testid=board]", (el) => {
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  });
  await sleep(400); // the camera is saved 300 ms after it moves
  const cam = await p.evaluate((id) => JSON.parse(localStorage.getItem(`canvas-camera:${id}`)), id);
  return { rect, cam, at: (wx, wy) => ({ x: rect.x + (wx - cam.x) * cam.z, y: rect.y + (wy - cam.y) * cam.z }) };
}

// Board layout (src/lib/canvas/kanban.ts) for one-line cards, as screen points through `v`.
const K = { pad: 14, titleH: 36, colGap: 10, colPad: 8, headH: 32, card: 35, gap: 6, add: 30 };
function geometry(b, view = v) {
  const s = b.scale;
  const n = b.columns.length;
  const colW = (b.w / s - K.pad * 2 - K.colGap * (n - 1)) / n;
  const colX = (i) => b.x + (K.pad + i * (colW + K.colGap)) * s;
  const top = b.y + (K.pad + K.titleH) * s;
  const tallest = Math.max(...b.columns.map((c) => c.cards.length));
  const colH = K.headH + tallest * (K.card + K.gap) + K.add + K.colPad;
  const at = (x, y) => view.at(x, y);
  return {
    /** World size. */
    w: b.w,
    h: (K.pad + K.titleH + colH + K.pad) * s,
    card: (i, j) => at(colX(i) + (K.colPad + 40) * s, top + (K.headH + j * (K.card + K.gap) + 17) * s),
    add: (i) => at(colX(i) + (K.colPad + 30) * s, top + (K.headH + b.columns[i].cards.length * (K.card + K.gap) + 15) * s),
    header: (i) => at(colX(i) + 60 * s, top + 16 * s),
    title: () => at(b.x + (K.pad + 20) * s, b.y + (K.pad + 12) * s),
    /** Just above slot j of column i (j counts cards without the dragged one). */
    slot: (i, j) => at(colX(i) + (colW / 2) * s, top + (K.headH + j * (K.card + K.gap) + 3) * s),
  };
}

async function drag(p, from, to, { shift = false } = {}) {
  if (shift) await p.keyboard.down("Shift");
  await p.mouse.move(from.x, from.y);
  await p.mouse.down();
  await p.mouse.move(from.x + 12, from.y + 6, { steps: 3 });
  await p.mouse.move(to.x, to.y, { steps: 10 });
  await p.mouse.up();
  if (shift) await p.keyboard.up("Shift");
}
const click = (p, pt) => p.mouse.click(pt.x, pt.y);

/** A cheap fingerprint of the canvas pixels in a screen rectangle. */
const pixels = (p, r) =>
  p.$eval(
    "[data-testid=board]",
    (canvas, r) => {
      const box = canvas.getBoundingClientRect();
      const dpr = canvas.width / box.width;
      const d = canvas
        .getContext("2d")
        .getImageData(Math.round((r.x - box.x) * dpr), Math.round((r.y - box.y) * dpr), Math.round(r.w * dpr), Math.round(r.h * dpr)).data;
      let h = 0;
      for (let i = 0; i < d.length; i += 16) h = (h * 31 + d[i] + d[i + 1] * 3 + d[i + 2] * 7) >>> 0;
      return h;
    },
    r,
  );
const pixelAt = (p, pt) =>
  p.$eval(
    "[data-testid=board]",
    (canvas, pt) => {
      const box = canvas.getBoundingClientRect();
      const dpr = canvas.width / box.width;
      return [...canvas.getContext("2d").getImageData(Math.round((pt.x - box.x) * dpr), Math.round((pt.y - box.y) * dpr), 1, 1).data];
    },
    pt,
  );
async function changesOver(p, r, ms = 900) {
  const first = await pixels(p, r);
  return waitFor(async () => (await pixels(p, r)) !== first, ms);
}

// ------------------------------------------------------------ a board
await signUp(a, { name: "Ana Torres" });
await Promise.all([a.waitForNavigation({ waitUntil: "load" }), a.click("main form button[type=submit]")]);
await a.waitForFunction(() => /^\/drawings\/[0-9a-f-]{36}$/.test(location.pathname), { timeout: 15_000 }); // the redirect is client-side
const id = a.url().split("/drawings/")[1];
await synced(a);
let v = await view(a, id);

await a.keyboard.press("k");
check(
  "K picks the to-do board tool",
  !!(await waitFor(() => a.$("[data-testid=tool-dock] button[data-tool='To-do board'][aria-pressed=true]"), 2000)),
);
await click(a, { x: v.rect.x + 520, y: v.rect.y + 160 });
await dialog(a, "New card");
check(
  "placing a board asks for its first card",
  await waitFor(() => a.evaluate(() => document.activeElement?.getAttribute("aria-label") === "Card text"), 2000),
);
await a.keyboard.type("Read ch. 4");
await a.keyboard.press("Enter");
await noDialog(a);
await synced(a);
let [b1] = boards(id);
check(
  "the board has To do, Doing and Done, and the card",
  b1 && b1.title === "To-do" && b1.columns.map((c) => c.title).join() === "To do,Doing,Done" && cards(b1) === "Read ch. 4 |  | ",
  b1 && cards(b1),
);

for (const text of ["Redox", "Lab report"]) {
  await click(a, geometry(b1).add(0));
  await dialog(a, "New card");
  // It puts the cursor in the field a frame after opening; typing before that would lose a letter.
  await a.waitForFunction(() => document.activeElement?.getAttribute("aria-label") === "Card text", { timeout: 3000 }).catch(() => {});
  await a.keyboard.type(text);
  await a.keyboard.press("Enter");
  await noDialog(a);
  await synced(a);
  [b1] = boards(id);
}
check("+ Add a card adds to the end of the column", cards(b1) === "Read ch. 4,Redox,Lab report |  | ", cards(b1));

// ------------------------------------------------------------ drag and drop
await drag(a, geometry(b1).card(0, 0), geometry(b1).slot(2, 0));
await synced(a);
[b1] = boards(id);
check("dragging a card to Done moves it there", cards(b1) === "Redox,Lab report |  | Read ch. 4", cards(b1));

await drag(a, geometry(b1).card(0, 1), geometry(b1).slot(0, 0));
await synced(a);
[b1] = boards(id);
check("dragging within a column reorders it", cards(b1) === "Lab report,Redox |  | Read ch. 4", cards(b1));

const beforeDud = cards(b1);
await drag(a, geometry(b1).card(0, 0), { x: v.rect.x + v.rect.w - 40, y: v.rect.y + v.rect.h - 40 });
await sleep(600);
[b1] = boards(id);
check("dropping a card off the board puts it back", cards(b1) === beforeDud, cards(b1));

// ------------------------------------------------------------ editing cards and columns
await click(a, geometry(b1).card(0, 1));
await dialog(a, "Edit card");
check("clicking a card opens it", (await a.$eval("[aria-label='Card text']", (t) => t.value)) === "Redox");
await selectField(a, "[aria-label='Card text']");
await a.keyboard.type("Balance redox");
await a.select("[role=dialog] select[aria-label=Column]", b1.columns[1].id);
await a.click(button("Save"));
await noDialog(a);
await synced(a);
[b1] = boards(id);
check("editing a card's text and column", cards(b1) === "Lab report | Balance redox | Read ch. 4", cards(b1));

await click(a, geometry(b1).card(0, 0));
await dialog(a, "Edit card");
await a.click(button("Delete"));
await noDialog(a);
await synced(a);
[b1] = boards(id);
check("deleting a card", cards(b1) === " | Balance redox | Read ch. 4", cards(b1));

await a.keyboard.down("Control");
await a.keyboard.press("z");
await a.keyboard.up("Control");
await synced(a);
[b1] = boards(id);
check("undo brings the card back", cards(b1) === "Lab report | Balance redox | Read ch. 4", cards(b1));

await a.mouse.click(geometry(b1).header(1).x, geometry(b1).header(1).y, { count: 2 });
await dialog(a, "Column");
await selectField(a, "[aria-label='Column name']");
await a.keyboard.type("In progress");
await a.click("[role=radio][aria-label='Colour #826cb0']");
await a.click(button("Save"));
await noDialog(a);
await synced(a);
[b1] = boards(id);
check("double-clicking a column renames and recolours it", b1.columns[1].title === "In progress" && b1.columns[1].color === "#826cb0");

const w0 = b1.w;
await click(a, geometry(b1).title());
await a.waitForSelector(button("Add column"));
await a.click(button("Add column"));
await synced(a);
[b1] = boards(id);
check("Add column adds a fourth and widens the board", b1.columns.length === 4 && b1.w > w0 + 200, `${b1.columns.length} ${w0}→${b1.w}`);

await a.waitForSelector(toolbar("Rename board"));
await a.click(toolbar("Rename board"));
await dialog(a, "Board title");
await selectField(a, "input[aria-label='Board title']");
await a.keyboard.type("Chemistry week");
await a.keyboard.press("Enter");
await noDialog(a);
await synced(a);
[b1] = boards(id);
check("renaming the board", b1.title === "Chemistry week", b1.title);

await a.mouse.click(geometry(b1).header(3).x, geometry(b1).header(3).y, { count: 2 });
await dialog(a, "Column");
await a.click(button("Delete column"));
await noDialog(a);
await synced(a);
[b1] = boards(id);
check("deleting an empty column", b1.columns.length === 3 && Math.abs(b1.w - w0) < 1, `${b1.columns.length} ${b1.w}`);

// ------------------------------------------------------------ a second board
await a.keyboard.press("Escape");
await a.keyboard.press("k");
const below = v.at(b1.x + 400, b1.y + geometry(b1).h + 100);
await click(a, below);
await dialog(a, "New card");
await a.keyboard.press("Escape");
await noDialog(a);
await synced(a);
let all = boards(id);
let b2 = all.find((b) => b.id !== b1.id);
check("a second board", all.length === 2 && b2 && cards(b2) === " |  | ");

const versionBefore = Number(sql(`select version from drawings where id='${id}'`));
await drag(a, geometry(b1).card(0, 0), geometry(b2).slot(1, 0));
await synced(a);
all = boards(id);
[b1, b2] = [all.find((b) => b.id === b1.id), all.find((b) => b.id === b2.id)];
check(
  "a card dragged onto another board moves there",
  cards(b1) === " | Balance redox | Read ch. 4" && cards(b2) === " | Lab report | ",
  `${cards(b1)} / ${cards(b2)}`,
);
const lastChange = JSON.parse(sql(`select ops from drawing_changes where drawing_id='${id}' order by version desc limit 1`));
check(
  "as one change to both boards",
  Number(sql(`select version from drawings where id='${id}'`)) === versionBefore + 1 && lastChange.length === 2,
  `${lastChange.length} ops`,
);

await a.keyboard.down("Control");
await a.keyboard.press("z");
await a.keyboard.up("Control");
await synced(a);
all = boards(id);
check(
  "one undo puts it back on the first board",
  cards(all.find((b) => b.id === b1.id)) === "Lab report | Balance redox | Read ch. 4" && cards(all.find((b) => b.id === b2.id)) === " |  | ",
);
[b1, b2] = [all.find((b) => b.id === b1.id), all.find((b) => b.id === b2.id)];

// A copy gets its own cards (fresh ids), then goes away again.
await click(a, geometry(b1).title());
await a.keyboard.down("Control");
await a.keyboard.press("d");
await a.keyboard.up("Control");
await synced(a);
const copy = boards(id).find((b) => b.id !== b1.id && b.id !== b2.id);
const ids = (b) => b.columns.flatMap((c) => [c.id, ...c.cards.map((k) => k.id)]);
check(
  "duplicating a board copies its cards with new ids",
  !!copy && cards(copy) === cards(b1) && !ids(copy).some((x) => ids(b1).includes(x)),
);
await a.keyboard.press("Delete");
await synced(a);
check("and the copy can be deleted", boards(id).length === 2);

// Resize the second board from its bottom-right handle.
await click(a, geometry(b2).title());
await sleep(200);
const g2 = geometry(b2);
const corner = v.at(b2.x + g2.w + 4 / v.cam.z, b2.y + g2.h + 4 / v.cam.z);
await drag(a, corner, { x: corner.x + 150, y: corner.y + 10 }, { shift: true });
await synced(a);
let r2 = boards(id).find((b) => b.id === b2.id);
check("Shift+drag on a corner only widens a board", r2.scale === b2.scale && r2.w > b2.w + 100, `scale ${r2.scale} w ${b2.w}→${r2.w}`);
const g3 = geometry(r2);
const corner2 = v.at(r2.x + g3.w + 4 / v.cam.z, r2.y + g3.h + 4 / v.cam.z);
await drag(a, corner2, { x: corner2.x + 200, y: corner2.y + 200 });
await synced(a);
const r3 = boards(id).find((b) => b.id === b2.id);
check("a corner drag scales the whole board", r3.scale > r2.scale * 1.1, `scale ${r2.scale}→${r3.scale}`);

// The server checks boards too.
const badBoard = { ...b1, id: randomUUID(), columns: Array.from({ length: 7 }, (_, i) => ({ ...b1.columns[0], id: `c${i}` })) };
const refused = await a.evaluate(
  async (id, el) =>
    (
      await fetch(`/api/drawings/${id}/changes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId: "test-client-01", batches: [{ id: crypto.randomUUID(), ops: [{ t: "add", el }] }] }),
      })
    ).status,
  id,
  badBoard,
);
check("the server refuses a board with 7 columns", refused === 422, String(refused));

// ------------------------------------------------------------ GIFs
// Look at an empty part of the canvas.
await a.keyboard.press("Escape");
await a.keyboard.press("h");
await drag(a, { x: v.rect.x + 900, y: v.rect.y + 700 }, { x: v.rect.x + 900, y: v.rect.y + 100 });
await a.keyboard.press("v");
v = await view(a, id);

const gifBytes = readFileSync(join(FIXTURES, "counter.gif"));
await (await a.$("[data-testid=image-input]")).uploadFile(join(FIXTURES, "counter.gif"));
await synced(a);
const gif = await waitFor(() => elements(id).find((e) => e.type === "gif"), 5000);
const gifAsset = gif && sql(`select mime_type || ' ' || byte_size from assets where id='${gif.assetId}'`);
check("a GIF goes on the board as a GIF", !!gif && gifAsset === `image/gif ${gifBytes.length}`, gifAsset);
const gifBox = gif && (() => {
  const tl = v.at(gif.x, gif.y);
  const br = v.at(gif.x + gif.w, gif.y + gif.h);
  return { x: tl.x + 4, y: tl.y + 4, w: br.x - tl.x - 8, h: br.y - tl.y - 8 };
})();
check("it animates", !!(await changesOver(a, gifBox, 1500)));
await click(a, { x: gifBox.x + gifBox.w / 2, y: gifBox.y + gifBox.h / 2 });
await a.waitForSelector(toolbar("Play GIF"), { timeout: 3000 }).catch(() => {});
await sleep(300); // the paused badge is drawn on the next frame
check("clicking it pauses it", !(await changesOver(a, gifBox, 900)) && !!(await a.$(toolbar("Play GIF"))));
await a.click(toolbar("Play GIF"));
check("and Play starts it again", !!(await changesOver(a, gifBox, 1500)));

// ------------------------------------------------------------ videos
await a.keyboard.press("Escape");
const mp4 = readFileSync(join(FIXTURES, "clip.mp4"));
await (await a.$("[data-testid=image-input]")).uploadFile(join(FIXTURES, "clip.mp4"));
await synced(a);
const video = await waitFor(() => elements(id).find((e) => e.type === "video"), 8000);
const videoAsset = video && sql(`select mime_type || ' ' || byte_size || ' ' || width || 'x' || height from assets where id='${video.assetId}'`);
check("a video goes on the board", !!video && videoAsset === `video/mp4 ${mp4.length} 320x180`, videoAsset);
const vBox = (() => {
  const tl = v.at(video.x, video.y);
  const br = v.at(video.x + video.w, video.y + video.h);
  return { x: tl.x + 4, y: tl.y + 4, w: br.x - tl.x - 8, h: br.y - tl.y - 20 };
})();
const vCenter = { x: vBox.x + vBox.w / 2, y: vBox.y + vBox.h / 2 + 8 };
const firstFrame = await waitFor(async () => {
  const [r, g, b] = await pixelAt(a, { x: vBox.x + 6, y: vBox.y + vBox.h / 2 });
  return !(r === 43 && g === 42 && b === 48) && r + g + b > 0 ? [r, g, b] : null;
}, 5000);
check("it shows its first frame", !!firstFrame, String(firstFrame));
await sleep(900); // the drawing effect it arrived with (Pop by default) has settled
check("and doesn't play by itself", !(await changesOver(a, vBox, 800)));
await click(a, vCenter);
await a.waitForSelector(toolbar("Pause video"), { timeout: 4000 }).catch(() => {});
check("clicking it plays it", !!(await a.$(toolbar("Pause video"))) && !!(await changesOver(a, vBox, 1500)));
const shown = await a.$eval("[role=toolbar][aria-label=Selection]", (t) => t.innerText);
check("the toolbar shows the time", /0:0\d \/ 0:03/.test(shown), shown.replace(/\s+/g, " "));
await a.click(toolbar("Pause video"));
await sleep(300);
check("Pause stops it", !(await changesOver(a, vBox, 800)) && !!(await a.$(toolbar("Play video"))));

// Byte ranges (what video players ask for).
const ranged = await a.evaluate(async (assetId) => {
  const get = (range) => fetch(`/api/assets/${assetId}`, range ? { headers: { Range: range } } : {});
  const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
  const first = await get("bytes=0-99");
  const open = await get("bytes=100-");
  const tail = await get("bytes=-10");
  const bad = await get("bytes=99999999-");
  const whole = await get(null);
  return {
    first: [first.status, first.headers.get("content-range"), b64(await first.arrayBuffer())],
    open: [open.status, open.headers.get("content-range"), (await open.arrayBuffer()).byteLength],
    tail: [tail.status, b64(await tail.arrayBuffer())],
    bad: [bad.status, bad.headers.get("content-range")],
    whole: [whole.status, whole.headers.get("accept-ranges"), (await whole.arrayBuffer()).byteLength],
  };
}, video.assetId);
check(
  "a range request gets exactly those bytes",
  ranged.first[0] === 206 && ranged.first[1] === `bytes 0-99/${mp4.length}` && ranged.first[2] === mp4.subarray(0, 100).toString("base64"),
  `${ranged.first[0]} ${ranged.first[1]}`,
);
check("an open-ended range gets the rest", ranged.open[0] === 206 && ranged.open[2] === mp4.length - 100, `${ranged.open[1]}`);
check("a suffix range gets the end", ranged.tail[0] === 206 && ranged.tail[1] === mp4.subarray(-10).toString("base64"));
check("a range past the end is refused", ranged.bad[0] === 416 && ranged.bad[1] === `bytes */${mp4.length}`);
check("the whole file says ranges are fine", ranged.whole[0] === 200 && ranged.whole[1] === "bytes" && ranged.whole[2] === mp4.length);

// Limits.
const tmp = join(tmpdir(), `canvas-boards-${Date.now()}`);
const bigPath = `${tmp}-big.mp4`;
const txtPath = `${tmp}-notes.txt`;
writeFileSync(bigPath, Buffer.alloc(51 * 1024 * 1024));
writeFileSync(txtPath, "just some notes");
const countBefore = elements(id).length;
await (await a.$("[data-testid=image-input]")).uploadFile(bigPath);
check("a video over 50 MB is turned away in the browser", !!(await waitFor(async () => /up to 50 MB/.test(await toastText(a)), 4000)), await toastText(a));
await (await a.$("[data-testid=image-input]")).uploadFile(txtPath);
check("so is a file that isn't a picture or video", !!(await waitFor(async () => /Only images, GIFs and videos/.test(await toastText(a)), 4000)));
await sleep(300);
check("neither went on the board", elements(id).length === countBefore);

const serverLimits = await a.evaluate(async (id) => {
  const send = async (blob) => {
    const form = new FormData();
    form.set("id", crypto.randomUUID());
    form.set("width", "320");
    form.set("height", "180");
    form.set("file", blob);
    const res = await fetch(`/api/drawings/${id}/assets`, { method: "POST", body: form });
    return [res.status, (await res.json()).error];
  };
  return {
    big: await send(new Blob([new Uint8Array(50 * 1024 * 1024 + 10)], { type: "video/mp4" })),
    text: await send(new Blob(["hello"], { type: "text/plain" })),
    bigGif: await send(new Blob([new Uint8Array(10 * 1024 * 1024 + 10)], { type: "image/gif" })),
  };
}, id);
check("the server refuses videos over 50 MB", serverLimits.big[0] === 413, serverLimits.big.join(" "));
check("and images over 10 MB", serverLimits.bigGif[0] === 413, serverLimits.bigGif.join(" "));
check("and other kinds of file", serverLimits.text[0] === 415, serverLimits.text.join(" "));
rmSync(bigPath, { force: true });
rmSync(txtPath, { force: true });

// An upload the server turns down for good is undone, with its reason.
await a.setRequestInterception(true);
const refuse = (req) => {
  if (req.method() === "POST" && req.url().endsWith(`/drawings/${id}/assets`)) {
    void req.respond({ status: 413, contentType: "application/json", body: JSON.stringify({ error: "No room for that video." }) });
  } else void req.continue();
};
a.on("request", refuse);
await (await a.$("[data-testid=image-input]")).uploadFile(join(FIXTURES, "clip.webm"));
check("a refused upload says why", !!(await waitFor(async () => /No room for that video/.test(await toastText(a)), 8000)), await toastText(a));
await synced(a);
check("and the video it added is taken off again", elements(id).filter((e) => e.type === "video").length === 1);
a.off("request", refuse);
await a.setRequestInterception(false);

// After a reload the video is still there and shows a frame.
await a.reload({ waitUntil: "load" });
await synced(a);
v = await view(a, id);
const afterReload = await waitFor(async () => {
  const [r, g, b] = await pixelAt(a, { x: vBox.x + 6, y: vBox.y + vBox.h / 2 });
  return !(r === 43 && g === 42 && b === 48) && r + g + b > 0;
}, 6000);
check("after a reload the video shows its frame again", !!afterReload);

// ------------------------------------------------------------ a view-only collaborator
const bPage = await browserB.newPage();
watch("B", bPage);
await bPage.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "reduce" }]);
const viewer = await signUp(bPage, { name: "Ben Viewer" });
sql(`insert into drawing_members (drawing_id, user_id, role) values ('${id}', '${viewer.id}', 'viewer')`);
await bPage.goto(`${a.url()}`, { waitUntil: "load" });
await bPage.waitForSelector("[data-testid=board]");
await synced(bPage).catch(() => {});
await bPage.evaluate((key, cam) => localStorage.setItem(key, JSON.stringify(cam)), `canvas-camera:${id}`, v.cam);
await bPage.reload({ waitUntil: "load" });
await bPage.waitForSelector("[data-testid=board]");
await sleep(1500);
check("viewers don't get the to-do board tool", !(await bPage.$("[data-testid=tool-dock] [data-items*='To-do board']")));
const bGif = await (async () => {
  const vb = await view(bPage, id);
  const tl = vb.at(gif.x, gif.y);
  const br = vb.at(gif.x + gif.w, gif.y + gif.h);
  return { box: { x: tl.x + 4, y: tl.y + 4, w: br.x - tl.x - 8, h: br.y - tl.y - 8 }, vb };
})();
await waitFor(async () => (await pixels(bPage, bGif.box)) !== 0, 3000);
check("with reduced motion, GIFs start paused", !(await changesOver(bPage, bGif.box, 1200)));
const bVideo = (() => {
  const tl = bGif.vb.at(video.x, video.y);
  const br = bGif.vb.at(video.x + video.w, video.y + video.h);
  return { x: (tl.x + br.x) / 2, y: (tl.y + br.y) / 2 };
})();
await click(bPage, bVideo);
await bPage.waitForSelector(toolbar("Pause video"), { timeout: 4000 }).catch(() => {});
check("a viewer can play a video", !!(await bPage.$(toolbar("Pause video"))));
const bBoard = boards(id).find((b) => b.id === b1.id);
const beforeViewerDrag = cards(bBoard);
await drag(bPage, geometry(bBoard, bGif.vb).card(0, 0), geometry(bBoard, bGif.vb).slot(2, 0));
await sleep(1200);
check("but can't move cards", cards(boards(id).find((b) => b.id === b1.id)) === beforeViewerDrag);

check("no page errors", errors.length === 0, errors.slice(0, 3).join(" / "));
await Promise.all([browserA.close(), browserB.close()]);
console.log(failures ? `\n${failures} FAILED` : "\nproblems: none");
process.exit(failures ? 1 : 0);
