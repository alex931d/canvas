import { sql } from "drizzle-orm";
import { connection } from "next/server";
import { db } from "@/db";

/**
 * For the container health check and uptime monitors: 200 when the app is
 * running and can reach its database, 503 when it can't. Says nothing else.
 */

const TIMEOUT_MS = 3000;

export async function GET() {
  await connection();
  const headers = { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" };
  try {
    await Promise.race([
      db.execute(sql`select 1`),
      new Promise((_, reject) => setTimeout(() => reject(new Error("timed out")), TIMEOUT_MS)),
    ]);
    return new Response("ok\n", { headers });
  } catch {
    return new Response("database unavailable\n", { status: 503, headers });
  }
}
