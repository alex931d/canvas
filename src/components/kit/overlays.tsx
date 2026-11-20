"use client";

import { X } from "lucide-react";
import {
  AlertDialog as AlertPrimitive,
  Dialog as DialogPrimitive,
  DropdownMenu as MenuPrimitive,
  Popover as PopoverPrimitive,
  Tooltip as TipPrimitive,
} from "radix-ui";
import { cn } from "@/lib/utils";
import { Button, buttonClasses } from "./button";
import { Kbd } from "./bits";

/*
 * Things that float over the page. Radix does the hard parts (focus moving
 * in and back out, Escape, clicks outside, screen-reader roles, keeping on
 * screen); the look, the animations (globals.css .kit-pop / .kit-fade /
 * .kit-slide-*) and the smaller APIs are canvas's own.
 */

const surface = "rounded-xl bg-white text-grey-900 shadow-float ring-1 ring-beige-500/25";

// ------------------------------------------------------------------ tooltip

/** Wrap the app once (the root layout): tooltips share an opening delay. */
export function TipProvider({ children }: { children: React.ReactNode }) {
  return (
    <TipPrimitive.Provider delayDuration={350} skipDelayDuration={200}>
      {children}
    </TipPrimitive.Provider>
  );
}

/**
 * A dark tooltip for its child, which must be a single focusable element.
 * `shortcut` adds a keycap: <Tip content="Pen" shortcut="P">…</Tip>.
 */
export function Tip({
  content,
  shortcut,
  side = "top",
  children,
}: {
  content: React.ReactNode;
  shortcut?: string;
  side?: "top" | "right" | "bottom" | "left";
  children: React.ReactElement;
}) {
  return (
    <TipPrimitive.Root>
      <TipPrimitive.Trigger asChild>{children}</TipPrimitive.Trigger>
      <TipPrimitive.Portal>
        <TipPrimitive.Content
          data-ui="tip"
          side={side}
          sideOffset={6}
          collisionPadding={8}
          className="kit-pop kit-instant-out z-[60] flex max-w-72 items-center gap-1.5 rounded-lg bg-grey-900 px-2.5 py-1.5 text-xs leading-snug font-bold text-white"
        >
          {content}
          {shortcut ? (
            <Kbd tone="dark" className="uppercase">
              {shortcut}
            </Kbd>
          ) : null}
          <TipPrimitive.Arrow className="fill-grey-900" width={10} height={5} />
        </TipPrimitive.Content>
      </TipPrimitive.Portal>
    </TipPrimitive.Root>
  );
}

// ------------------------------------------------------------------ popover

export const Popover = PopoverPrimitive.Root;
export const PopoverTrigger = PopoverPrimitive.Trigger;
export const PopoverAnchor = PopoverPrimitive.Anchor;

export function PopoverContent({
  className,
  align = "center",
  sideOffset = 8,
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Content>) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        data-ui="popover"
        align={align}
        sideOffset={sideOffset}
        collisionPadding={8}
        className={cn("kit-pop z-50 w-72 p-4 outline-none", surface, className)}
        {...props}
      />
    </PopoverPrimitive.Portal>
  );
}

// ------------------------------------------------------------------ menu

export const Menu = MenuPrimitive.Root;

export function MenuTrigger(props: React.ComponentProps<typeof MenuPrimitive.Trigger>) {
  return <MenuPrimitive.Trigger data-ui="menu-trigger" {...props} />;
}

export function MenuContent({
  className,
  sideOffset = 6,
  align = "start",
  ...props
}: React.ComponentProps<typeof MenuPrimitive.Content>) {
  return (
    <MenuPrimitive.Portal>
      <MenuPrimitive.Content
        data-ui="menu"
        sideOffset={sideOffset}
        align={align}
        collisionPadding={8}
        className={cn("kit-pop kit-instant-out z-50 min-w-48 overflow-hidden p-1.5 outline-none", surface, className)}
        {...props}
      />
    </MenuPrimitive.Portal>
  );
}

/** A menu entry. Icons go first in the children; `tone="danger"` for deleting and the like. */
export function MenuItem({
  className,
  tone = "default",
  ...props
}: React.ComponentProps<typeof MenuPrimitive.Item> & {
  tone?: "default" | "danger";
}) {
  return (
    <MenuPrimitive.Item
      data-ui="menu-item"
      className={cn(
        "relative flex h-9 cursor-default items-center gap-2.5 rounded-lg px-2.5 text-sm font-medium outline-none select-none",
        "data-[disabled]:pointer-events-none data-[disabled]:opacity-45 data-[highlighted]:bg-beige-100",
        "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        tone === "danger" ? "text-red [&_svg]:text-red" : "[&_svg]:text-grey-500",
        className,
      )}
      {...props}
    />
  );
}

/** A hint at the end of a menu entry: a shortcut, say. */
export function MenuShortcut({ className, ...props }: React.ComponentProps<"span">) {
  return <span className={cn("ml-auto pl-4 text-xs font-normal text-grey-500 tabular-nums", className)} {...props} />;
}

export function MenuLabel({ className, ...props }: React.ComponentProps<typeof MenuPrimitive.Label>) {
  return <MenuPrimitive.Label className={cn("px-2.5 py-2 text-sm", className)} {...props} />;
}

export function MenuSeparator({ className, ...props }: React.ComponentProps<typeof MenuPrimitive.Separator>) {
  return <MenuPrimitive.Separator className={cn("-mx-1.5 my-1.5 h-px bg-beige-500/25", className)} {...props} />;
}

// ------------------------------------------------------------------ dialog

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

const DIALOG_WIDTHS = {
  sm: "sm:max-w-[420px]",
  md: "sm:max-w-[520px]",
  lg: "sm:max-w-[620px]",
  xl: "sm:max-w-[760px]",
};

function Overlay() {
  return <DialogPrimitive.Overlay className="kit-fade fixed inset-0 z-50 bg-grey-900/45 backdrop-blur-[2px]" />;
}

function CloseButton({ className }: { className?: string }) {
  return (
    <DialogPrimitive.Close
      className={buttonClasses({
        variant: "ghost",
        size: "icon-md",
        className: cn("absolute top-4 right-4", className),
      })}
    >
      <X />
      <span className="sr-only">Close</span>
    </DialogPrimitive.Close>
  );
}

/**
 * A centred card over a dimmed page. The title (required: screen readers
 * announce it) and description are props; pass `titleHidden` when the
 * content shows its own heading.
 */
export function DialogContent({
  title,
  description,
  titleHidden = false,
  size = "md",
  className,
  children,
  ...props
}: Omit<React.ComponentProps<typeof DialogPrimitive.Content>, "title"> & {
  title: React.ReactNode;
  description?: React.ReactNode;
  titleHidden?: boolean;
  size?: keyof typeof DIALOG_WIDTHS;
}) {
  return (
    <DialogPrimitive.Portal>
      <Overlay />
      <DialogPrimitive.Content
        data-ui="dialog"
        // Without a description, say so (Radix otherwise expects one).
        {...(description ? {} : { "aria-describedby": undefined })}
        className={cn(
          "kit-pop fixed top-1/2 left-1/2 z-50 grid max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 gap-5 overflow-y-auto rounded-2xl bg-white p-6 shadow-float outline-none sm:p-7",
          DIALOG_WIDTHS[size],
          className,
        )}
        {...props}
      >
        <div className={cn("grid gap-1.5 pr-10", titleHidden && "sr-only")}>
          <DialogPrimitive.Title className="text-xl leading-tight font-bold">{title}</DialogPrimitive.Title>
          {description ? (
            <DialogPrimitive.Description className="text-sm leading-relaxed text-grey-500">
              {description}
            </DialogPrimitive.Description>
          ) : null}
        </div>
        {children}
        <CloseButton />
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

/** The row of buttons at the bottom of a dialog: right-aligned, stacked on phones. */
export function DialogFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn("flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-end", className)}
      {...props}
    />
  );
}

// ------------------------------------------------------------------ confirm

/** "Are you sure?" for things that can't be undone. Escape and Cancel back out. */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  cancelLabel = "Cancel",
  tone = "danger",
  pending = false,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: React.ReactNode;
  description?: React.ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  tone?: "danger" | "primary";
  pending?: boolean;
  onConfirm: () => void;
}) {
  return (
    <AlertPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <AlertPrimitive.Portal>
        <AlertPrimitive.Overlay className="kit-fade fixed inset-0 z-50 bg-grey-900/45 backdrop-blur-[2px]" />
        <AlertPrimitive.Content
          data-ui="confirm"
          className="kit-pop fixed top-1/2 left-1/2 z-50 grid w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 gap-5 rounded-2xl bg-white p-6 shadow-float outline-none sm:max-w-[420px] sm:p-7"
        >
          <div className="grid gap-1.5">
            <AlertPrimitive.Title className="text-xl leading-tight font-bold">{title}</AlertPrimitive.Title>
            {description ? (
              <AlertPrimitive.Description className="text-sm leading-relaxed text-grey-500">
                {description}
              </AlertPrimitive.Description>
            ) : null}
          </div>
          <DialogFooter>
            <AlertPrimitive.Cancel className={buttonClasses({ variant: "secondary", size: "lg" })}>
              {cancelLabel}
            </AlertPrimitive.Cancel>
            <Button
              variant={tone === "danger" ? "danger" : "primary"}
              size="lg"
              loading={pending}
              onClick={(e) => {
                e.preventDefault(); // stays open until the caller closes it
                onConfirm();
              }}
            >
              {confirmLabel}
            </Button>
          </DialogFooter>
        </AlertPrimitive.Content>
      </AlertPrimitive.Portal>
    </AlertPrimitive.Root>
  );
}

// ------------------------------------------------------------------ side panel

/**
 * A panel that slides in from the side. With `modal={false}` the page behind
 * stays usable (no dimming, focus isn't trapped). Give it a `title`, or put a
 * <SidePanelTitle> in the content and leave `title` out.
 */
export function SidePanel({
  open,
  onOpenChange,
  modal = true,
  title,
  description,
  side = "right",
  className,
  children,
  ...props
}: Omit<React.ComponentProps<typeof DialogPrimitive.Content>, "title"> & {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  modal?: boolean;
  title?: React.ReactNode;
  description?: React.ReactNode;
  side?: "right" | "left";
}) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange} modal={modal}>
      <DialogPrimitive.Portal>
        {modal ? <Overlay /> : null}
        <DialogPrimitive.Content
          data-ui="side-panel"
          className={cn(
            "fixed inset-y-0 z-50 flex h-full w-full flex-col bg-white shadow-float outline-none sm:max-w-sm",
            side === "right" ? "kit-slide-right right-0" : "kit-slide-left left-0",
            className,
          )}
          {...props}
        >
          {title ? (
            <div className="grid gap-1.5 p-5 pr-14 pb-3">
              <SidePanelTitle>{title}</SidePanelTitle>
              {description ? <SidePanelDescription>{description}</SidePanelDescription> : null}
            </div>
          ) : null}
          {children}
          <CloseButton className="top-3.5 right-3.5" />
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

export function SidePanelTitle({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return <DialogPrimitive.Title className={cn("text-xl leading-tight font-bold", className)} {...props} />;
}

export function SidePanelDescription({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return <DialogPrimitive.Description className={cn("text-sm leading-relaxed text-grey-500", className)} {...props} />;
}
