import { closeLocalDb, getLocalDb, localDbName } from "./idb";
import { slotPrefix } from "./store";

/**
 * On sign-out, remove this user's local copies from the browser, unless
 * something hasn't reached the server yet. Unsynced work is kept (in the
 * user's own namespace) and syncs the next time they sign in here.
 *
 * Returns how many drawings were kept because of unsynced changes.
 */
export async function clearLocalDataOnSignOut(userId: string): Promise<{ keptUnsynced: number }> {
  let keptUnsynced = 0;
  try {
    const db = await getLocalDb(userId);
    const metas = await db.getAll("meta");
    const assets = await db.getAll("assets");
    const outbox = await db.getAll("outbox");
    const unsynced = new Set([
      ...outbox.map((r) => r.drawingId),
      ...metas.filter((m) => m.localSeq > m.syncedSeq).map((m) => m.drawingId),
      ...assets.filter((a) => !a.uploaded).map((a) => a.drawingId),
    ]);
    keptUnsynced = unsynced.size;
    if (keptUnsynced === 0) {
      await closeLocalDb(userId);
      await new Promise<void>((resolve) => {
        const req = indexedDB.deleteDatabase(localDbName(userId));
        req.onsuccess = req.onerror = req.onblocked = () => resolve();
      });
    }
  } catch {
    // No IndexedDB (or it's broken): nothing to clear.
  }

  try {
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith(slotPrefix(userId))) {
        // Version 2 slots only ever hold unsynced changes; older ones say whether they're synced.
        const rec = JSON.parse(localStorage.getItem(key) ?? "null") as { v?: number; seq?: number; syncedSeq?: number } | null;
        const unsyncedSlot = rec?.v === 2 || (rec?.seq ?? 0) > (rec?.syncedSeq ?? 0);
        if (!unsyncedSlot) localStorage.removeItem(key);
        else keptUnsynced++;
      }
      // The saved view of each drawing isn't sensitive, but it isn't needed either.
      if (key.startsWith("canvas-camera:")) localStorage.removeItem(key);
    }
  } catch {
    /* storage disabled */
  }
  return { keptUnsynced };
}
