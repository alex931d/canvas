"use client";

import { Brush, Highlighter, PenLine, Plus } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
  Separator,
  Slider,
  Toggle,
  ToggleGroup,
  ToggleGroupItem,
} from "@/components/kit";
import type { Brush as BrushKind, FontKind, Sketch } from "@/lib/canvas/schema";
import { cn } from "@/lib/utils";
import { FRAME_ASPECTS, SWATCHES, isShapeTool, type EraserMode, type FrameAspect, type Style, type Tool } from "./tools";

/** Options for the current tool, floating at the top-left of the board. */
export function StyleBar({
  tool,
  style,
  onChange,
}: {
  tool: Tool;
  style: Style;
  onChange: (patch: Partial<Style>) => void;
}) {
  // The graph tool has its own editor.
  if (tool === "select" || tool === "lasso" || tool === "hand" || tool === "graph" || tool === "kanban") return null;
  if (tool === "frame") {
    return (
      <div
        role="toolbar"
        aria-label="Tool options"
        className="absolute top-3 left-3 z-20 flex max-w-[calc(100%-1.5rem)] flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border bg-card px-3 py-2 shadow-float"
        onPointerDown={(e) => e.stopPropagation()}
      >
        <span className="text-xs text-muted-foreground">Shape</span>
        <ToggleGroup
          size="sm"
          value={style.frameAspect}
          onValueChange={(v) => v && onChange({ frameAspect: v as FrameAspect })}
          aria-label="Frame shape"
        >
          {FRAME_ASPECTS.map((a) => (
            <ToggleGroupItem key={a.id} value={a.id} data-testid={`frame-aspect-${a.id}`}>
              {a.label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <span className="hidden text-xs text-muted-foreground md:inline">Drag around what the slide shows, or click for one the size of the view.</span>
      </div>
    );
  }
  const textLike = tool === "text" || tool === "equation";

  const sizeKey: keyof Style =
    tool === "eraser"
      ? "eraserSize"
      : tool === "pen"
        ? style.brush === "highlighter"
          ? "highlighterSize"
          : "penSize"
        : textLike
          ? "fontSize"
          : "shapeSize";
  const sizeRange: [number, number] =
    sizeKey === "eraserSize" ? [6, 120] : sizeKey === "highlighterSize" ? [8, 60] : sizeKey === "fontSize" ? [12, 120] : [1, 32];
  const showColors = tool !== "eraser";
  const showSize = !(tool === "eraser" && style.eraserMode === "stroke");

  return (
    <div
      role="toolbar"
      aria-label="Tool options"
      className="absolute top-3 left-3 z-20 flex max-w-[calc(100%-1.5rem)] flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border bg-card px-3 py-2 shadow-float"
      onPointerDown={(e) => e.stopPropagation()}
    >
      {tool === "pen" ? (
        <>
          <ToggleGroup
            size="sm"
            value={style.brush}
            onValueChange={(v) => v && onChange({ brush: v as BrushKind })}
            aria-label="Brush"
          >
            <ToggleGroupItem value="ink" aria-label="Ink (pressure sensitive)" title="Ink: width follows pen pressure">
              <PenLine /> <span className="hidden sm:inline">Ink</span>
            </ToggleGroupItem>
            <ToggleGroupItem value="marker" aria-label="Marker" title="Marker: even width">
              <Brush /> <span className="hidden sm:inline">Marker</span>
            </ToggleGroupItem>
            <ToggleGroupItem value="highlighter" aria-label="Highlighter" title="Highlighter: see-through">
              <Highlighter /> <span className="hidden sm:inline">Highlighter</span>
            </ToggleGroupItem>
          </ToggleGroup>
          <Separator orientation="vertical" className="h-6!" />
        </>
      ) : null}

      {tool === "eraser" ? (
        <>
          <ToggleGroup
            size="sm"
            value={style.eraserMode}
            onValueChange={(v) => v && onChange({ eraserMode: v as EraserMode })}
            aria-label="Eraser mode"
          >
            <ToggleGroupItem value="stroke" title="Removes whole strokes and shapes you touch">
              Whole strokes
            </ToggleGroupItem>
            <ToggleGroupItem value="pixel" title="Rubs out only where you drag">
              Pixels
            </ToggleGroupItem>
          </ToggleGroup>
          {showSize ? <Separator orientation="vertical" className="h-6!" /> : null}
        </>
      ) : null}

      {tool === "text" ? (
        <>
          <ToggleGroup
            size="sm"
            value={style.font}
            onValueChange={(v) => v && onChange({ font: v as FontKind })}
            aria-label="Font"
          >
            <ToggleGroupItem value="hand" className="font-hand text-lg">
              Hand
            </ToggleGroupItem>
            <ToggleGroupItem value="sans">Sans</ToggleGroupItem>
            <ToggleGroupItem value="mono" className="font-mono text-xs">
              Mono
            </ToggleGroupItem>
          </ToggleGroup>
          <Separator orientation="vertical" className="h-6!" />
        </>
      ) : null}

      {showColors ? (
        // Phones: one swatch that opens the palette, to keep the bar to one row.
        <Popover>
          <PopoverTrigger asChild>
            <button
              type="button"
              aria-label="Choose colour"
              className="size-7 rounded-full ring-2 ring-grey-900 ring-offset-2 sm:hidden"
              style={{ backgroundColor: style.color }}
            />
          </PopoverTrigger>
          <PopoverContent className="w-auto p-3 sm:hidden" align="start">
            <div className="grid grid-cols-6 gap-2">
              {SWATCHES.map((s) => (
                <button
                  key={s.hex}
                  type="button"
                  aria-label={s.name}
                  aria-pressed={style.color === s.hex}
                  onClick={() => onChange({ color: s.hex })}
                  className="size-8 rounded-full ring-1 ring-black/10 aria-pressed:ring-2 aria-pressed:ring-grey-900 aria-pressed:ring-offset-2"
                  style={{ backgroundColor: s.hex }}
                />
              ))}
              <input
                type="color"
                aria-label="Custom colour"
                value={style.color}
                onChange={(e) => onChange({ color: e.target.value })}
                className="size-8 cursor-pointer rounded-full border-0 bg-transparent p-0"
              />
            </div>
          </PopoverContent>
        </Popover>
      ) : null}

      {showColors ? (
        <div role="group" aria-label="Colour" className="hidden items-center gap-1 sm:flex">
          {SWATCHES.map((s) => (
            <button
              key={s.hex}
              type="button"
              title={s.name}
              aria-label={s.name}
              aria-pressed={style.color === s.hex}
              onClick={() => onChange({ color: s.hex })}
              className={cn(
                "size-6 rounded-full ring-1 ring-black/10 transition-transform hover:scale-110",
                "aria-pressed:ring-2 aria-pressed:ring-grey-900 aria-pressed:ring-offset-2",
              )}
              style={{ backgroundColor: s.hex }}
            />
          ))}
          <Popover>
            <PopoverTrigger asChild>
              <button
                type="button"
                aria-label="Custom colour"
                title="Custom colour"
                className="grid size-6 place-items-center rounded-full border border-dashed border-beige-500 text-grey-500 hover:text-grey-900"
              >
                <Plus className="size-3.5" />
              </button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-3" align="start">
              <label className="flex items-center gap-3 text-sm font-medium">
                Custom colour
                <input
                  type="color"
                  value={style.color}
                  onChange={(e) => onChange({ color: e.target.value })}
                  className="h-8 w-12 cursor-pointer rounded border-0 bg-transparent p-0"
                />
              </label>
            </PopoverContent>
          </Popover>
        </div>
      ) : null}

      {showSize ? (
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          {textLike ? "Size" : "Width"}
          <Slider
            className="w-20 sm:w-24"
            min={sizeRange[0]}
            max={sizeRange[1]}
            step={1}
            value={style[sizeKey] as number}
            onValueChange={(v) => onChange({ [sizeKey]: v } as Partial<Style>)}
            aria-label={tool === "text" ? "Text size" : tool === "equation" ? "Equation size" : "Width"}
          />
          <span className="w-6 text-right font-semibold text-foreground tabular-nums">{style[sizeKey] as number}</span>
        </label>
      ) : null}

      {isShapeTool(tool) ? (
        <>
          <Separator orientation="vertical" className="h-6!" />
          <Toggle
            size="sm"
            pressed={style.sketchy}
            onPressedChange={(v) => onChange({ sketchy: v })}
            title="Hand-drawn look (rough.js)"
          >
            Sketchy
          </Toggle>
          {style.sketchy ? (
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              Rough
              <Slider
                className="w-16"
                min={0.2}
                max={3}
                step={0.1}
                value={style.roughness}
                onValueChange={(v) => onChange({ roughness: v })}
                aria-label="Roughness"
              />
            </label>
          ) : null}
          {tool === "rect" || tool === "ellipse" ? (
            <>
              <Toggle size="sm" pressed={style.fill} onPressedChange={(v) => onChange({ fill: v })}>
                Fill
              </Toggle>
              {style.fill && style.sketchy ? (
                <ToggleGroup
                  size="sm"
                  value={style.fillStyle}
                  onValueChange={(v) => v && onChange({ fillStyle: v as Sketch["fillStyle"] })}
                  aria-label="Fill pattern"
                >
                  <ToggleGroupItem value="hachure">Hatch</ToggleGroupItem>
                  <ToggleGroupItem value="cross-hatch">Cross</ToggleGroupItem>
                  <ToggleGroupItem value="solid">Solid</ToggleGroupItem>
                </ToggleGroup>
              ) : null}
            </>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
