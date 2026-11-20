"use client";

import { CalendarDays, Ban } from "lucide-react";
import { useActionState, useEffect, useState } from "react";
import { saveSeasonalTheme, type AdminActionState } from "@/app/admin/actions";
import { FormError, FormNotice, SubmitButton } from "@/components/auth/form-parts";
import { CandyCane, EasterEgg, JackOLantern } from "@/components/seasonal/art";
import { refreshSeasonalMode } from "@/components/seasonal/season-context";
import { THEME_INFO, THEME_MODES, type ThemeMode } from "@/lib/seasons";
import { cn } from "@/lib/utils";

const OPTIONS: Record<ThemeMode, { label: string; note: string; art: React.ReactNode }> = {
  auto: { label: "Automatic", note: "Follows the calendar", art: <CalendarDays className="size-8 text-green" /> },
  easter: {
    label: THEME_INFO.easter.label,
    note: "Show it now",
    art: <EasterEgg id="pick-easter" base="#f6b8c8" band="#e0789a" className="h-9 w-auto" />,
  },
  halloween: { label: THEME_INFO.halloween.label, note: "Show it now", art: <JackOLantern className="h-8 w-auto" /> },
  christmas: { label: THEME_INFO.christmas.label, note: "Show it now", art: <CandyCane className="h-10 w-auto" /> },
  off: { label: "Off", note: "No decorations", art: <Ban className="size-7 text-grey-500" /> },
};

/** Admins pick the site's seasonal theme (src/lib/seasons.ts). */
export function SeasonalThemeForm({ mode, changed }: { mode: ThemeMode; changed: React.ReactNode }) {
  const [state, action, pending] = useActionState<AdminActionState, FormData>(saveSeasonalTheme, {});
  const [picked, setPicked] = useState<ThemeMode>(mode);
  // Show the new theme on this page straight away (other browsers catch up within a minute).
  useEffect(() => {
    if (state.ok) void refreshSeasonalMode();
  }, [state]);
  return (
    <form action={action} className="grid gap-5">
      <FormError message={state.error} />
      <FormNotice message={state.ok} />
      <fieldset>
        <legend className="sr-only">Seasonal theme</legend>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          {THEME_MODES.map((m) => (
            <label
              key={m}
              className={cn(
                "flex cursor-pointer flex-col items-center gap-2 rounded-xl border-2 bg-white px-3 py-4 text-center transition-colors has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-ring/50",
                picked === m ? "border-grey-900" : "border-transparent ring-1 ring-beige-500/30 hover:ring-beige-500/60",
              )}
            >
              <input
                type="radio"
                name="mode"
                value={m}
                checked={picked === m}
                onChange={() => setPicked(m)}
                className="sr-only"
              />
              <span className="grid h-11 place-items-center">{OPTIONS[m].art}</span>
              <span className="text-sm font-bold">{OPTIONS[m].label}</span>
              <span className="text-xs text-grey-500">{OPTIONS[m].note}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-grey-500">{changed}</p>
        <div className="sm:w-56">
          <SubmitButton pending={pending} disabled={picked === mode}>
            Save theme
          </SubmitButton>
        </div>
      </div>
    </form>
  );
}
