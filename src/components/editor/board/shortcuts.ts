import { ToolRegistry, type ActionId, type Tool } from "../tools";

/** Something a key asks the board to do. */
export type BoardCommand =
  | { kind: "select-all" }
  | { kind: "duplicate" }
  | { kind: "copy"; cut: boolean }
  | { kind: "zoom"; by: number }
  | { kind: "zoom-reset" }
  | { kind: "delete" }
  | { kind: "escape" }
  /** Move the selection by screen pixels; `alone` leaves a frame's contents where they are. */
  | { kind: "nudge"; dx: number; dy: number; alone: boolean }
  | { kind: "fit-all" }
  | { kind: "fit-selection" }
  | { kind: "tool"; tool: Tool }
  | { kind: "action"; action: ActionId };

type Keys = Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "shiftKey" | "altKey">;

const NUDGE: Record<string, [number, number]> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
};

/**
 * Which key does what on the board (the README's keyboard table). Pure: it
 * only names the command; the board checks whether it applies (a selection
 * to delete, say) and does it. Space to pan is held, so the board handles it.
 */
export class Shortcuts {
  static commandFor(e: Keys, readOnly: boolean): BoardCommand | null {
    // Autofill and some extensions send key events with no key name.
    if (typeof e.key !== "string") return null;
    const key = e.key.toLowerCase();
    if (e.metaKey || e.ctrlKey) {
      switch (key) {
        case "a":
          return { kind: "select-all" };
        case "d":
          return readOnly ? null : { kind: "duplicate" };
        case "c":
          return { kind: "copy", cut: false };
        case "x":
          return readOnly ? null : { kind: "copy", cut: true };
        case "=":
        case "+":
          return { kind: "zoom", by: 1.25 };
        case "-":
          return { kind: "zoom", by: 1 / 1.25 };
        case "0":
          return { kind: "zoom-reset" };
        default:
          return null;
      }
    }
    if (e.key === "Delete" || e.key === "Backspace") return readOnly ? null : { kind: "delete" };
    if (e.key === "Escape") return { kind: "escape" };
    if (e.key in NUDGE) {
      if (readOnly) return null;
      const step = e.shiftKey ? 10 : 1;
      const [dx, dy] = NUDGE[e.key];
      return { kind: "nudge", dx: dx * step, dy: dy * step, alone: e.altKey };
    }
    if (e.shiftKey && e.key === "!") return { kind: "fit-all" };
    if (e.shiftKey && e.key === "@") return { kind: "fit-selection" };
    if (e.altKey || e.shiftKey) return null;

    const registry = ToolRegistry.shared;
    const found = registry.forKey(key);
    if (!found || !registry.allowed(found.id, readOnly)) return null;
    return registry.isAction(found.id) ? { kind: "action", action: found.id } : { kind: "tool", tool: found.id };
  }
}
