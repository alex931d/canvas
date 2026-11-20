// A stand-in mail server for the e2e tests: a small SMTP server that keeps
// every message, and an HTTP inbox to read them.
//
//   node e2e/mock-mail.mjs          # SMTP on :2525, inbox on http://localhost:2526
//
// Start the app with SMTP_URL=smtp://localhost:2525 (see README, Tests).
//
//   GET    /messages?to=a@b.c   → [{ to, from, subject, text, html, at }], oldest first
//   DELETE /messages            → empty the inbox
import { createServer as createTcpServer } from "node:net";
import { createServer as createHttpServer } from "node:http";

const SMTP_PORT = Number(process.env.MOCK_SMTP_PORT ?? 2525);
const INBOX_PORT = Number(process.env.MOCK_INBOX_PORT ?? 2526);

let messages = [];

// ------------------------------------------------------------ MIME, just enough

function decodeQuotedPrintable(s) {
  const bytes = [];
  const body = s.replace(/=\r?\n/g, "");
  for (let i = 0; i < body.length; i++) {
    if (body[i] === "=" && /^[0-9A-F]{2}$/i.test(body.slice(i + 1, i + 3))) {
      bytes.push(parseInt(body.slice(i + 1, i + 3), 16));
      i += 2;
    } else {
      bytes.push(...Buffer.from(body[i], "utf8"));
    }
  }
  return Buffer.from(bytes).toString("utf8");
}

function decodeBody(body, encoding = "") {
  const e = encoding.toLowerCase();
  if (e === "quoted-printable") return decodeQuotedPrintable(body);
  if (e === "base64") return Buffer.from(body.replace(/\s+/g, ""), "base64").toString("utf8");
  return body;
}

/** =?UTF-8?Q?...?= and =?UTF-8?B?...?= words in headers. */
function decodeWords(value) {
  return value
    .replace(/\?=\s+=\?/g, "?==?")
    .replace(/=\?([^?]+)\?([QBqb])\?([^?]*)\?=/g, (_, _charset, enc, text) =>
      enc.toUpperCase() === "B"
        ? Buffer.from(text, "base64").toString("utf8")
        : decodeQuotedPrintable(text.replace(/_/g, " ")),
    );
}

function parsePart(raw) {
  const split = raw.indexOf("\r\n\r\n");
  const head = split === -1 ? raw : raw.slice(0, split);
  const body = split === -1 ? "" : raw.slice(split + 4);
  const headers = {};
  for (const line of head.replace(/\r\n[ \t]+/g, " ").split("\r\n")) {
    const colon = line.indexOf(":");
    if (colon > 0) headers[line.slice(0, colon).trim().toLowerCase()] = line.slice(colon + 1).trim();
  }
  return { headers, body };
}

/** The text/plain and text/html parts of a message (multipart or not). */
function collect(part, out) {
  const type = part.headers["content-type"] ?? "text/plain";
  const boundary = /boundary="?([^";]+)"?/i.exec(type)?.[1];
  if (/^multipart\//i.test(type) && boundary) {
    for (const chunk of part.body.split(`--${boundary}`).slice(1)) {
      if (chunk.startsWith("--")) break;
      collect(parsePart(chunk.replace(/^\r\n/, "")), out);
    }
  } else if (/^text\/(plain|html)/i.test(type)) {
    const key = /html/i.test(type) ? "html" : "text";
    out[key] ??= decodeBody(part.body.replace(/\r\n$/, ""), part.headers["content-transfer-encoding"]);
  }
  return out;
}

function store(recipients, from, data) {
  const message = parsePart(data);
  const parts = collect(message, {});
  for (const to of recipients) {
    messages.push({
      to,
      from,
      subject: decodeWords(message.headers.subject ?? ""),
      text: (parts.text ?? "").replace(/\r\n/g, "\n"),
      html: parts.html ?? "",
      at: new Date().toISOString(),
    });
  }
}

// ------------------------------------------------------------ SMTP

createTcpServer((socket) => {
  let buffer = "";
  let inData = false;
  let from = "";
  let recipients = [];
  const reply = (line) => socket.write(`${line}\r\n`);
  reply("220 mock-mail ESMTP ready");

  socket.on("data", (chunk) => {
    buffer += chunk.toString("utf8");
    for (;;) {
      if (inData) {
        const end = buffer.indexOf("\r\n.\r\n");
        if (end === -1) return;
        const data = buffer.slice(0, end).replace(/^\.\./gm, ".");
        buffer = buffer.slice(end + 5);
        inData = false;
        store(recipients, from, data);
        recipients = [];
        reply("250 OK: queued");
        continue;
      }
      const eol = buffer.indexOf("\r\n");
      if (eol === -1) return;
      const line = buffer.slice(0, eol);
      buffer = buffer.slice(eol + 2);
      const verb = line.split(" ")[0].toUpperCase();
      if (verb === "EHLO") {
        reply("250-mock-mail");
        reply("250-8BITMIME");
        reply("250 SMTPUTF8");
      } else if (verb === "HELO") reply("250 mock-mail");
      else if (verb === "MAIL") {
        from = /<([^>]*)>/.exec(line)?.[1] ?? "";
        reply("250 OK");
      } else if (verb === "RCPT") {
        recipients.push((/<([^>]*)>/.exec(line)?.[1] ?? "").toLowerCase());
        reply("250 OK");
      } else if (verb === "DATA") {
        inData = true;
        reply("354 End data with <CR><LF>.<CR><LF>");
      } else if (verb === "RSET") {
        recipients = [];
        reply("250 OK");
      } else if (verb === "NOOP") reply("250 OK");
      else if (verb === "QUIT") {
        reply("221 Bye");
        socket.end();
        return;
      } else reply("502 Command not implemented");
    }
  });
  socket.on("error", () => {});
}).listen(SMTP_PORT, () => console.log(`mock SMTP on :${SMTP_PORT}`));

// ------------------------------------------------------------ inbox

createHttpServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${INBOX_PORT}`);
  if (url.pathname === "/messages" && req.method === "GET") {
    const to = url.searchParams.get("to")?.toLowerCase();
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify(to ? messages.filter((m) => m.to === to) : messages));
  }
  if (url.pathname === "/messages" && req.method === "DELETE") {
    messages = [];
    res.writeHead(204);
    return res.end();
  }
  res.writeHead(404);
  res.end();
}).listen(INBOX_PORT, () => console.log(`mock inbox on :${INBOX_PORT}`));
