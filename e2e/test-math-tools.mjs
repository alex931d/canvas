// The members' math tools and the new chemistry calculators, end to end:
// the triangle solver (with the ambiguous case), exact trig values and the
// unit circle, two-column proofs checked by the (mock) AI, worksheets from
// the drawing's equations or a topic (printed, or put on the canvas as
// pages), and stoichiometry, gas laws and solutions. Each puts a figure on
// the canvas that syncs like anything drawn. Run against `npm start` with
// AI_BASE_URL pointing at e2e/mock-ai.mjs.
import puppeteer from "puppeteer-core";
import nextEnv from "@next/env";
import { readFileSync } from "node:fs";

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
  while (Date.now() - t0 < timeout) {
    const v = await fn();
    if (v) return v;
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
page.on("console", (m) => m.type() === "error" && !/status of (4\d\d|503)/.test(m.text()) && errors.push(`console: ${m.text()}`));

const status = () => page.$eval("[data-testid=storage-status]", (el) => el.innerText.replace(/\s+/g, " ")).catch(() => "");
const synced = () => waitFor(async () => /Saved here.*Synced/.test(await status()), 10_000);
const elements = (id) => JSON.parse(sql(`select data->'elements' from drawings where id='${id}'`) || "[]");
const panel = "[data-ui=side-panel]";
const panelText = () => page.$eval(panel, (p) => p.innerText).catch(() => "");
const tab = async (name) => {
  const [el] = await page.$$(`xpath/.//*[@data-ui='side-panel']//button[@role='tab'][normalize-space()='${name}']`);
  await el.click();
  await sleep(150);
};
const button = async (text) => {
  const [el] = await page.$$(`xpath/.//*[@data-ui='side-panel']//button[not(@hidden)][contains(normalize-space(), '${text}')][not(ancestor::*[@hidden])]`);
  return el;
};
const selectAll = async () => {
  await page.keyboard.down("Control");
  await page.keyboard.press("a");
  await page.keyboard.up("Control");
};
const fill = async (selector, value) => {
  await page.click(selector, { count: 3 });
  await selectAll();
  await page.keyboard.press("Backspace");
  if (value) await page.keyboard.type(value);
};
const textOf = (selector) => page.$eval(selector, (e) => e.innerText).catch(() => "");
/** Adds elements, waits for the save, and returns what was added. */
async function added(id, act) {
  const before = new Set(elements(id).map((e) => e.id));
  await act();
  await waitFor(async () => elements(id).length > before.size, 10_000);
  await synced();
  return elements(id).filter((e) => !before.has(e.id));
}

await signUp(page, { name: "Ines Moreau" });
await Promise.all([page.waitForNavigation({ waitUntil: "load" }), page.click("main form button[type=submit]")]);
await page.waitForFunction(() => /^\/drawings\/[0-9a-f-]{36}$/.test(location.pathname), { timeout: 15_000 });
const id = page.url().split("/drawings/")[1];
await synced();

// ------------------------------------------------------------ triangles
await page.click("[data-testid=math-tools-button]");
await page.waitForSelector("[data-testid=math-panel]");
await sleep(500);
check("members open the math tools", /Solve triangles/.test(await panelText()));
check("solves the default triangle (SAS)", await waitFor(async () => (await textOf("[data-testid=tri-out-c]")) === "5.3"), await textOf("[data-testid=tri-out-c]"));
check("names the case", (await textOf("[data-testid=tri-case]")) === "SAS");
check("and shows the working", /cos/.test(await textOf("[data-testid=math-panel] [data-testid=tex-steps]")));
await (await button("ambiguous case")).click();
check("the ambiguous case finds two triangles", await waitFor(async () => /Two triangles fit/.test(await panelText())));
check("the acute one first", (await textOf("[data-testid=tri-out-B]")) === "56.44°", await textOf("[data-testid=tri-out-B]"));
const [obtuse] = await page.$$("xpath/.//*[@data-ui='side-panel']//button[@role='radio'][normalize-space()='Obtuse']");
await obtuse.click();
check("then the obtuse one", await waitFor(async () => (await textOf("[data-testid=tri-out-B]")) === "123.56°"), await textOf("[data-testid=tri-out-B]"));
await fill("[data-testid=tri-A]", "");
await fill("[data-testid=tri-a]", "1");
await fill("[data-testid=tri-b]", "2");
await fill("[data-testid=tri-c]", "3");
check("sides that can't close are explained", await waitFor(async () => /can't close into a triangle/.test(await panelText())));
await (await button("3, 4, 5")).click();
await waitFor(async () => (await textOf("[data-testid=tri-out-C]")) === "90°");
check("3, 4, 5 is a right triangle", /Right triangle/.test(await panelText()));
const tri = await added(id, async () => (await button("Draw it on the canvas")).click());
const lines = tri.filter((e) => e.type === "line");
check("the triangle is drawn: three sides and the right-angle mark", lines.length === 5, `${lines.length} lines`);
check("with its corners named", ["A", "B", "C"].every((n) => tri.some((e) => e.type === "text" && e.text === n)));
check("its sides and angles labelled", tri.some((e) => e.type === "math" && e.source === "c = 5") && tri.some((e) => e.type === "math" && e.source === "90^\\circ"));
check("and the working typeset beside it", tri.some((e) => e.type === "math" && /^\\begin\{array\}/.test(e.source) && /cos/.test(e.source)));
check("it lands selected, ready to move", !!(await page.waitForSelector("[role=toolbar][aria-label=Selection]", { timeout: 5000 }).catch(() => null)));

// ------------------------------------------------------------ trig
await tab("Trig");
check("exact value of sin 150°", await waitFor(async () => /quadrant\sII\b/.test(await textOf("[data-testid=math-panel] [role=tabpanel]:not([hidden]) [data-testid=tex-steps]"))));
const [cosBtn] = await page.$$("xpath/.//*[@data-ui='side-panel']//button[@role='radio'][normalize-space()='cos']");
await cosBtn.click();
const [radBtn] = await page.$$("xpath/.//*[@data-ui='side-panel']//button[@role='radio'][normalize-space()='Radians']");
await radBtn.click();
await fill("[data-testid=trig-angle]", "5pi/4");
check("radians with pi: cos 5π/4 is in quadrant III and negative", await waitFor(async () => /quadrant\sIII[\s\S]*negative/.test(await textOf("[data-testid=math-panel] [role=tabpanel]:not([hidden]) [data-testid=tex-steps]"))));
await fill("[data-testid=trig-angle]", "pi/2");
const [tanBtn] = await page.$$("xpath/.//*[@data-ui='side-panel']//button[@role='radio'][normalize-space()='tan']");
await tanBtn.click();
check("tan π/2 is undefined", await waitFor(async () => /undefined/.test(await textOf("[data-testid=trig-answer]"))));
await cosBtn.click();
await fill("[data-testid=trig-angle]", "5pi/4");
await waitFor(async () => /quadrant\sIII/.test(await panelText()));
const circle = await added(id, async () => (await button("Draw the unit circle")).click());
check("the unit circle is drawn", circle.some((e) => e.type === "ellipse" && e.w === 380 && e.fill === null));
check("with the sixteen special angles", circle.filter((e) => e.type === "ellipse" && e.w === 8).length === 16);
check("labelled in radians", circle.some((e) => e.type === "math" && e.source === "\\frac{3\\pi}{4}"));
check("and the angle's point, exactly", circle.some((e) => e.type === "math" && e.source === "(-\\frac{\\sqrt{2}}{2},\\ -\\frac{\\sqrt{2}}{2})"));

// ------------------------------------------------------------ proofs
await tab("Proofs");
check("a proof to start from", (await page.$$("[data-testid=proof-row]")).length === 4);
check("a well formed proof has no issues", !(await page.$("[data-testid=proof-issues]")));
await (await button("Check with AI")).click();
check("the AI says it holds", await waitFor(async () => /The proof holds/.test(await textOf("[data-testid=proof-verdict]")), 15_000));
// The monthly AI allowance: one proof check used, triangles and trig used none.
const owner = sql(`select user_id from drawings where id='${id}'`);
const used = () => Number(sql(`select coalesce((select calls from ai_usage where user_id='${owner}'), 0)`));
check("the check used one of the month's AI calls", used() === 1, String(used()));
check("the panel says what's left", await waitFor(async () => /249 of 250 AI checks and worksheets left this month/.test(await textOf("[data-testid=ai-left]"))), await textOf("[data-testid=ai-left]"));
await fetch("http://localhost:4010/__test/busy", { method: "POST", body: JSON.stringify({ times: 20 }) });
await (await button("Check with AI")).click();
check("when the AI is busy the check fails", await waitFor(async () => /busy/.test(await panelText()), 40_000), (await panelText()).split("\n").filter((l) => /proof|busy|check|AI/i.test(l)).slice(-4).join(" / "));
check("and the call is given back", used() === 1, String(used()));
await fetch("http://localhost:4010/__test/busy", { method: "POST", body: JSON.stringify({ times: 0 }) });
sql(`update ai_usage set calls = 250 where user_id='${owner}'`);
await (await button("Check with AI")).click();
check("with the month's 250 used, it says so", await waitFor(async () => /You've used all 250 AI checks and worksheets for this month\. They start over on/.test(await panelText()), 10_000));
check("and nothing more is counted", used() === 250);
sql(`update ai_usage set calls = 1 where user_id='${owner}'`);
await (await button("Check with AI")).click();
await waitFor(async () => /The proof holds/.test(await textOf("[data-testid=proof-verdict]")), 15_000);
const sent = JSON.parse(readFileSync("/tmp/mock-ai-text.json", "utf8"));
check("it was sent the proof, line by line", /Prove: △ABC ≅ △CDA/.test(sent.user) && /3\. AC ≅ CA \| Reflexive property/.test(sent.user), sent.user.slice(0, 120));
await fill("[aria-label='Reason 3']", "Because I said so");
check("an edit clears the verdict", !(await page.$("[data-testid=proof-verdict]")));
await (await button("Check with AI")).click();
check("a bad reason is caught", await waitFor(async () => /Not there yet/.test(await textOf("[data-testid=proof-verdict]")), 15_000));
check("on its line, with a hint", /isn't a reason/.test(await panelText()) && !!(await page.$("[aria-label=\"Doesn't follow\"]")));
await fill("[aria-label='Statement 4']", "AB ∥ CD");
check("the last line has to be what's proved", await waitFor(async () => /The last statement should be what you set out to prove/.test(await textOf("[data-testid=proof-issues]"))));
await fill("[aria-label='Statement 4']", "△ABC ≅ △CDA");
await (await button("Check with AI")).click();
await waitFor(async () => /Not there yet/.test(await textOf("[data-testid=proof-verdict]")), 15_000);
const proof = await added(id, async () => (await button("Add to canvas")).click());
const proofTexts = proof.filter((e) => e.type === "text").map((e) => e.text);
check("the proof goes on the canvas as a two-column table", proofTexts.includes("Statements") && proofTexts.includes("Reasons") && proofTexts.includes("1.  AB ≅ CD") && proof.some((e) => e.type === "rect"));
check("with the AI's marks", proofTexts.includes("✗") && proofTexts.filter((t) => t === "✓").length === 3);

// ------------------------------------------------------------ worksheets
// Two equations on the drawing first, with the equation tool.
await page.keyboard.press("Escape");
await page.click("[data-testid=math-tools-button]");
await waitFor(async () => !(await page.$("[data-testid=math-panel]")), 3000);
const board = await page.$eval("[data-testid=board]", (el) => {
  const r = el.getBoundingClientRect();
  return { x: r.x, y: r.y };
});
for (const [i, eq] of ["2x + 3 = 11", "x^2 - 9 = 0"].entries()) {
  await page.keyboard.press("m");
  await page.mouse.click(board.x + 120, board.y + 120 + i * 90);
  await page.waitForSelector("[aria-label='Equation in LaTeX']");
  await page.type("[aria-label='Equation in LaTeX']", eq);
  await page.waitForSelector("[data-testid=equation-preview] canvas", { timeout: 15_000 });
  await page.keyboard.press("Enter");
  await synced();
}
await page.keyboard.press("/");
await page.waitForSelector("[data-testid=tool-search] input", { timeout: 5000 });
await page.type("[data-testid=tool-search] input", "worksheet");
await sleep(200);
await page.keyboard.press("Enter");
await page.waitForSelector("[data-testid=math-panel]");
await sleep(400);
check("Make a worksheet opens on the worksheet tab", /equations? found/.test(await textOf("[data-testid=ws-found]")));
const found = await textOf("[data-testid=ws-found]");
check("it finds the drawing's own equations, not the figures' labels", /^2 equations found/.test(found), found);
await (await button("Make worksheet")).click();
check("the AI writes the answer key", await waitFor(async () => (await page.$$("[data-testid=ws-answer]")).length > 0, 15_000));
const preview = await textOf("[data-testid=ws-problems]");
check("the drawing's equations are the problems", /2x\+3=11[\s\S]*x2−9=0/.test(preview.replace(/\s+/g, "")), preview.replace(/\s+/g, " ").slice(0, 80));
const sentKey = JSON.parse(readFileSync("/tmp/mock-ai-text.json", "utf8"));
check("asked for the key with the equations in reading order", /answer keys/.test(sentKey.system) && /2x \+ 3 = 11/.test(sentKey.user), sentKey.user.slice(0, 100));
const baseCount = (await page.$$("[data-testid=ws-problems] > li")).length;
await page.select("[data-testid=ws-more]", "2");
await (await button("Make worksheet")).click();
check("plus more practice like them", await waitFor(async () => (await page.$$("[data-testid=ws-problems] > li")).length === baseCount + 2, 15_000));
await (await button("Print or save as PDF")).click();
const printed = await waitFor(
  () => page.evaluate(() => [...document.querySelectorAll("iframe[aria-hidden=true]")].map((f) => f.contentDocument?.body?.innerText ?? "").find((t) => /Answer key/.test(t)) ?? ""),
  10_000,
);
check("it prints with the answer key on its own page", /Name:/.test(printed) && /Answer key/.test(printed) && /answer\s1/.test(printed), printed.slice(0, 80));
check("its math typeset by KaTeX", await page.evaluate(() => [...document.querySelectorAll("iframe[aria-hidden=true]")].some((f) => !!f.contentDocument?.querySelector(".katex"))));
const sheet = await added(id, async () => (await button("Put on the canvas")).click());
const frames = sheet.filter((e) => e.type === "frame");
check("on the canvas it's pages and an answer key, as frames", frames.length >= 2 && frames.some((f) => f.title === "Answer key") && frames.every((f) => f.w === 816 && f.h === 1056), frames.map((f) => f.title).join(" | "));
check("which become slides, in order", (() => {
  const o = frames.map((f) => f.order);
  return new Set(o).size === o.length;
})());
check("with every problem typeset", sheet.filter((e) => e.type === "math" && e.x < frames[0].x + 816).length === baseCount + 2);

const [topicBtn] = await page.$$("xpath/.//*[@data-ui='side-panel']//button[@role='radio'][normalize-space()='From a topic']");
await topicBtn.click();
await page.type("[data-testid=ws-topic]", "two-step equations");
await (await button("Make worksheet")).click();
check("or practice problems on a topic", await waitFor(async () => (await page.$$("[data-testid=ws-problems] > li")).length === 8, 15_000));
check("titled after it", (await page.$eval("[aria-label='Worksheet title']", (i) => i.value)) === "Practice: two-step equations");
await page.click("[aria-label='Remove problem 1']");
check("problems can be taken out", (await page.$$("[data-testid=ws-problems] > li")).length === 7);

// ------------------------------------------------------------ chemistry calculators
// From the tool search while the math tools are open: one side panel at a time.
await page.mouse.click(board.x + 40, board.y + 600);
await page.keyboard.press("/");
await page.waitForSelector("[data-testid=tool-search] input", { timeout: 5000 });
await page.type("[data-testid=tool-search] input", "stoichiometry");
await sleep(200);
await page.keyboard.press("Enter");
await page.waitForSelector("[data-testid=molar-mass], [data-ui=side-panel] input[placeholder^='e.g.']", { timeout: 5000 }).catch(() => null);
check("one side panel at a time", await waitFor(async () => !(await page.$("[data-testid=math-panel]")) && /Periodic table/.test(await panelText()), 4000));
await sleep(400);
await tab("Amounts");
check("finds the limiting reagent", await waitFor(async () => (await textOf("[data-testid=stoich-limiting]")) === "O₂"), await textOf("[data-testid=stoich-limiting]"));
check("and the theoretical yield", (await textOf("[data-testid=stoich-grams-0]")) === "18.02", await textOf("[data-testid=stoich-grams-0]"));
await page.type("[aria-label='Actual grams of product 1']", "15");
check("and the percent yield", await waitFor(async () => /83\.3%/.test(await panelText())));
await fill("[data-testid=stoich-amount-1]", "");
check("an amount left blank is in excess", await waitFor(async () => (await textOf("[data-testid=stoich-limiting]")) === "H₂"), await textOf("[data-testid=stoich-limiting]"));
const working = await added(id, async () => (await button("Add the working")).click());
check("its working goes on the canvas", working.length === 1 && working[0].type === "math" && /Limiting|Balanced/.test(working[0].source), working[0]?.source.slice(0, 60));

await tab("Gases");
check("PV = nRT: a mole at 0 °C and 1 atm is 22.41 L", await waitFor(async () => /22\.41/.test(await textOf("[data-testid=gas-answer]"))), await textOf("[data-testid=gas-answer]"));
const [combined] = await page.$$("xpath/.//*[@data-ui='side-panel']//button[@role='radio'][normalize-space()='Before and after']");
await combined.click();
check("the combined law, with °C converted", await waitFor(async () => /1\.445/.test(await textOf("[data-testid=gas-answer]"))), await textOf("[data-testid=gas-answer]"));
await fill("[data-testid=gas-T1]", "");
await fill("[data-testid=gas-T2]", "");
check("Boyle's law when temperature stays", await waitFor(async () => /1\.333/.test(await textOf("[data-testid=gas-answer]")) && /Boyle/.test(await panelText())), await textOf("[data-testid=gas-answer]"));

await tab("Solutions");
check("molarity from grams", await waitFor(async () => /^0\.2\b/.test(await textOf("[data-testid=sol-answer]"))), await textOf("[data-testid=sol-answer]"));
const [dil] = await page.$$("xpath/.//*[@data-ui='side-panel']//button[@role='radio'][normalize-space()='Dilution']");
await dil.click();
check("dilution", await waitFor(async () => /^62\.5/.test(await textOf("[data-testid=sol-answer]"))), await textOf("[data-testid=sol-answer]"));
const [phBtn] = await page.$$("xpath/.//*[@data-ui='side-panel']//button[@role='radio'][normalize-space()='pH']");
await phBtn.click();
check("pH of a weak acid", await waitFor(async () => /^2\.88/.test(await textOf("[data-testid=sol-answer]"))), await textOf("[data-testid=sol-answer]"));

// ------------------------------------------------------------ after a reload
await page.reload({ waitUntil: "load" });
await synced();
const all = elements(id);
check("everything placed is in the drawing", all.filter((e) => e.type === "frame").length >= 2 && all.some((e) => e.type === "ellipse" && e.w === 380));

// The membership page shows the month's allowance.
const calls = used();
await page.goto(`${BASE}/membership`, { waitUntil: "load" });
const meter = await page.waitForSelector("[data-testid=ai-allowance]", { timeout: 10_000 }).then(() => textOf("[data-testid=ai-allowance]")).catch(() => "");
check("the membership page shows the month's AI use", new RegExp(`${calls} of 250 used this month`).test(meter) && /Starts over on/.test(meter), meter.replace(/\s+/g, " ").slice(0, 120));

check("no page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
await browser.close();
console.log(failures ? `\n${failures} FAILED` : "\nall passed");
process.exit(failures ? 1 : 0);
