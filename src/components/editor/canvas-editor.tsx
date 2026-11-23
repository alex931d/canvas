"use client";

import {
  ArrowLeft,
  ChevronDown,
  Ellipsis,
  Eye,
  FileDown,
  FileImage,
  FileUp,
  FlaskConical,
  ImagePlus,
  Redo2,
  Share2,
  Sparkles,
  Trash2,
  Undo2,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useEffectEvent, useReducer, useRef, useState, useSyncExternalStore } from "react";
import { renameDrawing } from "@/app/actions";
import { AppSidebar, SidebarButton, SidebarSeparator } from "@/components/app-sidebar";
import { Badge, Button, Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger, Tip, toast } from "@/components/kit";
import { SidebarUserMenu, type MenuUser } from "@/components/user-menu";
import { mathCheckSchema, type MathCheck } from "@/lib/ai/math-check-schema";
import { AssetCache, inspectGif } from "@/lib/canvas/images";
import { exportRegion, makeThumbnail, renderRegion, type RenderEnv } from "@/lib/canvas/render";
import { assetIdsOf, drawingDataSchema, isAssetElement, type DrawingData } from "@/lib/canvas/schema";
import type { Role } from "@/lib/collab/access-types";
import { CollabDoc, type HistoryAction } from "@/lib/collab/doc";
import { peerColor, type Peer } from "@/lib/collab/peers";
import { DrawingSync, type PresenceMessage, type SyncStatus } from "@/lib/collab/sync-client";
import { LocalDrawingStore, type LocalStatus } from "@/lib/local-store/store";
import { DEFAULT_PREFERENCES, type Preferences } from "@/lib/preferences";
import { cn } from "@/lib/utils";
import { Board, type BoardHandle, type FlashcardCapture } from "./board";
import { ChemPanel } from "./chem-panel";
import { FlashcardDialog } from "./flashcard-dialog";
import { PeerAvatars } from "./peer-avatars";
import { ShareDialog } from "./share-dialog";
import { StoragePopover, type ServerState } from "./storage-panel";
import { StyleBar } from "./style-bar";
import { DEFAULT_STYLE, IMAGE_ACTION, MEDIA_ACCEPT, TOOLS, VIEW_TOOLS, type Style, type Tool } from "./tools";

function fileSafe(name: string) {
  return (
    name
      .replace(/[^\w\- ]+/g, "")
      .trim()
      .replace(/\s+/g, "-") || "drawing"
  );
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const blobToDataUrl = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });


/** This tab's id in the collaboration protocol. */
function newClientId() {
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(36).padStart(2, "0")).join("");
}

/** The white buttons along the top: 40 px, icon-only on phones. */
const BAR_BUTTON = "h-10 px-4 max-sm:w-10 max-sm:px-0";

const PEER_TIMEOUT_MS = 30_000;
const THUMBNAIL_IDLE_MS = 2_000;

const INITIAL_STATUS: SyncStatus = {
  connection: "connecting",
  sending: false,
  error: null,
  signedOut: false,
  membershipEnded: false,
  lastSyncedAt: null,
};

export function CanvasEditor({
  id,
  user,
  role: initialRole,
  ownerName,
  initialTitle,
  initialData,
  initialVersion,
  serverUpdatedAt,
  preferences = DEFAULT_PREFERENCES,
}: {
  id: string;
  user: MenuUser;
  role: Role;
  ownerName: string | null;
  initialTitle: string;
  initialData: DrawingData;
  initialVersion: number;
  serverUpdatedAt: string;
  /** Drawing and to-do board effects, from the settings page. */
  preferences?: Preferences;
}) {
  const background = initialData.background;
  const router = useRouter();

  // ---------------------------------------------------------------- state
  const [clientId] = useState(newClientId);
  const [doc] = useState(() => new CollabDoc({ elements: initialData.elements, version: initialVersion }));

  /** Every edit from the board. */
  const dispatch = useCallback((action: HistoryAction) => doc.dispatch(action), [doc]);
  const snap = useSyncExternalStore(doc.subscribe, doc.getSnapshot, doc.getSnapshot);
  const elements = snap.elements;

  const [role, setRole] = useState<Role>(initialRole);
  const [ended, setEnded] = useState<"revoked" | "deleted" | null>(null);
  const readOnly = role === "viewer" || ended !== null;

  const [toolChoice, setTool] = useState<Tool>(initialRole === "viewer" ? "select" : "pen");
  const tool: Tool = readOnly && !VIEW_TOOLS.includes(toolChoice) ? "select" : toolChoice;
  const [style, setStyle] = useState<Style>(DEFAULT_STYLE);

  const [title, setTitle] = useState(initialTitle);
  const [savedTitle, setSavedTitle] = useState(initialTitle);
  const titleFocused = useRef(false);

  // Browser storage (see src/lib/local-store/store.ts)
  const storeRef = useRef<LocalDrawingStore | null>(null);
  const [localStatus, setLocalStatus] = useState<LocalStatus | null>(null);
  const [ready, setReady] = useState(false);
  const [images, setImages] = useState<AssetCache | null>(null);
  const [imageVersion, bumpImages] = useReducer((n: number) => n + 1, 0);

  // Server sync and collaborators (see src/lib/collab)
  const syncRef = useRef<DrawingSync | null>(null);
  const readOnlyRef = useRef(readOnly);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>(INITIAL_STATUS);
  const [peers, setPeers] = useState<Peer[]>([]);
  const pointerRef = useRef<{ x: number; y: number } | null>(null);
  const selectionRef = useRef<string[]>([]);
  const [panelMessage, setPanelMessage] = useState<string | null>(null);
  const [chemOpen, setChemOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [flashcard, setFlashcard] = useState<FlashcardCapture | null>(null);

  const boardRef = useRef<BoardHandle>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const backupInputRef = useRef<HTMLInputElement>(null);

  const localMode = localStatus?.mode ?? "indexeddb";
  const serverState: ServerState = syncStatus.sending
    ? "syncing"
    : syncStatus.signedOut
      ? "signed-out"
      : syncStatus.membershipEnded
        ? "membership"
        : syncStatus.error
          ? "error"
          : snap.unsynced > 0
            ? "waiting"
            : "synced";

  const env: RenderEnv = {
    getImage: (assetId) => images?.get(assetId) ?? null,
    getMedia: (el) => images?.media(el) ?? null,
  };

  useEffect(() => {
    readOnlyRef.current = readOnly;
    doc.setReadOnly(readOnly);
  }, [doc, readOnly]);

  // ------------------------------------------------ storage + live sync

  const onSyncTitle = useEffectEvent((next: string) => {
    setSavedTitle(next);
    if (!titleFocused.current) setTitle(next);
  });

  const onPresence = useEffectEvent((p: PresenceMessage) => {
    if (p.u === user.id) return; // your own other tabs
    setPeers((prev) => {
      if (p.bye) return prev.filter((x) => x.clientId !== p.c);
      const next: Peer = {
        clientId: p.c,
        userId: p.u,
        name: p.n,
        avatarUrl: typeof p.a === "string" && p.a.startsWith("/api/avatars/") ? p.a : null,
        color: peerColor(p.u),
        cursor: p.cur,
        selection: p.sel,
        seenAt: Date.now(),
      };
      const i = prev.findIndex((x) => x.clientId === p.c);
      return i < 0 ? [...prev, next] : prev.map((x, k) => (k === i ? next : x));
    });
  });

  const onRole = useEffectEvent((next: Role) => {
    if (next === role) return;
    setRole(next);
    if (next === "viewer") toast.info("You can view this drawing now, but not change it.", { id: "role" });
    else toast.success("You can edit this drawing now.", { id: "role" });
  });

  useEffect(() => {
    const store = new LocalDrawingStore(id, user.id, clientId);
    storeRef.current = store;
    const unsubscribe = store.subscribe(setLocalStatus);
    let cancelled = false;
    let cache: AssetCache | null = null;
    let sync: DrawingSync | null = null;

    const disconnect = doc.connect({
      onLocalBatch: (batch) => {
        storeRef.current?.saveBatch(batch);
        syncRef.current?.kick();
      },
      onSettled: (ids) => storeRef.current?.removeBatches(ids),
    });

    store
      .open({ elements: doc.serverElements })
      .then(({ batches, restoredChanges }) => {
        if (cancelled) return;
        if (restoredChanges > 0) {
          doc.restore(batches);
          toast.success(
            `Restored ${restoredChanges} ${restoredChanges === 1 ? "change" : "changes"} from this browser that hadn't reached the server yet.`,
            { id: "restored", duration: 8000 },
          );
        }
      })
      .catch((err) => console.error("[editor] couldn't open local storage", err))
      .finally(() => {
        if (cancelled) return;
        cache = new AssetCache(id, () => storeRef.current, bumpImages);
        setImages(cache);
        sync = new DrawingSync({
          drawingId: id,
          clientId,
          doc,
          images: () => cache,
          canEdit: () => !readOnlyRef.current,
          events: {
            status: setSyncStatus,
            presence: onPresence,
            title: onSyncTitle,
            role: onRole,
            revoked: () => setEnded("revoked"),
            deleted: () => setEnded("deleted"),
            rejected: (message) => toast.error(message, { id: "rejected" }),
          },
        });
        syncRef.current = sync;
        sync.start();
        setReady(true);
      });

    return () => {
      cancelled = true;
      unsubscribe();
      sync?.stop();
      syncRef.current = null;
      disconnect();
      store.dispose();
      cache?.dispose();
      storeRef.current = null;
    };
  }, [id, user.id, clientId, doc]);

  // Forget people we haven't heard from (closed laptop, lost connection).
  useEffect(() => {
    const t = setInterval(() => {
      const cutoff = Date.now() - PEER_TIMEOUT_MS;
      setPeers((prev) => (prev.some((p) => p.seenAt < cutoff) ? prev.filter((p) => p.seenAt >= cutoff) : prev));
    }, 5000);
    return () => clearInterval(t);
  }, []);

  // Retry straight away when this page is shown again (Next keeps it alive
  // while you're on /login, so this runs after logging back in), when the tab
  // regains focus, or when the network comes back.
  useEffect(() => {
    const retry = () => {
      if (document.visibilityState === "visible") syncRef.current?.retryNow();
    };
    const shown = setTimeout(retry, 0);
    window.addEventListener("focus", retry);
    window.addEventListener("online", retry);
    document.addEventListener("visibilitychange", retry);
    return () => {
      clearTimeout(shown);
      window.removeEventListener("focus", retry);
      window.removeEventListener("online", retry);
      document.removeEventListener("visibilitychange", retry);
    };
  }, []);

  // A fresh gallery preview once things settle after edits (anyone who can edit may send it).
  const thumbVersion = useRef(initialVersion);
  const sendThumbnail = useEffectEvent(async () => {
    const version = doc.serverVersion;
    if (readOnly || version === thumbVersion.current || doc.getSnapshot().unsynced > 0) return;
    thumbVersion.current = version;
    const thumbnail = makeThumbnail({ version: 2, background, elements: doc.elements }, env);
    if (!thumbnail) return;
    try {
      const res = await fetch(`/api/drawings/${id}/thumbnail`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ thumbnail }),
      });
      if (!res.ok) thumbVersion.current = -1;
    } catch {
      thumbVersion.current = -1; // try again after the next change
    }
  });
  useEffect(() => {
    if (!ready || snap.unsynced > 0 || snap.version === thumbVersion.current) return;
    const t = setTimeout(() => void sendThumbnail(), THUMBNAIL_IDLE_MS);
    return () => clearTimeout(t);
  }, [ready, snap.unsynced, snap.version]);

  // Warn before leaving only if something could actually be lost.
  const hasUnsavedRisk = useEffectEvent(
    () =>
      (localStatus?.pendingWrites ?? 0) > 0 ||
      (localMode !== "indexeddb" && (snap.unsynced > 0 || syncStatus.sending)) ||
      (images?.hasUnuploaded(assetIdsOf(elements)) ?? false),
  );
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (hasUnsavedRisk()) e.preventDefault();
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, []);

  // Undo / redo / save shortcuts (tool and selection keys live in the board).
  const onKeyDown = useEffectEvent((e: KeyboardEvent) => {
    const mod = e.metaKey || e.ctrlKey;
    const key = e.key.toLowerCase();
    if (mod && key === "s") {
      e.preventDefault();
      syncRef.current?.retryNow();
      return;
    }
    const target = e.target as HTMLElement | null;
    if (target?.closest("input, textarea, select, [contenteditable='true']")) return;
    if (!ready || !mod || readOnly) return;
    if (key === "z") {
      e.preventDefault();
      doc.dispatch({ type: e.shiftKey ? "redo" : "undo" });
    } else if (key === "y") {
      e.preventDefault();
      doc.dispatch({ type: "redo" });
    }
  });
  useEffect(() => {
    const handler = (e: KeyboardEvent) => onKeyDown(e);
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  // Presence: where this tab's pointer is and what it has selected.
  const onPointerWorld = useCallback((p: { x: number; y: number } | null) => {
    pointerRef.current = p;
    syncRef.current?.setPresence(p, selectionRef.current);
  }, []);
  const onSelectionChange = useCallback((ids: string[]) => {
    selectionRef.current = ids;
    syncRef.current?.setPresence(pointerRef.current, ids);
  }, []);

  // ------------------------------------------------------------- actions

  async function commitTitle() {
    titleFocused.current = false;
    const next = title.trim();
    if (!next || next === savedTitle) {
      setTitle(savedTitle);
      return;
    }
    try {
      const res = await renameDrawing(id, next);
      if (res.ok) {
        setSavedTitle(next);
        setTitle(next);
      } else {
        setTitle(savedTitle);
        toast.error(res.error);
      }
    } catch {
      toast.error("Couldn't rename: the server is unreachable. Try again when you're back online.");
    }
  }

  function exportPng() {
    const region = exportRegion(elements, 48);
    const scale = Math.min(2, 8000 / Math.max(region.w, region.h));
    renderRegion({ elements, background, region, scale, env }).toBlob((blob) => {
      if (blob) downloadBlob(blob, `${fileSafe(title)}.png`);
    }, "image/png");
  }

  async function downloadBackup() {
    const imagesOut: Record<string, string> = {};
    for (const assetId of assetIdsOf(elements)) {
      const blob = await images?.getBlob(assetId);
      if (blob) imagesOut[assetId] = await blobToDataUrl(blob);
    }
    const payload = {
      app: "canvas",
      version: 2,
      exportedAt: new Date().toISOString(),
      id,
      title,
      data: { version: 2, background, elements },
      images: imagesOut,
    };
    downloadBlob(new Blob([JSON.stringify(payload)], { type: "application/json" }), `${fileSafe(title)}.canvas.json`);
    setPanelMessage("Backup downloaded. Load it from the Export menu any time to restore this drawing.");
  }

  async function loadBackup(file: File) {
    try {
      const json = JSON.parse(await file.text());
      const raw = json?.data ?? json;
      // Accept v1 backups too.
      const parsed = drawingDataSchema.safeParse(raw?.version === 1 ? { ...raw, version: 2 } : raw);
      if (!parsed.success) {
        toast.error("That file isn't a canvas backup.");
        return;
      }
      // Re-add embedded images, GIFs and videos under fresh ids.
      const remap = new Map<string, string>();
      const kinds = new Map(parsed.data.elements.flatMap((el) => (isAssetElement(el) ? [[el.assetId, el.type]] : [])));
      for (const [oldId, dataUrl] of Object.entries((json?.images ?? {}) as Record<string, string>)) {
        if (!images || typeof dataUrl !== "string" || !/^data:(image|video)\//.test(dataUrl)) continue;
        try {
          const blob = await (await fetch(dataUrl)).blob();
          const gif = kinds.get(oldId) === "gif" ? await inspectGif(blob) : null;
          const added =
            kinds.get(oldId) === "video"
              ? await images.addVideo(blob, blob.type)
              : gif
                ? await images.addGif(blob, gif)
                : await images.add(blob);
          remap.set(oldId, added.id);
        } catch (err) {
          console.warn("[editor] skipped a file in the backup", err);
        }
      }
      const els = parsed.data.elements.map((el) =>
        isAssetElement(el) && remap.has(el.assetId) ? { ...el, assetId: remap.get(el.assetId)! } : el,
      );
      doc.dispatch({ type: "replace", elements: els });
      toast.success(`Loaded ${els.length} items from the backup. Undo reverts it.`);
    } catch {
      toast.error("That file couldn't be read.");
    }
  }

  async function freeUpSpace() {
    setPanelMessage(null);
    await storeRef.current?.freeUpSpace();
  }

  async function checkMath(imageDataUrl: string): Promise<MathCheck> {
    let res: Response;
    try {
      res = await fetch("/api/check-math", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image: imageDataUrl }),
      });
    } catch {
      throw new Error("Couldn't reach the server. Checking math needs a connection.");
    }
    const json = await res.json().catch(() => null);
    if (!res.ok) throw new Error(json?.error ?? `Checking failed (${res.status}).`);
    return mathCheckSchema.parse(json);
  }

  const updateStyle = (patch: Partial<Style>) => setStyle((s) => ({ ...s, ...patch }));

  // ------------------------------------------------------------------ UI

  const banner =
    ended === "deleted"
      ? {
          text: "The owner deleted this drawing. What you see is no longer saved anywhere; download a backup to keep it.",
          action: "Download backup",
          onAction: downloadBackup,
        }
      : ended === "revoked"
        ? {
            text: "You no longer have access to this drawing. Changes you make here aren't saved.",
            action: "All drawings",
            onAction: () => router.push("/"),
          }
        : syncStatus.signedOut
          ? {
              text: "You've been signed out. Your changes are safe in this browser and sync as soon as you log in again.",
              action: "Log in",
              onAction: () => router.push(`/login?next=${encodeURIComponent(`/drawings/${id}`)}`),
            }
          : syncStatus.membershipEnded
            ? {
                text: "Your membership has ended. Your changes are safe in this browser and sync as soon as you renew.",
                action: "Renew",
                onAction: () => router.push("/pricing"),
              }
            : localMode !== "indexeddb" && localStatus?.notice
              ? { text: localStatus.notice, action: "Download backup", onAction: downloadBackup }
              : null;

  const tools = readOnly ? TOOLS.filter((t) => VIEW_TOOLS.includes(t.id)) : TOOLS;

  return (
    <div className="flex min-h-dvh flex-col md:flex-row">
      <AppSidebar footer={<SidebarUserMenu user={user} />} seasonalMotion={false}>
        {tools.map((t) => (
          <SidebarButton
            key={t.id}
            compact
            icon={<t.Icon />}
            label={t.label}
            shortcut={t.key}
            active={tool === t.id}
            pressed={tool === t.id}
            onClick={() => setTool(t.id)}
          />
        ))}
        {readOnly ? null : (
          <>
            <SidebarButton
              compact
              icon={<ImagePlus />}
              label={IMAGE_ACTION.label}
              shortcut={IMAGE_ACTION.key}
              onClick={() => imageInputRef.current?.click()}
            />
            <SidebarSeparator />
            <SidebarButton
              compact
              icon={<Undo2 />}
              label="Undo"
              disabled={!ready || !snap.canUndo}
              onClick={() => doc.dispatch({ type: "undo" })}
            />
            <SidebarButton
              compact
              icon={<Redo2 />}
              label="Redo"
              disabled={!ready || !snap.canRedo}
              onClick={() => doc.dispatch({ type: "redo" })}
            />
            <SidebarButton
              compact
              icon={<Trash2 />}
              label="Clear board"
              disabled={!ready || elements.length === 0}
              onClick={() => doc.dispatch({ type: "clear" })}
            />
          </>
        )}
      </AppSidebar>

      <main className="flex h-dvh min-w-0 flex-1 flex-col gap-4 px-3 pt-3 pb-[76px] md:px-8 md:pt-6 md:pb-6">
        <header className="flex items-center gap-2 md:gap-3">
          <Button asChild variant="ghost" size="icon-md" className="md:hidden" aria-label="All drawings">
            <Link href="/">
              <ArrowLeft />
            </Link>
          </Button>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onFocus={() => (titleFocused.current = true)}
            onBlur={commitTitle}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
              if (e.key === "Escape") {
                setTitle(savedTitle);
                requestAnimationFrame(() => (e.target as HTMLInputElement).blur());
              }
            }}
            readOnly={readOnly}
            maxLength={120}
            aria-label="Drawing title"
            className="min-w-0 flex-1 truncate rounded-lg bg-transparent px-2 py-1 text-xl font-bold tracking-tight outline-none sm:text-2xl md:-ml-2 md:text-[32px] [&:not([readonly])]:hover:bg-card/60 [&:not([readonly])]:focus-visible:bg-card [&:not([readonly])]:focus-visible:ring-2 [&:not([readonly])]:focus-visible:ring-ring"
          />

          <PeerAvatars peers={peers} />

          {role === "viewer" ? (
            <Badge tone="neutral" className="h-8 gap-1.5 px-3 text-sm shadow-none max-sm:hidden">
              <Eye /> View only
            </Badge>
          ) : null}

          <StoragePopover
            local={localStatus}
            server={serverState}
            serverError={syncStatus.error}
            lastSyncedAt={syncStatus.lastSyncedAt ? new Date(syncStatus.lastSyncedAt).toISOString() : serverUpdatedAt}
            live={syncStatus.connection}
            message={panelMessage}
            onFreeUpSpace={freeUpSpace}
            onDownloadBackup={downloadBackup}
          />

          <Tip
            content={
              role === "owner" ? "Invite people to draw with you, live" : `Shared by ${ownerName ?? "the owner"}`
            }
          >
            <Button
              variant="light"
              className={cn(BAR_BUTTON, "max-sm:hidden")}
              onClick={() => setShareOpen(true)}
              aria-label="Share"
            >
              <Share2 /> <span className="max-lg:hidden">Share</span>
            </Button>
          </Tip>

          <Menu>
            <MenuTrigger asChild>
              <Button variant="light" className={cn(BAR_BUTTON, "max-sm:hidden")} aria-label="Export">
                <FileDown className="sm:hidden" />
                <span className="max-sm:hidden">Export</span>
                <ChevronDown className="max-sm:hidden" />
              </Button>
            </MenuTrigger>
            <MenuContent align="end" className="w-56">
              <MenuItem onSelect={exportPng}>
                <FileImage /> Export PNG
              </MenuItem>
              <MenuItem onSelect={() => void downloadBackup()}>
                <FileDown /> Download backup (.json)
              </MenuItem>
              {readOnly ? null : (
                <>
                  <MenuSeparator />
                  <MenuItem onSelect={() => backupInputRef.current?.click()}>
                    <FileUp /> Load backup…
                  </MenuItem>
                </>
              )}
            </MenuContent>
          </Menu>

          <Tip content="Molar mass, balancing equations and the periodic table">
            <Button
              variant="light"
              className={cn(BAR_BUTTON, "max-sm:hidden")}
              onClick={() => setChemOpen((o) => !o)}
              aria-label="Chemistry"
              aria-pressed={chemOpen}
            >
              <FlaskConical /> <span className="max-xl:hidden">Chemistry</span>
            </Button>
          </Tip>

          {/* Phones: Share, Export and Chemistry share one menu, so the title has room. */}
          <Menu>
            <MenuTrigger asChild>
              <Button variant="light" className={cn(BAR_BUTTON, "sm:hidden")} aria-label="More">
                <Ellipsis />
              </Button>
            </MenuTrigger>
            <MenuContent align="end" className="w-56">
              <MenuItem onSelect={() => setShareOpen(true)}>
                <Share2 /> Share
              </MenuItem>
              <MenuItem onSelect={() => setChemOpen((o) => !o)}>
                <FlaskConical /> {chemOpen ? "Close chemistry" : "Chemistry"}
              </MenuItem>
              <MenuSeparator />
              <MenuItem onSelect={exportPng}>
                <FileImage /> Export PNG
              </MenuItem>
              <MenuItem onSelect={() => void downloadBackup()}>
                <FileDown /> Download backup (.json)
              </MenuItem>
              {readOnly ? null : (
                <MenuItem onSelect={() => backupInputRef.current?.click()}>
                  <FileUp /> Load backup…
                </MenuItem>
              )}
            </MenuContent>
          </Menu>

          <Tip content="Draw a loop around an equation and the AI checks each step">
            <Button
              className={cn(BAR_BUTTON, "bg-green hover:bg-[#1f6965]")}
              onClick={() => boardRef.current?.startMathCheck()}
              disabled={!ready}
              aria-label="Check math"
            >
              <Sparkles /> <span className="max-sm:hidden">Check math</span>
            </Button>
          </Tip>
        </header>

        {banner ? (
          <div
            role="status"
            className="flex items-center gap-4 rounded-xl border-l-4 border-red bg-card px-5 py-3 text-sm"
          >
            <p className="flex-1">{banner.text}</p>
            <Button size="sm" onClick={() => void banner.onAction()}>
              {banner.action}
            </Button>
          </div>
        ) : null}

        <div className="relative min-h-0 flex-1 overflow-hidden rounded-xl bg-card">
          <Board
            ref={boardRef}
            drawingId={id}
            elements={elements}
            background={background}
            dispatch={dispatch}
            tool={tool}
            setTool={setTool}
            style={style}
            ready={ready}
            images={images}
            imageVersion={imageVersion}
            onCheckMath={checkMath}
            readOnly={readOnly}
            drawEffect={preferences.drawEffect}
            boardEffects={preferences.boardEffects}
            peers={peers}
            onPointerWorld={onPointerWorld}
            onSelectionChange={onSelectionChange}
            onMakeFlashcard={setFlashcard}
          />
          {readOnly ? null : <StyleBar tool={tool} style={style} onChange={updateStyle} />}
        </div>
      </main>

      <ChemPanel
        open={chemOpen}
        onOpenChange={setChemOpen}
        canInsert={ready && !readOnly}
        onInsert={async (value) => {
          try {
            await boardRef.current?.insertMath(value);
            toast.success("Added to the canvas.", { id: "chem-insert", duration: 2000 });
          } catch {
            toast.error("Couldn't load the equation tools. Check your connection and try again.");
          }
        }}
      />

      <FlashcardDialog capture={flashcard} drawingId={id} deck={savedTitle} onClose={() => setFlashcard(null)} />

      <ShareDialog
        drawingId={id}
        title={savedTitle}
        me={{ id: user.id, name: user.name, avatarUrl: user.avatarUrl }}
        open={shareOpen}
        onOpenChange={setShareOpen}
      />

      <input
        ref={imageInputRef}
        type="file"
        accept={MEDIA_ACCEPT}
        multiple
        hidden
        onChange={(e) => {
          const files = [...(e.target.files ?? [])];
          e.target.value = "";
          boardRef.current?.insertFiles(files);
        }}
      />
      <input
        ref={backupInputRef}
        type="file"
        accept="application/json,.json"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) void loadBackup(file);
        }}
      />
    </div>
  );
}
