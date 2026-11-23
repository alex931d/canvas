/**
 * The open drawing as the board sees it, for things that live on the canvas
 * but aren't drawn by it (the study buddies walking about on it): its camera
 * and what's drawn. The board publishes every change; listeners are called
 * straight away, in the same frame, so whatever follows the camera never lags
 * behind the drawing.
 *
 * screen = (world - {x, y}) * z, relative to the board's top-left corner.
 */

import type { CanvasElement } from "./schema";

export type View = { x: number; y: number; z: number };

type Listener<T> = (value: T) => void;

let current: View | null = null;
const listeners = new Set<Listener<View>>();

export function publishView(view: View | null) {
  current = view;
  if (view) for (const listener of listeners) listener(view);
}

/** The camera right now (null when no drawing is open). */
export const currentView = () => current;

export function onView(listener: Listener<View>) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

// ------------------------------------------------------------ what's drawn

const NOTHING: readonly CanvasElement[] = [];
let scene: readonly CanvasElement[] = NOTHING;
const sceneListeners = new Set<Listener<readonly CanvasElement[]>>();

/** The drawing's elements (a new array whenever anything changes, yours or anyone else's). */
export function publishScene(elements: readonly CanvasElement[] | null) {
  scene = elements ?? NOTHING;
  for (const listener of sceneListeners) listener(scene);
}

export const currentScene = () => scene;

export function onScene(listener: Listener<readonly CanvasElement[]>) {
  sceneListeners.add(listener);
  return () => {
    sceneListeners.delete(listener);
  };
}
