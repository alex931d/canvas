import type { AssetCache } from "@/lib/canvas/images";
import type { Role } from "./access-types";
import type { CollabDoc } from "./doc";
import { assetIdsIn, type DocOp } from "./ops";

/**
 * Keeps one browser tab and the server in step for one drawing:
 *
 *  - sends the doc's new batches (images first, so nobody sees a missing
 *    picture), one request at a time, retrying with back-off;
 *  - follows the live stream (/events) and feeds every change to the doc,
 *    reloading the drawing if it ever falls behind;
 *  - shares this tab's cursor and selection, and passes on everyone else's.
 *
 * Cursors only go out while someone else has the drawing open: alone, a tab
 * says hello when it connects and checks in every 30 s, and that's all. When
 * someone arrives (their hello, or any message from a tab we didn't know),
 * we answer with where we are, and from then on send every move.
 */

export type ConnectionState = "connecting" | "live" | "offline" | "ended";

export type SyncStatus = {
  connection: ConnectionState;
  sending: boolean;
  /** Why the last attempt to send failed; null once it works again. */
  error: string | null;
  signedOut: boolean;
  membershipEnded: boolean;
  lastSyncedAt: number | null;
};

export type PresenceMessage = {
  c: string;
  u: string;
  n: string;
  /** Their profile picture URL, or null. */
  a?: string | null;
  cur: { x: number; y: number } | null;
  sel: string[];
  hello?: boolean;
  bye?: boolean;
};

export type SyncEvents = {
  status: (s: SyncStatus) => void;
  presence: (p: PresenceMessage) => void;
  title: (title: string) => void;
  role: (role: Role) => void;
  /** Lost access (removed, or the drawing is gone). */
  revoked: () => void;
  deleted: () => void;
  /** The server refused changes for good; they were undone locally. */
  rejected: (message: string) => void;
};

type Options = {
  drawingId: string;
  clientId: string;
  /** Your own other tabs don't show each other's cursors, so they don't count as company. */
  userId: string;
  doc: CollabDoc;
  images: () => AssetCache | null;
  canEdit: () => boolean;
  events: SyncEvents;
};

const MAX_REQUEST_CHARS = 4_000_000;
/** At most one cursor update per this many ms while moving. */
const PRESENCE_INTERVAL_MS = 80;
/** With company: "still here" at least this often (they forget us after 30 s). */
const PRESENCE_HEARTBEAT_MS = 10_000;
/** Alone: a check-in this often, in case someone's arrival was missed. */
const PRESENCE_BEACON_MS = 30_000;
/** Forget a tab we haven't heard from for this long. */
const PEER_TIMEOUT_MS = 35_000;

class RestartStream extends Error {}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(t);
      resolve();
    });
  });

export class DrawingSync {
  private stopped = false;
  private ended = false;
  private sending = false;
  private sendTimer: ReturnType<typeof setTimeout> | null = null;
  private failures = 0;
  private error: string | null = null;
  private signedOut = false;
  private membershipEnded = false;
  private lastSyncedAt: number | null = null;
  private connection: ConnectionState = "connecting";
  private streamAbort: AbortController | null = null;
  private wake: AbortController | null = null;

  private presenceState: { cursor: { x: number; y: number } | null; selection: string[] } = { cursor: null, selection: [] };
  private presenceTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeat: ReturnType<typeof setInterval> | null = null;
  private replyTimer: ReturnType<typeof setTimeout> | null = null;
  private lastPresenceAt = 0;
  private lastPresenceKey = "";
  /** Other people's tabs on this drawing → when we last heard from each. */
  private peers = new Map<string, number>();

  constructor(private readonly opts: Options) {}

  start() {
    void this.listen();
    this.heartbeat = setInterval(() => this.checkIn(), 5000);
    this.scheduleSend(0);
  }

  stop() {
    this.stopped = true;
    this.streamAbort?.abort();
    this.wake?.abort();
    if (this.sendTimer) clearTimeout(this.sendTimer);
    if (this.presenceTimer) clearTimeout(this.presenceTimer);
    if (this.heartbeat) clearInterval(this.heartbeat);
    if (this.replyTimer) clearTimeout(this.replyTimer);
  }

  /** A new local batch: send it shortly (bursts go together). */
  kick() {
    this.scheduleSend(30);
  }

  /** Back online, focused again, or signed in again: try now instead of waiting out back-off. */
  retryNow() {
    if (this.stopped || this.ended) return;
    if (this.sendTimer) clearTimeout(this.sendTimer);
    this.sendTimer = null;
    this.failures = 0;
    void this.send();
    this.wake?.abort();
  }

  status(): SyncStatus {
    return {
      connection: this.connection,
      sending: this.sending,
      error: this.error,
      signedOut: this.signedOut,
      membershipEnded: this.membershipEnded,
      lastSyncedAt: this.lastSyncedAt,
    };
  }

  private emitStatus() {
    if (!this.stopped) this.opts.events.status(this.status());
  }

  // ---------------------------------------------------------------- sending

  private scheduleSend(delay: number) {
    if (this.sendTimer || this.stopped) return;
    this.sendTimer = setTimeout(() => {
      this.sendTimer = null;
      void this.send();
    }, delay);
  }

  private backoff() {
    this.failures++;
    return Math.min(30_000, 1000 * 2 ** (this.failures - 1));
  }

  private async send() {
    const { doc, drawingId, clientId, events } = this.opts;
    if (this.sending || this.stopped || this.ended || !this.opts.canEdit()) return;
    const unsent = doc.unsent();
    if (unsent.length === 0) return;

    const take: { id: string; ops: DocOp[] }[] = [];
    let size = 0;
    for (const b of unsent) {
      const n = JSON.stringify(b.ops).length;
      if (take.length && (size + n > MAX_REQUEST_CHARS || take.length >= 200)) break;
      take.push({ id: b.id, ops: b.ops });
      size += n;
    }

    this.sending = true;
    this.emitStatus();
    let retryIn: number | null = null;
    try {
      const assetIds = new Set<string>();
      for (const b of take) for (const id of assetIdsIn(b.ops)) assetIds.add(id);
      const images = this.opts.images();
      if (assetIds.size && images) {
        const uploaded = await images.uploadPending(assetIds);
        if (typeof uploaded === "object") {
          // The server won't take a file: undo the changes that add it, keep the rest.
          const refused = new Set(uploaded.rejected);
          const ids = take.filter((b) => [...assetIdsIn(b.ops)].some((id) => refused.has(id))).map((b) => b.id);
          doc.reject(ids);
          events.rejected(uploaded.message);
          retryIn = 0;
          return;
        }
        if (uploaded === "signed-out" || uploaded === "membership") {
          if (uploaded === "signed-out") this.signedOut = true;
          else this.membershipEnded = true;
          this.error = uploaded === "signed-out" ? "Signed out" : "Membership ended";
          retryIn = 30_000;
          return;
        }
        if (uploaded === "failed") {
          this.error = navigator.onLine ? "Couldn't upload a file" : "You're offline";
          retryIn = this.backoff();
          return;
        }
      }

      const res = await fetch(`/api/drawings/${drawingId}/changes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId, batches: take }),
      });
      if (res.ok) {
        const json = (await res.json()) as { versions: { id: string; version: number }[] };
        doc.acknowledge(json.versions);
        this.error = null;
        this.failures = 0;
        this.signedOut = false;
        this.membershipEnded = false;
        this.lastSyncedAt = Date.now();
        if (doc.unsent().length) retryIn = 0;
        return;
      }
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      switch (res.status) {
        case 401:
          this.signedOut = true;
          this.error = "Signed out";
          retryIn = 30_000;
          break;
        case 402:
          this.membershipEnded = true;
          this.error = "Membership ended";
          retryIn = 30_000;
          break;
        case 403: {
          // Made view-only meanwhile: these changes can't be saved.
          const ids = doc.unsent().map((b) => b.id);
          doc.reject(ids);
          events.role("viewer");
          events.rejected(body.error ?? "You can view this drawing but not change it.");
          break;
        }
        case 404:
          this.end();
          events.revoked();
          break;
        case 413:
        case 422:
          doc.reject(take.map((b) => b.id));
          events.rejected(body.error ?? "A change couldn't be saved and was undone.");
          retryIn = 0;
          break;
        case 429:
          retryIn = (Number(res.headers.get("Retry-After")) || 2) * 1000;
          break;
        default:
          this.error = body.error ?? `Sync failed (${res.status})`;
          retryIn = this.backoff();
      }
    } catch {
      this.error = navigator.onLine ? "Couldn't reach the server" : "You're offline";
      retryIn = this.backoff();
    } finally {
      this.sending = false;
      this.emitStatus();
      if (retryIn !== null) this.scheduleSend(retryIn);
    }
  }

  // -------------------------------------------------------------- listening

  private setConnection(c: ConnectionState) {
    if (this.connection === c) return;
    this.connection = c;
    this.emitStatus();
  }

  private end() {
    this.ended = true;
    this.setConnection("ended");
    this.streamAbort?.abort();
  }

  private async listen() {
    const { drawingId, clientId } = this.opts;
    let attempt = 0;
    while (!this.stopped && !this.ended) {
      const ctrl = new AbortController();
      this.streamAbort = ctrl;
      let opened = false;
      try {
        const res = await fetch(
          `/api/drawings/${drawingId}/events?since=${this.opts.doc.serverVersion}&client=${encodeURIComponent(clientId)}`,
          { signal: ctrl.signal, cache: "no-store", headers: { Accept: "text/event-stream" } },
        );
        if (res.status === 401 || res.status === 402) {
          if (res.status === 401) this.signedOut = true;
          else this.membershipEnded = true;
          this.setConnection("offline");
          this.emitStatus();
          await this.waitForWake(30_000);
          continue;
        }
        if (res.status === 404) {
          this.end();
          this.opts.events.revoked();
          return;
        }
        if (!res.ok || !res.body) throw new Error(`events ${res.status}`);
        opened = true;
        this.signedOut = false;
        this.membershipEnded = false;
        this.setConnection("live");
        attempt = 0;
        await this.read(res.body, ctrl.signal);
      } catch (err) {
        if (err instanceof RestartStream) {
          ctrl.abort();
          continue;
        }
      }
      if (this.stopped || this.ended) return;
      this.setConnection(navigator.onLine ? "connecting" : "offline");
      // Quick retry after a stream that worked; growing waits after failures.
      const delay = opened ? 500 : Math.min(30_000, 1000 * 2 ** attempt++);
      await this.waitForWake(delay);
    }
  }

  private async waitForWake(ms: number) {
    this.wake = new AbortController();
    await sleep(ms, this.wake.signal);
    this.wake = null;
  }

  /** Read Server-Sent Events until the stream ends. */
  private async read(body: ReadableStream<Uint8Array>, signal: AbortSignal) {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    signal.addEventListener("abort", () => void reader.cancel().catch(() => {}));
    let buffer = "";
    let event = "message";
    let data = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return;
      buffer += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buffer.indexOf("\n")) >= 0) {
        let line = buffer.slice(0, nl);
        buffer = buffer.slice(nl + 1);
        if (line.endsWith("\r")) line = line.slice(0, -1);
        if (line === "") {
          if (data) await this.handle(event, data.slice(0, -1));
          event = "message";
          data = "";
          continue;
        }
        if (line.startsWith(":")) continue;
        const colon = line.indexOf(":");
        const field = colon < 0 ? line : line.slice(0, colon);
        let val = colon < 0 ? "" : line.slice(colon + 1);
        if (val.startsWith(" ")) val = val.slice(1);
        if (field === "event") event = val;
        else if (field === "data") data += `${val}\n`;
      }
    }
  }

  private async handle(event: string, raw: string) {
    let data: Record<string, unknown>;
    try {
      data = JSON.parse(raw);
    } catch {
      return;
    }
    const { doc, events } = this.opts;
    switch (event) {
      case "hello":
        events.role(data.role as Role);
        void this.sendPresence("hello");
        break;
      case "change": {
        const result = doc.applyRemote({ v: data.v as number, b: data.b as string, ops: data.ops as DocOp[] });
        if (result === "gap") {
          await this.resync();
          throw new RestartStream();
        }
        break;
      }
      case "reset":
        await this.resync();
        throw new RestartStream();
      case "presence": {
        const p = data as unknown as PresenceMessage;
        events.presence(p);
        this.notePeer(p);
        break;
      }
      case "meta":
        events.title(String(data.title));
        break;
      case "role":
        events.role(data.role as Role);
        break;
      case "revoked":
        this.end();
        events.revoked();
        break;
      case "deleted":
        this.end();
        events.deleted();
        break;
    }
  }

  /** Too far behind to catch up change by change: load the drawing again. */
  private async resync() {
    const { doc, drawingId, events } = this.opts;
    try {
      const res = await fetch(`/api/drawings/${drawingId}/doc`, { cache: "no-store" });
      if (res.status === 404) {
        this.end();
        events.revoked();
        return;
      }
      if (!res.ok) return;
      const json = (await res.json()) as {
        version: number;
        title: string;
        role: Role;
        data: { elements: Parameters<CollabDoc["reset"]>[0]["elements"] };
      };
      doc.reset({ elements: json.data.elements, version: json.version });
      events.title(json.title);
      events.role(json.role);
    } catch {
      /* the stream retries */
    }
  }

  // --------------------------------------------------------------- presence

  /** Is anyone else looking? Only then do cursor moves go out. */
  get hasCompany() {
    return this.peers.size > 0;
  }

  /** This tab's cursor (world coordinates, null = off the canvas) and selection. */
  setPresence(cursor: { x: number; y: number } | null, selection: string[]) {
    this.presenceState = {
      cursor: cursor ? { x: Math.round(cursor.x * 10) / 10, y: Math.round(cursor.y * 10) / 10 } : null,
      selection: selection.slice(0, 50),
    };
    // Alone: remember it for when someone arrives, send nothing.
    if (this.presenceTimer || !this.hasCompany) return;
    const wait = Math.max(0, this.lastPresenceAt + PRESENCE_INTERVAL_MS - Date.now());
    this.presenceTimer = setTimeout(() => {
      this.presenceTimer = null;
      void this.sendPresence("move");
    }, wait);
  }

  private notePeer(p: PresenceMessage) {
    if (p.u === this.opts.userId || p.c === this.opts.clientId) return;
    if (p.bye) {
      this.peers.delete(p.c);
      return;
    }
    const known = this.peers.has(p.c);
    this.peers.set(p.c, Date.now());
    // Someone new, or back after reconnecting: show ourselves to them now.
    if (p.hello || !known) this.reply();
  }

  /** Answer an arrival, once even if several arrive together. */
  private reply() {
    if (this.replyTimer) return;
    this.replyTimer = setTimeout(
      () => {
        this.replyTimer = null;
        void this.sendPresence("always");
      },
      150 + Math.random() * 200,
    );
  }

  /** Every 5 s: forget tabs that went quiet, and say we're still here when it's due. */
  private checkIn() {
    const now = Date.now();
    for (const [c, at] of this.peers) if (now - at > PEER_TIMEOUT_MS) this.peers.delete(c);
    const every = this.hasCompany ? PRESENCE_HEARTBEAT_MS : PRESENCE_BEACON_MS;
    if (now - this.lastPresenceAt >= every - 500) void this.sendPresence("always");
  }

  /**
   * "move": a cursor or selection change, sent only with company and only if
   * something changed. "hello": just connected. "always": an answer or a
   * check-in, sent as is.
   */
  private async sendPresence(kind: "move" | "hello" | "always") {
    if (this.stopped || this.ended || this.connection !== "live") return;
    const body = { clientId: this.opts.clientId, cursor: this.presenceState.cursor, selection: this.presenceState.selection };
    const key = JSON.stringify(body);
    if (kind === "move" && (!this.hasCompany || key === this.lastPresenceKey)) return;
    this.lastPresenceKey = key;
    this.lastPresenceAt = Date.now();
    try {
      await fetch(`/api/drawings/${this.opts.drawingId}/presence`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(kind === "hello" ? { ...body, hello: true } : body),
        keepalive: true,
      });
    } catch {
      /* cursors are best effort */
    }
  }
}
