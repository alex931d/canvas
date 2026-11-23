/**
 * How the rest of the app tells the study buddies what happened, without
 * importing them: a window event. Safe to call when no buddies are showing.
 */

export type BuddyEvent =
  | { kind: "review"; grade: "again" | "good" | "easy" }
  | { kind: "session-done"; reviewed: number }
  | { kind: "task"; count: number }
  | { kind: "open-settings" };

const NAME = "study-buddy";

/** Returns whether buddies on this page took care of it (so the sender can do something else if not). */
export function emitBuddy(event: BuddyEvent): boolean {
  if (typeof window === "undefined") return false;
  return !window.dispatchEvent(new CustomEvent<BuddyEvent>(NAME, { detail: event, cancelable: true }));
}

/** `handler` returns true when it took care of the event. */
export function onBuddy(handler: (event: BuddyEvent) => boolean | void) {
  const listener = (e: Event) => {
    if (handler((e as CustomEvent<BuddyEvent>).detail) === true) e.preventDefault();
  };
  window.addEventListener(NAME, listener);
  return () => window.removeEventListener(NAME, listener);
}
