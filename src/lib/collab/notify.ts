import "server-only";

import { bus } from "./bus";
import { hub } from "./hub";

/**
 * Live events for the people looking at a drawing. `notify` hands them to
 * this server's open streams straight away (from memory) and to the other
 * app servers through the bus (src/lib/collab/bus.ts). Changes themselves
 * aren't in the message: the hub reads them from drawing_changes, so a
 * message can be small, late, doubled or lost without anyone missing a
 * change.
 *
 * Call it after the database work has committed, never inside a
 * transaction: a stream told about a change must be able to read it.
 */

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

export async function notify(message: HubMessage) {
  hub.receive(message);
  await bus.publish(message);
}
