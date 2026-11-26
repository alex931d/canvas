"use client";

import { ArrowDown, ArrowUp, Blend, Frame, GalleryHorizontal, Play, Plus, Route, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button, SidePanel, Switch, ToggleGroup, ToggleGroupItem } from "@/components/kit";
import { elementBox } from "@/lib/canvas/geometry";
import { renderRegion, type RenderEnv } from "@/lib/canvas/render";
import type { CanvasElement, FrameElement, Presentation } from "@/lib/canvas/schema";
import { cn } from "@/lib/utils";

const STYLES: { id: Presentation["style"]; label: string; Icon: typeof Blend; about: string }[] = [
  { id: "fade", label: "Fade", Icon: Blend, about: "Each slide fades into the next." },
  { id: "swipe", label: "Slide", Icon: GalleryHorizontal, about: "Slides push in from the side, like turning pages." },
  {
    id: "journey",
    label: "Fly",
    Icon: Route,
    about: "The view flies across the canvas from frame to frame, so everyone sees how the parts connect.",
  },
];

/**
 * The drawing's frames as slides: their order, titles and how they're
 * presented. Non-modal, beside the board, so you can keep drawing.
 */
export function SlidesPanel({
  open,
  onOpenChange,
  slides,
  elements,
  background,
  env,
  imageVersion,
  presentation,
  onPresentationChange,
  readOnly,
  focusId,
  onGoTo,
  onPresent,
  onRename,
  onMove,
  onDelete,
  onNewSlide,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  slides: FrameElement[];
  elements: readonly CanvasElement[];
  background: string;
  env: RenderEnv;
  imageVersion: number;
  presentation: Presentation;
  onPresentationChange: (next: Presentation) => void;
  readOnly: boolean;
  /** A frame to bring into view in the list and start renaming (its title was double-clicked). */
  focusId: string | null;
  onGoTo: (id: string) => void;
  onPresent: (fromId: string | null) => void;
  onRename: (id: string, title: string) => void;
  onMove: (from: number, to: number) => void;
  onDelete: (id: string) => void;
  onNewSlide: () => void;
}) {
  const style = STYLES.find((s) => s.id === presentation.style) ?? STYLES[0];

  return (
    <SidePanel
      open={open}
      onOpenChange={onOpenChange}
      modal={false}
      title="Slides"
      description="Each frame on the canvas is a slide. They're shown in this order."
      className="overflow-y-auto sm:max-w-[380px]"
      onInteractOutside={(e) => e.preventDefault()}
      // Opened from a frame's title: its row takes the focus, to rename it.
      onOpenAutoFocus={(e) => {
        if (focusId) e.preventDefault();
      }}
      // Esc while renaming puts the title back; the next Esc closes the panel.
      onEscapeKeyDown={(e) => {
        if ((e.target as HTMLElement | null)?.closest?.("input")) e.preventDefault();
      }}
      data-testid="slides-panel"
      data-scrollable
    >
      <div className="flex flex-col gap-6 px-5 pb-8">
        <div className="flex gap-2">
          <Button className="flex-1" disabled={!slides.length} onClick={() => onPresent(null)} data-testid="present">
            <Play /> Present
          </Button>
          {readOnly ? null : (
            <Button variant="secondary" onClick={onNewSlide} title="Frames what's selected, or the middle of the view">
              <Plus /> New slide
            </Button>
          )}
        </div>

        <section aria-labelledby="slides-style" className="flex flex-col gap-3">
          <h3 id="slides-style" className="text-sm font-semibold">
            Moving between slides
          </h3>
          <div
            role="radiogroup"
            aria-labelledby="slides-style"
            className="grid grid-cols-3 gap-2"
            onKeyDown={(e) => {
              const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
              if (!step || readOnly) return;
              e.preventDefault();
              const at = STYLES.findIndex((s) => s.id === presentation.style);
              const next = STYLES[(at + step + STYLES.length) % STYLES.length];
              onPresentationChange({ ...presentation, style: next.id });
              e.currentTarget.querySelector<HTMLButtonElement>(`[data-testid=style-${next.id}]`)?.focus();
            }}
          >
            {STYLES.map((s) => {
              const on = s.id === presentation.style;
              return (
                <button
                  key={s.id}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  tabIndex={on ? 0 : -1}
                  disabled={readOnly}
                  data-testid={`style-${s.id}`}
                  onClick={() => onPresentationChange({ ...presentation, style: s.id })}
                  className={cn(
                    "flex flex-col items-center gap-1.5 rounded-lg border px-2 py-3 text-sm font-semibold transition-colors outline-none",
                    "focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed",
                    on ? "border-grey-900 bg-grey-900 text-white" : "border-beige-500/40 hover:bg-beige-100",
                  )}
                >
                  <s.Icon className="size-5" aria-hidden />
                  {s.label}
                </button>
              );
            })}
          </div>
          <p className="text-sm text-grey-500">{style.about}</p>

          <div className="flex items-center justify-between gap-3">
            <span className="text-sm" id="slides-stage">
              Around each slide
            </span>
            <ToggleGroup
              size="sm"
              value={presentation.stage}
              onValueChange={(v) => v && onPresentationChange({ ...presentation, stage: v as Presentation["stage"] })}
              aria-labelledby="slides-stage"
            >
              <ToggleGroupItem value="dark" data-testid="stage-dark" disabled={readOnly}>
                Dark
              </ToggleGroupItem>
              <ToggleGroupItem value="paper" data-testid="stage-paper" disabled={readOnly}>
                Canvas colour
              </ToggleGroupItem>
            </ToggleGroup>
          </div>
          <label className="flex items-center justify-between gap-3 text-sm">
            Slide numbers
            <Switch
              checked={presentation.numbers}
              disabled={readOnly}
              onCheckedChange={(v) => onPresentationChange({ ...presentation, numbers: v })}
              data-testid="slide-numbers"
            />
          </label>
        </section>

        <section aria-label="Slides" className="flex flex-col gap-2">
          {slides.length === 0 ? (
            <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-beige-500/50 px-5 py-8 text-center">
              <Frame className="size-6 text-grey-500" aria-hidden />
              <p className="font-semibold">No slides yet</p>
              <p className="text-sm text-grey-500">
                Pick the Frame tool (F) and drag around what a slide should show, or select something and press New
                slide.
              </p>
            </div>
          ) : (
            <ol className="flex flex-col gap-2" data-testid="slide-list">
              {slides.map((frame, i) => (
                <SlideRow
                  key={frame.id}
                  frame={frame}
                  index={i}
                  count={slides.length}
                  elements={elements}
                  background={background}
                  env={env}
                  imageVersion={imageVersion}
                  readOnly={readOnly}
                  focus={focusId === frame.id}
                  onGoTo={() => onGoTo(frame.id)}
                  onPresent={() => onPresent(frame.id)}
                  onRename={(t) => onRename(frame.id, t)}
                  onMove={(to) => onMove(i, to)}
                  onDelete={() => onDelete(frame.id)}
                />
              ))}
            </ol>
          )}
          {slides.length && !readOnly ? (
            <p className="text-xs text-grey-500">
              {"Deleting a slide removes only its frame; what's drawn there stays. Moving a frame on the canvas takes what's inside it along (hold Alt to move the frame alone)."}
            </p>
          ) : null}
        </section>
      </div>
    </SidePanel>
  );
}

function SlideRow({
  frame,
  index,
  count,
  elements,
  background,
  env,
  imageVersion,
  readOnly,
  focus,
  onGoTo,
  onPresent,
  onRename,
  onMove,
  onDelete,
}: {
  frame: FrameElement;
  index: number;
  count: number;
  elements: readonly CanvasElement[];
  background: string;
  env: RenderEnv;
  imageVersion: number;
  readOnly: boolean;
  focus: boolean;
  onGoTo: () => void;
  onPresent: () => void;
  onRename: (title: string) => void;
  onMove: (to: number) => void;
  onDelete: () => void;
}) {
  // While typing: the draft. Otherwise the frame's own title (which others may change).
  const [draft, setDraft] = useState<string | null>(null);
  const cancelRef = useRef(false);
  const rowRef = useRef<HTMLLIElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!focus) return;
    rowRef.current?.scrollIntoView({ block: "nearest" });
    if (!readOnly) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [focus, readOnly]);

  const commit = () => {
    const next = (draft ?? "").trim().slice(0, 80);
    if (!cancelRef.current && draft !== null && next && next !== frame.title) onRename(next);
    cancelRef.current = false;
    setDraft(null);
  };

  return (
    <li
      ref={rowRef}
      data-testid="slide-row"
      className={cn(
        "flex items-center gap-3 rounded-xl border bg-white p-2 pr-1.5",
        focus ? "border-green ring-2 ring-green/25" : "border-beige-500/30",
      )}
    >
      <button
        type="button"
        onClick={onGoTo}
        aria-label={`Show ${frame.title} on the canvas`}
        className="relative shrink-0 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <SlideThumb frame={frame} elements={elements} background={background} env={env} imageVersion={imageVersion} />
        <span className="absolute top-1 left-1 grid min-w-5 place-items-center rounded bg-grey-900/80 px-1 text-[11px] font-semibold text-white tabular-nums">
          {index + 1}
        </span>
      </button>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <input
          ref={inputRef}
          value={draft ?? frame.title}
          readOnly={readOnly}
          maxLength={80}
          aria-label={`Title of slide ${index + 1}`}
          data-testid="slide-title"
          onFocus={() => !readOnly && setDraft(frame.title)}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
            if (e.key === "Escape") {
              cancelRef.current = true;
              e.stopPropagation();
              e.currentTarget.blur();
            }
          }}
          className="min-w-0 truncate rounded-md px-1.5 py-1 text-sm font-semibold outline-none read-only:cursor-default [&:not([readonly])]:hover:bg-beige-100 [&:not([readonly])]:focus-visible:bg-beige-100 [&:not([readonly])]:focus-visible:ring-2 [&:not([readonly])]:focus-visible:ring-ring"
        />
        <div className="flex items-center gap-0.5">
          <RowButton label={`Present from slide ${index + 1}`} onClick={onPresent}>
            <Play />
          </RowButton>
          {readOnly ? null : (
            <>
              <RowButton label="Move up" disabled={index === 0} onClick={() => onMove(index - 1)}>
                <ArrowUp />
              </RowButton>
              <RowButton label="Move down" disabled={index === count - 1} onClick={() => onMove(index + 1)}>
                <ArrowDown />
              </RowButton>
              <RowButton label={`Delete slide ${index + 1}`} onClick={onDelete} className="ml-auto hover:text-red">
                <Trash2 />
              </RowButton>
            </>
          )}
        </div>
      </div>
    </li>
  );
}

function RowButton({
  label,
  disabled,
  onClick,
  className,
  children,
}: {
  label: string;
  disabled?: boolean;
  onClick: () => void;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "grid size-7 place-items-center rounded-md text-grey-500 outline-none hover:bg-beige-100 hover:text-grey-900",
        "focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-35 disabled:hover:bg-transparent [&_svg]:size-4",
        className,
      )}
    >
      {children}
    </button>
  );
}

const THUMB_W = 112;
const THUMB_H = 72;

/** A small picture of what's inside a frame, redrawn shortly after the drawing changes. */
function SlideThumb({
  frame,
  elements,
  background,
  env,
  imageVersion,
}: {
  frame: FrameElement;
  elements: readonly CanvasElement[];
  background: string;
  env: RenderEnv;
  imageVersion: number;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const scale = Math.min(THUMB_W / frame.w, THUMB_H / frame.h);
  const w = Math.max(8, Math.round(frame.w * scale));
  const h = Math.max(8, Math.round(frame.h * scale));

  useEffect(() => {
    const t = setTimeout(() => {
      const canvas = ref.current;
      if (!canvas) return;
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      const img = renderRegion({ elements, background, region: elementBox(frame), scale: (w * dpr) / frame.w, env });
      const ctx = canvas.getContext("2d")!;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    }, 180);
    return () => clearTimeout(t);
  }, [frame, elements, background, env, imageVersion, w, h]);

  return (
    <span className="grid place-items-center rounded-md bg-beige-100" style={{ width: THUMB_W, height: THUMB_H }}>
      <canvas
        ref={ref}
        aria-hidden
        className="rounded-[3px] shadow-[0_0_0_1px_rgba(32,31,36,0.12)]"
        style={{ width: w, height: h, background }}
      />
    </span>
  );
}
