/*
 * The drawing board: an infinite canvas you draw, write and arrange on.
 *
 *   board.tsx     the React component: pointer, keyboard and the floating UI
 *   camera.ts     Camera (where the view is) and CameraMemory (kept per drawing)
 *   drafts.ts     DraftSession: a stroke or shape while it's being drawn
 *   painter.ts    BoardPainter: paints the scene and overlays, once per frame
 *   overlays.ts   selection boxes, lasso, peers' cursors and selections
 *   frames.ts     frames on the board: titles, what they carry, new ones
 *   clipboard.ts  BoardClipboard: copy and paste, shared by every board in the tab
 *   shortcuts.ts  Shortcuts: which key does what
 *   types.ts      interaction states and the board's public types
 */
export { Board } from "./board";
export type { BoardHandle, FlashcardCapture, TracedPicture } from "./types";
