// The landing page: who sees it, its links, layout at phone-to-desktop
// widths, the hero animation (and reduced motion), and basic accessibility.
// Run against `npm run build && npm start` (see README); uses DATABASE_URL.
import puppeteer from "puppeteer-core";
import nextEnv from "@next/env";

nextEnv.loadEnvConfig(process.cwd());
const { BASE, sleep, sql, signUp } = await import("./helpers.mjs");

const CHROME = process.env.CHROME_PATH ?? "/usr/bin/google-chrome";
let failures = 0;
function check(label, cond, extra = "") {
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}${extra ? `  (${extra})` : ""}`);
  if (!cond) failures++;
}

// ------------------------------------------------------------ served as static HTML
const res = await fetch(`${BASE}/`, { redirect: "manual" });
const html = await res.text();
check(
  "signed-out / is the prerendered landing page",
  res.status === 200 && /^1\b/.test(res.headers.get("x-nextjs-prerender") ?? "") && html.includes("Sketch it,"),
  `${res.status} prerender=${res.headers.get("x-nextjs-prerender")}`,
);
check("/welcome serves the same page", (await fetch(`${BASE}/welcome`)).status === 200);

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--no-sandbox"] });
const problems = [];
async function newPage(ctx, viewport) {
  const page = await ctx.newPage();
  page.on("pageerror", (e) => problems.push(e.message));
  page.on("console", (m) => m.type() === "error" && problems.push(m.text()));
  page.on("requestfailed", (r) => r.failure()?.errorText !== "net::ERR_ABORTED" && problems.push(`failed ${r.url()}`));
  page.on("response", (r) => r.status() >= 400 && problems.push(`${r.status()} ${r.url()}`));
  if (viewport) await page.setViewport(viewport);
  return page;
}

// ------------------------------------------------------------ content and links
const ctx = await browser.createBrowserContext();
const page = await newPage(ctx, { width: 1440, height: 900 });
await page.goto(BASE, { waitUntil: "networkidle0" });
const outline = await page.evaluate(() => ({
  h1: [...document.querySelectorAll("h1")].map((h) => h.textContent),
  h2: [...document.querySelectorAll("h2")].map((h) => h.textContent),
  landmarks: ["header", "main", "footer"].every((t) => document.querySelector(t)),
  imgsWithoutAlt: [...document.querySelectorAll("img")].filter((i) => !i.getAttribute("alt")).length,
  demo: document.querySelector("figure[role=img]")?.getAttribute("aria-label") ?? "",
  start: [...document.querySelectorAll("a[href='/local/new']")].map((a) => a.textContent.trim()),
  canvas: [...document.querySelectorAll("header a[href='/local']")].map((a) => a.textContent.trim()),
  signup: [...document.querySelectorAll("a[href='/signup']")].length,
  pricing: [...document.querySelectorAll("a[href='/pricing']")].map((a) => a.textContent.trim()),
  login: [...document.querySelectorAll("a[href='/login']")].map((a) => a.textContent.trim()),
  text: document.body.innerText,
}));
check("one h1, then a heading per section", outline.h1.length === 1 && outline.h2.length === 5, outline.h2.join(" | "));
check("header, main and footer landmarks", outline.landmarks);
check(
  "drawing for free and the $5 membership are on the page, self-hosting isn't",
  /Free, with no account: drawings save in your browser\./.test(outline.text) &&
    /Start free\. Join when you want more\./.test(outline.text) &&
    /\$5\s*a month/.test(outline.text) &&
    !/Run your own copy|docker compose/.test(outline.text),
);
check("every image has alt text", outline.imgsWithoutAlt === 0);
check("the hero demo is described for screen readers", /mistake/.test(outline.demo) && /x should be 11/.test(outline.demo));
check(
  "Start drawing in the hero and the closing section, no account needed",
  outline.start.length === 2 && outline.start.every((t) => t === "Start drawing") && outline.signup === 0,
  `${outline.start.join(" | ")} / ${outline.signup}`,
);
check(
  "the header opens the canvas and has the one login link",
  outline.canvas.join() === "Open canvas" && outline.login.length === 1,
  `${outline.canvas.join()} / ${outline.login.length}`,
);
check(
  "the pricing page is linked from the header, the hero and the closing section",
  ["Pricing", "See the membership", "Compare the plans"].every((t) => outline.pricing.includes(t)),
  outline.pricing.join(" | "),
);

// keyboard: wordmark, Pricing, Log in, Open canvas, with a visible focus ring
for (let i = 0; i < 4; i++) await page.keyboard.press("Tab");
await sleep(300); // the button's ring fades in (transition-all)
const focused = await page.evaluate(() => ({
  text: document.activeElement?.textContent?.trim(),
  ring: getComputedStyle(document.activeElement).boxShadow,
}));
check(
  "keyboard reaches Open canvas with a visible focus ring",
  focused.text === "Open canvas" && / 3px/.test(focused.ring),
  focused.ring.match(/[^,]* 3px/)?.[0] ?? focused.ring,
);

// the editor screenshot loads (it's lazy, so scroll to it)
await page.$eval("img[alt^='The canvas editor']", (img) => img.scrollIntoView());
await page.waitForFunction(() => {
  const img = document.querySelector("img[alt^='The canvas editor']");
  return img?.complete && img.naturalWidth > 0;
}, { timeout: 10000 }).catch(() => {});
const shot = await page.$eval("img[alt^='The canvas editor']", (img) => ({ w: img.naturalWidth, src: img.currentSrc }));
check("the editor screenshot loads as an optimised image", shot.w > 0 && /\/_next\/image\?/.test(shot.src), `${shot.w}px`);

await page.evaluate(() => scrollTo(0, 0));
await Promise.all([page.waitForNavigation({ waitUntil: "networkidle0" }), page.click("header a[href='/local']")]);
check("Open canvas opens this browser's drawings, no account needed", new URL(page.url()).pathname === "/local");
await page.goto(`${BASE}/signup`, { waitUntil: "networkidle0" });
await Promise.all([page.waitForNavigation({ waitUntil: "networkidle0" }), page.click("aside a[href='/']")]);
check("the wordmark on the auth pages leads back to the landing page", /Sketch it/.test(await page.$eval("h1", (h) => h.textContent)));

// ------------------------------------------------------------ hero animation
const anim = await newPage(ctx, { width: 1440, height: 900 });
await anim.goto(BASE, { waitUntil: "domcontentloaded" });
await sleep(400);
const early = await anim.evaluate(() => ({
  card: Number(getComputedStyle(document.querySelector(".hero-card")).opacity),
  lastLine: getComputedStyle(document.querySelectorAll(".hero-write")[3]).clipPath,
}));
await sleep(4600);
const late = await anim.evaluate(() => ({
  card: Number(getComputedStyle(document.querySelector(".hero-card")).opacity),
  cursor: Number(getComputedStyle(document.querySelector(".hero-cursor")).opacity),
  draw: Number(getComputedStyle(document.querySelector(".hero-lasso-draw")).opacity),
  loop: Number(getComputedStyle(document.querySelector(".hero-appear")).opacity),
}));
check("the hero starts unwritten", early.card === 0 && /inset\(0(px)? 100%/.test(early.lastLine), JSON.stringify(early));
check("and ends on the finished check", late.card === 1 && late.loop === 1 && late.cursor === 0 && late.draw === 0, JSON.stringify(late));

const reducedPage = await newPage(ctx, { width: 1440, height: 900 });
await reducedPage.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "reduce" }]);
await reducedPage.goto(BASE, { waitUntil: "domcontentloaded" });
await sleep(100);
const reduced = await reducedPage.evaluate(() => ({
  card: Number(getComputedStyle(document.querySelector(".hero-card")).opacity),
  animations: document.getAnimations().length,
}));
check("with reduced motion the finished scene shows at once", reduced.card === 1 && reduced.animations === 0, JSON.stringify(reduced));

// ------------------------------------------------------------ layout from phones to desktop
const widths = [];
for (const [w, h, mobile] of [[360, 740, true], [390, 844, true], [820, 1180, true], [1024, 768, false], [1280, 800, false], [1920, 1080, false]]) {
  const p = await newPage(ctx, { width: w, height: h, isMobile: mobile, hasTouch: mobile });
  await p.goto(BASE, { waitUntil: "networkidle0" });
  await sleep(4500);
  const m = await p.evaluate(() => {
    const board = document.querySelector("section[aria-labelledby=hero-title] > div").getBoundingClientRect();
    const inBoard = [...document.querySelectorAll("#hero-title, section[aria-labelledby=hero-title] p, .hero-card")].every((el) => {
      const r = el.getBoundingClientRect();
      return r.left >= board.left - 0.5 && r.right <= board.right + 0.5;
    });
    return { overflow: document.documentElement.scrollWidth - innerWidth, inBoard };
  });
  widths.push(`${w}:${m.overflow}${m.inBoard ? "" : "!"}`);
  await p.close();
}
check("no sideways scrolling, and the hero fits its board, at 360–1920 px", widths.every((w) => /:0$/.test(w)), widths.join(" "));

// ------------------------------------------------------------ who sees it
const ctxB = await browser.createBrowserContext();
// ------------------------------------------------------------ the terms of service
{
  const tctx = await browser.createBrowserContext();
  const tp = await newPage(tctx, { width: 1280, height: 900 });
  const termsRes = await tp.goto(`${BASE}/terms`, { waitUntil: "networkidle0" });
  check("/terms is public", termsRes.status() === 200 && new URL(tp.url()).pathname === "/terms");
  const terms = await tp.evaluate(() => ({
    h1: document.querySelector("h1")?.textContent,
    sections: [...document.querySelectorAll("article section[id] h2")].map((h) => h.textContent.trim()),
    contents: [...document.querySelectorAll("nav[aria-labelledby=contents-title] a")].map((a) => a.getAttribute("href")),
    ids: [...document.querySelectorAll("article section[id]")].map((s) => `#${s.id}`),
    text: document.querySelector("article")?.innerText ?? "",
    updated: document.querySelector("time")?.getAttribute("datetime"),
  }));
  check(
    "it has its title, a date and thirteen numbered sections",
    terms.h1 === "Terms of service" && /^\d{4}-\d{2}-\d{2}$/.test(terms.updated ?? "") && terms.sections.length === 13 && /^1\./.test(terms.sections[0]),
    `${terms.h1} ${terms.updated} ${terms.sections.length}`,
  );
  check("the contents link to every section", terms.contents.join() === terms.ids.join(), terms.contents.join());
  check(
    "the membership terms quote the plan's price and how to cancel, and say where free drawings are kept",
    /The membership costs \$5 a month in US dollars/.test(terms.text) &&
      /cancel any time from the Membership page/.test(terms.text) &&
      /saved in your browser on your device/.test(terms.text),
  );
  await tp.click("nav[aria-labelledby=contents-title] a[href='#ai']");
  await sleep(300);
  check("a contents link jumps to its section", await tp.$eval("#ai", (el) => Math.abs(el.getBoundingClientRect().top) < 80));
  for (const [path, where] of [["/welcome", "landing page"], ["/pricing", "pricing page"]]) {
    await tp.goto(`${BASE}${path}`, { waitUntil: "networkidle0" });
    check(`the ${where}'s footer links to the terms`, !!(await tp.$("footer a[href='/terms']")));
  }
  await tp.goto(`${BASE}/signup`, { waitUntil: "networkidle0" });
  check(
    "signing up says you agree to the terms, with a link",
    /By creating an account you agree to the terms of service/.test(await tp.$eval("form", (f) => f.innerText)) &&
      !!(await tp.$("form a[href='/terms']")),
  );
  const phone = await newPage(tctx, { width: 360, height: 740, isMobile: true, hasTouch: true });
  await phone.goto(`${BASE}/terms`, { waitUntil: "networkidle0" });
  check(
    "it fits a 360px phone",
    await phone.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth),
  );
  await tctx.close();
}

const pb = await newPage(ctxB, { width: 1280, height: 800 });
const user = await signUp(pb, { name: "Landing Test" });
await pb.goto(BASE, { waitUntil: "networkidle0" });
check("signed-in people get their drawings at /", (await pb.$eval("h1", (h) => h.textContent)) === "Drawings");
await pb.goto(`${BASE}/welcome`, { waitUntil: "networkidle0" });
check("and can still open the landing page at /welcome", /Sketch it/.test(await pb.$eval("h1", (h) => h.textContent)));
sql(`delete from sessions where user_id = '${user.id}'`);
await pb.goto(BASE, { waitUntil: "networkidle0" });
check("an expired session at / goes to the login page", new URL(pb.url()).pathname === "/login");
await ctxB.close();

console.log("\nproblems:", problems.length ? problems : "none");
check("no console errors or failed requests", problems.length === 0);
await browser.close();
process.exit(failures ? 1 : 0);
