"use client";

import { ChevronUp, Plus, Redo2, Search, Undo2 } from "lucide-react";
import { useState } from "react";
import { Kbd, Menu, MenuContent, MenuItem, MenuTrigger, Tip } from "@/components/kit";
import { cn } from "@/lib/utils";
import { ToolRegistry, type ActionId, type Tool, type ToolGroup } from "./tools";

const registry = ToolRegistry.shared;

/**
 * The tools, as a dock floating at the bottom of the board. Related tools
 * share a slot (pointer, shapes, insert) that shows the last one used:
 * press it to use that again; press it again, or its arrow, for the rest.
 * Undo and redo sit at the end, and the search finds anything by name (/).
 * View-only collaborators get select, lasso and pan.
 */
export function ToolDock({
  tool,
  onTool,
  onAction,
  readOnly,
  disabled,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onSearch,
}: {
  tool: Tool;
  onTool: (t: Tool) => void;
  onAction: (a: ActionId) => void;
  readOnly: boolean;
  disabled: boolean;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onSearch: () => void;
}) {
  // Each group's last-used tool. Kept in step with the tool however it was picked (keys, search).
  const [memory, setMemory] = useState<Record<string, Tool>>({});
  const [seen, setSeen] = useState(tool);
  if (seen !== tool) {
    setSeen(tool);
    const group = registry.groupOf(tool);
    if (group) setMemory((m) => ({ ...m, [group.id]: tool }));
  }
  const [open, setOpen] = useState<string | null>(null);

  const groups: ToolGroup[] = readOnly
    ? (registry.groups[0].items as Tool[]).map((id) => ({ id, label: registry.tool(id).label, items: [id] }))
    : [...registry.groups];

  const pick = (id: Tool | ActionId) => {
    setOpen(null);
    if (registry.isAction(id)) onAction(id);
    else onTool(id);
  };

  return (
    <div
      role="toolbar"
      aria-label="Tools"
      aria-disabled={disabled || undefined}
      data-testid="tool-dock"
      className={cn(
        "absolute bottom-3 left-1/2 z-20 flex -translate-x-1/2 items-center gap-0.5 rounded-2xl bg-grey-900 p-1.5 text-grey-300 shadow-float",
        disabled && "pointer-events-none opacity-60",
      )}
      onPointerDown={(e) => e.stopPropagation()}
    >
      {groups.map((group) => {
        const tools = group.items.filter((i): i is Tool => !registry.isAction(i));
        const active = group.items.includes(tool);
        const isInsert = group.id === "insert";
        // The tool the slot stands for: the active one, else the last used, else the first.
        const shown = active ? tool : (memory[group.id] ?? tools[0]);
        const def = registry.tool(shown);
        const many = group.items.length > 1;
        const labels = group.items.map((i) => (registry.isAction(i) ? registry.action(i).label : registry.tool(i).label));
        // Insert always opens its list (it holds different kinds of things); others use their tool first.
        const opensList = isInsert || (many && active);
        const Icon = isInsert && !active ? Plus : def.Icon;
        const label = isInsert && !active ? "Insert" : def.label;
        return (
          <div key={group.id} className="relative flex items-center" data-items={labels.join(",")}>
            <Tip content={many ? (opensList ? `${label}: more ${group.label.toLowerCase()}` : label) : label} shortcut={isInsert && !active ? undefined : def.key}>
              <button
                type="button"
                aria-label={label}
                aria-pressed={active}
                data-tool={isInsert && !active ? undefined : def.label}
                onClick={() => (opensList ? setOpen(open === group.id ? null : group.id) : onTool(shown))}
                className={cn(
                  "grid size-10 place-items-center rounded-xl outline-none transition-colors [&_svg]:size-5",
                  "focus-visible:ring-2 focus-visible:ring-green",
                  active ? "bg-beige-100 text-grey-900 [&_svg]:text-green" : "hover:bg-white/10 hover:text-white",
                )}
              >
                <Icon />
              </button>
            </Tip>
            {many ? (
              <Menu open={open === group.id} onOpenChange={(o) => setOpen(o ? group.id : null)}>
                <MenuTrigger asChild>
                  <button
                    type="button"
                    aria-label={`More ${group.label.toLowerCase()}`}
                    className="absolute -top-1 right-0 grid size-4 place-items-center rounded-full bg-grey-900 text-grey-300 outline-none hover:text-white focus-visible:ring-2 focus-visible:ring-green max-sm:hidden [&_svg]:size-3"
                  >
                    <ChevronUp />
                  </button>
                </MenuTrigger>
                {/* Above toasts, which also rise from the bottom. */}
                <MenuContent side="top" align="center" sideOffset={10} className="z-[80] w-60" data-testid={`tool-group-${group.id}`}>
                  {group.items.map((id) => {
                    const item = registry.isAction(id) ? registry.action(id) : registry.tool(id);
                    const on = id === tool;
                    return (
                      <MenuItem
                        key={id}
                        onSelect={() => pick(id)}
                        aria-current={on || undefined}
                        className={cn(on && "bg-beige-100 [&_svg]:text-green")}
                      >
                        <item.Icon /> <span className="flex-1">{item.label}</span>
                        <Kbd className="uppercase">{item.key}</Kbd>
                      </MenuItem>
                    );
                  })}
                </MenuContent>
              </Menu>
            ) : null}
          </div>
        );
      })}

      {readOnly ? null : (
        <>
          <span className="mx-1 h-6 w-px bg-white/15" aria-hidden />
          <DockButton label="Undo" shortcut="⌘Z" onClick={onUndo} disabled={!canUndo}>
            <Undo2 />
          </DockButton>
          <DockButton label="Redo" shortcut="⇧⌘Z" onClick={onRedo} disabled={!canRedo}>
            <Redo2 />
          </DockButton>
        </>
      )}
      <span className="mx-1 h-6 w-px bg-white/15 max-sm:hidden" aria-hidden />
      <DockButton label="Find a tool" shortcut="/" onClick={onSearch} className="max-sm:hidden" testId="tool-search-button">
        <Search />
      </DockButton>
    </div>
  );
}

function DockButton({
  label,
  shortcut,
  onClick,
  disabled,
  className,
  testId,
  children,
}: {
  label: string;
  shortcut?: string;
  onClick: () => void;
  disabled?: boolean;
  className?: string;
  testId?: string;
  children: React.ReactNode;
}) {
  return (
    <Tip content={label} shortcut={shortcut}>
      <button
        type="button"
        aria-label={label}
        onClick={onClick}
        disabled={disabled}
        data-testid={testId}
        className={cn(
          "grid size-10 place-items-center rounded-xl outline-none transition-colors hover:bg-white/10 hover:text-white [&_svg]:size-5",
          "focus-visible:ring-2 focus-visible:ring-green disabled:pointer-events-none disabled:opacity-35",
          className,
        )}
      >
        {children}
      </button>
    </Tip>
  );
}
