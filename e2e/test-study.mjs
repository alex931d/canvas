// Math, chemistry and study tools, end to end: typeset equations (LaTeX and
// mhchem), function graphs, the chemistry panel (molar mass, balancing, the
// periodic table), flashcards made from a selection, and spaced-repetition
// review on /study. Run against `npm start`.
import puppeteer from "puppeteer-core";
import nextEnv from "@next/env";

nextEnv.loadEnvConfig(process.cwd());
const { signUp, sql, sleep, BASE } = await import("./helpers.mjs");
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

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ["--no-sandbox"],
  defaultViewport: { width: 1440, height: 900 },
});
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
page.on("console", (m) => m.type() === "error" && errors.push(`console: ${m.text()}`));

const status = () => page.$eval("[data-testid=storage-status]", (el) => el.innerText.replace(/\s+/g, " ")).catch(() => "");
const synced = () => waitFor(async () => /Saved here.*Synced/.test(await status()), 10_000);
const elements = (id) => JSON.parse(sql(`select data->'elements' from drawings where id='${id}'`) || "[]");
const board = () =>
  page.$eval("[data-testid=board]", (el) => {
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y };
  });
/** A button by its text, optionally inside the element matched by `root` (XPath). */
const button = async (text, root = "") => {
  const [el] = await page.$$(`xpath/${root ? `${root}//` : ".//"}button[contains(normalize-space(), '${text}')]`);
  return el;
};
const selectAll = async () => {
  await page.keyboard.down("Control");
  await page.keyboard.press("a");
  await page.keyboard.up("Control");
};
/** How many board pixels in a box (board coordinates) are close to a colour. */
const pixels = (box, rgb, tol = 60) =>
  page.$eval(
    "[data-testid=board]",
    (canvas, box, rgb, tol) => {
      const dpr = canvas.width / canvas.getBoundingClientRect().width;
      const data = canvas
        .getContext("2d")
        .getImageData(box.x * dpr, box.y * dpr, box.w * dpr, box.h * dpr).data;
      let n = 0;
      for (let i = 0; i < data.length; i += 4) {
        if (data[i + 3] > 128 && Math.abs(data[i] - rgb[0]) + Math.abs(data[i + 1] - rgb[1]) + Math.abs(data[i + 2] - rgb[2]) < tol) n++;
      }
      return n;
    },
    box,
    rgb,
    tol,
  );

const me = await signUp(page, { name: "Priya Patel" });
await Promise.all([page.waitForNavigation({ waitUntil: "load" }), page.click("main form button[type=submit]")]);
await page.waitForFunction(() => /^\/drawings\/[0-9a-f-]{36}$/.test(location.pathname), { timeout: 15_000 }); // the redirect is client-side
const id = page.url().split("/drawings/")[1];
await synced();
await page.click("[aria-label='Drawing title']");
await selectAll();
await page.keyboard.type("Quadratics and rust");
await page.keyboard.press("Enter");

// ------------------------------------------------------------ equations
await page.keyboard.press("m");
let b = await board();
await page.mouse.click(b.x + 160, b.y + 220);
await page.waitForSelector("[aria-label='Equation in LaTeX']");
await page.type("[aria-label='Equation in LaTeX']", "\\frac{1}{");
const texError = await waitFor(async () => /never closed/.test(await page.$eval("[data-testid=equation-preview]", (e) => e.innerText)), 15_000);
check("a LaTeX mistake is explained", texError, await page.$eval("[data-testid=equation-preview]", (e) => e.innerText).catch(() => ""));
await page.click("[aria-label='Equation in LaTeX']");
await selectAll();
await page.keyboard.type("x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}");
check("the preview typesets it", !!(await page.waitForSelector("[data-testid=equation-preview] canvas", { timeout: 15_000 }).catch(() => null)));
await page.keyboard.press("Enter");
await synced();
let math = elements(id).find((e) => e.type === "math");
check("Enter puts it on the canvas", math?.syntax === "tex" && /sqrt\{b\^2/.test(math.source) && math.w > 100 && math.h > 30, JSON.stringify(math && { w: math.w, h: math.h }));
await sleep(300);
check("and it's drawn there", (await pixels({ x: 160, y: 180, w: 340, h: 90 }, [32, 31, 36])) > 300);

// chemistry syntax
await page.mouse.click(b.x + 160, b.y + 360);
await page.waitForSelector("[aria-label='Equation in LaTeX']");
const [chemRadio] = await page.$$("xpath/.//button[@role='radio'][normalize-space()='Chemistry']");
await chemRadio.click();
await page.type("[aria-label='Chemical equation']", "N2 + 3H2 <=> 2NH3");
await page.waitForSelector("[data-testid=equation-preview] canvas", { timeout: 15_000 });
await page.keyboard.press("Enter");
await synced();
const chem = elements(id).find((e) => e.type === "math" && e.syntax === "chem");
check("chemistry is typeset with mhchem", chem?.source === "N2 + 3H2 <=> 2NH3", chem?.source);

// edit by double-clicking
// (Board coordinates: the equation starts where it was clicked into place.)
await page.keyboard.press("v");
await page.mouse.click(b.x + 10, b.y + 600);
await page.mouse.click(b.x + 220, b.y + 220, { count: 2 });
const reopened = await page.waitForSelector("[aria-label='Equation in LaTeX']", { timeout: 4000 }).catch(() => null);
check("double-clicking an equation opens it for editing", !!reopened && /sqrt/.test(await page.$eval("[aria-label='Equation in LaTeX']", (t) => t.value)));
if (reopened) {
  await page.click("[aria-label='Equation in LaTeX']");
  await selectAll();
  await page.keyboard.type("E = mc^2");
  await page.waitForFunction(() => !!document.querySelector("[data-testid=equation-preview] canvas"));
  await sleep(250);
  await page.keyboard.press("Enter");
  await synced();
}
const edited = elements(id).find((e) => e.id === math.id);
check("saving changes it in place", edited?.source === "E = mc^2" && edited.w < math.w, `${edited?.source}, w ${Math.round(math.w)}→${Math.round(edited?.w)}`);

// ------------------------------------------------------------ graphs
await page.keyboard.press("g");
b = await board();
await page.mouse.move(b.x + 620, b.y + 160);
await page.mouse.down();
await page.mouse.move(b.x + 800, b.y + 300, { steps: 5 });
await page.mouse.move(b.x + 1000, b.y + 440, { steps: 5 });
await page.mouse.up();
await page.waitForSelector("[aria-label='Function 1']");
await page.click("[aria-label='Function 1']");
await selectAll();
await page.keyboard.type("x^2 - 3");
await (await button("Add function")).click();
await page.type("[aria-label='Function 2']", "sinn(x)");
check("a function that can't be read says why", await waitFor(async () => /isn't a function I know/.test(await page.$eval("[role=dialog][aria-label=Graph]", (d) => d.innerText))));
await page.click("[aria-label='Function 2']");
await selectAll();
await page.keyboard.type("2sin(x)");
await page.click("[aria-label='x from']");
await selectAll();
await page.keyboard.type("-5");
await page.click("[aria-label='x to']");
await selectAll();
await page.keyboard.type("5");
await (await button("Fit y to the curves")).click();
const yTo = await page.$eval("[aria-label='y to']", (i) => i.value);
check("Fit sets the y window from the curves", Number(yTo) >= 20 && Number(yTo) <= 30, `y to ${yTo}`);
await (await button("Done")).click();
await synced();
const graph = elements(id).find((e) => e.type === "graph");
check(
  "the graph is saved with its functions and window",
  graph && graph.fns.map((f) => f.expr).join("|") === "x^2 - 3|2sin(x)" && graph.xMin === -5 && graph.xMax === 5 && graph.w > 300,
  JSON.stringify(graph && { fns: graph.fns.map((f) => f.expr), x: [graph.xMin, graph.xMax], y: [graph.yMin, graph.yMax] }),
);
await sleep(300);
check("and its curves are drawn", (await pixels({ x: 620, y: 160, w: 380, h: 280 }, [39, 124, 120], 50)) > 150);

// ------------------------------------------------------------ chemistry panel
await page.click("button[aria-label=Chemistry]");
const panel = "[data-ui=side-panel]";
await page.waitForSelector(panel);
await sleep(500); // let it slide in
const formula = `${panel} input[placeholder^='e.g.']`;
await page.click(formula, { clickCount: 1 });
await selectAll();
await page.keyboard.type("Ca(OH)2");
check("molar mass of Ca(OH)2", await waitFor(async () => /74\.092/.test(await page.$eval("[data-testid=molar-mass]", (e) => e.innerText).catch(() => ""))));
const breakdown = await page.$eval(`${panel} table`, (t) => t.innerText);
check("with each element's share", /Ca[\s\S]*Calcium[\s\S]*54\.09%/.test(breakdown) && /H[\s\S]*Hydrogen[\s\S]*2/.test(breakdown), breakdown.replace(/\s+/g, " ").slice(0, 120));
await page.click("[aria-label='Mass in grams']");
await selectAll();
await page.keyboard.type("37.046");
check("grams convert to moles", await waitFor(async () => (await page.$eval("[aria-label='Amount in moles']", (i) => i.value)) === "0.5"));
await page.click(formula);
await selectAll();
await page.keyboard.type("h2o");
check("lowercase symbols get a hint", await waitFor(async () => /capital letter: try "H"/.test(await page.$eval(panel, (p) => p.innerText))));

await (await button("Balance", "//*[@data-ui='side-panel']")).click();
const equationInput = `${panel} input[placeholder='Fe + O2 -> Fe2O3']`;
await page.waitForSelector(equationInput);
await page.click(equationInput);
await selectAll();
await page.keyboard.type("Al + HCl -> AlCl3 + H2");
check("balances an equation", await waitFor(async () => (await page.$eval("[data-testid=balanced]", (e) => e.innerText).catch(() => "")) === "2Al + 6HCl → 2AlCl₃ + 3H₂"));
await page.click(equationInput);
await selectAll();
await page.keyboard.type("MnO4- + Fe2+ + H+ -> Mn2+ + Fe3+ + H2O");
check("including ionic equations, by charge", await waitFor(async () => (await page.$eval("[data-testid=balanced]", (e) => e.innerText).catch(() => "")) === "MnO₄⁻ + 5Fe²⁺ + 8H⁺ → Mn²⁺ + 5Fe³⁺ + 4H₂O"));
await page.click(equationInput);
await selectAll();
await page.keyboard.type("Al + HCl -> AlCl3 + H2");
await waitFor(async () => /2AlCl/.test(await page.$eval("[data-testid=balanced]", (e) => e.innerText).catch(() => "")));
const before = elements(id).length;
await (await button("Add to canvas", "//*[@data-ui='side-panel']")).click();
await synced();
const added = elements(id).at(-1);
check("a balanced equation goes onto the canvas", elements(id).length === before + 1 && added.syntax === "chem" && added.source === "2Al + 6HCl -> 2AlCl3 + 3H2", added?.source);

await (await button("Periodic table", "//*[@data-ui='side-panel']")).click();
await page.click("button[aria-label='Iron, Fe, atomic number 26']");
const detail = await page.$eval(`${panel} dl`, (d) => d.innerText);
check("the periodic table shows an element's details", /Iron/.test(detail) && /55\.845/.test(detail) && /Transition metal/.test(detail));
check("all 118 elements are there", (await page.$$(`${panel} button[aria-label*='atomic number']`)).length === 118);
await (await button("Use in formula", "//*[@data-ui='side-panel']")).click();
check("and can go into the molar mass formula", await waitFor(async () => /Fe/.test(await page.$eval(formula, (i) => i.value).catch(() => ""))));
await page.click(`${panel} > button.absolute`);
await page.waitForSelector(panel, { hidden: true });

// ------------------------------------------------------------ flashcards from the canvas
await page.keyboard.press("v");
b = await board();
await page.mouse.click(b.x + 10, b.y + 620);
await page.mouse.click(b.x + 810, b.y + 300);
await (await button("Flashcard")).click();
await page.waitForSelector("[aria-label='Front text']");
check("the selection becomes the card's picture", !!(await page.$("[role=dialog] img[alt='The selected part of the drawing']")));
await page.type("[aria-label='Front text']", "Sketch y = x² − 3 and y = 2 sin x");
await (await button("Save card")).click();
check("saving the card", await waitFor(() => sql(`select count(*) from flashcards where user_id='${me.id}'`) === "1"));
await page.waitForSelector("[role=dialog]", { hidden: true });
const card1 = sql(`select id || '|' || deck || '|' || image_side || '|' || image_mime_type || '|' || octet_length(image) from flashcards where user_id='${me.id}'`).split("|");
check("files it under the drawing's deck, with the picture on the back", card1[1] === "Quadratics and rust" && card1[2] === "back" && card1[3] === "image/webp" && Number(card1[4]) > 1000, card1.slice(1).join(", "));
check("the picture is served to its owner", (await page.evaluate(async (id) => {
  const res = await fetch(`/api/flashcards/${id}/image`);
  return `${res.status} ${res.headers.get("content-type")}`;
}, card1[0])) === "200 image/webp");

// A text-only card from the chemistry equation
await page.mouse.click(b.x + 10, b.y + 620);
await page.mouse.click(b.x + 200, b.y + 360);
await (await button("Flashcard")).click();
await page.waitForSelector("[aria-label='Front text']");
const [neither] = await page.$$("xpath/.//button[@role='radio'][normalize-space()='Neither']");
await neither.click();
await page.type("[aria-label='Front text']", "Ammonia synthesis?");
check("text from the selection fills in the answer", (await page.$eval("[aria-label='Back text']", (t) => t.value)) === "N2 + 3H2 <=> 2NH3");
await (await button("Save card")).click();
await waitFor(() => sql(`select count(*) from flashcards where user_id='${me.id}'`) === "2");
check("a card can be text only", sql(`select count(*) from flashcards where user_id='${me.id}' and image is null and back = 'N2 + 3H2 <=> 2NH3'`) === "1");

const bad = await page.evaluate(async () => {
  const form = new FormData();
  form.set("front", "A question with no answer");
  return (await fetch("/api/flashcards", { method: "POST", body: form })).status;
});
check("a card needs something on both sides", bad === 422, String(bad));

// ------------------------------------------------------------ studying
await page.goto(`${BASE}/`, { waitUntil: "networkidle0" });
check("the gallery shows cards due", (await page.$eval("[data-testid=due-count]", (e) => e.innerText)) === "2");
await page.goto(`${BASE}/study`, { waitUntil: "networkidle0" });
check("the study page lists the deck", /Quadratics and rust/.test(await page.$eval("nav[aria-label=Decks]", (n) => n.innerText)));
const front1 = await page.$eval("[data-testid=study-card]", (c) => c.innerText);
check("cards start with only the front showing", /Sketch y = x² − 3|Ammonia synthesis/.test(front1) && !(await page.$("[data-testid=study-card] hr")));
await page.keyboard.press(" ");
await page.waitForSelector("[data-testid=study-card] hr");
check("Space shows the answer", true);
const firstId = sql(`select id from flashcards where user_id='${me.id}' order by due_at asc, created_at asc limit 1`);
const firstIsPicture = /Sketch/.test(front1);
await page.keyboard.press("3"); // Easy
const easy = await waitFor(() => sql(`select box from flashcards where user_id='${me.id}' and front like '${firstIsPicture ? "Sketch%" : "Ammonia%"}'`) === "2");
const easyDays = Number(sql(`select extract(epoch from due_at - now()) / 86400 from flashcards where user_id='${me.id}' and front like '${firstIsPicture ? "Sketch%" : "Ammonia%"}'`));
check("Easy moves a new card two boxes up, due in 3 days", easy && easyDays > 2.9 && easyDays < 3.1, `${easyDays.toFixed(2)} days`);
await page.keyboard.press(" ");
await page.keyboard.press("1"); // Again
const other = firstIsPicture ? "Ammonia%" : "Sketch%";
await waitFor(() => sql(`select box from flashcards where user_id='${me.id}' and front like '${other}'`) === "1");
const againMin = Number(sql(`select extract(epoch from due_at - now()) / 60 from flashcards where user_id='${me.id}' and front like '${other}'`));
check("Again brings it back in 10 minutes", againMin > 9 && againMin <= 10, `${againMin.toFixed(1)} min`);
check("and again in this session", /1 left/.test(await page.$eval("[data-testid=study-progress]", (e) => e.innerText)));
await page.keyboard.press(" ");
await page.keyboard.press("2"); // Good
await waitFor(() => sql(`select reviews from flashcards where user_id='${me.id}' and front like '${other}'`) === "2");
check("Good after Again moves it up one box", sql(`select box from flashcards where user_id='${me.id}' and front like '${other}'`) === "2");
check("the session ends with a summary", await waitFor(async () => /Done for now[\s\S]*3 cards and knew 2/.test(await page.$eval("main", (m) => m.innerText))));
void firstId;

// managing cards
await page.goto(`${BASE}/study`, { waitUntil: "networkidle0" });
check("nothing is due afterwards", /Nothing due/.test(await page.$eval("main", (m) => m.innerText)));
await page.click("button[aria-label^='Actions for “Ammonia']");
const [editItem] = await page.$$("xpath/.//div[@role='menuitem'][contains(., 'Edit')]");
await editItem.click();
await page.waitForSelector("[role=dialog] textarea");
const fronts = await page.$$("[role=dialog] textarea");
await fronts[0].click();
await selectAll();
await page.keyboard.type("How is ammonia made?");
await (await button("Save", "//*[@role='dialog']")).click();
check("cards can be edited", await waitFor(() => sql(`select count(*) from flashcards where user_id='${me.id}' and front = 'How is ammonia made?'`) === "1"));
await sleep(500);
await page.click("button[aria-label^='Actions for “How is ammonia']");
const [startOver] = await page.$$("xpath/.//div[@role='menuitem'][contains(., 'Start over')]");
await startOver.click();
check("start over makes a card new and due", await waitFor(() => sql(`select box || ',' || (due_at <= now()) from flashcards where user_id='${me.id}' and front = 'How is ammonia made?'`) === "0,true"));
await page.reload({ waitUntil: "networkidle0" });
await page.click("button[aria-label^='Actions for “How is ammonia']");
const [del] = await page.$$("xpath/.//div[@role='menuitem'][contains(., 'Delete')]");
await del.click();
check("and deleted", await waitFor(() => sql(`select count(*) from flashcards where user_id='${me.id}'`) === "1"));

// someone else can't see these cards
const other2 = await browser.createBrowserContext();
const p2 = await other2.newPage();
await signUp(p2, { name: "Kai Moreno" });
const theirs = await p2.evaluate(async (id) => (await fetch(`/api/flashcards/${id}/image`)).status, card1[0]);
check("cards and pictures are private", theirs === 404);
await p2.goto(`${BASE}/study`, { waitUntil: "networkidle0" });
check("and don't show up for anyone else", /No flashcards yet/.test(await p2.$eval("main", (m) => m.innerText)));

const real = errors.filter((e) => !/40[0-4]|422|status of 4/.test(e));
console.log("\nerrors:", real.length ? real : "none");
await browser.close();
process.exit(failures ? 1 : 0);
