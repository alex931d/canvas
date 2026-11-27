"use client";

import { CircleCheck, CircleX, Loader2, Plus, Sparkles, Trash2 } from "lucide-react";
import { useId, useMemo, useRef, useState } from "react";
import { Badge, Button, Label } from "@/components/kit";
import { proofFigure } from "@/lib/math/figures";
import { lintProof, PROOF_REASONS, type Proof, type ProofVerdict } from "@/lib/math/proof";
import { cn } from "@/lib/utils";
import { AddButton, ErrorLine, Examples, type Place } from "./shared";

const SYMBOLS = ["≅", "∠", "△", "∥", "⊥", "°", "≠", "≤", "≥", "√", "π", "∴"];

const EXAMPLES: { label: string; value: Proof }[] = [
  {
    label: "Congruent triangles (SSS)",
    value: {
      given: "AB ≅ CD; BC ≅ DA",
      prove: "△ABC ≅ △CDA",
      rows: [
        { statement: "AB ≅ CD", reason: "Given" },
        { statement: "BC ≅ DA", reason: "Given" },
        { statement: "AC ≅ CA", reason: "Reflexive property" },
        { statement: "△ABC ≅ △CDA", reason: "SSS" },
      ],
    },
  },
  {
    label: "Vertical angles",
    value: {
      given: "∠1 and ∠2 are a linear pair; ∠2 and ∠3 are a linear pair",
      prove: "∠1 ≅ ∠3",
      rows: [
        { statement: "∠1 and ∠2 are a linear pair", reason: "Given" },
        { statement: "∠2 and ∠3 are a linear pair", reason: "Given" },
        { statement: "m∠1 + m∠2 = 180°", reason: "Linear pair postulate" },
        { statement: "m∠2 + m∠3 = 180°", reason: "Linear pair postulate" },
        { statement: "m∠1 + m∠2 = m∠2 + m∠3", reason: "Substitution" },
        { statement: "m∠1 = m∠3", reason: "Subtraction property of equality" },
        { statement: "∠1 ≅ ∠3", reason: "Definition of congruence" },
      ],
    },
  },
  {
    label: "Algebra",
    value: {
      given: "3(x − 2) = 12",
      prove: "x = 6",
      rows: [
        { statement: "3(x − 2) = 12", reason: "Given" },
        { statement: "3x − 6 = 12", reason: "Distributive property" },
        { statement: "3x = 18", reason: "Addition property of equality" },
        { statement: "x = 6", reason: "Division property of equality" },
      ],
    },
  },
];

const BLANK: Proof = { given: "", prove: "", rows: [{ statement: "", reason: "Given" }, { statement: "", reason: "" }] };

type Check = { status: "idle" } | { status: "checking" } | { status: "done"; verdict: ProofVerdict; for: string } | { status: "error"; error: string };

export function ProofTool({ place, canInsert }: { place: Place; canInsert: boolean }) {
  const [proof, setProof] = useState<Proof>(EXAMPLES[0].value);
  const [check, setCheck] = useState<Check>({ status: "idle" });
  const lastField = useRef<HTMLInputElement | null>(null);
  const reasonsId = useId();

  const issues = useMemo(() => lintProof(proof), [proof]);
  const key = JSON.stringify(proof);
  // A verdict only applies to the proof it was given.
  const verdict = check.status === "done" && check.for === key ? check.verdict : null;
  const rowsShown = proof.rows;

  const update = (patch: Partial<Proof>) => setProof((p) => ({ ...p, ...patch }));
  const setRow = (i: number, patch: Partial<Proof["rows"][number]>) =>
    setProof((p) => ({ ...p, rows: p.rows.map((r, j) => (j === i ? { ...r, ...patch } : r)) }));

  /** Types a symbol where the cursor was last. */
  const insertSymbol = (sym: string) => {
    const el = lastField.current;
    if (!el) return;
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? start;
    const next = el.value.slice(0, start) + sym + el.value.slice(end);
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    setter?.call(el, next);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.focus();
    requestAnimationFrame(() => el.setSelectionRange(start + sym.length, start + sym.length));
  };

  async function runCheck() {
    setCheck({ status: "checking" });
    try {
      const res = await fetch("/api/check-proof", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...proof, rows: proof.rows.filter((r) => r.statement.trim() || r.reason.trim()) }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error ?? `Checking failed (${res.status}).`);
      setCheck({ status: "done", verdict: body as ProofVerdict, for: key });
    } catch (err) {
      setCheck({ status: "error", error: err instanceof Error && err.message !== "Failed to fetch" ? err.message : "The server is unreachable. Try again when you're back online." });
    }
  }

  const field = "h-10 w-full min-w-0 rounded-lg border border-beige-500 bg-white px-3 text-sm text-grey-900 outline-none focus-visible:border-grey-900 focus-visible:ring-[3px] focus-visible:ring-green/25";
  const track = { onFocus: (e: React.FocusEvent<HTMLInputElement>) => (lastField.current = e.currentTarget) };
  let filled = 0;

  return (
    <div className="flex flex-col gap-4">
      <Examples label="Examples" items={[...EXAMPLES, { label: "Start blank", value: BLANK }]} onPick={(v) => (setProof(structuredClone(v)), setCheck({ status: "idle" }))} />
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1">
          <Label htmlFor={`${reasonsId}-given`}>Given</Label>
          <input id={`${reasonsId}-given`} className={field} value={proof.given} onChange={(e) => update({ given: e.target.value })} placeholder="Separate them with ;" {...track} data-testid="proof-given" />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor={`${reasonsId}-prove`}>Prove</Label>
          <input id={`${reasonsId}-prove`} className={field} value={proof.prove} onChange={(e) => update({ prove: e.target.value })} {...track} data-testid="proof-prove" />
        </div>
      </div>

      <div className="flex flex-wrap gap-1" role="group" aria-label="Symbols">
        {SYMBOLS.map((s) => (
          <button
            key={s}
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => insertSymbol(s)}
            className="grid size-8 place-items-center rounded-md bg-beige-100 text-sm transition-colors hover:bg-beige-300 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            aria-label={`Type ${s}`}
          >
            {s}
          </button>
        ))}
      </div>

      <div className="overflow-hidden rounded-xl border border-beige-300">
        <div className="grid grid-cols-[2rem_1fr_1fr_2rem] gap-2 bg-beige-100 px-3 py-2 text-xs font-bold text-grey-500">
          <span />
          <span>Statements</span>
          <span>Reasons</span>
          <span />
        </div>
        <ol>
          {rowsShown.map((r, i) => {
            const blank = !r.statement.trim() && !r.reason.trim();
            const n = blank ? null : ++filled;
            const line = n && verdict ? verdict.lines[n - 1] : null;
            return (
              <li key={i} className={cn("border-t border-beige-300 px-3 py-2", line && !line.ok && "bg-red/5")} data-testid="proof-row">
                <div className="grid grid-cols-[2rem_1fr_1fr_2rem] items-center gap-2">
                  <span className="flex items-center text-sm font-bold text-grey-500 tabular-nums">
                    {line ? line.ok ? <CircleCheck className="size-4 text-green" aria-label="Follows" /> : <CircleX className="size-4 text-red" aria-label="Doesn't follow" /> : `${i + 1}.`}
                  </span>
                  <input aria-label={`Statement ${i + 1}`} className={field} value={r.statement} onChange={(e) => setRow(i, { statement: e.target.value })} {...track} />
                  <input aria-label={`Reason ${i + 1}`} className={field} value={r.reason} onChange={(e) => setRow(i, { reason: e.target.value })} list={reasonsId} {...track} />
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Remove line ${i + 1}`}
                    disabled={proof.rows.length <= 1}
                    onClick={() => setProof((p) => ({ ...p, rows: p.rows.filter((_, j) => j !== i) }))}
                  >
                    <Trash2 />
                  </Button>
                </div>
                {line && !line.ok && line.note ? <p className="mt-1 ml-10 text-xs text-red">{line.note}</p> : null}
              </li>
            );
          })}
        </ol>
        <datalist id={reasonsId}>
          {PROOF_REASONS.flatMap((g) => g.reasons).map((r) => (
            <option key={r} value={r} />
          ))}
        </datalist>
        <div className="border-t border-beige-300 px-3 py-2">
          <Button variant="ghost" size="sm" onClick={() => setProof((p) => ({ ...p, rows: [...p.rows, { statement: "", reason: "" }] }))}>
            <Plus /> Add a line
          </Button>
        </div>
      </div>

      {issues.length ? (
        <ul className="flex list-disc flex-col gap-1 pl-5 text-sm text-grey-700" data-testid="proof-issues">
          {issues.slice(0, 4).map((x, i) => (
            <li key={i}>{x.message}</li>
          ))}
        </ul>
      ) : null}

      {verdict ? (
        <div className={cn("rounded-xl p-4 text-sm", verdict.valid ? "bg-green/10" : "bg-red/5")} role="status" data-testid="proof-verdict">
          <Badge tone={verdict.valid ? "green" : "red"}>{verdict.valid ? "The proof holds" : "Not there yet"}</Badge>
          <p className="mt-2">{verdict.summary}</p>
        </div>
      ) : check.status === "error" ? (
        <ErrorLine>{check.error}</ErrorLine>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Button onClick={() => void runCheck()} disabled={check.status === "checking" || !proof.prove.trim()} className="bg-green hover:bg-[#1f6965]" data-testid="proof-check">
          {check.status === "checking" ? <Loader2 className="animate-spin" /> : <Sparkles />} Check with AI
        </Button>
        <AddButton testId="proof-add" disabled={!canInsert || !proof.rows.some((r) => r.statement.trim())} onClick={() => void place((ink) => proofFigure(proof, verdict, ink))}>
          Add to canvas
        </AddButton>
      </div>
      <p className="text-xs text-muted-foreground">The AI checks that each line follows from the ones before it by the reason you gave. It can be wrong, so read its notes as hints.</p>
    </div>
  );
}
