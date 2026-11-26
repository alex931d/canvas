"use client";

import { Minus, Plus } from "lucide-react";
import { Button, Menu, MenuContent, MenuItem, MenuSeparator, MenuShortcut, MenuTrigger, Tip } from "@/components/kit";

export function ZoomControls({
  zoom,
  onZoomIn,
  onZoomOut,
  onZoomTo,
  onFit,
  onFitSelection,
}: {
  zoom: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onZoomTo: (z: number) => void;
  onFit: () => void;
  onFitSelection?: () => void;
}) {
  return (
    <div
      className="absolute right-3 bottom-[68px] z-20 flex items-center gap-0.5 rounded-xl border bg-card p-1 shadow-float lg:bottom-3"
      onPointerDown={(e) => e.stopPropagation()}
    >
      <Tip content="Zoom out" shortcut="Ctrl −">
        <Button variant="ghost" size="icon-sm" onClick={onZoomOut} aria-label="Zoom out">
          <Minus />
        </Button>
      </Tip>

      <Menu>
        <MenuTrigger asChild>
          <Button variant="ghost" size="sm" className="w-16 font-semibold tabular-nums" aria-label="Zoom level">
            {Math.round(zoom * 100)}%
          </Button>
        </MenuTrigger>
        <MenuContent align="end" side="top" className="w-52">
          <MenuItem onSelect={onFit}>
            Zoom to fit <MenuShortcut>⇧1</MenuShortcut>
          </MenuItem>
          {onFitSelection ? (
            <MenuItem onSelect={onFitSelection}>
              Zoom to selection <MenuShortcut>⇧2</MenuShortcut>
            </MenuItem>
          ) : null}
          <MenuSeparator />
          {[0.5, 1, 2].map((z) => (
            <MenuItem key={z} onSelect={() => onZoomTo(z)}>
              Zoom to {z * 100}%{z === 1 ? <MenuShortcut>Ctrl 0</MenuShortcut> : null}
            </MenuItem>
          ))}
        </MenuContent>
      </Menu>

      <Tip content="Zoom in" shortcut="Ctrl +">
        <Button variant="ghost" size="icon-sm" onClick={onZoomIn} aria-label="Zoom in">
          <Plus />
        </Button>
      </Tip>
    </div>
  );
}
