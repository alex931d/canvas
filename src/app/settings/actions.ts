"use server";

import { refresh } from "next/cache";
import { limiters } from "@/lib/auth/rate-limit";
import { getCurrentSession } from "@/lib/auth/session";
import { preferencesSchema, type Preferences } from "@/lib/preferences";
import { avatarUrl } from "@/lib/profile/avatar";
import { nameProblem, removeAvatar, savePreferences, setAvatar, setName } from "@/lib/profile/server";

/*
 * The settings page: your name, profile picture and effect choices. Each
 * action checks the session again and refreshes the page, so the account
 * menu shows the new name and picture straight away.
 */

export type NameState = { ok?: string; error?: string; value?: string };
export type ProfileResult = { ok: true; avatarUrl: string | null } | { ok: false; error: string };
export type SaveResult = { ok: true } | { ok: false; error: string };

const SIGNED_OUT = "Your session ended. Log in again to change your settings.";
const TOO_FAST = "That's a lot of changes at once. Wait a few seconds and try again.";

async function signedIn() {
  const { user } = await getCurrentSession();
  return user && user.emailVerified ? user : null;
}

export async function saveName(_prev: NameState, formData: FormData): Promise<NameState> {
  const user = await signedIn();
  if (!user) return { error: SIGNED_OUT };
  const raw = formData.get("name");
  const name = (typeof raw === "string" ? raw : "").trim();
  const problem = nameProblem(name);
  if (problem) return { error: problem, value: name };
  if (name === user.name) return { ok: "That's already your name.", value: name };
  if (!(await limiters.profileByUser.consume(user.id)).ok) return { error: TOO_FAST, value: name };
  await setName(user.id, name);
  refresh();
  return { ok: "Name saved.", value: name };
}

export async function uploadAvatar(formData: FormData): Promise<ProfileResult> {
  const user = await signedIn();
  if (!user) return { ok: false, error: SIGNED_OUT };
  const file = formData.get("avatar");
  if (!(file instanceof Blob)) return { ok: false, error: "Choose a picture to upload." };
  if (!(await limiters.profileByUser.consume(user.id)).ok) return { ok: false, error: TOO_FAST };
  const result = await setAvatar(user.id, file);
  if (!result.ok) return result;
  refresh();
  return { ok: true, avatarUrl: avatarUrl(user.id, result.updatedAt) };
}

export async function deleteAvatar(): Promise<ProfileResult> {
  const user = await signedIn();
  if (!user) return { ok: false, error: SIGNED_OUT };
  await removeAvatar(user.id);
  refresh();
  return { ok: true, avatarUrl: null };
}

export async function updatePreferences(next: Preferences): Promise<SaveResult> {
  const user = await signedIn();
  if (!user) return { ok: false, error: SIGNED_OUT };
  const parsed = preferencesSchema.safeParse(next);
  if (!parsed.success) return { ok: false, error: "That setting isn't one canvas knows." };
  if (!(await limiters.preferencesByUser.consume(user.id)).ok) return { ok: false, error: TOO_FAST };
  await savePreferences(user.id, parsed.data);
  return { ok: true };
}
