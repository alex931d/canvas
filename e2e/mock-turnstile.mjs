// A stand-in for Cloudflare Turnstile, for the e2e tests: the widget script
// and the siteverify API. Real Turnstile can't be used here (it's built to
// stop automated browsers, and its test keys accept any token).
//
//   node e2e/mock-turnstile.mjs     # http://localhost:4030
//
// Start the app with TURNSTILE_SITE_KEY=1x00000000000000000000AA
// TURNSTILE_SECRET_KEY=1x0000000000000000000000000000000AA
// TURNSTILE_SCRIPT_URL=http://localhost:4030/turnstile/v0/api.js
// TURNSTILE_VERIFY_URL=http://localhost:4030/turnstile/v0/siteverify (see README, Tests).
//
// The widget asks this server for each token, so only tokens it issued pass,
// each once and for 5 minutes, and siteverify reports the widget's action,
// like the real one. Secrets starting with 2x always fail. A page can slow the
// widget down with window.__mockTurnstileDelay (ms).
import { createServer } from "node:http";
import { randomBytes } from "node:crypto";

const PORT = Number(process.env.MOCK_TURNSTILE_PORT ?? 4030);
const SECRET = "1x0000000000000000000000000000000AA";
const TOKEN_LIFETIME_MS = 300_000;

/** token → { action, issuedAt, used } */
const tokens = new Map();
const stats = { issued: 0, passed: 0, failed: 0 };

const widgetScript = (origin) => `(() => {
  const ORIGIN = ${JSON.stringify(origin)};
  const widgets = new Map();
  let next = 0;
  async function issue(id) {
    const w = widgets.get(id);
    if (!w) return;
    const round = ++w.round; // a reset makes earlier rounds stale
    clearTimeout(w.timer);
    w.token = "";
    const res = await fetch(ORIGIN + "/turnstile/v0/token?action=" + encodeURIComponent(w.options.action || ""), { method: "POST" });
    const { token } = await res.json();
    if (w.round !== round) return;
    w.timer = setTimeout(() => {
      if (widgets.get(id) !== w || w.round !== round) return;
      w.token = token;
      w.options.callback && w.options.callback(token);
    }, window.__mockTurnstileDelay ?? 150);
  }
  window.turnstile = {
    render(container, options) {
      const el = typeof container === "string" ? document.querySelector(container) : container;
      const id = "mock-widget-" + ++next;
      el.setAttribute("data-mock-turnstile", options.sitekey);
      widgets.set(id, { options, token: "", timer: 0, round: 0 });
      issue(id);
      return id;
    },
    reset(id) { issue(id); },
    remove(id) { const w = widgets.get(id); if (w) clearTimeout(w.timer); widgets.delete(id); },
    getResponse(id) { return widgets.get(id)?.token; },
    isExpired() { return false; },
  };
})();`;

function json(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => resolve(data));
  });
}

createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  if (req.method === "GET" && url.pathname === "/turnstile/v0/api.js") {
    res.writeHead(200, { "Content-Type": "text/javascript", "Cache-Control": "no-store" });
    return res.end(widgetScript(`http://localhost:${PORT}`));
  }

  if (req.method === "POST" && url.pathname === "/turnstile/v0/token") {
    const token = `mock.${randomBytes(24).toString("base64url")}`;
    tokens.set(token, { action: url.searchParams.get("action") ?? "", issuedAt: Date.now(), used: false });
    stats.issued++;
    return json(res, 200, { token });
  }

  if (req.method === "POST" && url.pathname === "/turnstile/v0/siteverify") {
    const form = new URLSearchParams(await readBody(req));
    const secret = form.get("secret") ?? "";
    const response = form.get("response") ?? "";
    const fail = (code) => {
      stats.failed++;
      return json(res, 200, { success: false, "error-codes": [code] });
    };
    if (!secret) return fail("missing-input-secret");
    if (secret.startsWith("2x")) return fail("invalid-input-response");
    if (secret !== SECRET) return fail("invalid-input-secret");
    if (!response) return fail("missing-input-response");
    const t = tokens.get(response);
    if (!t) return fail("invalid-input-response");
    if (t.used || Date.now() - t.issuedAt > TOKEN_LIFETIME_MS) return fail("timeout-or-duplicate");
    t.used = true;
    stats.passed++;
    return json(res, 200, {
      success: true,
      challenge_ts: new Date(t.issuedAt).toISOString(),
      hostname: "localhost",
      action: t.action,
      "error-codes": [],
    });
  }

  if (req.method === "GET" && url.pathname === "/stats") return json(res, 200, stats);

  if (req.method === "OPTIONS") {
    res.writeHead(204, { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST" });
    return res.end();
  }
  json(res, 404, { error: "not found" });
}).listen(PORT, () => console.log(`mock Turnstile on :${PORT}`));
