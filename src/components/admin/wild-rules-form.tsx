"use client";

import { useActionState, useState } from "react";
import { saveWildPandas, type WildActionState } from "@/app/admin/actions";
import { FormError, FormNotice } from "@/components/auth/form-parts";
import { RarityBadge } from "@/components/buddy/rarity-badge";
import { Button, Input, Label, Switch } from "@/components/kit";
import { RARITIES, RARITY, type Rarity } from "@/lib/buddy/kinds";
import {
  apartText,
  DEFAULT_RULES,
  fieldName,
  firstLevel,
  formValue,
  KIND_FIELDS,
  LIMITS,
  RULE_LABELS,
  sharesAt,
  TOP_LEVEL,
  type KindField,
  type WildRules,
} from "@/lib/buddy/rules";
import { cn } from "@/lib/utils";

/**
 * Admins set how wild pandas turn up and battle, for everyone
 * (src/lib/buddy/rules.ts). The numbers are typed as whole numbers (percents
 * for chances); what they add up to is shown as they're typed, and the
 * server checks them again.
 */

type Values = Record<string, string>;
type Field = keyof typeof LIMITS;
const TOP_FIELDS = ["chance", "gapMinutes", "stayMinutes"] as const;

function valuesOf(rules: WildRules): Values {
  const v: Values = { on: rules.on ? "on" : "" };
  for (const f of TOP_FIELDS) v[f] = String(formValue(rules, f));
  for (const r of RARITIES) for (const f of KIND_FIELDS) v[fieldName(f, r)] = String(formValue(rules, f, r));
  return v;
}

const same = (a: Values, b: Values) => Object.keys(b).every((k) => a[k] === b[k]);

/** The rules the typed values add up to, or null while any is out of range. */
function rulesOf(v: Values): WildRules | null {
  const read = (field: Field, rarity?: Rarity) => {
    const text = (v[fieldName(field, rarity)] ?? "").trim();
    const limit = LIMITS[field];
    if (!/^-?\d+$/.test(text)) return null;
    const n = Number(text);
    if (n < limit.min || n > limit.max) return null;
    return "percent" in limit ? n / 100 : n;
  };
  const top = TOP_FIELDS.map((f) => read(f));
  const kinds = RARITIES.map((r) => KIND_FIELDS.map((f) => read(f, r)));
  if (top.some((n) => n === null) || kinds.some((k) => k.some((n) => n === null))) return null;
  return {
    on: v.on === "on",
    chance: top[0]!,
    gapMinutes: top[1]!,
    stayMinutes: top[2]!,
    kinds: Object.fromEntries(
      RARITIES.map((r, i) => [r, Object.fromEntries(KIND_FIELDS.map((f, j) => [f, kinds[i][j]!]))]),
    ) as WildRules["kinds"],
  };
}

const pct = (n: number) => `${Math.round(n * 100)} %`;
const minutes = (n: number) => `${n} ${n === 1 ? "minute" : "minutes"}`;

const HINTS: Record<KindField, string> = {
  weight: `Against the other kinds someone can meet; the share is at level ${TOP_LEVEL}. 0: never.`,
  minLevel: "Members' study level before these turn up.",
  levelBonus: "How far above the member's level they come.",
  catchRate: "Chance bamboo is taken at its last breath.",
  flee: "Each turn from the second.",
};

export function WildRulesForm({ rules, changed }: { rules: WildRules; changed: React.ReactNode }) {
  const [state, action, pending] = useActionState<WildActionState, FormData>(saveWildPandas, {});
  const [base, setBase] = useState(() => valuesOf(rules));
  const [values, setValues] = useState(base);
  // A save (or reset) went through: what was saved is the new starting point.
  const [seen, setSeen] = useState(state);
  if (state !== seen) {
    setSeen(state);
    if (state.saved) {
      const next = valuesOf(state.saved);
      setBase(next);
      setValues(next);
    }
  }

  const set = (name: string, value: string) => setValues((v) => ({ ...v, [name]: value }));
  const errors = state.fieldErrors ?? {};
  const live = rulesOf(values);
  const unchanged = same(values, base);
  const atDefaults = same(values, valuesOf(DEFAULT_RULES)) && same(base, valuesOf(DEFAULT_RULES));
  const shares = live ? sharesAt(TOP_LEVEL, live.kinds) : null;
  const from = live ? firstLevel(live.kinds) : null;

  const number = (field: Field, rarity?: Rarity, label?: string) => {
    const name = fieldName(field, rarity);
    const limit = LIMITS[field];
    const error = errors[name];
    const id = `wild-${name.replace(".", "-")}`;
    return (
      <div className="grid gap-1">
        <div className="relative">
          <Input
            id={id}
            name={name}
            type="number"
            inputMode="numeric"
            fieldSize="sm"
            min={limit.min}
            max={limit.max}
            step={1}
            value={values[name] ?? ""}
            onChange={(e) => set(name, e.target.value)}
            aria-label={label}
            aria-invalid={!!error}
            aria-describedby={error ? `${id}-error` : undefined}
            className={cn("w-full tabular-nums", "percent" in limit && "pr-7", error && "border-destructive")}
          />
          {"percent" in limit ? (
            <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-xs text-grey-500" aria-hidden>
              %
            </span>
          ) : null}
        </div>
        {error ? (
          <p id={`${id}-error`} className="text-xs text-destructive">
            {error}
          </p>
        ) : null}
      </div>
    );
  };

  const th = "px-2 py-2 text-left align-bottom text-xs font-normal text-grey-500 first:pl-0";
  const td = "px-2 py-2.5 align-top first:pl-0";

  return (
    <form action={action} noValidate className="grid min-w-0 gap-6" data-testid="wild-rules-form">
      <FormError message={state.error} />
      <FormNotice message={state.ok} />

      <div className="flex items-start justify-between gap-6 rounded-lg bg-beige-100 px-4 py-3.5">
        <div>
          <p id="wild-on-label" className="text-sm font-bold">
            Wild pandas turn up
          </p>
          <p className="mt-0.5 text-xs text-grey-500">
            Off: no new ones for anyone. Any already out stay until their time is up, and battles finish.
          </p>
        </div>
        <Switch
          name="on"
          checked={values.on === "on"}
          onCheckedChange={(on) => set("on", on ? "on" : "")}
          aria-labelledby="wild-on-label"
        />
      </div>

      {/* min-w-0: a fieldset is otherwise as wide as its widest content, and the table below would stretch the page on a phone. */}
      <fieldset className="grid min-w-0 gap-3">
        <legend className="mb-3 text-sm font-bold">How often</legend>
        <div className="grid gap-4 sm:grid-cols-3">
          {TOP_FIELDS.map((f) => (
            <div key={f} className="grid content-start gap-1.5">
              <Label htmlFor={`wild-${f}`}>{RULE_LABELS[f]}</Label>
              {number(f)}
              <span className="text-xs text-grey-500">
                {f === "chance"
                  ? "That one turns up, each time it may."
                  : f === "gapMinutes"
                    ? "From when the last one turned up or left."
                    : "Before it wanders off, unless it's in a battle."}
              </span>
            </div>
          ))}
        </div>
        <p className="text-sm" data-testid="wild-summary" aria-live="polite">
          {!live
            ? "Fix the numbers to see what they add up to."
            : values.on !== "on"
              ? "Switched off: no new wild pandas turn up."
              : from === null
                ? "No kind is set to turn up."
                : `With a drawing open, ${apartText(live)}, staying ${minutes(live.stayMinutes)}${
                    from > 1 ? `, for members from level ${from}` : ""
                  }.`}
        </p>
      </fieldset>

      <fieldset className="min-w-0">
        <legend className="mb-3 text-sm font-bold">Each kind</legend>
        <div className="relative overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="border-b border-grey-100">
              <tr>
                <th scope="col" className={th}>
                  Kind
                </th>
                {KIND_FIELDS.map((f) => (
                  <th key={f} scope="col" className={cn(th, "w-[17%]")}>
                    <span className="block font-bold text-grey-900">{RULE_LABELS[f]}</span>
                    <span className="block leading-snug">{HINTS[f]}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-grey-100">
              {RARITIES.map((r) => (
                <tr key={r} data-testid="wild-kind" data-rarity={r}>
                  <th scope="row" className={cn(td, "text-left font-normal")}>
                    <span className="flex flex-wrap items-center gap-2 pt-1.5">
                      <span className="font-bold">{RARITY[r].coat.name}</span>
                      <RarityBadge rarity={r} />
                    </span>
                  </th>
                  {KIND_FIELDS.map((f) => (
                    <td key={f} className={td}>
                      {number(f, r, `${RARITY[r].label}: ${RULE_LABELS[f].toLowerCase()}`)}
                      {f === "weight" && shares ? (
                        <span className="mt-1 block text-xs text-grey-500 tabular-nums" data-testid="wild-share">
                          {shares[r] > 0 ? `${pct(shares[r])} of them` : "never"}
                        </span>
                      ) : null}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 max-w-[46rem] text-xs leading-relaxed text-grey-500">
          New wild pandas follow the new numbers straight away. A battle keeps the bamboo and running-off chances it
          started with.
        </p>
      </fieldset>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-grey-500">{changed}</p>
        {/* Save comes first, so Enter in a field saves (it's shown on the right). */}
        <div className="flex flex-col gap-2 sm:flex-row-reverse">
          <Button type="submit" size="lg" loading={pending} disabled={unchanged} className="sm:w-56">
            Save wild pandas
          </Button>
          {/* Not name="reset": that would hide the form's reset(), which React calls after an action. */}
          <Button type="submit" name="intent" value="defaults" variant="secondary" size="lg" disabled={pending || atDefaults}>
            Reset to defaults
          </Button>
        </div>
      </div>
    </form>
  );
}
