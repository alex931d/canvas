// Applies the SQL migrations in ./drizzle (what `npm run db:migrate` runs).
//
// It does the same job as `drizzle-kit migrate` and uses the same bookkeeping
// table (drizzle.__drizzle_migrations), but drizzle-kit exits without a word
// when it can't reach the database. This prints what went wrong and what to try.
import nextEnv from "@next/env";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";

nextEnv.loadEnvConfig(process.cwd(), false, { info: () => {}, error: console.error });

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set. Copy .env.example to .env.local (cp .env.example .env.local) and try again.");
  process.exit(1);
}

/** The URL with the password hidden, for messages. */
function describe(raw) {
  try {
    const u = new URL(raw);
    if (u.password) u.password = "****";
    return u.toString();
  } catch {
    return "(DATABASE_URL isn't a valid URL)";
  }
}

const SUPABASE_SHAPE = "postgresql://postgres.<project-ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres";

const isLocal = (u) => !u || ["localhost", "127.0.0.1", "[::1]", "::1", "postgres", "db"].includes(u.hostname);

/** Supabase: the usual ways a copied connection string goes wrong. */
function supabaseHint(err, u) {
  const host = u.hostname;
  const lines = [];
  if (!/\.(pooler\.supabase\.com|supabase\.co)$/.test(host)) {
    lines.push(
      `"${host}" isn't a Supabase database address. In your project, click Connect, choose Session pooler`,
      "and copy that connection string exactly. It looks like:",
      `  ${SUPABASE_SHAPE}`,
    );
  } else if (host.endsWith(".supabase.co")) {
    lines.push(
      "This is Supabase's direct address, which only works on networks with IPv6. Use the Session pooler",
      "string instead (Connect > Session pooler). It looks like:",
      `  ${SUPABASE_SHAPE}`,
    );
  } else if (u.port === "6543") {
    lines.push(
      "Port 6543 is Supabase's transaction pooler. Migrations need a whole session: use the Session pooler",
      "string (same address, port 5432).",
    );
  } else {
    lines.push(
      "Check the string matches Connect > Session pooler exactly: the user must be postgres.<project-ref>,",
      "the region must be your project's, and a password with symbols like @ # / ? must be URL-encoded.",
    );
  }
  if (err.code === "28P01") lines.push("Supabase refused the password: reset it under Project Settings > Database.");
  return lines;
}

function hint(err, u) {
  const where = u ? `${u.hostname}:${u.port || 5432}` : "the database";
  const db = u?.pathname.slice(1) || "the database";
  if (u && /supabase\.(com|co)$/.test(u.hostname)) return supabaseHint(err, u);
  if (!isLocal(u) && (err.code === "ECONNRESET" || /terminated unexpectedly/i.test(err.message ?? ""))) {
    return [
      `The server at ${where} closed the connection before answering.`,
      "Check the host and port in DATABASE_URL against your provider's connection string, and whether it",
      "needs SSL (add ?sslmode=require) or a pooler address for outside connections.",
    ];
  }
  switch (err.code) {
    case "ECONNREFUSED":
      return [
        `Nothing is accepting connections at ${where}, so PostgreSQL isn't running there.`,
        "Start it with:  docker compose up -d --wait",
        "If docker compose itself fails, see Troubleshooting in README.md.",
      ];
    case "57P03": // the database system is starting up
    case "ECONNRESET":
      return ["PostgreSQL is still starting up. Wait a few seconds and run npm run db:migrate again."];
    case "ENOTFOUND":
    case "EAI_AGAIN":
      return [`The host "${u?.hostname}" in DATABASE_URL can't be found. Check .env.local.`];
    case "3D000": // database does not exist
      return [
        `The server at ${where} is running but has no database called "${db}".`,
        "If you meant to use the Docker database, another PostgreSQL (one installed on this computer)",
        "is probably using that port: stop it (e.g. sudo systemctl stop postgresql) and run",
        "docker compose up -d --wait. To use that server instead, create the database (createdb " + db + ").",
      ];
    case "28P01": // password authentication failed
    case "28000": // no pg_hba.conf entry / role problems
      return [
        `The server at ${where} refused the user or password in DATABASE_URL.`,
        "If you meant to use the Docker database, another PostgreSQL is probably using that port:",
        "stop it (e.g. sudo systemctl stop postgresql) and run docker compose up -d --wait.",
        "Otherwise put that server's user and password in .env.local.",
      ];
    default:
      return [];
  }
}

let parsed = null;
try {
  parsed = new URL(url);
} catch {
  console.error("✗ DATABASE_URL in .env.local isn't a valid connection string.");
  console.error("  It should look like  postgresql://USER:PASSWORD@HOST:PORT/DATABASE");
  console.error(`  For Supabase: Connect > Session pooler, copied exactly:\n    ${SUPABASE_SHAPE}`);
  console.error("  A password with symbols like @ # / ? has to be URL-encoded (e.g. @ becomes %40).");
  process.exit(1);
}
if (!parsed.hostname) {
  console.error(`✗ DATABASE_URL has no server address after the @: ${describe(url)}`);
  console.error(`  For Supabase: Connect > Session pooler, copied exactly:\n    ${SUPABASE_SHAPE}`);
  process.exit(1);
}

const pool = new pg.Pool({ connectionString: url, connectionTimeoutMillis: 10_000, max: 1 });
try {
  const db = drizzle({ client: pool });
  await migrate(db, { migrationsFolder: "./drizzle" });
  const { rows } = await pool.query("select count(*)::int as n from drizzle.__drizzle_migrations");
  console.log(`✓ Database is up to date (${rows[0].n} migrations applied) at ${describe(url)}`);
} catch (caught) {
  // drizzle wraps driver errors ("Failed query: …"); the cause says what happened.
  let err = caught ?? {};
  while (err.cause && typeof err.cause === "object") err = err.cause;
  const message = err.message || err.code || String(err);
  console.error(`✗ Couldn't migrate ${describe(url)}`);
  console.error(`  ${message}${err.code && !message.includes(err.code) ? ` (${err.code})` : ""}`);
  const lines = hint(err, parsed);
  if (lines.length) console.error(`\n  ${lines.join("\n  ")}`);
  process.exitCode = 1;
} finally {
  await pool.end().catch(() => {});
}
