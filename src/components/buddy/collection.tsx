"use client";

import { House, Lock } from "lucide-react";
import Link from "next/link";
import { useRef, useState } from "react";
import { Button, Switch, toast } from "@/components/kit";
import { kindOf, partyIdFor, type CaughtBuddy } from "@/lib/buddy/game";
import { ABILITY, BAMBOO, RARITIES, RARITY, type Rarity } from "@/lib/buddy/kinds";
import type { WildOpenings } from "@/lib/buddy/rules";
import { accessoriesFor, BUDDY_COLORS, MAX_BUDDIES, type BuddySettings } from "@/lib/buddy/shared";
import { cn } from "@/lib/utils";
import { Panda } from "./panda";
import { RarityBadge } from "./rarity-badge";

/**
 * The buddies page: who's walking with you, every panda you've caught (each
 * can come along, three at a time), and a field guide to the rarities and how
 * catching works.
 */

/** The canvas's dotted paper, behind each panda. */
const PAPER = {
  backgroundImage: "radial-gradient(circle, #d8d1ca 1px, transparent 1.2px)",
  backgroundSize: "14px 14px",
};

const ABOUT: Record<Rarity, string> = {
  common: "The pandas you'll meet most. Easy to catch.",
  uncommon: "A little tougher, and now and then they slip away.",
  rare: "Stronger than you'd expect, and harder to catch.",
  superRare: "Strongest of all, and the hardest to catch.",
};

const caughtOn = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });

export function BuddyCollection({
  settings: initial,
  collection,
  level,
  bamboo,
  stats,
  wild,
}: {
  settings: BuddySettings;
  collection: CaughtBuddy[];
  level: number;
  bamboo: number;
  stats: { caught: number; won: number };
  /** Whether wild pandas turn up, and from which level each kind does (src/lib/buddy/rules.ts). */
  wild: WildOpenings;
}) {
  const [settings, setSettings] = useState(initial);
  const latest = useRef(initial);
  const [saving, setSaving] = useState<string | null>(null);
  const accessories = accessoriesFor(level);
  const out = new Set(settings.buddies.flatMap((b) => (b.catchId ? [b.catchId] : [])));
  const full = settings.buddies.length >= MAX_BUDDIES;

  const saveParty = async (next: BuddySettings, what: string) => {
    const before = latest.current;
    latest.current = next;
    setSettings(next);
    setSaving(what);
    try {
      const res = await fetch("/api/buddy", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(next),
      });
      if (!res.ok) {
        const json = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(json?.error ?? "That didn't save. Try again.");
      }
    } catch (e) {
      latest.current = before;
      setSettings(before);
      toast.error(e instanceof Error ? e.message : "That didn't save. Try again.");
    } finally {
      setSaving(null);
    }
  };

  const takeAlong = (c: CaughtBuddy) => {
    const s = latest.current;
    if (s.buddies.length >= MAX_BUDDIES || s.buddies.some((b) => b.catchId === c.id)) return;
    const color = BUDDY_COLORS.find((col) => !s.buddies.some((b) => b.color === col)) ?? BUDDY_COLORS[0];
    void saveParty(
      {
        ...s,
        buddies: [...s.buddies, { id: partyIdFor(c.id), name: c.name.slice(0, 24), color, x: null, y: null, catchId: c.id }],
      },
      c.id,
    );
  };
  const leaveHome = (catchId: string) => {
    const s = latest.current;
    if (s.buddies.length <= 1) return;
    void saveParty({ ...s, buddies: s.buddies.filter((b) => b.catchId !== catchId) }, catchId);
  };

  return (
    <div className="grid gap-6">
      {/* ------------------------------------------------ out with you */}
      <section aria-labelledby="party-title" className="rounded-xl bg-card p-5 md:p-8">
        <div className="mb-5 flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
          <h2 id="party-title" className="text-xl font-bold">
            Walking with you
          </h2>
          <p className="text-sm text-grey-500">
            Up to {MAX_BUDDIES} at a time. Names and scarves are in buddy settings, from your account menu.
          </p>
        </div>
        <ul className="grid gap-4 sm:grid-cols-3">
          {settings.buddies.map((b) => {
            const kind = kindOf(b, collection);
            return (
              <li key={b.id} className="flex items-center gap-4 rounded-xl bg-beige-100 p-3" data-testid="party-slot">
                <span className="grid size-20 shrink-0 place-items-center rounded-lg bg-white" style={PAPER}>
                  <span className="size-16">
                    <Panda color={b.color} accessories={accessories} coat={RARITY[kind.rarity].coat} />
                  </span>
                </span>
                <span className="grid min-w-0 flex-1 gap-1">
                  <span className="truncate font-bold">{b.name}</span>
                  <span className="flex flex-wrap items-center gap-1.5 text-xs text-grey-500">
                    <RarityBadge rarity={kind.rarity} />
                    {ABILITY[kind.ability].trick}
                  </span>
                  {b.catchId ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="-ml-2 justify-self-start"
                      disabled={settings.buddies.length <= 1 || saving !== null}
                      onClick={() => leaveHome(b.catchId!)}
                    >
                      <House /> Leave at home
                    </Button>
                  ) : null}
                </span>
              </li>
            );
          })}
          {Array.from({ length: MAX_BUDDIES - settings.buddies.length }, (_, i) => (
            <li
              key={`room-${i}`}
              className="grid min-h-[104px] place-items-center rounded-xl border-2 border-dashed border-beige-500/35 p-3 text-center text-sm text-grey-500"
            >
              {collection.some((c) => !out.has(c.id))
                ? "Room for one more: pick one from your collection."
                : "Room for one more."}
            </li>
          ))}
        </ul>
      </section>

      {/* ------------------------------------------------ caught */}
      <section aria-labelledby="caught-title" className="rounded-xl bg-card p-5 md:p-8">
        <div className="mb-5 flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
          <h2 id="caught-title" className="text-xl font-bold">
            Your collection
          </h2>
          <p className="text-sm text-grey-500" data-testid="buddy-stats">
            {stats.caught === 0 && stats.won === 0
              ? "Pandas you catch stay with you for good."
              : `You've caught ${stats.caught} ${stats.caught === 1 ? "panda" : "pandas"} and won ${stats.won} ${stats.won === 1 ? "battle" : "battles"}.`}
          </p>
        </div>
        {collection.length === 0 ? (
          <div className="grid justify-items-center gap-3 rounded-xl px-6 py-12 text-center" style={PAPER}>
            <span className="size-20 opacity-60" aria-hidden>
              <Panda pose="sleep" />
            </span>
            <h3 className="text-lg font-bold">No pandas caught yet</h3>
            <p className="max-w-md text-sm leading-relaxed text-grey-500">
              {wild.on
                ? "Keep a drawing open and one will wander onto it before long. Press it to battle, then offer bamboo."
                : "Wild pandas are taking a break just now. When they're back, keep a drawing open and one will wander onto it."}
            </p>
            <Button asChild variant="secondary" size="sm">
              <Link href="/">Open your drawings</Link>
            </Button>
          </div>
        ) : (
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {collection.map((c) => {
              const walking = out.has(c.id);
              const ability = ABILITY[c.ability];
              return (
                <li
                  key={c.id}
                  className="grid grid-rows-[auto_1fr] overflow-hidden rounded-xl bg-white ring-1 ring-beige-500/20"
                  data-testid="caught-buddy"
                  data-rarity={c.rarity}
                >
                  <div className="relative grid h-32 place-items-center" style={PAPER}>
                    <span className="size-24">
                      <Panda
                        coat={RARITY[c.rarity].coat}
                        pose={walking ? "happy" : "idle"}
                        color={settings.buddies.find((b) => b.catchId === c.id)?.color}
                        accessories={walking ? accessories : []}
                      />
                    </span>
                    <span className="absolute top-3 right-3">
                      <RarityBadge rarity={c.rarity} />
                    </span>
                  </div>
                  <div className="flex flex-col gap-2 p-4">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="truncate text-base font-bold" data-testid="caught-name">
                        {c.name}
                      </span>
                      <span className="shrink-0 text-xs font-semibold text-grey-500">Level {c.level}</span>
                    </div>
                    <p className="text-sm">
                      <span className="font-semibold">{ability.trick}.</span>{" "}
                      <span className="text-grey-500">{ability.text}</span>
                    </p>
                    <p className="text-xs text-grey-500">
                      In battle: <span className="font-semibold text-grey-900">{ability.move}</span>, {ability.moveText.toLowerCase()}
                    </p>
                    <div className="mt-auto flex items-center justify-between gap-3 border-t border-beige-500/20 pt-3">
                      <span className="text-xs text-grey-500">Caught {caughtOn(c.caughtAt)}</span>
                      <label className="flex items-center gap-2 text-sm font-semibold">
                        Out with you
                        <Switch
                          checked={walking}
                          disabled={saving !== null || (walking ? settings.buddies.length <= 1 : full)}
                          onCheckedChange={(on) => (on ? takeAlong(c) : leaveHome(c.id))}
                          aria-label={`${c.name} walks with you`}
                        />
                      </label>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        {collection.length > 0 && full ? (
          <p className="mt-4 text-sm text-grey-500">
            Three are out with you. Leave one at home to take another along.
          </p>
        ) : null}
      </section>

      {/* ------------------------------------------------ field guide */}
      <section aria-labelledby="guide-title" className="rounded-xl bg-card p-5 md:p-8">
        <h2 id="guide-title" className="mb-1 text-xl font-bold">
          Field guide
        </h2>
        <p className="mb-6 text-sm text-grey-500">
          You&apos;re level {level}. Rarer pandas start turning up as you study more.
        </p>
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {RARITIES.map((r) => {
            const info = RARITY[r];
            const from = wild.from[r];
            const open = from !== null && level >= from;
            return (
              <li key={r} className="grid gap-3 rounded-xl bg-beige-100 p-4" data-testid="guide-rarity" data-open={open}>
                <span className="grid h-28 place-items-center rounded-lg bg-white" style={PAPER}>
                  <span className={cn("size-20", !open && "opacity-35 grayscale")}>
                    <Panda coat={info.coat} />
                  </span>
                </span>
                <span className="flex items-center justify-between gap-2">
                  <span className="font-bold">{info.coat.name}</span>
                  <RarityBadge rarity={r} />
                </span>
                <span className="text-sm leading-snug text-grey-500">{ABOUT[r]}</span>
                <span className={cn("flex items-center gap-1.5 text-xs font-semibold", open ? "text-green" : "text-grey-500")}>
                  {open ? null : <Lock className="size-3.5" aria-hidden />}
                  {open ? "You can meet these now" : from === null ? "Not turning up for now" : `From level ${from}`}
                </span>
              </li>
            );
          })}
        </ul>

        <div className="mt-8 grid gap-6 md:grid-cols-[minmax(0,1fr)_minmax(0,18rem)] md:gap-10">
          <div>
            <h3 className="mb-3 font-bold">How catching works</h3>
            <ol className="grid gap-3 text-sm leading-relaxed">
              {[
                `Now and then a wild panda wanders onto the drawing you have open. It stays ${wild.stayMinutes === 1 ? "a minute" : `${wild.stayMinutes} minutes`}; press it to battle.`,
                "Your buddies take turns: bump, swipe, stare it down, or use their own trick as a special move.",
                "Offer bamboo once it's tired. The more worn out it is, the likelier it takes it. Wear it out completely and it wanders off instead.",
                `A panda that takes the bamboo stays for good. Up to ${MAX_BUDDIES} walk with you; the rest wait here.`,
              ].map((text, i) => (
                <li key={i} className="grid grid-cols-[1.75rem_minmax(0,1fr)] gap-2">
                  <span className="grid size-6 place-items-center rounded-full bg-grey-900 text-xs font-bold text-white">
                    {i + 1}
                  </span>
                  <span>{text}</span>
                </li>
              ))}
            </ol>
          </div>
          <div className="self-start rounded-xl bg-grey-900 p-5 text-white" data-testid="bamboo">
            <h3 className="font-bold">Bamboo</h3>
            <p className="mt-2 text-sm leading-relaxed text-grey-300">
              You have <span className="font-bold text-white">{bamboo}</span>. You started with {BAMBOO.start}, and
              every {BAMBOO.perPoints} points of studying earns one more: a flashcard answered is 1 point, a to-do card
              moved to Done is 5.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
