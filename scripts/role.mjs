// Roles from the command line (what `npm run role` runs). Use it to make the
// first admin; after that, admins can change roles in /admin.
//
//   npm run role -- set you@example.com admin     (user, support or admin)
//   npm run role -- show you@example.com
//   npm run role -- list                          (everyone with a staff role)
//
// Roles and what they allow are described in src/lib/auth/roles.ts.
import nextEnv from "@next/env";
import pg from "pg";

nextEnv.loadEnvConfig(process.cwd(), false, { info: () => {}, error: console.error });

const ROLES = ["user", "support", "admin"];
const [command, email, role] = process.argv.slice(2);
const usage = "Usage: npm run role -- set <email> <user|support|admin> | show <email> | list";
if (!["set", "show", "list"].includes(command) || (command !== "list" && !email) || (command === "set" && !ROLES.includes(role))) {
  console.error(usage);
  process.exit(1);
}
if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set. Copy .env.example to .env.local and try again.");
  process.exit(1);
}

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
try {
  if (command === "list") {
    const { rows } = await client.query(
      "select name, email, role from users where role <> 'user' order by role, lower(email)",
    );
    if (rows.length === 0) console.log("Nobody has a staff role yet. Make an admin with: npm run role -- set <email> admin");
    for (const r of rows) console.log(`${r.role.padEnd(8)} ${r.name} <${r.email}>`);
  } else {
    const { rows: found } = await client.query(
      "select id, name, email, role, email_verified from users where lower(email) = lower($1)",
      [email.trim()],
    );
    const user = found[0];
    if (!user) {
      console.error(`No account uses ${email}. They need to sign up first.`);
      process.exitCode = 1;
    } else if (command === "show") {
      console.log(`${user.name} <${user.email}> is ${user.role === "admin" ? "an" : "a"} ${user.role}.`);
    } else if (user.role === role) {
      console.log(`${user.name} <${user.email}> is already ${role === "admin" ? "an" : "a"} ${role}.`);
    } else if (role !== "user" && !user.email_verified) {
      // Anyone can sign up with any address; only its owner can confirm it.
      console.error(`${user.name} <${user.email}> hasn't confirmed their email yet. Ask them to enter the code we sent, then try again.`);
      process.exitCode = 1;
    } else {
      await client.query("begin");
      await client.query("update users set role = $1 where id = $2", [role, user.id]);
      await client.query(
        "insert into audit_events (actor_id, user_id, action, details) values (null, $1, 'role.changed', $2)",
        [user.id, JSON.stringify({ from: user.role, to: role, via: "command line" })],
      );
      await client.query("commit");
      console.log(`${user.name} <${user.email}> is now ${role === "admin" ? "an" : "a"} ${role} (was ${user.role}).`);
    }
  }
} finally {
  await client.end();
}
