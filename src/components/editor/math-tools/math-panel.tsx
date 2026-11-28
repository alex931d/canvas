"use client";

import { SidePanel, Tab, TabList, Tabs } from "@/components/kit";
import type { CanvasElement } from "@/lib/canvas/schema";
import { useAiAllowance } from "../ai-allowance";
import { ProofTool } from "./proof-tool";
import type { Place } from "./shared";
import { TriangleTool } from "./triangle-tool";
import { TrigTool } from "./trig-tool";
import { WorksheetTool } from "./worksheet-tool";

export type MathTab = "triangle" | "trig" | "proof" | "worksheet";

/**
 * Math tools beside the canvas (members only): a triangle solver, exact
 * trig values on the unit circle, a two-column proof builder the AI can
 * check, and worksheets. Results go on the canvas as figures made of
 * ordinary elements. Non-modal, like the chemistry panel.
 */
export function MathPanel({
  open,
  onOpenChange,
  tab,
  onTabChange,
  place,
  canInsert,
  elements,
  getSelection,
  title,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tab: MathTab;
  onTabChange: (tab: MathTab) => void;
  place: Place;
  canInsert: boolean;
  elements: readonly CanvasElement[];
  getSelection: () => string[];
  title: string;
}) {
  const ai = useAiAllowance(open);
  return (
    <SidePanel
      open={open}
      onOpenChange={onOpenChange}
      modal={false}
      title="Math tools"
      description="Solve triangles, find exact trig values, write proofs and make worksheets. Everything can go on the canvas."
      className="overflow-y-auto sm:max-w-[680px]"
      onInteractOutside={(e) => e.preventDefault()}
      data-scrollable
      data-testid="math-panel"
    >
      <Tabs value={tab} onValueChange={(v) => onTabChange(v as MathTab)} className="gap-4 px-5 pb-6">
        <TabList className="w-full overflow-x-auto">
          <Tab value="triangle">Triangles</Tab>
          <Tab value="trig">Trig</Tab>
          <Tab value="proof">Proofs</Tab>
          <Tab value="worksheet">Worksheet</Tab>
        </TabList>
        <Kept value="triangle" tab={tab}>
          <TriangleTool place={place} canInsert={canInsert} />
        </Kept>
        <Kept value="trig" tab={tab}>
          <TrigTool place={place} canInsert={canInsert} />
        </Kept>
        <Kept value="proof" tab={tab}>
          <ProofTool place={place} canInsert={canInsert} />
        </Kept>
        <Kept value="worksheet" tab={tab}>
          <WorksheetTool place={place} canInsert={canInsert} elements={elements} getSelection={getSelection} title={title} />
        </Kept>
        {ai ? (
          <p className="text-xs text-muted-foreground" data-testid="ai-left">
            {ai.left} of {ai.limit} AI checks and worksheets left this month. Triangles, trig and printing don’t use any.
          </p>
        ) : null}
      </Tabs>
    </SidePanel>
  );
}

/** A tab's content that stays mounted while hidden, so a half-written proof survives a look at another tab. */
function Kept({ value, tab, children }: { value: MathTab; tab: MathTab; children: React.ReactNode }) {
  return (
    <div role="tabpanel" hidden={value !== tab} aria-label={value} className="outline-none">
      {children}
    </div>
  );
}
