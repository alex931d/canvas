"use client";

import { useSyncExternalStore } from "react";
import { updatePreferences, uploadAvatar } from "@/app/settings/actions";
import { parsePreferences, type Preferences } from "@/lib/preferences";

/**
 * Settings kept in this browser for people without a membership, so nothing
 * of theirs takes up room on the server: the effect choices, and a profile
 * picture (a small data URL; AVATAR_SIZE square, usually 10–40 KB).
 *
 *   canvas-preferences        effect choices, for whoever uses this browser
 *   canvas-avatar:<userId>    that account's picture (people sharing a
 *                             browser each keep their own)
 *
 * When someone becomes a member, `moveToAccount` puts both in their account
 * and clears the browser's copies. Changes are announced to every hook on
 * the page and, through the storage event, to other tabs.
 */

const PREFERENCES_KEY = "canvas-preferences";
const avatarKey = (userId: string) => `canvas-avatar:${userId}`;
const EVENT = "canvas-browser-profile";

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null; // storage turned off
  }
}

function announce() {
  window.dispatchEvent(new Event(EVENT));
}

function subscribe(listener: () => void) {
  window.addEventListener(EVENT, listener);
  window.addEventListener("storage", listener);
  return () => {
    window.removeEventListener(EVENT, listener);
    window.removeEventListener("storage", listener);
  };
}

const blobToDataUrl = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });

export class BrowserProfile {
  // ------------------------------------------------------- preferences

  /** The effect choices saved in this browser, or null if none are. */
  static preferences(): Preferences | null {
    const raw = read(PREFERENCES_KEY);
    if (!raw) return null;
    try {
      return parsePreferences(JSON.parse(raw));
    } catch {
      return null;
    }
  }

  /** False when the browser wouldn't keep them (storage off or full). */
  static savePreferences(next: Preferences): boolean {
    try {
      localStorage.setItem(PREFERENCES_KEY, JSON.stringify(next));
      announce();
      return true;
    } catch {
      return false;
    }
  }

  // ------------------------------------------------------------ picture

  /** The account's picture kept in this browser (a data URL), or null. */
  static avatar(userId: string): string | null {
    const url = read(avatarKey(userId));
    return url?.startsWith("data:image/") ? url : null;
  }

  /** Keep a prepared picture (see the settings page); false when the browser wouldn't. */
  static async saveAvatar(userId: string, picture: Blob): Promise<boolean> {
    try {
      localStorage.setItem(avatarKey(userId), await blobToDataUrl(picture));
      announce();
      return true;
    } catch {
      return false;
    }
  }

  static removeAvatar(userId: string) {
    try {
      localStorage.removeItem(avatarKey(userId));
    } catch {
      /* storage off: nothing kept anyway */
    }
    announce();
  }

  // -------------------------------------------------------- joining

  /**
   * A new member's picture and effect choices go into their account; the
   * browser's copies go once the server has them. Resolves whether anything
   * moved (the page shows the new picture after a refresh).
   */
  static async moveToAccount(userId: string): Promise<boolean> {
    let moved = false;
    const avatar = BrowserProfile.avatar(userId);
    if (avatar) {
      const blob = await (await fetch(avatar)).blob();
      const form = new FormData();
      form.set("avatar", blob, blob.type === "image/webp" ? "avatar.webp" : "avatar.jpg");
      const result = await uploadAvatar(form).catch(() => null);
      if (result?.ok) {
        BrowserProfile.removeAvatar(userId);
        moved = true;
      }
    }
    const preferences = BrowserProfile.preferences();
    if (preferences) {
      const result = await updatePreferences(preferences).catch(() => null);
      if (result?.ok) {
        try {
          localStorage.removeItem(PREFERENCES_KEY);
        } catch {
          /* nothing to clear */
        }
        announce();
        moved = true;
      }
    }
    return moved;
  }
}

/** The effect choices kept in this browser (null: none, or not known yet while rendering on the server). */
export function useBrowserPreferences(): Preferences | null {
  const raw = useSyncExternalStore(subscribe, () => read(PREFERENCES_KEY), () => null);
  if (!raw) return null;
  try {
    return parsePreferences(JSON.parse(raw));
  } catch {
    return null;
  }
}

/** The account's picture kept in this browser, if any. */
export function useBrowserAvatar(userId: string | null | undefined): string | null {
  return useSyncExternalStore(
    subscribe,
    () => (userId ? BrowserProfile.avatar(userId) : null),
    () => null,
  );
}
