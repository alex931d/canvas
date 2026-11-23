"use server";

import { randomUUID } from "node:crypto";
import { and, eq, like } from "drizzle-orm";
import { refresh } from "next/cache";
import { db } from "@/db";
import { emailVerificationCodes, passwordResetTokens, sessions, subscriptions, userAvatars, users } from "@/db/schema";
import { audit } from "@/lib/admin/users";
import { isValidEmail, normalizeEmail } from "@/lib/auth/account";
import { sendPasswordResetLink } from "@/lib/auth/password-reset";
import { can, canManage, isRole, roleChangeBlocked, type Permission, type Role } from "@/lib/auth/roles";
import { getCurrentSession } from "@/lib/auth/session";
import { isThemeMode, THEME_INFO } from "@/lib/seasons";
import { saveSeasonalMode } from "@/lib/site/settings";
import { emailLinkOrigin } from "@/lib/site-url";

/*
 * What staff can do to an account from /admin. Every action checks the
 * signed-in person's role again (the page hiding a button is not the
 * check), records what it did in audit_events, and refreshes the page.
 */

export type AdminActionState = {
  ok?: string;
  error?: string;
  fieldErrors?: { name?: string; email?: string };
  /** What was typed, to put back after an error. */
  values?: { name: string; email?: string };
};

const NO_ACCESS: AdminActionState = { error: "You don't have access to do that." };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const str = (v: FormDataEntryValue | null) => (typeof v === "string" ? v : "");

/** The signed-in staff member, if their role has `permission`. */
async function staff(permission: Permission) {
  const { user } = await getCurrentSession();
  if (!user || !user.emailVerified || !can(user.role, permission)) return null;
  return user;
}

type Target = { id: string; name: string; email: string; role: Role; emailVerified: boolean };

/** The account being edited, if `actor` may edit it; otherwise the error to show. */
async function target(actor: { id: string; role: Role }, id: FormDataEntryValue | null): Promise<Target | AdminActionState> {
  const raw = str(id);
  if (!UUID.test(raw)) return { error: "This account doesn't exist." };
  const [row] = await db
    .select({ id: users.id, name: users.name, email: users.email, role: users.role, emailVerified: users.emailVerified })
    .from(users)
    .where(eq(users.id, raw));
  if (!row) return { error: "This account doesn't exist anymore." };
  if (!canManage(actor, row)) return { error: "Only admins can edit staff accounts." };
  return row;
}

const isTarget = (t: Target | AdminActionState): t is Target => "id" in t;

/** Name, email, role and email confirmation, from the edit panel's form. */
export async function saveUser(_prev: AdminActionState, formData: FormData): Promise<AdminActionState> {
  const actor = await staff("users:edit");
  if (!actor) return NO_ACCESS;
  const user = await target(actor, formData.get("id"));
  if (!isTarget(user)) return user;

  const changes: Partial<Pick<Target, "name" | "email" | "role" | "emailVerified">> = {};
  const fieldErrors: NonNullable<AdminActionState["fieldErrors"]> = {};

  const name = str(formData.get("name")).trim();
  if (!name) fieldErrors.name = "Enter a name.";
  else if (name.length > 80) fieldErrors.name = "Keep it under 80 characters.";
  else if (name !== user.name) changes.name = name;

  // Fields the form disables for this person aren't sent at all.
  if (formData.has("email")) {
    const email = normalizeEmail(str(formData.get("email")));
    if (email !== user.email) {
      if (!can(actor.role, "users:email")) return { error: "Only admins can change email addresses." };
      if (!isValidEmail(email)) fieldErrors.email = "Enter a valid email address.";
      else changes.email = email;
    }
  }
  if (formData.has("role")) {
    const role = str(formData.get("role"));
    if (role !== user.role) {
      const blocked = roleChangeBlocked(actor, user);
      if (blocked) return { error: blocked };
      if (!isRole(role)) return { error: "Choose one of the roles." };
      changes.role = role;
    }
  }
  const verified = formData.get("emailVerified") === "on";
  if (verified !== user.emailVerified) changes.emailVerified = verified;

  const values = { name, email: formData.has("email") ? str(formData.get("email")) : undefined };
  if (Object.keys(fieldErrors).length) return { fieldErrors, values };
  if (Object.keys(changes).length === 0) return { ok: "Nothing changed." };

  try {
    await db.transaction(async (tx) => {
      await tx.update(users).set(changes).where(eq(users.id, user.id));
      for (const [field, to] of Object.entries(changes)) {
        const from = user[field as keyof typeof changes];
        await audit(tx, actor.id, user.id, field === "role" ? "role.changed" : "user.updated", { field, from, to });
      }
      if (changes.email) {
        // Codes and reset links went to the old address.
        await tx.delete(emailVerificationCodes).where(eq(emailVerificationCodes.userId, user.id));
        await tx.delete(passwordResetTokens).where(eq(passwordResetTokens.userId, user.id));
      }
    });
  } catch (err) {
    const code = (err as { code?: string; cause?: { code?: string } }).code ?? (err as { cause?: { code?: string } }).cause?.code;
    if (code === "23505") return { fieldErrors: { email: "Another account already uses this email." }, values };
    throw err;
  }
  refresh();
  return { ok: "Saved." };
}

/** Give (give=1) or end (give=0) a complimentary membership. Paid ones are managed in Stripe. */
export async function setComplimentary(_prev: AdminActionState, formData: FormData): Promise<AdminActionState> {
  const actor = await staff("memberships:comp");
  if (!actor) return NO_ACCESS;
  const user = await target(actor, formData.get("id"));
  if (!isTarget(user)) return user;
  const give = formData.get("give") === "1";

  const active = and(
    eq(subscriptions.userId, user.id),
    like(subscriptions.id, "comp\\_%"),
    eq(subscriptions.status, "active"),
  );
  const result = await db.transaction(async (tx) => {
    const existing = await tx.select({ id: subscriptions.id }).from(subscriptions).where(active);
    if (give) {
      if (existing.length) return { ok: "They already have a complimentary membership." };
      await tx.insert(subscriptions).values({ id: `comp_${randomUUID()}`, userId: user.id, status: "active" });
      await audit(tx, actor.id, user.id, "membership.granted");
      return { ok: "Gave them a complimentary membership." };
    }
    if (!existing.length) return { error: "They don't have a complimentary membership." };
    const now = new Date();
    await tx.update(subscriptions).set({ status: "canceled", endedAt: now, updatedAt: now }).where(active);
    await audit(tx, actor.id, user.id, "membership.ended");
    return { ok: "Ended their complimentary membership." };
  });
  refresh();
  return result;
}

/** End every session the account has, on every device. */
export async function signOutEverywhere(_prev: AdminActionState, formData: FormData): Promise<AdminActionState> {
  const actor = await staff("users:edit");
  if (!actor) return NO_ACCESS;
  const user = await target(actor, formData.get("id"));
  if (!isTarget(user)) return user;
  if (user.id === actor.id) return { error: "To sign yourself out, use Sign out in your account menu." };

  const ended = await db.transaction(async (tx) => {
    const rows = await tx.delete(sessions).where(eq(sessions.userId, user.id)).returning({ id: sessions.id });
    await audit(tx, actor.id, user.id, "sessions.revoked", { count: rows.length });
    return rows.length;
  });
  refresh();
  return { ok: ended ? `Signed them out of ${ended} ${ended === 1 ? "session" : "sessions"}.` : "They weren't signed in anywhere." };
}

/** Take down someone's profile picture (they can upload another). */
export async function removeUserAvatar(_prev: AdminActionState, formData: FormData): Promise<AdminActionState> {
  const actor = await staff("users:edit");
  if (!actor) return NO_ACCESS;
  const user = await target(actor, formData.get("id"));
  if (!isTarget(user)) return user;
  await db.transaction(async (tx) => {
    await tx.delete(userAvatars).where(eq(userAvatars.userId, user.id));
    await tx.update(users).set({ avatarUpdatedAt: null }).where(eq(users.id, user.id));
    await audit(tx, actor.id, user.id, "avatar.removed");
  });
  refresh();
  return { ok: "Removed their profile picture." };
}

/** Email them a password reset link (the same one "Forgot password?" sends). */
export async function sendResetLink(_prev: AdminActionState, formData: FormData): Promise<AdminActionState> {
  const actor = await staff("users:edit");
  if (!actor) return NO_ACCESS;
  const user = await target(actor, formData.get("id"));
  if (!isTarget(user)) return user;

  let result;
  try {
    result = await sendPasswordResetLink(user.email, await emailLinkOrigin());
  } catch (err) {
    console.error("[email] couldn't send a password reset link:", err);
    return { error: "The email couldn't be sent. Try again in a minute." };
  }
  if (result === "limited") return { error: "This address had 3 reset emails recently. Try again in 20 minutes." };
  if (result === "no-app-url") return { error: "Set APP_URL to this site's address so reset emails can link to it." };
  if (result === "no-account") return { error: "This account doesn't exist anymore." };
  await audit(db, actor.id, user.id, "password_reset.sent");
  refresh();
  return { ok: `Sent a reset link to ${user.email}.` };
}

/** The site's seasonal theme: follow the calendar, show one now, or none. */
export async function saveSeasonalTheme(_prev: AdminActionState, formData: FormData): Promise<AdminActionState> {
  const actor = await staff("site:settings");
  if (!actor) return NO_ACCESS;
  const mode = formData.get("mode");
  if (!isThemeMode(mode)) return { error: "Choose one of the options." };
  await saveSeasonalMode(mode, actor.id);
  refresh();
  return {
    ok:
      mode === "auto"
        ? "Saved. Themes now follow the calendar."
        : mode === "off"
          ? "Saved. No seasonal theme for now."
          : `Saved. Everyone sees the ${THEME_INFO[mode].label} theme now.`,
  };
}
