import "server-only";

import { sql } from "drizzle-orm";
import { db } from "@/db";

/**
 * Events between server processes go through Postgres LISTEN/NOTIFY on one
 * channel, so live collaboration works with any number of app servers.
 * Payloads stay small (Postgres caps them at 8000 bytes): changes are only
 * announced here; the hub reads them from drawing_changes.
 */
export const CHANNEL = "drawing_events";

export type HubMessage =
  /** New rows in drawing_changes. */
  | { t: "change"; d: string }
  /** Someone's cursor, selection or arrival/departure (never stored). */
  | {
      t: "presence";
      d: string;
      c: string;
      u: string;
      n: string;
      /** Their profile picture URL, if they have one. */
      a?: string | null;
      cur: { x: number; y: number } | null;
      sel: string[];
      hello?: boolean;
      bye?: boolean;
    }
  /** The title changed. */
  | { t: "meta"; d: string; title: string }
  /** Sharing changed: subscribers re-check what they're allowed. */
  | { t: "access"; d: string }
  /** The owner deleted the drawing. */
  | { t: "deleted"; d: string };

type Executor = { execute: typeof db.execute };

/** Send a message; inside a transaction it goes out when that commits. */
export async function notify(message: HubMessage, executor: Executor = db) {
  await executor.execute(sql`select pg_notify(${CHANNEL}, ${JSON.stringify(message)})`);
}
