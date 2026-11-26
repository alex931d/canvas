"use client";

import { Cloud, CloudOff, HardDrive, LoaderCircle } from "lucide-react";
import Link from "next/link";
import { Button, Popover, PopoverContent, PopoverTrigger } from "@/components/kit";
import type { ConnectionState } from "@/lib/collab/sync-client";
import type { BrowserSaveState } from "@/lib/local-store/browser-session";
import type { LocalStatus } from "@/lib/local-store/store";
import { cn } from "@/lib/utils";

export type ServerState = "synced" | "waiting" | "syncing" | "error" | "signed-out" | "membership";

function formatBytes(n: number) {
  if (n < 1024) return `${n} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v < 10 ? v.toFixed(1) : Math.round(v)} ${units[i]}`;
}

const timeFormat = new Intl.DateTimeFormat(undefined, { timeStyle: "short" });

export function localLabel(s: LocalStatus | null): { text: string; warn: boolean } {
  if (!s) return { text: "Opening…", warn: false };
  if (s.mode === "indexeddb") return { text: s.pendingWrites > 0 ? "Saving here…" : "Saved here", warn: false };
  if (s.mode === "backup-slot") return { text: "Backup slot", warn: true };
  return { text: "Not saved here", warn: true };
}

export function serverLabel(state: ServerState): { text: string; warn: boolean } {
  switch (state) {
    case "synced":
      return { text: "Synced", warn: false };
    case "waiting":
      return { text: "Waiting to sync", warn: false };
    case "syncing":
      return { text: "Syncing…", warn: false };
    case "error":
      return { text: "Sync failed", warn: true };
    case "signed-out":
      return { text: "Log in to sync", warn: true };
    case "membership":
      return { text: "Renew to sync", warn: true };
  }
}

function Row({ label, value, tone }: { label: string; value: string; tone?: "warn" | "ok" }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b py-2.5 text-sm last:border-b-0">
      <span className="text-muted-foreground">{label}</span>
      <span
        className={cn(
          "text-right font-bold",
          tone === "warn" ? "text-destructive" : tone === "ok" ? "text-green" : "text-foreground",
        )}
      >
        {value}
      </span>
    </div>
  );
}

const LIVE_LABEL: Record<ConnectionState, { text: string; tone?: "warn" | "ok" }> = {
  live: { text: "On", tone: "ok" },
  connecting: { text: "Reconnecting…" },
  offline: { text: "Offline", tone: "warn" },
  ended: { text: "Stopped", tone: "warn" },
};

export function StoragePopover({
  local,
  server,
  serverError,
  lastSyncedAt,
  live,
  message,
  onFreeUpSpace,
  onDownloadBackup,
}: {
  local: LocalStatus | null;
  server: ServerState;
  serverError: string | null;
  lastSyncedAt: string;
  live: ConnectionState;
  message: string | null;
  onFreeUpSpace: () => void;
  onDownloadBackup: () => void;
}) {
  const l = localLabel(local);
  const s = serverLabel(server);
  const ratio = local?.usage != null && local.quota ? Math.min(1, local.usage / local.quota) : null;

  const localSentence =
    local?.mode === "indexeddb"
      ? "Every change is kept in this browser until the server has it, so nothing is lost offline or if the tab closes."
      : local?.mode === "backup-slot"
        ? "Browser storage is full. This drawing is held in a separate backup slot and every change goes to the server right away."
        : "This browser has no room left. Every change goes straight to the server; download a backup if you might go offline.";
  const liveRow = LIVE_LABEL[live];

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="light"
          className="h-10 gap-3 px-3"
          title={local?.notice ?? "Where this drawing is saved"}
          data-testid="storage-status"
        >
          <span className={cn("flex items-center gap-1.5", l.warn && "text-destructive")}>
            <HardDrive className="size-4" />
            <span className="hidden lg:inline">{l.text}</span>
          </span>
          <span className={cn("flex items-center gap-1.5", s.warn && "text-destructive")}>
            {server === "syncing" ? (
              <LoaderCircle className="size-4 animate-spin" />
            ) : s.warn ? (
              <CloudOff className="size-4" />
            ) : (
              <Cloud className="size-4" />
            )}
            <span className="hidden lg:inline">{s.text}</span>
          </span>
          <span className="sr-only lg:hidden">
            {l.text}, {s.text}
          </span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(24rem,calc(100vw-1rem))] p-6" data-testid="storage-panel">
        <h2 className="text-xl font-bold">Where this drawing is saved</h2>

        <h3 className="mt-5 text-base font-bold">This browser</h3>
        <p className="mt-1 text-sm text-muted-foreground">{localSentence}</p>
        <div className="mt-2">
          <Row label="Status" value={l.text} tone={l.warn ? "warn" : "ok"} />
          {ratio !== null && local?.usage != null && local.quota ? (
            <Row label="Space used by this site" value={`${formatBytes(local.usage)} of ${formatBytes(local.quota)}`} />
          ) : null}
        </div>
        {ratio !== null ? (
          <div className="mt-1 h-2 overflow-hidden rounded-full bg-beige-100">
            <div
              className={cn("h-full rounded-full", ratio > 0.8 ? "bg-red" : "bg-green")}
              style={{ width: `${Math.max(1, ratio * 100)}%` }}
            />
          </div>
        ) : null}

        <h3 className="mt-5 text-base font-bold">Server</h3>
        <div className="mt-1">
          <Row label="Status" value={s.text} tone={s.warn ? "warn" : server === "synced" ? "ok" : undefined} />
          <Row
            label={server === "error" ? "Problem" : "Last synced"}
            value={server === "error" ? (serverError ?? "Unknown error") : timeFormat.format(new Date(lastSyncedAt))}
            tone={server === "error" ? "warn" : undefined}
          />
          <Row label="Live updates" value={liveRow.text} tone={liveRow.tone} />
        </div>

        {message || local?.notice ? (
          <p className="mt-4 rounded-lg border-l-4 border-cyan bg-beige-100 px-3 py-2 text-sm">
            {message ?? local?.notice}
          </p>
        ) : null}

        <div className="mt-5 flex flex-wrap gap-2">
          <Button onClick={onDownloadBackup}>Download backup</Button>
          <Button variant="secondary" onClick={onFreeUpSpace}>
            Free up space
          </Button>
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          Free up space removes this browser&rsquo;s copies of images and videos that are already saved on the server.
          Anything not yet synced is never removed.
        </p>
      </PopoverContent>
    </Popover>
  );
}

/**
 * On the free plan the drawing lives only in this browser: the header says
 * whether it's saved, and the panel says what that means and how to keep it.
 */
export function BrowserSavePopover({
  status,
  readOnly,
  member,
  message,
  onDownloadBackup,
  onMove,
}: {
  status: BrowserSaveState | null;
  /** Open for editing in another tab. */
  readOnly: boolean;
  /** Members can move it into their account. */
  member: boolean;
  message: string | null;
  onDownloadBackup: () => void;
  onMove: () => void;
}) {
  const label = !status
    ? { text: "Opening…", warn: false }
    : readOnly
      ? { text: "Open in another tab", warn: true }
      : status.state === "error"
        ? { text: "Not saved", warn: true }
        : status.state === "saving"
          ? { text: "Saving…", warn: false }
          : { text: "Saved in this browser", warn: false };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="light"
          className="h-10 gap-1.5 px-3"
          title="Where this drawing is saved"
          data-testid="storage-status"
          data-state={status?.state ?? "opening"}
        >
          <span className={cn("flex items-center gap-1.5", label.warn && "text-destructive")}>
            {status?.state === "saving" ? <LoaderCircle className="size-4 animate-spin" /> : <HardDrive className="size-4" />}
            <span className="hidden lg:inline">{label.text}</span>
          </span>
          <span className="sr-only lg:hidden">{label.text}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(24rem,calc(100vw-1rem))] p-6" data-testid="storage-panel">
        <h2 className="text-xl font-bold">Saved in this browser</h2>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          This drawing is kept on this device, in this browser only, and saves as you go. It isn&rsquo;t on our server,
          so it won&rsquo;t show up on your other devices, and clearing this site&rsquo;s data deletes it.
        </p>
        <div className="mt-3">
          <Row label="Status" value={label.text} tone={label.warn ? "warn" : status?.state === "saved" ? "ok" : undefined} />
          {status?.savedAt ? <Row label="Last saved" value={timeFormat.format(new Date(status.savedAt))} /> : null}
        </div>
        {message || status?.error || readOnly ? (
          <p className="mt-4 rounded-lg border-l-4 border-cyan bg-beige-100 px-3 py-2 text-sm">
            {message ??
              status?.error ??
              "You're editing this drawing in another tab. Close it there to edit it here; until then you can look, present and export."}
          </p>
        ) : null}
        <div className="mt-5 flex flex-wrap gap-2">
          {member ? (
            <Button onClick={onMove} disabled={readOnly}>
              Move to your account
            </Button>
          ) : (
            <Button asChild>
              <Link href="/pricing">Keep it in an account</Link>
            </Button>
          )}
          <Button variant="secondary" onClick={onDownloadBackup}>
            Download backup
          </Button>
        </div>
        <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
          {member
            ? "Moving it puts it in your account with its pictures, so it's on every device and you can share it."
            : "Members' drawings are kept in their account, on every device. Becoming a member moves the drawings in this browser there."}
        </p>
      </PopoverContent>
    </Popover>
  );
}
