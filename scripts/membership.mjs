// Complimentary memberships, for you and anyone you want to let in for free
// (what `npm run membership` runs):
//
//   npm run membership -- grant you@example.com
//   npm run membership -- revoke you@example.com
//   npm run membership -- show you@example.com
//
// A complimentary membership is a row in `subscriptions` whose id starts with
// comp_. Stripe never sees it, and syncing from Stripe never touches it.
import { randomUUID } from "node:crypto";
import nextEnv from "@next/env";
import pg from "pg";

nextEnv.loadEnvConfig(process.cwd(), false, { info: () => {}, error: console.error });

const [command, email] = process.argv.slice(2);
if (!["grant", "revoke", "show"].includes(command) || !email) {
  console.error("Usage: npm run membership -- grant|revoke|show <email>");
  process.exit(1);
}
if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set. Copy .env.example to .env.local and try again.");
  process.exit(1);
}

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
try {
  const { rows: found } = await client.query(
    "select id, name, email_verified from users where lower(email) = lower($1)",
    [email.trim()],
  );
  const user = found[0];
  if (!user) {
    console.error(`No account uses ${email}. They need to sign up first.`);
    process.exitCode = 1;
  } else if (command === "grant" && !user.email_verified) {
    // Anyone can sign up with any address; only the address's owner can confirm it.
    console.error(`${user.name} <${email}> hasn't confirmed their email yet. Ask them to enter the code we sent, then try again.`);
    process.exitCode = 1;
  } else if (command === "grant") {
    const { rows: existing } = await client.query(
      "select id from subscriptions where user_id = $1 and id like 'comp\\_%' and status = 'active'",
      [user.id],
    );
    if (existing.length > 0) {
      console.log(`${user.name} <${email}> already has a complimentary membership.`);
    } else {
      await client.query("insert into subscriptions (id, user_id, status) values ($1, $2, 'active')", [
        `comp_${randomUUID()}`,
        user.id,
      ]);
      console.log(`Granted ${user.name} <${email}> a complimentary membership.`);
    }
  } else if (command === "revoke") {
    const { rowCount } = await client.query(
      "update subscriptions set status = 'canceled', ended_at = now(), updated_at = now() where user_id = $1 and id like 'comp\\_%' and status = 'active'",
      [user.id],
    );
    console.log(
      rowCount
        ? `Ended ${user.name} <${email}>'s complimentary membership.`
        : `${user.name} <${email}> has no complimentary membership. Paid memberships are cancelled in Stripe.`,
    );
  } else {
    const { rows } = await client.query(
      "select id, status, current_period_end, cancel_at, ended_at from subscriptions where user_id = $1 order by created_at desc",
      [user.id],
    );
    if (!user.email_verified) console.log(`${user.name} <${email}> hasn't confirmed their email yet.`);
    if (rows.length === 0) console.log(`${user.name} <${email}> has never had a membership.`);
    for (const r of rows) {
      const kind = r.id.startsWith("comp_") ? "complimentary" : "Stripe";
      const when = r.ended_at
        ? `ended ${r.ended_at.toISOString().slice(0, 10)}`
        : r.cancel_at
          ? `ends ${r.cancel_at.toISOString().slice(0, 10)}`
          : r.current_period_end
            ? `renews ${r.current_period_end.toISOString().slice(0, 10)}`
            : "";
      console.log(`${r.status.padEnd(10)} ${kind.padEnd(14)} ${r.id}  ${when}`);
    }
  }
} finally {
  await client.end();
}
