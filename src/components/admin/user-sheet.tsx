"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { SidePanel } from "@/components/kit";

/**
 * The edit panel. Whether it's open is the `user` in the address: rows link
 * to it, and closing goes to the same address without it, so reloads and
 * Back keep the panel as it was. Closing starts at once rather than waiting
 * for the new address to load.
 */
export function UserSheet({ open, closeHref, children }: { open: boolean; closeHref: string; children: React.ReactNode }) {
  const router = useRouter();
  const [closing, setClosing] = useState(false);
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    setClosing(false);
  }
  return (
    <SidePanel
      open={open && !closing}
      onOpenChange={(next) => {
        if (next) return;
        setClosing(true);
        router.push(closeHref, { scroll: false });
      }}
      className="overflow-y-auto bg-beige-100 sm:max-w-[520px]"
      aria-describedby={undefined}
      // Focus the panel itself rather than selecting the name field, which a stray keypress would replace.
      onOpenAutoFocus={(e) => {
        e.preventDefault();
        (e.currentTarget as HTMLElement | null)?.focus();
      }}
    >
      {children}
    </SidePanel>
  );
}
