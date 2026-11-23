"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { Switch, toast } from "@/components/kit";
import type { BuddySettings } from "@/lib/buddy/shared";

type Toggle = "visible" | "wander" | "roam" | "tricks" | "wild";

/** How the study buddies behave, saved as soon as a switch changes. */
export function BuddiesSection({ initial, wildOn }: { initial: BuddySettings; wildOn: boolean }) {
  const [settings, setSettings] = useState(initial);
  const latest = useRef(initial);
  const [status, setStatus] = useState<"" | "saving" | "saved">("");
  const queue = useRef(Promise.resolve());

  const set = (key: Toggle, on: boolean) => {
    const before = latest.current;
    const next = { ...before, [key]: on };
    latest.current = next;
    setSettings(next);
    setStatus("saving");
    // One save at a time, in order, so a quick second change can't land first.
    queue.current = queue.current.then(async () => {
      try {
        const res = await fetch("/api/buddy", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(latest.current),
        });
        if (!res.ok) throw new Error(((await res.json().catch(() => null)) as { error?: string } | null)?.error);
        setStatus("saved");
      } catch (e) {
        latest.current = before;
        setSettings(before);
        setStatus("");
        toast.error(e instanceof Error && e.message ? e.message : "That didn't save. Try again.");
      }
    });
  };

  const rows: { key: Toggle; label: string; hint: string; disabled?: boolean }[] = [
    { key: "visible", label: "Show study buddies", hint: "Pandas that keep you company while you draw and study." },
    { key: "wander", label: "Let them wander about", hint: "Off: they stay exactly where you put them." },
    {
      key: "roam",
      label: "Walk on drawings",
      hint: settings.wander
        ? "On a drawing they climb onto the canvas and walk about on it, moving with it as you pan and zoom."
        : "Needs wandering about on.",
      disabled: !settings.wander,
    },
    { key: "tricks", label: "Do their tricks", hint: "Now and then: a sprint across the screen, a nap, a little dance." },
    {
      key: "wild",
      label: "Wild pandas on drawings",
      hint: wildOn
        ? "They turn up on your drawings now and then, to battle and catch."
        : "Taking a break for everyone just now. This switch is kept for when they're back.",
    },
  ];

  return (
    <div className="grid gap-6">
      <div className="flex items-baseline justify-between gap-4">
        <p className="text-sm text-grey-500">
          Names, scarves and the pandas you&apos;ve caught are on{" "}
          <Link href="/buddies" className="font-semibold text-green underline-offset-4 hover:underline">
            your buddies page
          </Link>
          .
        </p>
        <span role="status" data-testid="buddy-prefs-status" className="shrink-0 text-sm text-grey-500">
          {status === "saving" ? "Saving…" : status === "saved" ? "Saved" : ""}
        </span>
      </div>
      <div className="grid max-w-xl gap-5">
        {rows.map((r) => (
          <label
            key={r.key}
            className={`flex items-center justify-between gap-6 text-sm font-semibold ${r.disabled ? "text-grey-500" : ""}`}
          >
            <span>
              {r.label}
              <span className="block text-sm font-normal text-grey-500">{r.hint}</span>
            </span>
            <Switch
              id={`buddy-${r.key}`}
              checked={r.key === "roam" ? settings.roam && settings.wander : settings[r.key]}
              disabled={r.disabled}
              onCheckedChange={(on) => set(r.key, on)}
            />
          </label>
        ))}
      </div>
    </div>
  );
}
