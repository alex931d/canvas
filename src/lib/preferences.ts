import { z } from "zod";

/**
 * Choices from the settings page that change how canvas behaves (saved per
 * person in user_preferences; see src/lib/preferences-server.ts).
 *
 * Drawing effects play when things arrive on a canvas without you drawing
 * them there: a drawing opening, someone else drawing, pasting, undo, or an
 * equation, graph or image being added. What you draw yourself is already on
 * screen as you draw it, so it never replays. Erased and deleted things leave
 * with the same effect.
 */

export const DRAW_EFFECTS = ["off", "fade", "pop", "trace"] as const;
export type DrawEffect = (typeof DRAW_EFFECTS)[number];

export const DRAW_EFFECT_INFO: Record<DrawEffect, { label: string; text: string }> = {
  off: { label: "Off", text: "Everything appears and disappears at once." },
  fade: { label: "Fade", text: "New things fade in. Erased things fade out." },
  pop: { label: "Pop", text: "New things spring into place. Erased things shrink away." },
  trace: {
    label: "Trace",
    text: "Lines draw themselves in, the way a pen would. Text and pictures sweep in from the left.",
  },
};

export type Preferences = {
  drawEffect: DrawEffect;
  /** To-do boards: cards glide between columns, and finished cards get crossed out as you watch. */
  boardEffects: boolean;
};

export const DEFAULT_PREFERENCES: Preferences = { drawEffect: "pop", boardEffects: true };

export const preferencesSchema = z.object({
  drawEffect: z.enum(DRAW_EFFECTS),
  boardEffects: z.boolean(),
});

/** Stored preferences with anything missing or unknown replaced by the default. */
export function parsePreferences(raw: unknown): Preferences {
  const obj = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const effect = z.enum(DRAW_EFFECTS).safeParse(obj.drawEffect);
  const board = z.boolean().safeParse(obj.boardEffects);
  return {
    drawEffect: effect.success ? effect.data : DEFAULT_PREFERENCES.drawEffect,
    boardEffects: board.success ? board.data : DEFAULT_PREFERENCES.boardEffects,
  };
}
