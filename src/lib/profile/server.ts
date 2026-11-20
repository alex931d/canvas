import "server-only";

import { eq } from "drizzle-orm";
import { db } from "@/db";
import { userAvatars, userPreferences, users } from "@/db/schema";
import { DEFAULT_PREFERENCES, parsePreferences, type Preferences } from "@/lib/preferences";
import { MAX_AVATAR_BYTES, sniffImageType } from "./avatar";

export const NAME_MAX = 80;

/** Error text for a name, or null when it's fine (the same rules as signing up). */
export function nameProblem(name: string): string | null {
  if (!name) return "Enter your name.";
  if (name.length > NAME_MAX) return `Keep it under ${NAME_MAX} characters.`;
  return null;
}

export async function setName(userId: string, name: string) {
  await db.update(users).set({ name }).where(eq(users.id, userId));
}

export type AvatarResult = { ok: true; updatedAt: Date } | { ok: false; error: string };

/** Store a new picture: checks its size and that it really is a PNG, JPEG or WebP. */
export async function setAvatar(userId: string, file: Blob): Promise<AvatarResult> {
  if (file.size === 0) return { ok: false, error: "That file is empty." };
  if (file.size > MAX_AVATAR_BYTES) return { ok: false, error: "That picture is too large. Try another photo." };
  const bytes = Buffer.from(await file.arrayBuffer());
  const type = sniffImageType(bytes);
  if (!type) return { ok: false, error: "Use a PNG, JPEG or WebP picture." };
  const updatedAt = new Date();
  await db.transaction(async (tx) => {
    await tx
      .insert(userAvatars)
      .values({ userId, mimeType: type, bytes, updatedAt })
      .onConflictDoUpdate({ target: userAvatars.userId, set: { mimeType: type, bytes, updatedAt } });
    await tx.update(users).set({ avatarUpdatedAt: updatedAt }).where(eq(users.id, userId));
  });
  return { ok: true, updatedAt };
}

export async function removeAvatar(userId: string) {
  await db.transaction(async (tx) => {
    await tx.delete(userAvatars).where(eq(userAvatars.userId, userId));
    await tx.update(users).set({ avatarUpdatedAt: null }).where(eq(users.id, userId));
  });
}

export async function getAvatar(userId: string) {
  const [row] = await db
    .select({ mimeType: userAvatars.mimeType, bytes: userAvatars.bytes, updatedAt: userAvatars.updatedAt })
    .from(userAvatars)
    .where(eq(userAvatars.userId, userId))
    .limit(1);
  return row ?? null;
}

export async function getPreferences(userId: string): Promise<Preferences> {
  const [row] = await db
    .select({ preferences: userPreferences.preferences })
    .from(userPreferences)
    .where(eq(userPreferences.userId, userId))
    .limit(1);
  return row ? parsePreferences(row.preferences) : DEFAULT_PREFERENCES;
}

export async function savePreferences(userId: string, preferences: Preferences) {
  await db
    .insert(userPreferences)
    .values({ userId, preferences })
    .onConflictDoUpdate({ target: userPreferences.userId, set: { preferences, updatedAt: new Date() } });
}
