// The email queue (src/lib/email/queue.ts), end to end against e2e/mock-mail.mjs:
// urgent mail goes before bulk mail that was queued earlier; a real email from
// the app is queued with its priority, encrypted while it waits and erased once
// sent; a mail server's "try later" is retried and its "no such mailbox" isn't;
// a job a stopped server left mid-send goes back in the queue; and admins see
// the queue on the admin page.
import puppeteer from "puppeteer-core";
import nextEnv from "@next/env";

nextEnv.loadEnvConfig(process.cwd());
const { BASE, sleep, sql, signUp, uniqueEmail, waitForEmail } = await import("./helpers.mjs");

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
    value = await Promise.resolve(fn()).catch(() => null);
    if (value) return value;
    await sleep(200);
  }
  return value;
}

const run = `q${Date.now().toString(36)}`;
const addr = (name) => `${name}-${run}@canvas.test`;
/** Queue a job straight into the table (a plain body, as the app stores one without ENCRYPTION_KEY). */
function queue(to, priority, kind, { due = "now()" } = {}) {
  const body = JSON.stringify({ subject: `${kind} for ${to}`, text: `Hello from the ${kind} test.`, html: `<p>${kind}</p>` });
  return sql(
    `insert into email_jobs (to_address, kind, priority, body, sealed, run_after)
     values ('${to}', '${kind}', ${priority}, convert_to('${body.replace(/'/g, "''")}', 'UTF8'), false, ${due}) returning id`,
  );
}
const job = (id) =>
  sql(`select status || '|' || attempts || '|' || (body is null) || '|' || coalesce(last_error, '') from email_jobs where id = ${id}`).split("|");

// ------------------------------------------------------------ urgent before bulk
// Bulk mail queued first, then urgent mail; all of it falls due at once.
const bulk = [1, 2, 3, 4, 5, 6].map((n) => queue(addr(`bulk${n}`), 3, `${run} bulk`, { due: "now() + interval '1 day'" }));
const urgent = [1, 2].map((n) => queue(addr(`urgent${n}`), 0, `${run} urgent`, { due: "now() + interval '1 day'" }));
sql(`update email_jobs set run_after = now() where kind like '${run} %'`);
const allSent = await waitFor(() => sql(`select count(*) from email_jobs where kind like '${run} %' and status = 'sent'`) === "8", 20_000);
check("everything queued is sent", !!allSent);
const order = sql(
  `select (select max(sent_at) from email_jobs where kind = '${run} urgent') < (select min(sent_at) from email_jobs where kind = '${run} bulk')`,
);
check("urgent mail goes before bulk mail queued earlier", order === "t");
check(
  "each arrives in its inbox",
  !!(await waitForEmail(addr("urgent1"), /urgent/).catch(() => null)) && !!(await waitForEmail(addr("bulk6"), /bulk/).catch(() => null)),
);
check(
  "and sent messages are erased from the queue",
  sql(`select count(*) from email_jobs where id in (${[...bulk, ...urgent].join(",")}) and body is not null`) === "0",
);

// ------------------------------------------------------------ a real email from the app
const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--no-sandbox"] });
const page = await (await browser.createBrowserContext()).newPage();
await page.setViewport({ width: 1280, height: 860 });
const person = uniqueEmail("queue");
const t0 = Date.now();
await signUp(page, { name: "Quinn Queue", email: person, verify: false });
const code = await waitForEmail(person, /code/i, { after: t0 }).catch(() => null);
check("the confirmation code still arrives", !!code, code?.subject);
const row = sql(
  `select kind || '|' || priority || '|' || status || '|' || sealed || '|' || (body is null) from email_jobs where to_address = '${person}' order by id desc limit 1`,
).split("|");
check("it went through the queue as urgent", row[0] === "confirmation code" && row[1] === "0" && row[2] === "sent", row.join(" "));
check(
  "encrypted while it waited, erased once sent",
  (process.env.ENCRYPTION_KEY ? row[3] === "true" : true) && row[4] === "true",
  row.join(" "),
);

// ------------------------------------------------------------ try later, and no such mailbox
const busyId = queue(`busy-once+${run}@canvas.test`, 1, `${run} retry`);
const firstTry = await waitFor(() => {
  const [status, attempts] = job(busyId);
  return status === "queued" && attempts === "1" ? job(busyId) : null;
});
check("a mail server's 'try later' puts it back in the queue", !!firstTry && /451/.test(firstTry[3]), firstTry?.join(" "));
check(
  "for about 30 seconds",
  Number(sql(`select round(extract(epoch from run_after - now())) from email_jobs where id = ${busyId}`)) > 20,
);
sql(`update email_jobs set run_after = now() where id = ${busyId}`); // don't wait the 30 s here
const retried = await waitFor(() => job(busyId)[0] === "sent");
check("and the next try sends it", !!retried && job(busyId)[1] === "2", job(busyId).join(" "));

const nobodyId = queue(`nobody+${run}@canvas.test`, 2, `${run} bounce`);
const bounced = await waitFor(() => job(nobodyId)[0] === "failed");
check(
  "'no such mailbox' isn't retried",
  !!bounced && job(nobodyId)[1] === "1" && /550/.test(job(nobodyId)[3]) && job(nobodyId)[2] === "true",
  job(nobodyId).join(" "),
);

// ------------------------------------------------------------ a job left mid-send
const stuckId = queue(addr("stuck"), 2, `${run} stuck`);
sql(`update email_jobs set status = 'sending', attempts = 1, locked_at = now() - interval '10 minutes' where id = ${stuckId}`);
const freed = await waitFor(() => job(stuckId)[0] === "sent", 75_000); // the worker tidies up once a minute
check("a job a stopped server left mid-send is sent again", !!freed, job(stuckId).join(" "));

// ------------------------------------------------------------ the admin page
const adminPage = await (await browser.createBrowserContext()).newPage();
await adminPage.setViewport({ width: 1280, height: 860 });
const admin = await signUp(adminPage, { name: "Ada Admin", email: uniqueEmail("queue-admin") });
sql(`update users set role = 'admin' where id = '${admin.id}'`);
await adminPage.goto(`${BASE}/admin`, { waitUntil: "networkidle0" });
const card = await adminPage.$eval("[data-testid=email-queue]", (s) => s.innerText).catch(() => "");
check("admins see the queue on the admin page", /waiting/.test(card) && /sent today/.test(card) && /[1-9]\d* failed today/.test(card), card);

await browser.close();
console.log(failures ? `\n${failures} failed` : "\nall passed");
process.exit(failures ? 1 : 0);
