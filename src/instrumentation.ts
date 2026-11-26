/**
 * Runs once when a server starts (Next.js instrumentation). It starts the
 * hourly storage sweep: ended memberships' server data is deleted after 30
 * days (src/lib/billing/lapsed.ts). STORAGE_SWEEP_SECONDS changes how often
 * (the tests use a few seconds); 0 turns it off on this server.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const seconds = Number(process.env.STORAGE_SWEEP_SECONDS ?? 3600);
  if (!(seconds > 0)) return;
  const { sweepStorage } = await import("./lib/billing/lapsed");
  let running = false;
  const sweep = async () => {
    if (running) return;
    running = true;
    try {
      const result = await sweepStorage();
      if (result && (result.scheduled || result.warned || result.reminded || result.deleted)) {
        console.info("[storage] sweep:", JSON.stringify(result));
      }
    } catch (err) {
      console.error("[storage] sweep failed:", err);
    } finally {
      running = false;
    }
  };
  // A first pass shortly after starting, then on the interval; neither keeps the process alive.
  setTimeout(() => void sweep(), Math.min(seconds, 60) * 1000).unref?.();
  setInterval(() => void sweep(), seconds * 1000).unref?.();
}
