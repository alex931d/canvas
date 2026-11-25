// A stand-in for Google's sign-in, for the e2e tests: the account chooser and
// the token endpoint (OAuth 2.0 with PKCE, OpenID Connect ID tokens).
//
//   node e2e/mock-google.mjs     # http://localhost:4040
//
// Start the app with GOOGLE_CLIENT_ID=mock-client.apps.googleusercontent.com
// GOOGLE_CLIENT_SECRET=mock-google-secret
// GOOGLE_AUTH_URL=http://localhost:4040/o/oauth2/v2/auth
// GOOGLE_TOKEN_URL=http://localhost:4040/token (see README, Tests).
//
// The chooser is a form: type the Google account's email (and name, and
// whether Google has confirmed the address), then Continue or Cancel. The
// account's `sub` is derived from the email, so the same email is the same
// Google account every time. Like Google, it checks the client secret, the
// redirect URI and the PKCE verifier, and each code works once, for a minute.
import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";

const PORT = Number(process.env.MOCK_GOOGLE_PORT ?? 4040);
const CLIENT_ID = "mock-client.apps.googleusercontent.com";
const CLIENT_SECRET = "mock-google-secret";

/** code → { redirectUri, challenge, claims, at } */
const codes = new Map();
const stats = { authorized: 0, exchanged: 0, rejected: 0 };

const b64url = (buf) => Buffer.from(buf).toString("base64url");
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const subFor = (email) => createHash("sha256").update(email.toLowerCase()).digest("hex").slice(0, 21).replace(/[a-f]/g, (c) => String(c.charCodeAt(0) % 10));

function chooser(params) {
  const hidden = [...params].map(([k, v]) => `<input type="hidden" name="${esc(k)}" value="${esc(v)}">`).join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Sign in – Google Accounts (mock)</title></head>
<body style="font-family:sans-serif;max-width:420px;margin:48px auto">
<h1>Choose an account</h1>
<p>to continue to <strong>canvas</strong> (mock Google)</p>
<form method="post" action="/o/oauth2/v2/auth/decide">${hidden}
<p><label>Email <input name="email" id="google-email" type="email" required></label></p>
<p><label>Name <input name="name" id="google-name"></label></p>
<p><label><input type="checkbox" name="email_verified" id="google-verified" value="true" checked> Email confirmed by Google</label></p>
<p><button name="decision" value="allow" id="google-continue">Continue</button>
<button name="decision" value="deny" id="google-cancel" formnovalidate>Cancel</button></p>
</form></body></html>`;
}

function redirectTo(res, uri, params) {
  const url = new URL(uri);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  res.writeHead(302, { Location: url.toString() });
  res.end();
}

async function body(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return new URLSearchParams(Buffer.concat(chunks).toString());
}

function json(res, status, data) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  try {
    if (req.method === "GET" && url.pathname === "/o/oauth2/v2/auth") {
      const p = url.searchParams;
      const problems = [];
      if (p.get("client_id") !== CLIENT_ID) problems.push("unknown client_id");
      if (p.get("response_type") !== "code") problems.push("response_type must be code");
      if (p.get("code_challenge_method") !== "S256" || !p.get("code_challenge")) problems.push("PKCE (S256) required");
      if (!p.get("state")) problems.push("state required");
      if (!/\bopenid\b/.test(p.get("scope") ?? "")) problems.push("scope must include openid");
      if (!p.get("redirect_uri")) problems.push("redirect_uri required");
      if (problems.length) {
        res.writeHead(400, { "Content-Type": "text/plain" });
        return res.end(`Error 400: invalid_request\n${problems.join("\n")}`);
      }
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      return res.end(chooser(p));
    }

    if (req.method === "POST" && url.pathname === "/o/oauth2/v2/auth/decide") {
      const f = await body(req);
      const redirectUri = f.get("redirect_uri");
      if (f.get("decision") !== "allow") return redirectTo(res, redirectUri, { error: "access_denied", state: f.get("state") });
      const email = (f.get("email") ?? "").trim().toLowerCase();
      const code = b64url(randomBytes(24));
      codes.set(code, {
        redirectUri,
        challenge: f.get("code_challenge"),
        at: Date.now(),
        claims: {
          sub: subFor(email),
          email,
          email_verified: f.get("email_verified") === "true",
          name: f.get("name") || undefined,
        },
      });
      stats.authorized++;
      return redirectTo(res, redirectUri, { code, state: f.get("state"), scope: "openid email profile" });
    }

    if (req.method === "POST" && url.pathname === "/token") {
      const f = await body(req);
      const auth = req.headers.authorization ?? "";
      const [id, secret] = auth.startsWith("Basic ")
        ? Buffer.from(auth.slice(6), "base64").toString().split(":").map(decodeURIComponent)
        : [f.get("client_id"), f.get("client_secret")];
      const reject = (error) => {
        stats.rejected++;
        return json(res, 400, { error });
      };
      if (id !== CLIENT_ID || secret !== CLIENT_SECRET) return reject("invalid_client");
      if (f.get("grant_type") !== "authorization_code") return reject("unsupported_grant_type");
      const entry = codes.get(f.get("code"));
      codes.delete(f.get("code"));
      if (!entry || Date.now() - entry.at > 60_000) return reject("invalid_grant");
      if (entry.redirectUri !== f.get("redirect_uri")) return reject("redirect_uri_mismatch");
      const verifier = f.get("code_verifier") ?? "";
      if (b64url(createHash("sha256").update(verifier).digest()) !== entry.challenge) return reject("invalid_grant");
      const now = Math.floor(Date.now() / 1000);
      const idToken = [
        b64url(JSON.stringify({ alg: "RS256", kid: "mock", typ: "JWT" })),
        b64url(JSON.stringify({ iss: "https://accounts.google.com", aud: CLIENT_ID, azp: CLIENT_ID, iat: now, exp: now + 3600, ...entry.claims })),
        b64url("mock-signature"),
      ].join(".");
      stats.exchanged++;
      return json(res, 200, {
        access_token: b64url(randomBytes(24)),
        expires_in: 3599,
        token_type: "Bearer",
        scope: "openid https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/userinfo.profile",
        id_token: idToken,
      });
    }

    if (req.method === "GET" && url.pathname === "/stats") return json(res, 200, stats);
    res.writeHead(404);
    res.end();
  } catch (err) {
    res.writeHead(500);
    res.end(String(err));
  }
}).listen(PORT, () => console.log(`mock Google on http://localhost:${PORT}`));
