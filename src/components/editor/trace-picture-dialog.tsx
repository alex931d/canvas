"use client";

import { Maximize } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Button, Dialog, DialogContent, DialogFooter, Label, Slider, Switch, toast } from "@/components/kit";
import { MAX_TRACED_STROKES, findInk, grayscale, looksDark, traceStrokes, type Box, type TraceResult } from "@/lib/canvas/trace";
import { cn } from "@/lib/utils";
import type { TracedPicture } from "./board";

/**
 * "Trace a picture": a photo or screenshot of an equation (math, chemistry,
 * anything written) opens here. Drag a box around the part you want; the
 * preview shows the strokes it becomes, in your pen colour; Add to canvas
 * puts them on the board (src/lib/canvas/trace.ts does the tracing).
 */

/** Traced at about this many pixels across: plenty for writing, quick on a phone. */
const WORK_SIZE = 1000;
const MAX_WORK_PIXELS = 1_200_000;
/** Small pictures are enlarged up to this much first, so thin lines have room to be thinned. */
const MAX_UPSCALE = 4;
const MIN_BOX = 8;

type Handle = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";
type Drag =
  | { kind: "move"; start: { x: number; y: number }; box0: Box }
  | { kind: "resize"; handle: Handle; box0: Box }
  | { kind: "new"; start: { x: number; y: number } };

type Traced = TraceResult & { work: { w: number; h: number }; box: Box; key: string };

const HANDLES: { id: Handle; className: string; cursor: string }[] = [
  { id: "nw", className: "-top-1.5 -left-1.5", cursor: "nwse-resize" },
  { id: "ne", className: "-top-1.5 -right-1.5", cursor: "nesw-resize" },
  { id: "sw", className: "-bottom-1.5 -left-1.5", cursor: "nesw-resize" },
  { id: "se", className: "-right-1.5 -bottom-1.5", cursor: "nwse-resize" },
  { id: "n", className: "-top-1.5 left-1/2 -translate-x-1/2", cursor: "ns-resize" },
  { id: "s", className: "-bottom-1.5 left-1/2 -translate-x-1/2", cursor: "ns-resize" },
  { id: "w", className: "top-1/2 -left-1.5 -translate-y-1/2", cursor: "ew-resize" },
  { id: "e", className: "top-1/2 -right-1.5 -translate-y-1/2", cursor: "ew-resize" },
];

export function TracePictureDialog({
  file,
  color,
  onClose,
  onAdd,
  onPickAnother,
}: {
  file: File | null;
  /** The pen colour: what the strokes will be. */
  color: string;
  onClose: () => void;
  /** Put the strokes on the board; returns how many went on. */
  onAdd: (picture: TracedPicture) => number;
  onPickAnother: () => void;
}) {
  return (
    <Dialog open={!!file} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        size="xl"
        title="Trace a picture"
        description="Drag a box around the part you want. It becomes pen strokes you can move, resize, recolor and erase."
      >
        {file ? (
          <Tracer
            key={`${file.name}:${file.size}:${file.lastModified}`}
            file={file}
            color={color}
            onClose={onClose}
            onAdd={onAdd}
            onPickAnother={onPickAnother}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function Tracer({
  file,
  color,
  onClose,
  onAdd,
  onPickAnother,
}: {
  file: File;
  color: string;
  onClose: () => void;
  onAdd: (picture: TracedPicture) => number;
  onPickAnother: () => void;
}) {
  const [image, setImage] = useState<ImageBitmap | null>(null);
  const [box, setBox] = useState<Box | null>(null);
  const [detail, setDetail] = useState(0.5);
  const [dark, setDark] = useState<boolean | null>(null);
  const [traced, setTraced] = useState<Traced | null>(null);
  const [view, setView] = useState({ w: 0, h: 0 });
  const frameRef = useRef<HTMLDivElement>(null);
  const previewRef = useRef<HTMLCanvasElement>(null);
  const dragRef = useRef<Drag | null>(null);

  // Open the picture (turned the right way up), and start with a box around its writing.
  useEffect(() => {
    let cancelled = false;
    let opened: ImageBitmap | null = null;
    createImageBitmap(file, { imageOrientation: "from-image" })
      .then((bitmap) => {
        if (cancelled) return bitmap.close();
        opened = bitmap;
        const small = toPixels(bitmap, { x: 0, y: 0, w: bitmap.width, h: bitmap.height }, 600);
        const darkBackground = looksDark(grayscale(small.pixels));
        const ink = findInk(small.pixels, { darkBackground });
        setDark(darkBackground);
        setBox(ink ? padBox(scaleBox(ink, 1 / small.scale), bitmap.width, bitmap.height) : full(bitmap));
        setImage(bitmap);
      })
      .catch(() => {
        if (cancelled) return;
        toast.error("That file isn't a picture this browser can open. Try a JPEG, PNG or screenshot.");
        onClose();
      });
    return () => {
      cancelled = true;
      opened?.close();
    };
  }, [file, onClose]);

  // The picture fits the dialog's width and at most about half the screen's height.
  useLayoutEffect(() => {
    const el = frameRef.current;
    if (!el || !image) return;
    const fit = () => {
      const parent = el.parentElement!;
      const pad = parseFloat(getComputedStyle(parent).paddingLeft) + parseFloat(getComputedStyle(parent).paddingRight);
      const maxW = parent.clientWidth - pad;
      const maxH = Math.max(220, Math.min(window.innerHeight * 0.5, 520));
      const s = Math.min(maxW / image.width, maxH / image.height, 2);
      setView({ w: Math.round(image.width * s), h: Math.round(image.height * s) });
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el.parentElement!);
    return () => ro.disconnect();
  }, [image]);

  // Trace the box a moment after it stops changing.
  const wanted = JSON.stringify([box, detail, dark]);
  const working = traced?.key !== wanted;
  useEffect(() => {
    if (!image || !box || dark === null) return;
    const timer = setTimeout(() => {
      const { pixels } = toPixels(image, box, WORK_SIZE);
      const result = traceStrokes(pixels, { detail, darkBackground: dark });
      setTraced({ ...result, work: { w: pixels.width, h: pixels.height }, box: { ...box }, key: JSON.stringify([box, detail, dark]) });
    }, 120);
    return () => clearTimeout(timer);
  }, [image, box, detail, dark]);

  const scale = image && view.w ? view.w / image.width : 1;

  // The preview: the picture dimmed outside the box, faded inside it, and the strokes on top.
  useEffect(() => {
    const canvas = previewRef.current;
    if (!canvas || !image || !box || !view.w) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(view.w * dpr);
    canvas.height = Math.round(view.h * dpr);
    const ctx = canvas.getContext("2d")!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, view.w, view.h);
    const b = scaleBox(box, scale);
    ctx.fillStyle = "rgba(32, 31, 36, 0.5)";
    ctx.fillRect(0, 0, view.w, view.h);
    ctx.clearRect(b.x, b.y, b.w, b.h);
    ctx.fillStyle = "rgba(255, 255, 255, 0.78)";
    ctx.fillRect(b.x, b.y, b.w, b.h);
    if (!traced) return;
    const k = (traced.box.w / traced.work.w) * scale;
    const ox = traced.box.x * scale;
    const oy = traced.box.y * scale;
    ctx.strokeStyle = color === "#ffffff" ? "#201f24" : color;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    for (const s of traced.strokes) {
      ctx.lineWidth = Math.max(1, s.size * k);
      ctx.beginPath();
      ctx.moveTo(ox + s.points[0] * k, oy + s.points[1] * k);
      if (s.points.length === 2) ctx.lineTo(ox + s.points[0] * k + 0.01, oy + s.points[1] * k);
      for (let i = 2; i < s.points.length; i += 2) ctx.lineTo(ox + s.points[i] * k, oy + s.points[i + 1] * k);
      ctx.stroke();
    }
  }, [traced, box, image, view, scale, color]);

  // ------------------------------------------------------------ the box

  const toImage = useCallback(
    (e: { clientX: number; clientY: number }) => {
      const r = frameRef.current!.getBoundingClientRect();
      return { x: (e.clientX - r.left) / scale, y: (e.clientY - r.top) / scale };
    },
    [scale],
  );

  const onPointerDown = (e: React.PointerEvent) => {
    if (!image || !box || e.button !== 0) return;
    const p = toImage(e);
    const handle = (e.target as HTMLElement).dataset.handle as Handle | undefined;
    if (handle) dragRef.current = { kind: "resize", handle, box0: box };
    else if (p.x >= box.x && p.x <= box.x + box.w && p.y >= box.y && p.y <= box.y + box.h) {
      dragRef.current = { kind: "move", start: p, box0: box };
    } else dragRef.current = { kind: "new", start: p };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    e.preventDefault();
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const drag = dragRef.current;
    if (!drag || !image) return;
    const p = toImage(e);
    const W = image.width;
    const H = image.height;
    const min = MIN_BOX / scale;
    if (drag.kind === "move") {
      const { box0 } = drag;
      setBox({
        ...box0,
        x: clamp(box0.x + p.x - drag.start.x, 0, W - box0.w),
        y: clamp(box0.y + p.y - drag.start.y, 0, H - box0.h),
      });
    } else if (drag.kind === "new") {
      const x0 = clamp(Math.min(drag.start.x, p.x), 0, W);
      const y0 = clamp(Math.min(drag.start.y, p.y), 0, H);
      const x1 = clamp(Math.max(drag.start.x, p.x), 0, W);
      const y1 = clamp(Math.max(drag.start.y, p.y), 0, H);
      if (x1 - x0 >= min && y1 - y0 >= min) setBox({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 });
    } else {
      const { box0, handle } = drag;
      let x0 = box0.x, y0 = box0.y, x1 = box0.x + box0.w, y1 = box0.y + box0.h;
      if (handle.includes("w")) x0 = clamp(p.x, 0, x1 - min);
      if (handle.includes("e")) x1 = clamp(p.x, x0 + min, W);
      if (handle.includes("n")) y0 = clamp(p.y, 0, y1 - min);
      if (handle.includes("s")) y1 = clamp(p.y, y0 + min, H);
      setBox({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 });
    }
  };

  const onPointerUp = () => {
    dragRef.current = null;
  };

  /** Arrow keys move the box; with Shift they resize it. */
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!image || !box) return;
    const step = Math.max(1, Math.round(Math.max(image.width, image.height) / 100)) * (e.altKey ? 0.2 : 1);
    const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
    if (!d) return;
    e.preventDefault();
    const min = MIN_BOX / scale;
    if (e.shiftKey) {
      setBox({ ...box, w: clamp(box.w + d[0], min, image.width - box.x), h: clamp(box.h + d[1], min, image.height - box.y) });
    } else {
      setBox({ ...box, x: clamp(box.x + d[0], 0, image.width - box.w), y: clamp(box.y + d[1], 0, image.height - box.h) });
    }
  };

  // ------------------------------------------------------------ result

  const count = traced?.strokes.length ?? 0;
  const tooMany = count > MAX_TRACED_STROKES;
  const status = !traced
    ? "Reading the picture…"
    : count === 0
      ? "No writing found in the box. Make it bigger, or move Detail toward Fainter lines."
      : tooMany
        ? `That's ${count} strokes: too much to add at once. Make the box smaller, or move Detail toward Fewer specks.`
        : `${count} ${count === 1 ? "stroke" : "strokes"}, in your pen colour.`;

  const add = () => {
    if (!traced || !count || tooMany) return;
    const added = onAdd({
      strokes: traced.strokes,
      width: traced.work.w,
      height: traced.work.h,
      naturalWidth: traced.box.w,
      naturalHeight: traced.box.h,
    });
    if (added) toast.success(`Added ${added} ${added === 1 ? "stroke" : "strokes"}. They're selected: drag to move them.`);
    onClose();
  };

  const b = box ? scaleBox(box, scale) : null;

  return (
    <div className="grid min-w-0 gap-5">
      <div className="grid min-w-0 justify-items-center rounded-xl bg-beige-100 p-2">
        <div
          ref={frameRef}
          className="relative touch-none select-none"
          style={{ width: view.w || undefined, height: view.h || undefined, minHeight: image ? undefined : 220 }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          data-testid="trace-picture"
        >
          {image ? <BitmapView image={image} width={view.w} height={view.h} /> : null}
          <canvas ref={previewRef} className="pointer-events-none absolute inset-0 size-full" data-testid="trace-preview" />
          {b ? (
            <div
              role="group"
              tabIndex={0}
              aria-label="Part to trace. Drag it to move, drag its edges to resize. Arrow keys move it; Shift and arrow keys resize it."
              onKeyDown={onKeyDown}
              className="absolute cursor-move rounded-sm outline-2 outline-offset-0 outline-green focus-visible:outline-4"
              style={{ left: b.x, top: b.y, width: b.w, height: b.h }}
              data-testid="trace-box"
            >
              {HANDLES.map((h) => (
                <span
                  key={h.id}
                  data-handle={h.id}
                  aria-hidden
                  className={cn(
                    "absolute size-3 rounded-full border-2 border-green bg-white",
                    "before:absolute before:-inset-3 before:content-['']", // a bigger target for fingers
                    h.className,
                  )}
                  style={{ cursor: h.cursor }}
                />
              ))}
            </div>
          ) : null}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end sm:gap-8">
        <div className="grid gap-2">
          <Label htmlFor="trace-detail">Detail</Label>
          <Slider
            id="trace-detail"
            min={0}
            max={1}
            step={0.05}
            value={detail}
            onValueChange={setDetail}
            aria-label="Detail"
          />
          <div className="flex justify-between text-xs text-grey-500" aria-hidden>
            <span>Fewer specks</span>
            <span>Fainter lines</span>
          </div>
        </div>
        <label className="flex items-center gap-3 text-sm">
          <Switch checked={!!dark} onCheckedChange={setDark} aria-label="Light writing on a dark background" />
          Light writing on a dark background
        </label>
      </div>

      <p role="status" aria-live="polite" className={cn("text-sm", tooMany || count === 0 ? "text-red" : "text-grey-500")}>
        {working && traced ? "Tracing…" : status}
      </p>

      <DialogFooter className="sm:justify-between">
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button variant="ghost" onClick={onPickAnother}>
            Choose another picture
          </Button>
          <Button variant="ghost" disabled={!image} onClick={() => image && setBox(full(image))}>
            <Maximize /> Whole picture
          </Button>
        </div>
        <div className="flex flex-col-reverse gap-2 sm:flex-row">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={add} disabled={!traced || working || count === 0 || tooMany}>
            Add to canvas
          </Button>
        </div>
      </DialogFooter>
    </div>
  );
}

/** The picture itself, drawn once per size. */
function BitmapView({ image, width, height }: { image: ImageBitmap; width: number; height: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || !width) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    const ctx = canvas.getContext("2d")!;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
  }, [image, width, height]);
  return <canvas ref={ref} className="block size-full rounded-md" aria-hidden />;
}

// ---------------------------------------------------------------- helpers

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const full = (image: { width: number; height: number }): Box => ({ x: 0, y: 0, w: image.width, h: image.height });
const scaleBox = (b: Box, s: number): Box => ({ x: b.x * s, y: b.y * s, w: b.w * s, h: b.h * s });

/** A little room around the writing, inside the picture. */
function padBox(b: Box, W: number, H: number): Box {
  const pad = Math.max(8, Math.round(Math.max(b.w, b.h) * 0.06));
  const x = Math.max(0, b.x - pad);
  const y = Math.max(0, b.y - pad);
  return { x, y, w: Math.min(W, b.x + b.w + pad) - x, h: Math.min(H, b.y + b.h + pad) - y };
}

/** That part of the picture as pixels, about `size` across (enlarged up to 4× when small). */
function toPixels(image: ImageBitmap, box: Box, size: number) {
  let scale = Math.min(MAX_UPSCALE, size / Math.max(box.w, box.h));
  if (box.w * box.h * scale * scale > MAX_WORK_PIXELS) scale = Math.sqrt(MAX_WORK_PIXELS / (box.w * box.h));
  const w = Math.max(1, Math.round(box.w * scale));
  const h = Math.max(1, Math.round(box.h * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.fillStyle = "#ffffff"; // transparent parts read as paper
  ctx.fillRect(0, 0, w, h);
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(image, box.x, box.y, box.w, box.h, 0, 0, w, h);
  return { pixels: ctx.getImageData(0, 0, w, h), scale };
}
