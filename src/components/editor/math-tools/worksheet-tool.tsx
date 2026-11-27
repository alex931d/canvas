"use client";

import { Loader2, Printer, Shuffle, Sparkles, X } from "lucide-react";
import { useState } from "react";
import { Button, Label, Select, Switch, ToggleGroup, ToggleGroupItem } from "@/components/kit";
import type { CanvasElement } from "@/lib/canvas/schema";
import { worksheetFigure } from "@/lib/math/figures";
import {
  problemsFromElements,
  shuffled,
  withAnswers,
  WORKSHEET_LEVELS,
  type Worksheet,
  type WorksheetLevel,
  type WorksheetRequest,
} from "@/lib/math/worksheet";
import { Tex } from "../tex";
import { printWorksheet } from "./print-worksheet";
import { AddButton, ErrorLine, type Place } from "./shared";

/**
 * Worksheets from the drawing's equations, or practice problems on a topic,
 * with an answer key: printed (or saved as a PDF), or put on the canvas as
 * pages (frames) that present like slides.
 */

type Source = "drawing" | "topic";
const SPACE = { small: 70, medium: 130, large: 220 } as const;

async function ask(req: WorksheetRequest): Promise<Worksheet> {
  let res: Response;
  try {
    res = await fetch("/api/worksheet", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(req) });
  } catch {
    throw new Error("The server is unreachable. Try again when you're back online.");
  }
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.error ?? `The worksheet couldn't be made (${res.status}).`);
  return body as Worksheet;
}

export function WorksheetTool({
  place,
  canInsert,
  elements,
  getSelection,
  title,
}: {
  place: Place;
  canInsert: boolean;
  elements: readonly CanvasElement[];
  getSelection: () => string[];
  title: string;
}) {
  const [source, setSource] = useState<Source>("drawing");
  const [onlySelected, setOnlySelected] = useState(false);
  const [withKey, setWithKey] = useState(true);
  const [more, setMore] = useState(0);
  const [topic, setTopic] = useState("");
  const [level, setLevel] = useState<WorksheetLevel>("standard");
  const [count, setCount] = useState(8);
  const [space, setSpace] = useState<keyof typeof SPACE>("medium");
  const [sheet, setSheet] = useState<Worksheet | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selection = getSelection();
  const found = problemsFromElements(elements, onlySelected && selection.length ? new Set(selection) : undefined);

  async function make() {
    setBusy(true);
    setError(null);
    try {
      if (source === "topic") {
        setSheet(await ask({ mode: "topic", topic: topic.trim(), level, count }));
        return;
      }
      if (!found.length) {
        setError("There are no typed equations here yet. Add some with the equation tool (or pick a topic instead).");
        return;
      }
      const base: Worksheet = { title: `${title || "Drawing"}: practice`, instructions: "Show your work.", problems: found.map((prompt) => ({ prompt, answer: null })) };
      const [keyed, extra] = await Promise.all([
        withKey ? ask({ mode: "key", problems: found }) : null,
        more > 0 ? ask({ mode: "similar", problems: found, level, count: more }) : null,
      ]);
      setSheet({
        ...base,
        instructions: keyed?.instructions ?? base.instructions,
        problems: [...withAnswers(found, keyed), ...(extra?.problems.map((p) => (withKey ? p : { ...p, answer: null })) ?? [])],
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "The worksheet couldn't be made.");
    } finally {
      setBusy(false);
    }
  }

  const canMake = source === "topic" ? topic.trim().length >= 2 : found.length > 0;

  return (
    <div className="flex flex-col gap-4">
      <ToggleGroup value={source} onValueChange={(v) => (setSource(v as Source), setError(null))} aria-label="Problems from" size="md" className="self-start">
        <ToggleGroupItem value="drawing">From this drawing</ToggleGroupItem>
        <ToggleGroupItem value="topic">From a topic</ToggleGroupItem>
      </ToggleGroup>

      {source === "drawing" ? (
        <div className="flex flex-col gap-3 rounded-xl bg-beige-100 p-4 text-sm">
          <p data-testid="ws-found">
            {found.length === 0
              ? "No typed equations found."
              : `${found.length} equation${found.length === 1 ? "" : "s"} found, in reading order.`}
          </p>
          {selection.length ? (
            <label className="flex items-center justify-between gap-3">
              Only the selected ones
              <Switch checked={onlySelected} onCheckedChange={setOnlySelected} />
            </label>
          ) : null}
          <label className="flex items-center justify-between gap-3">
            Answer key, worked out by the AI
            <Switch checked={withKey} onCheckedChange={setWithKey} data-testid="ws-key" />
          </label>
          <label className="flex items-center justify-between gap-3">
            More practice problems like these
            <Select fieldSize="sm" className="w-24" value={String(more)} onChange={(e) => setMore(Number(e.target.value))} data-testid="ws-more">
              {[0, 2, 4, 6, 8, 10].map((n) => (
                <option key={n} value={n}>
                  {n === 0 ? "None" : n}
                </option>
              ))}
            </Select>
          </label>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <Label htmlFor="ws-topic">Topic</Label>
            <input
              id="ws-topic"
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              placeholder="e.g. solving quadratics by factoring, or right-triangle trig"
              maxLength={160}
              data-testid="ws-topic"
              className="h-11 rounded-lg border border-beige-500 bg-white px-3 text-sm text-grey-900 outline-none focus-visible:border-grey-900 focus-visible:ring-[3px] focus-visible:ring-green/25"
            />
          </div>
          <label className="flex items-center justify-between gap-3 text-sm">
            How many problems
            <Select fieldSize="sm" className="w-24" value={String(count)} onChange={(e) => setCount(Number(e.target.value))}>
              {[4, 6, 8, 10, 12, 15, 20].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </Select>
          </label>
        </div>
      )}

      {source === "topic" || more > 0 ? (
        <div className="flex items-center justify-between gap-3 text-sm">
          Level
          <ToggleGroup value={level} onValueChange={(v) => setLevel(v as WorksheetLevel)} aria-label="Level">
            {WORKSHEET_LEVELS.map((l) => (
              <ToggleGroupItem key={l.id} value={l.id}>
                {l.label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>
      ) : null}

      <Button onClick={() => void make()} disabled={busy || !canMake} className="self-start" data-testid="ws-make">
        {busy ? <Loader2 className="animate-spin" /> : source === "topic" || withKey || more ? <Sparkles /> : null} Make worksheet
      </Button>
      {error ? <ErrorLine>{error}</ErrorLine> : null}

      {sheet ? (
        <section className="flex flex-col gap-3 border-t border-beige-300 pt-4" aria-label="Worksheet preview">
          <input
            aria-label="Worksheet title"
            value={sheet.title}
            onChange={(e) => setSheet({ ...sheet, title: e.target.value.slice(0, 80) })}
            className="rounded-md bg-transparent text-lg font-bold outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <p className="text-sm text-grey-700">{sheet.instructions}</p>
          <ol className="flex flex-col divide-y divide-beige-300 rounded-xl border border-beige-300" data-testid="ws-problems">
            {sheet.problems.map((p, i) => (
              <li key={`${i}-${p.prompt}`} className="flex items-start gap-3 px-3 py-2.5 text-sm">
                <span className="w-6 shrink-0 font-bold tabular-nums">{i + 1}.</span>
                <span className="min-w-0 flex-1 overflow-x-auto">
                  <Tex latex={p.prompt} />
                  {p.answer ? (
                    <span className="mt-1 block text-xs text-grey-500" data-testid="ws-answer">
                      Answer: <Tex latex={p.answer} />
                    </span>
                  ) : null}
                </span>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Remove problem ${i + 1}`}
                  onClick={() => setSheet({ ...sheet, problems: sheet.problems.filter((_, j) => j !== i) })}
                >
                  <X />
                </Button>
              </li>
            ))}
          </ol>
          <div className="flex items-center justify-between gap-3 text-sm">
            Room to work
            <ToggleGroup value={space} onValueChange={(v) => setSpace(v as keyof typeof SPACE)} aria-label="Room to work">
              <ToggleGroupItem value="small">Less</ToggleGroupItem>
              <ToggleGroupItem value="medium">Some</ToggleGroupItem>
              <ToggleGroupItem value="large">Lots</ToggleGroupItem>
            </ToggleGroup>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              disabled={!sheet.problems.length}
              onClick={() => void printWorksheet(sheet, { workSpace: SPACE[space], key: true })}
              data-testid="ws-print"
            >
              <Printer /> Print or save as PDF
            </Button>
            <AddButton
              testId="ws-canvas"
              disabled={!canInsert || !sheet.problems.length}
              onClick={() => void place((ink, measure) => worksheetFigure(sheet, ink, measure, { workSpace: SPACE[space] }))}
            >
              Put on the canvas
            </AddButton>
            <Button variant="ghost" onClick={() => setSheet({ ...sheet, problems: shuffled(sheet.problems) })} disabled={sheet.problems.length < 2}>
              <Shuffle /> Shuffle
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            On the canvas each page is a frame, so it presents as a slide; the answer key is its own page beside it.
            {sheet.problems.some((p) => p.answer) ? " Check the AI's answers before handing it out." : ""}
          </p>
        </section>
      ) : null}
    </div>
  );
}
