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
  Lock,
  NotebookPen,
  Play,
  Presentation as PresentationIcon,
  Redo2,
  Share2,
  Sigma,
  Sparkles,
  Trash2,
  Undo2,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useEffectEvent,
  useMemo,
  useReducer,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { renameDrawing, savePresentation } from "@/app/actions";
import { UpgradeDialog } from "@/components/billing/upgrade-dialog";
import {
  Badge,
  Button,
  ConfirmDialog,
  Menu,
  MenuContent,
  MenuItem,
  MenuSeparator,
  MenuTrigger,
  Tip,
  toast,
} from "@/components/kit";
import { GuestMenu, HeaderUserMenu, type MenuUser } from "@/components/user-menu";
import { canUse, type MemberFeature, type Plan } from "@/lib/billing/plan";
import { mathCheckSchema, type MathCheck } from "@/lib/ai/math-check-schema";
import { slidesOf } from "@/lib/canvas/geometry";
import { AssetCache, inspectGif } from "@/lib/canvas/images";
import { reorderSlides } from "@/lib/canvas/present";
import { exportRegion, makeThumbnail, renderRegion, type RenderEnv } from "@/lib/canvas/render";
import {
  assetIdsOf,
  drawingDataSchema,
  isAssetElement,
  type CanvasElement,
  type DrawingData,
  type FrameElement,
  type Presentation,
} from "@/lib/canvas/schema";
import type { Role } from "@/lib/collab/access-types";
import { CollabDoc, type HistoryAction } from "@/lib/collab/doc";
import { peerColor, type Peer } from "@/lib/collab/peers";
import { PeerDrafts } from "@/lib/collab/peer-drafts";
import { DrawingSync, type PresenceMessage, type SyncStatus } from "@/lib/collab/sync-client";
import { BrowserDrawingSession, type BrowserSaveState } from "@/lib/local-store/browser-session";
import { BrowserDrawingMover } from "@/lib/local-store/mover";
import { LocalDrawingStore, type LocalStatus } from "@/lib/local-store/store";
import { typesetMath } from "@/lib/math/layout";
import { DEFAULT_PREFERENCES, type Preferences } from "@/lib/preferences";
import { cn } from "@/lib/utils";
import { Board, type BoardHandle, type FlashcardCapture } from "./board";
import { noteAiCallsLeft } from "./ai-allowance";
import { ChemPanel } from "./chem-panel";
import { MathPanel, type MathTab } from "./math-tools/math-panel";
import type { Place } from "./math-tools/shared";
import { FlashcardDialog } from "./flashcard-dialog";
import { PeerAvatars } from "./peer-avatars";
import { Presenter } from "./presenter";
import { ShareDialog } from "./share-dialog";
import { SlidesPanel } from "./slides-panel";
import { BrowserSavePopover, StoragePopover, type ServerState } from "./storage-panel";
import { StyleBar } from "./style-bar";
import { ToolDock } from "./tool-dock";
import { ToolSearch, type SearchItem } from "./tool-search";
import { DEFAULT_STYLE, MEDIA_ACCEPT, ToolRegistry, type ActionId, type Style, type Tool } from "./tools";
import { TracePictureDialog } from "./trace-picture-dialog";

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
  storage = "server",
  plan = "member",
  role: initialRole,
  ownerName,
  initialTitle,
  initialData,
  initialPresentation,
  initialVersion,
  serverUpdatedAt,
  preferences = DEFAULT_PREFERENCES,
}: {
  id: string;
  /** Who's drawing; null for someone without an account (the free plan). */
  user: MenuUser | null;
  /**
   * Where the drawing is kept: on the server (members), or only in this
   * browser (the free plan; see src/lib/local-store/library.ts).
   */
  storage?: "server" | "browser";
  /** Member features (math checks, chemistry, flashcards, sharing) need "member". */
  plan?: Plan;
  role: Role;
  ownerName: string | null;
  initialTitle: string;
  initialData: DrawingData;
  /** How the frames are presented (Slides panel). */
  initialPresentation: Presentation;
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
  const browser = storage === "browser";
  // On the free plan: another tab is editing this drawing, or it's on its way to the member's account.
  const [openElsewhere, setOpenElsewhere] = useState(false);
  const [moving, setMoving] = useState(false);
  const readOnly = role === "viewer" || ended !== null || openElsewhere || moving;

  const [toolChoice, setTool] = useState<Tool>(initialRole === "viewer" ? "select" : "pen");
  const tool: Tool = ToolRegistry.shared.allowed(toolChoice, readOnly) ? toolChoice : "select";
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

  // The free plan: kept in this browser only (see src/lib/local-store/browser-session.ts)
  const browserRef = useRef<BrowserDrawingSession | null>(null);
  const [browserStatus, setBrowserStatus] = useState<BrowserSaveState | null>(null);
  const [moveOpen, setMoveOpen] = useState(false);
  /** A member feature someone on the free plan reached for: offer the membership. */
  const [upgrade, setUpgrade] = useState<MemberFeature | null>(null);
  /** True if this person can use `feature`; otherwise shows what the membership offers. */
  const allow = (feature: MemberFeature) => {
    if (canUse(plan, feature)) return true;
    setUpgrade(feature);
    return false;
  };
  const locked = (feature: MemberFeature) => !canUse(plan, feature);

  // Server sync and collaborators (see src/lib/collab)
  const syncRef = useRef<DrawingSync | null>(null);
  const readOnlyRef = useRef(readOnly);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>(INITIAL_STATUS);
  const [peers, setPeers] = useState<Peer[]>([]);
  /** What other people are drawing right now, put together from their presence. */
  const [peerDrafts] = useState(() => new PeerDrafts());
  const pointerRef = useRef<{ x: number; y: number } | null>(null);
  const selectionRef = useRef<string[]>([]);
  const [panelMessage, setPanelMessage] = useState<string | null>(null);
  const [chemOpen, setChemOpenState] = useState(false);
  const [mathOpen, setMathOpenState] = useState(false);
  const [mathTab, setMathTab] = useState<MathTab>("triangle");
  const [searchOpen, setSearchOpen] = useState(false);
  const [slidesOpen, setSlidesOpenState] = useState(false);
  /** A frame to show in the slides panel (its title was double-clicked). */
  const [slideFocus, setSlideFocus] = useState<string | null>(null);
  const [presentation, setPresentation] = useState<Presentation>(initialPresentation);
  const [presenting, setPresenting] = useState<{ startId: string | null } | null>(null);
  // One side panel at a time: they open in the same place.
  const setChemOpen = (open: boolean) => {
    setChemOpenState(open);
    if (open) {
      setSlidesOpenState(false);
      setMathOpenState(false);
    }
  };
  const setMathOpen = (open: boolean) => {
    setMathOpenState(open);
    if (open) {
      setSlidesOpenState(false);
      setChemOpenState(false);
    }
  };
  const setSlidesOpen = (open: boolean) => {
    setSlidesOpenState(open);
    if (open) {
      setChemOpenState(false);
      setMathOpenState(false);
    } else setSlideFocus(null);
  };
  const [shareOpen, setShareOpen] = useState(false);
  const [flashcard, setFlashcard] = useState<FlashcardCapture | null>(null);

  const boardRef = useRef<BoardHandle>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const traceInputRef = useRef<HTMLInputElement>(null);
  const [traceFile, setTraceFile] = useState<File | null>(null);
  const closeTrace = useCallback(() => setTraceFile(null), []);
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

  const env: RenderEnv = useMemo(
    () => ({
      getImage: (assetId) => images?.get(assetId) ?? null,
      getMedia: (el) => images?.media(el) ?? null,
    }),
    [images],
  );
  const slides = useMemo(() => slidesOf(elements), [elements]);

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
    if (p.u === user?.id) return; // your own other tabs
    if (p.bye) peerDrafts.forget(p.c);
    else peerDrafts.apply(p.c, p.dr);
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

  const userId = user?.id ?? null;
  useEffect(() => {
    if (browser || !userId) return;
    const store = new LocalDrawingStore(id, userId, clientId);
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
          userId,
          doc,
          images: () => cache,
          canEdit: () => !readOnlyRef.current,
          events: {
            status: setSyncStatus,
            presence: onPresence,
            title: onSyncTitle,
            presentation: setPresentation,
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
  }, [browser, id, userId, clientId, doc]);

  // The free plan: save into this browser's library as you go.
  useEffect(() => {
    if (!browser) return;
    const session = new BrowserDrawingSession(id, doc);
    browserRef.current = session;
    const unsubscribe = session.subscribe(setBrowserStatus);
    const cache = new AssetCache(id, () => session.assets, bumpImages, false);
    let cancelled = false;
    // Another tab editing it: look for now; once that tab closes, edit here.
    const takeOver = () => {
      if (cancelled) return;
      setOpenElsewhere(false);
      toast.info("You can edit this drawing here now.", { id: "took-over" });
    };
    void session.open(takeOver).then(({ editable }) => {
      if (cancelled) return;
      if (!editable) setOpenElsewhere(true);
      setBrowserStatus(session.getStatus());
      setImages(cache);
      setReady(true);
    });
    // Leaving or hiding the page: write what's waiting now rather than in a moment.
    const save = () => void session.flush();
    const hidden = () => document.visibilityState === "hidden" && save();
    window.addEventListener("pagehide", save);
    document.addEventListener("visibilitychange", hidden);
    return () => {
      cancelled = true;
      window.removeEventListener("pagehide", save);
      document.removeEventListener("visibilitychange", hidden);
      unsubscribe();
      void session.close();
      cache.dispose();
      browserRef.current = null;
    };
  }, [browser, id, doc]);

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
    if (browser) {
      await browserRef.current?.saveThumbnail(thumbnail).catch(() => (thumbVersion.current = -1));
      return;
    }
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
      (browser && snap.unsynced > 0) ||
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

  // Toasts rise above the tool dock while the editor is open.
  useEffect(() => {
    document.documentElement.dataset.dock = "";
    return () => {
      delete document.documentElement.dataset.dock;
    };
  }, []);

  // Undo / redo / save shortcuts (tool and selection keys live in the board).
  const onKeyDown = useEffectEvent((e: KeyboardEvent) => {
    // Autofill and some extensions send key events with no key name.
    if (typeof e.key !== "string") return;
    const mod = e.metaKey || e.ctrlKey;
    const key = e.key.toLowerCase();
    if (mod && key === "s") {
      e.preventDefault();
      syncRef.current?.retryNow();
      return;
    }
    const target = e.target as HTMLElement | null;
    if (target?.closest("input, textarea, select, [contenteditable='true']")) return;
    // Find a tool by name: / or ⌘K.
    if ((e.key === "/" && !mod) || (mod && key === "k")) {
      e.preventDefault();
      setSearchOpen(true);
      return;
    }
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

  // What this tab is drawing, piece by piece, for the others to see as it grows.
  const onDraft = useCallback((draft: CanvasElement | null) => syncRef.current?.setDraft(draft), []);

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
    if (browser) {
      try {
        await browserRef.current?.rename(next);
        setSavedTitle(next);
        setTitle(next);
      } catch {
        setTitle(savedTitle);
        toast.error("Couldn't rename it: this browser didn't save the change.");
      }
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

  async function changePresentation(next: Presentation) {
    const before = presentation;
    setPresentation(next);
    if (browser) {
      await browserRef.current?.savePresentation(next).catch(() => {
        setPresentation(before);
        toast.error("Couldn't save the slide style in this browser.");
      });
      return;
    }
    try {
      const res = await savePresentation(id, next);
      if (!res.ok) {
        setPresentation(before);
        toast.error(res.error);
      }
    } catch {
      setPresentation(before);
      toast.error("Couldn't save the slide style: the server is unreachable. Try again when you're back online.");
    }
  }

  /** A member's drawing from this browser goes into their account, then opens from there. */
  async function moveToAccount() {
    setMoving(true);
    try {
      await browserRef.current?.flush();
      await BrowserDrawingMover.shared.moveOne(id);
      toast.success("Moved to your account.", { id: "moved" });
      router.replace(`/drawings/${id}`);
    } catch (err) {
      setMoving(false);
      setMoveOpen(false);
      toast.error(err instanceof Error ? err.message : "It couldn't be moved. It's still in this browser.");
    }
  }

  /** Share: on the server, the sharing dialog; in this browser, the way there. */
  function share() {
    if (!allow("sharing")) return;
    if (browser) setMoveOpen(true);
    else setShareOpen(true);
  }

  const startMathCheck = () => {
    if (allow("math-check")) boardRef.current?.startMathCheck();
  };
  const toggleChemistry = () => {
    if (chemOpen || allow("chemistry")) setChemOpen(!chemOpen);
  };
  const toggleMath = () => {
    if (mathOpen || allow("math-tools")) setMathOpen(!mathOpen);
  };
  const openMathTab = (tab: MathTab, feature: "math-tools" | "worksheets" = "math-tools") => {
    if (!allow(feature)) return;
    setMathTab(tab);
    setMathOpen(true);
  };
  const MEMBERS_HINT = "Part of the membership";

  /** A figure from the math or chemistry tools, in the pen colour, onto the canvas. */
  const place: Place = async (build) => {
    try {
      const ink = style.color === "#ffffff" ? "#201f24" : style.color;
      const parts = await build(ink, async (tex) => {
        const layout = await typesetMath(tex);
        return { width: layout.width, height: layout.height };
      });
      const panel = document.querySelector("[data-ui=side-panel]")?.getBoundingClientRect();
      const boardBox = document.querySelector("[data-testid=board]")?.getBoundingClientRect();
      const covered = panel && boardBox ? Math.max(0, boardBox.right - panel.left) : 0;
      // It lands selected in view, which says enough (a toast would cover the panel's buttons).
      boardRef.current?.insertFigure(parts, covered);
    } catch {
      toast.error("Couldn't load the equation tools. Check your connection and try again.");
    }
  };

  const updateFrame = (frame: FrameElement, patch: Partial<FrameElement>) =>
    doc.dispatch({ type: "update", elements: [{ ...frame, ...patch }] });

  /** Show a frame on the board; beside the slides panel on wide screens, instead of it on phones. */
  function showFrame(frameId: string) {
    const narrow = window.matchMedia("(max-width: 639px)").matches;
    if (narrow && slidesOpen) setSlidesOpen(false);
    const panel = slidesOpen && !narrow ? document.querySelector("[data-testid=slides-panel]") : null;
    const boardBox = document.querySelector("[data-testid=board]")?.getBoundingClientRect();
    const covered = panel && boardBox ? Math.max(0, boardBox.right - panel.getBoundingClientRect().left) : 0;
    boardRef.current?.goToFrame(frameId, covered);
  }

  function present(startId: string | null) {
    if (!slides.length) return;
    setPresenting({ startId });
  }

  /** Image or video, or Trace a picture: both start with picking a file. */
  function runAction(action: ActionId) {
    if (readOnly || !ready) return;
    if (action === "media") imageInputRef.current?.click();
    else traceInputRef.current?.click();
  }

  // Everything the tool search finds: the tools this person can use, then commands.
  const registry = ToolRegistry.shared;
  const searchItems: SearchItem[] = [
    ...registry.tools
      .filter((t) => registry.allowed(t.id, readOnly))
      .map((t) => ({ id: t.id, label: t.label, hint: t.hint, words: t.words, shortcut: t.key, Icon: t.Icon, run: () => setTool(t.id) })),
    ...(readOnly
      ? []
      : registry.actions.map((a) => ({ id: a.id, label: a.label, hint: a.hint, words: a.words, shortcut: a.key, Icon: a.Icon, run: () => runAction(a.id) }))),
    ...(readOnly
      ? []
      : [
          { id: "undo", label: "Undo", shortcut: "⌘Z", Icon: Undo2, run: () => doc.dispatch({ type: "undo" }) },
          { id: "redo", label: "Redo", shortcut: "⇧⌘Z", Icon: Redo2, run: () => doc.dispatch({ type: "redo" }) },
        ]),
    {
      id: "check",
      label: "Check math",
      hint: locked("math-check") ? MEMBERS_HINT : "Loop around an equation and the AI checks each step",
      words: "ai verify answer",
      Icon: Sparkles,
      run: startMathCheck,
    },
    { id: "slides", label: "Slides", hint: "Frames as slides: order, style, present", words: "presentation frames", Icon: PresentationIcon, run: () => setSlidesOpen(true) },
    ...(slides.length
      ? [{ id: "present", label: "Present", hint: "Show the slides full screen", words: "slideshow presentation", Icon: Play, run: () => present(null) }]
      : []),
    {
      id: "chemistry",
      label: "Chemistry",
      hint: locked("chemistry") ? MEMBERS_HINT : "Molar mass, balancing, amounts, gas laws, pH",
      words: "chem elements molar stoichiometry limiting reagent gas law molarity dilution ph",
      Icon: FlaskConical,
      run: () => allow("chemistry") && setChemOpen(true),
    },
    {
      id: "math-tools",
      label: "Math tools",
      hint: locked("math-tools") ? MEMBERS_HINT : "Solve triangles, exact trig values, two-column proofs",
      words: "geometry trigonometry triangle unit circle sin cos tan proof theorem",
      Icon: Sigma,
      run: () => openMathTab(mathTab === "worksheet" ? "triangle" : mathTab),
    },
    {
      id: "worksheet",
      label: "Make a worksheet",
      hint: locked("worksheets") ? MEMBERS_HINT : "From this drawing's equations or a topic, with an answer key",
      words: "print practice problems homework pdf answer key",
      Icon: NotebookPen,
      run: () => openMathTab("worksheet", "worksheets"),
    },
    {
      id: "share",
      label: "Share",
      hint: locked("sharing") ? MEMBERS_HINT : "Invite people to draw with you, live",
      words: "invite collaborate link",
      Icon: Share2,
      run: share,
    },
    { id: "export", label: "Export PNG", hint: "A picture of the whole drawing", words: "download image save", Icon: FileImage, run: exportPng },
    { id: "backup", label: "Download backup", hint: "The drawing as a .json file", words: "save export json", Icon: FileDown, run: () => void downloadBackup() },
    ...(readOnly
      ? []
      : [{ id: "clear", label: "Clear board", hint: "Remove everything (undo brings it back)", words: "delete all empty", Icon: Trash2, run: () => doc.dispatch({ type: "clear" }) }]),
  ];

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
    noteAiCallsLeft(res);
    return mathCheckSchema.parse(json);
  }

  const updateStyle = (patch: Partial<Style>) => setStyle((s) => ({ ...s, ...patch }));

  // ------------------------------------------------------------------ UI

  const banner =
    browser && openElsewhere
      ? {
          text: "This drawing is open in another tab, so it can only be changed there. Close it there to edit it here.",
          action: "Download backup",
          onAction: downloadBackup,
        }
      : browser && browserStatus?.state === "error"
        ? {
            text: browserStatus.error ?? "Your latest changes couldn't be saved in this browser.",
            action: "Download backup",
            onAction: downloadBackup,
          }
        : ended === "deleted"
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

  return (
    <div className="flex min-h-dvh flex-col">
      <main className="flex h-dvh min-w-0 flex-1 flex-col gap-3 p-3 md:gap-4 md:px-6 md:pt-5 md:pb-5">
        <header className="flex items-center gap-2 md:gap-3">
          <Button asChild variant="ghost" size="icon-md" aria-label="All drawings">
            <Link href={browser && !user ? "/local" : "/"}>
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

          {browser ? (
            <BrowserSavePopover
              status={browserStatus}
              readOnly={openElsewhere}
              member={plan === "member" && !!user}
              message={panelMessage}
              onDownloadBackup={downloadBackup}
              onMove={() => setMoveOpen(true)}
            />
          ) : (
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
          )}

          <Tip
            content={
              locked("sharing")
                ? "Drawing together is part of the membership"
                : browser
                  ? "Move it to your account to share it"
                  : role === "owner"
                    ? "Invite people to draw with you, live"
                    : `Shared by ${ownerName ?? "the owner"}`
            }
          >
            <Button variant="light" className={cn(BAR_BUTTON, "max-sm:hidden")} onClick={share} aria-label="Share">
              <Share2 /> <span className="max-lg:hidden">Share</span>
              {locked("sharing") ? <Lock className="size-3.5 opacity-60 max-lg:hidden" aria-label="Members" /> : null}
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

          <Tip content="Frames on the canvas as slides: order them, pick a style, present">
            <Button
              variant="light"
              className={cn(BAR_BUTTON, "max-sm:hidden")}
              onClick={() => setSlidesOpen(!slidesOpen)}
              aria-label="Slides"
              aria-pressed={slidesOpen}
              data-testid="slides-button"
            >
              <PresentationIcon /> <span className="max-xl:hidden">Slides</span>
            </Button>
          </Tip>

          <Tip
            content={
              locked("math-tools")
                ? "The geometry, trig, proof and worksheet tools are part of the membership"
                : "Triangles, exact trig values, two-column proofs and worksheets"
            }
          >
            <Button
              variant="light"
              className={cn(BAR_BUTTON, "max-sm:hidden")}
              onClick={toggleMath}
              aria-label="Math tools"
              aria-pressed={mathOpen}
              data-testid="math-tools-button"
            >
              <Sigma /> <span className="max-xl:hidden">Math</span>
              {locked("math-tools") ? <Lock className="size-3.5 opacity-60 max-xl:hidden" aria-label="Members" /> : null}
            </Button>
          </Tip>

          <Tip
            content={
              locked("chemistry")
                ? "The chemistry tools are part of the membership"
                : "Molar mass, balancing, amounts, gas laws, solutions and the periodic table"
            }
          >
            <Button
              variant="light"
              className={cn(BAR_BUTTON, "max-sm:hidden")}
              onClick={toggleChemistry}
              aria-label="Chemistry"
              aria-pressed={chemOpen}
            >
              <FlaskConical /> <span className="max-xl:hidden">Chemistry</span>
              {locked("chemistry") ? <Lock className="size-3.5 opacity-60 max-xl:hidden" aria-label="Members" /> : null}
            </Button>
          </Tip>

          {/* Phones: Share, Export, Math and Chemistry share one menu, so the title has room. */}
          <Menu>
            <MenuTrigger asChild>
              <Button variant="light" className={cn(BAR_BUTTON, "sm:hidden")} aria-label="More">
                <Ellipsis />
              </Button>
            </MenuTrigger>
            <MenuContent align="end" className="w-56">
              <MenuItem onSelect={share}>
                <Share2 /> Share
                {locked("sharing") ? <Lock className="ml-auto size-3.5 opacity-60" aria-label="Members" /> : null}
              </MenuItem>
              <MenuItem onSelect={() => setSlidesOpen(!slidesOpen)}>
                <PresentationIcon /> {slidesOpen ? "Close slides" : "Slides"}
              </MenuItem>
              <MenuItem onSelect={toggleMath}>
                <Sigma /> {mathOpen ? "Close math tools" : "Math tools"}
                {locked("math-tools") ? <Lock className="ml-auto size-3.5 opacity-60" aria-label="Members" /> : null}
              </MenuItem>
              <MenuItem onSelect={toggleChemistry}>
                <FlaskConical /> {chemOpen ? "Close chemistry" : "Chemistry"}
                {locked("chemistry") ? <Lock className="ml-auto size-3.5 opacity-60" aria-label="Members" /> : null}
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

          <Tip
            content={
              locked("math-check")
                ? "Checking math is part of the membership"
                : "Draw a loop around an equation and the AI checks each step"
            }
          >
            <Button
              className={cn(BAR_BUTTON, "bg-green hover:bg-[#1f6965]")}
              onClick={startMathCheck}
              disabled={!ready}
              aria-label="Check math"
              data-locked={locked("math-check") || undefined}
            >
              <Sparkles /> <span className="max-sm:hidden">Check math</span>
              {locked("math-check") ? <Lock className="size-3.5 opacity-80 max-sm:hidden" aria-label="Members" /> : null}
            </Button>
          </Tip>

          {user ? <HeaderUserMenu user={user} /> : <GuestMenu next={`/local/${id}`} />}
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
            mathCheckLocked={locked("math-check")}
            onLocked={setUpgrade}
            readOnly={readOnly}
            drawEffect={preferences.drawEffect}
            boardEffects={preferences.boardEffects}
            peers={peers}
            onPointerWorld={onPointerWorld}
            onSelectionChange={onSelectionChange}
            onMakeFlashcard={(capture) => allow("flashcards") && setFlashcard(capture)}
            onTracePicture={() => traceInputRef.current?.click()}
            onOpenFrame={(frameId) => {
              setSlidesOpen(true);
              setSlideFocus(frameId);
            }}
            onPresentFrame={present}
            onDraft={onDraft}
            peerDrafts={peerDrafts}
          />
          {readOnly ? null : <StyleBar tool={tool} style={style} onChange={updateStyle} />}
          <ToolDock
            tool={tool}
            onTool={setTool}
            onAction={runAction}
            readOnly={readOnly}
            disabled={!ready}
            canUndo={snap.canUndo}
            canRedo={snap.canRedo}
            onUndo={() => doc.dispatch({ type: "undo" })}
            onRedo={() => doc.dispatch({ type: "redo" })}
            onSearch={() => setSearchOpen(true)}
          />
        </div>
      </main>

      <MathPanel
        open={mathOpen}
        onOpenChange={setMathOpen}
        tab={mathTab}
        onTabChange={setMathTab}
        place={place}
        canInsert={ready && !readOnly}
        elements={elements}
        getSelection={() => selectionRef.current}
        title={title}
      />

      <ChemPanel
        open={chemOpen}
        onOpenChange={setChemOpen}
        place={place}
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

      <ToolSearch open={searchOpen} onOpenChange={setSearchOpen} items={searchItems} />

      <SlidesPanel
        open={slidesOpen}
        onOpenChange={setSlidesOpen}
        slides={slides}
        elements={elements}
        background={background}
        env={env}
        imageVersion={imageVersion}
        presentation={presentation}
        onPresentationChange={(next) => void changePresentation(next)}
        readOnly={readOnly}
        focusId={slideFocus}
        onGoTo={showFrame}
        onPresent={present}
        onRename={(frameId, t) => {
          const frame = slides.find((f) => f.id === frameId);
          if (frame) updateFrame(frame, { title: t });
        }}
        onMove={(from, to) => {
          const changed = reorderSlides(slides, from, to);
          if (changed.length) doc.dispatch({ type: "update", elements: changed });
        }}
        onDelete={(frameId) => doc.dispatch({ type: "remove", ids: [frameId] })}
        onNewSlide={() => {
          const frameId = boardRef.current?.frameSelection();
          if (frameId) setSlideFocus(frameId);
        }}
      />

      {presenting ? (
        <Presenter
          elements={elements}
          background={background}
          env={env}
          imageVersion={imageVersion}
          presentation={presentation}
          startId={presenting.startId}
          onClose={(lastId) => {
            setPresenting(null);
            if (lastId) showFrame(lastId);
          }}
        />
      ) : null}

      <TracePictureDialog
        file={traceFile}
        color={style.color}
        onClose={closeTrace}
        onAdd={(picture) => boardRef.current?.insertTraced(picture) ?? 0}
        onPickAnother={() => traceInputRef.current?.click()}
      />

      <FlashcardDialog
        capture={flashcard}
        drawingId={browser ? null : id}
        deck={savedTitle}
        onClose={() => setFlashcard(null)}
      />

      {!browser && user ? (
        <ShareDialog
          drawingId={id}
          title={savedTitle}
          me={{ id: user.id, name: user.name, avatarUrl: user.avatarUrl }}
          open={shareOpen}
          onOpenChange={setShareOpen}
        />
      ) : null}

      <UpgradeDialog feature={upgrade} onClose={() => setUpgrade(null)} />

      {browser ? (
        <ConfirmDialog
          open={moveOpen}
          onOpenChange={(open) => !moving && setMoveOpen(open)}
          title="Move this drawing to your account?"
          description="It's uploaded with its pictures, so it's on every device you sign in on and you can share it. The copy in this browser is removed once your account has it."
          confirmLabel={moving ? "Moving…" : "Move it"}
          tone="primary"
          pending={moving}
          onConfirm={() => void moveToAccount()}
        />
      ) : null}

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
        ref={traceInputRef}
        type="file"
        accept="image/*"
        hidden
        data-testid="trace-input"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) setTraceFile(file);
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
