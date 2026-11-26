import { sql } from "drizzle-orm";
import type { Role } from "@/lib/auth/roles";
import type { Outcome } from "@/lib/buddy/battle";
import type { Ability, Rarity } from "@/lib/buddy/kinds";
import {
  bigint,
  boolean,
  check,
  customType,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/** Postgres `bytea`, read and written as a Node Buffer. */
const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() {
    return "bytea";
  },
});

// Every table has Row Level Security switched on with no policies. The app
// connects as the tables' owner, which RLS doesn't apply to, so nothing changes
// for it; but on hosts that put an HTTP API in front of the database (Supabase's
// Data API reads the public schema), other roles can't read or write these rows.
// New tables should do the same: add .enableRLS().

// ------------------------------------------------------------------ auth
// Session design follows the Lucia guide (lucia-auth.com): see src/lib/auth.

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    /** Stored lowercased and trimmed. */
    email: text("email").notNull(),
    /**
     * Argon2id PHC string ($argon2id$v=19$m=19456,t=2,p=1$...), or null for
     * accounts that only sign in with Google (they can add one with
     * "Forgot password?").
     */
    passwordHash: text("password_hash"),
    /**
     * True once they've entered the code we emailed them, or reset their
     * password through an emailed link. Until then they can only reach
     * /verify-email (src/lib/auth/session.ts requireUser).
     */
    emailVerified: boolean("email_verified").notNull().default(false),
    /** What they may do beyond using canvas (src/lib/auth/roles.ts). Set with `npm run role` or in /admin. */
    role: text("role").$type<Role>().notNull().default("user"),
    /** Their customer in Stripe (cus_...), created the first time they start a membership. */
    stripeCustomerId: text("stripe_customer_id"),
    /**
     * When they last set a profile picture (user_avatars), or null for none.
     * Also the picture's version in its URL, so browsers can keep it cached.
     */
    avatarUpdatedAt: timestamp("avatar_updated_at", { withTimezone: true }),
    /**
     * Their study level: what the points from their study_events add up to
     * (LEVELS in src/lib/buddy/shared.ts). Brought up to date whenever they
     * study, and whenever their progress is read (src/lib/buddy/progress.ts).
     */
    level: integer("level").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("users_email_idx").on(sql`lower(${t.email})`),
    uniqueIndex("users_stripe_customer_id_idx").on(t.stripeCustomerId),
    check("users_role_check", sql`${t.role} in ('user', 'support', 'admin')`),
    check("users_level_check", sql`${t.level} >= 1`),
  ],
).enableRLS();

/**
 * Profile pictures: a 256 px square the browser crops and encodes before
 * uploading (src/lib/profile). Kept out of `users` so loading a session never
 * reads image bytes.
 */
export const userAvatars = pgTable("user_avatars", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  mimeType: text("mime_type").notNull(),
  bytes: bytea("bytes").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}).enableRLS();

/**
 * Settings page choices (src/lib/preferences.ts): one row per person once
 * they change anything; until then the defaults apply.
 */
export const userPreferences = pgTable("user_preferences", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  preferences: jsonb("preferences").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
}).enableRLS();

export const sessions = pgTable(
  "sessions",
  {
    /** Public half of the token `<id>.<secret>`. */
    id: text("id").primaryKey(),
    /** SHA-256 of the secret half. The raw secret only ever lives in the cookie. */
    secretHash: bytea("secret_hash").notNull(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    /** Bumped at most hourly; sessions idle for 30 days expire. */
    lastVerifiedAt: timestamp("last_verified_at", { withTimezone: true }).notNull().defaultNow(),
    /**
     * Password (or Google) checked, but the account has two-factor sign-in
     * and the code hasn't been entered yet. Such a session only opens the
     * code page (/login/two-factor) and lasts 10 minutes
     * (src/lib/auth/session.ts).
     */
    twoFactorPending: boolean("two_factor_pending").notNull().default(false),
  },
  (t) => [index("sessions_user_id_idx").on(t.userId)],
).enableRLS();

/**
 * Two-factor sign-in with an authenticator app (src/lib/auth/two-factor.ts).
 * A row with no enabled_at is a setup in progress: the code from it hasn't
 * been entered yet, so it isn't asked for at login.
 */
export const userTwoFactor = pgTable("user_two_factor", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  /** The app's secret key, encrypted with ENCRYPTION_KEY (AES-256-GCM: iv, tag, ciphertext). */
  totpKey: bytea("totp_key").notNull(),
  enabledAt: timestamp("enabled_at", { withTimezone: true }),
  /** The last 30-second step a code was accepted for, so a code works only once. */
  lastUsedStep: bigint("last_used_step", { mode: "number" }).notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}).enableRLS();

/** One-time codes for when the authenticator app isn't at hand. Only hashes are kept. */
export const twoFactorRecoveryCodes = pgTable(
  "two_factor_recovery_codes",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** SHA-256 of the code (codes are random, so a fast hash is enough). */
    codeHash: bytea("code_hash").notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
  },
  (t) => [primaryKey({ columns: [t.userId, t.codeHash] })],
).enableRLS();

/**
 * Accounts at other sign-in providers linked to a canvas account. Today only
 * Google (src/lib/auth/google.ts): provider_user_id is Google's `sub`.
 */
export const oauthAccounts = pgTable(
  "oauth_accounts",
  {
    provider: text("provider").$type<"google">().notNull(),
    providerUserId: text("provider_user_id").notNull(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** The address the provider gave when it was linked, to show in Settings. */
    email: text("email"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.provider, t.providerUserId] }),
    uniqueIndex("oauth_accounts_user_provider_idx").on(t.userId, t.provider),
    check("oauth_accounts_provider_check", sql`${t.provider} in ('google')`),
  ],
).enableRLS();

/**
 * The code emailed to confirm an account's address (src/lib/auth/email-verification.ts).
 * One per account: sending a new code replaces the old one. Only SHA-256 of
 * the code is stored; it works for 15 minutes and 5 tries.
 */
export const emailVerificationCodes = pgTable("email_verification_codes", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  /** The address it went to. It only verifies the account while that's still the account's email. */
  email: text("email").notNull(),
  codeHash: bytea("code_hash").notNull(),
  /** Wrong codes entered so far. */
  attempts: integer("attempts").notNull().default(0),
  sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
}).enableRLS();

/**
 * Password reset links (src/lib/auth/password-reset.ts). The link carries a
 * random token and only its SHA-256 is stored, like session secrets. Each
 * link works once, for an hour; setting a new password removes them all.
 */
export const passwordResetTokens = pgTable(
  "password_reset_tokens",
  {
    tokenHash: bytea("token_hash").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** The address the link went to. */
    email: text("email").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (t) => [index("password_reset_tokens_user_id_idx").on(t.userId)],
).enableRLS();

/**
 * What staff did to accounts in /admin (and `npm run role`): one row per
 * change, shown as the account's history. Kept with the account.
 */
export const auditEvents = pgTable(
  "audit_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Who did it; null for the command line (or an actor who no longer exists). */
    actorId: uuid("actor_id").references(() => users.id, { onDelete: "set null" }),
    /** The account it was done to. */
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    action: text("action").$type<AuditAction>().notNull(),
    /** What changed, e.g. { field: "name", from: "Ada", to: "Ada L." }. */
    details: jsonb("details").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("audit_events_user_id_created_at_idx").on(t.userId, t.createdAt)],
).enableRLS();

/**
 * Site-wide settings staff change in /admin, one row per key (src/lib/site/settings.ts).
 * "seasonal_theme": "auto" | "off" | "easter" | "halloween" | "christmas".
 */
export const siteSettings = pgTable("site_settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  updatedBy: uuid("updated_by").references(() => users.id, { onDelete: "set null" }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}).enableRLS();

export type AuditAction =
  | "user.updated"
  | "role.changed"
  | "membership.granted"
  | "membership.ended"
  | "sessions.revoked"
  | "password_reset.sent"
  | "avatar.removed"
  | "two_factor.disabled";

export type User = typeof users.$inferSelect;
export type Session = typeof sessions.$inferSelect;

// -------------------------------------------------------------- membership

/**
 * Memberships. Most rows mirror a Stripe subscription and are only written
 * by src/lib/billing/sync.ts, which copies Stripe's current state after each
 * webhook and when someone returns from Checkout. Rows whose id starts with
 * "comp_" are complimentary memberships granted with `npm run membership`.
 * Someone is a member while any of their rows has a member status (see
 * src/lib/billing/membership.ts).
 */
export const subscriptions = pgTable(
  "subscriptions",
  {
    /** Stripe subscription id (sub_...), or comp_... for a complimentary membership. */
    id: text("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** Stripe customer id; null for complimentary memberships. */
    customerId: text("customer_id"),
    /** Stripe's subscription status: active, trialing, past_due, canceled, unpaid, ... */
    status: text("status").notNull(),
    priceId: text("price_id"),
    /** When the current paid period ends: the next renewal date. */
    currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }),
    /** Set once it's cancelled but still running: the day access stops. */
    cancelAt: timestamp("cancel_at", { withTimezone: true }),
    /** When the subscription ended, for canceled ones. */
    endedAt: timestamp("ended_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [index("subscriptions_user_id_idx").on(t.userId)],
).enableRLS();

export type Subscription = typeof subscriptions.$inferSelect;

// ---------------------------------------------------------------- drawings

export const drawings = pgTable(
  "drawings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /**
     * Owner. Nullable only for drawings made before sign-in existed; the first
     * account created adopts those (see src/lib/auth/account.ts).
     */
    userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
    /**
     * The team workspace it's in, or null for the owner's own drawings. Its
     * members can open it with their workspace role; deleting the workspace
     * gives its drawings back to their owners.
     */
    workspaceId: uuid("workspace_id").references(() => workspaces.id, { onDelete: "set null" }),
    title: text("title").notNull().default("Untitled"),
    /**
     * Vector scene (see src/lib/canvas/schema.ts). Older rows may hold the
     * version 1 format, so it's typed `unknown` and normalized on read.
     */
    data: jsonb("data").$type<unknown>().notNull(),
    /**
     * How its frames are presented (see presentationSchema in
     * src/lib/canvas/schema.ts); null until someone picks a style.
     */
    presentation: jsonb("presentation").$type<unknown>(),
    /** Small image data URL shown in the gallery. */
    thumbnail: text("thumbnail"),
    /**
     * Bumped once per applied change (a row in drawing_changes). Editors
     * follow the drawing live from this number; see src/lib/collab.
     */
    version: bigint("version", { mode: "number" }).notNull().default(0),
    /** Secret in the invite link (/join/<token>); null while link sharing is off. */
    shareToken: text("share_token"),
    /** What joining with the link allows: "editor" or "viewer". */
    shareRole: text("share_role").$type<MemberRole>().notNull().default("editor"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    index("drawings_updated_at_idx").on(t.updatedAt.desc()),
    index("drawings_user_id_idx").on(t.userId, t.updatedAt.desc()),
    uniqueIndex("drawings_share_token_idx").on(t.shareToken),
    index("drawings_workspace_id_idx").on(t.workspaceId, t.updatedAt.desc()),
  ],
).enableRLS();

export type MemberRole = "editor" | "viewer";

/**
 * Team workspaces: a group of people and the drawings they share. Everyone
 * in it can open its drawings, with their workspace role (see
 * src/lib/workspaces/roles.ts).
 */
export const workspaces = pgTable(
  "workspaces",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    /** Secret in the invite link (/join/workspace/<token>); null while the link is off. */
    inviteToken: text("invite_token"),
    /** What joining with the link makes you: "editor" or "viewer". */
    inviteRole: text("invite_role").$type<MemberRole>().notNull().default("editor"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [uniqueIndex("workspaces_invite_token_idx").on(t.inviteToken)],
).enableRLS();

export type WorkspaceRole = "owner" | "admin" | "editor" | "viewer";

/** Who's in a workspace. Exactly one owner, who made it (or was handed it). */
export const workspaceMembers = pgTable(
  "workspace_members",
  {
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: text("role").$type<WorkspaceRole>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.workspaceId, t.userId] }), index("workspace_members_user_id_idx").on(t.userId)],
).enableRLS();

/**
 * Invitations emailed to one address. The link's token is only in the email;
 * this keeps its SHA-256. Accepting needs an account with that (confirmed)
 * address; it's used up then, or after 14 days.
 */
export const workspaceInvites = pgTable(
  "workspace_invites",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    /** Lowercased. */
    email: text("email").notNull(),
    role: text("role").$type<MemberRole>().notNull(),
    tokenHash: bytea("token_hash").notNull(),
    invitedBy: uuid("invited_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (t) => [
    uniqueIndex("workspace_invites_token_hash_idx").on(t.tokenHash),
    uniqueIndex("workspace_invites_workspace_email_idx").on(t.workspaceId, t.email),
    index("workspace_invites_email_idx").on(t.email),
  ],
).enableRLS();

/**
 * People a drawing is shared with (the owner is drawings.user_id). Rows are
 * added when someone opens an invite link; the owner can change or remove them.
 */
export const drawingMembers = pgTable(
  "drawing_members",
  {
    drawingId: uuid("drawing_id")
      .notNull()
      .references(() => drawings.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: text("role").$type<MemberRole>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.drawingId, t.userId] }), index("drawing_members_user_id_idx").on(t.userId)],
).enableRLS();

/**
 * Recent changes per drawing, one row per batch of operations a client sent
 * (see src/lib/collab/ops.ts). Editors that reconnect catch up from here;
 * the drawing itself (drawings.data) always holds the result. Old rows are
 * pruned, so this is a short history, not an archive.
 */
export const drawingChanges = pgTable(
  "drawing_changes",
  {
    drawingId: uuid("drawing_id")
      .notNull()
      .references(() => drawings.id, { onDelete: "cascade" }),
    version: bigint("version", { mode: "number" }).notNull(),
    /** Chosen by the client, so a retried request is applied only once. */
    batchId: uuid("batch_id").notNull(),
    /** The browser tab that sent it, so it can recognise its own changes. */
    clientId: text("client_id").notNull(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    ops: jsonb("ops").$type<unknown>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.drawingId, t.version] }),
    uniqueIndex("drawing_changes_batch_id_idx").on(t.drawingId, t.batchId),
  ],
).enableRLS();

/**
 * Images placed on a canvas (pasted screenshots, dropped files).
 * The id is generated in the browser so the image can be drawn and saved
 * locally before it's uploaded.
 */
export const assets = pgTable(
  "assets",
  {
    id: uuid("id").primaryKey(),
    drawingId: uuid("drawing_id")
      .notNull()
      .references(() => drawings.id, { onDelete: "cascade" }),
    mimeType: text("mime_type").notNull(),
    bytes: bytea("bytes").notNull(),
    byteSize: integer("byte_size").notNull(),
    width: integer("width").notNull(),
    height: integer("height").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("assets_drawing_id_idx").on(t.drawingId)],
).enableRLS();

// -------------------------------------------------------------- flashcards

/**
 * Study cards. Each belongs to one person; `drawing_id` is the drawing it was
 * made from (its deck), kept even if they later lose access to that drawing.
 * Scheduling is a Leitner system: `box` 0 is new, higher boxes come back
 * after longer gaps (src/lib/study/schedule.ts).
 */
export const flashcards = pgTable(
  "flashcards",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    drawingId: uuid("drawing_id").references(() => drawings.id, { onDelete: "set null" }),
    /** Deck name, copied from the drawing's title when the card is made. */
    deck: text("deck").notNull().default("Cards"),
    front: text("front").notNull().default(""),
    back: text("back").notNull().default(""),
    /** Part of the canvas captured as a picture (WebP or PNG), shown on one side. */
    image: bytea("image"),
    imageMimeType: text("image_mime_type"),
    imageSide: text("image_side").$type<"front" | "back">(),
    imageWidth: integer("image_width"),
    imageHeight: integer("image_height"),
    box: integer("box").notNull().default(0),
    dueAt: timestamp("due_at", { withTimezone: true }).notNull().defaultNow(),
    reviews: integer("reviews").notNull().default(0),
    lapses: integer("lapses").notNull().default(0),
    lastReviewedAt: timestamp("last_reviewed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [index("flashcards_user_id_due_at_idx").on(t.userId, t.dueAt), index("flashcards_drawing_id_idx").on(t.drawingId)],
).enableRLS();

export type Flashcard = typeof flashcards.$inferSelect;

export type Drawing = typeof drawings.$inferSelect;
export type NewDrawing = typeof drawings.$inferInsert;
export type Asset = typeof assets.$inferSelect;

/**
 * Study buddies (src/lib/buddy): one row per person once they change
 * anything; until then the defaults apply.
 */
export const buddySettings = pgTable("buddy_settings", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  /** BuddySettings (src/lib/buddy/shared.ts). */
  settings: jsonb("settings").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
}).enableRLS();

/**
 * Pandas caught in battles: yours for good. The server decided their rarity
 * and trick when they turned up (src/lib/buddy/wild.ts), so nobody can make
 * themselves a super rare one by editing their settings.
 */
export const buddyCollection = pgTable(
  "buddy_collection",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    rarity: text("rarity").$type<Rarity>().notNull(),
    ability: text("ability").$type<Ability>().notNull(),
    /** Its level when it was caught. */
    level: integer("level").notNull(),
    caughtAt: timestamp("caught_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("buddy_collection_user_id_idx").on(t.userId, t.caughtAt)],
).enableRLS();

/**
 * Wild pandas: at most one around per person at a time, gone after a few
 * minutes. A battle's state (BattleState in src/lib/buddy/battle.ts) lives
 * here while it lasts, and stays with how it ended.
 */
export const buddyEncounters = pgTable(
  "buddy_encounters",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    rarity: text("rarity").$type<Rarity>().notNull(),
    ability: text("ability").$type<Ability>().notNull(),
    level: integer("level").notNull(),
    /** wild: wandering about; battle: in one; then how it ended, or gone (it wandered off). */
    status: text("status").$type<"wild" | "battle" | "gone" | Outcome>().notNull().default("wild"),
    state: jsonb("state"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    /** It wanders off then, unless a battle started. */
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
  },
  (t) => [index("buddy_encounters_user_id_idx").on(t.userId, t.createdAt)],
).enableRLS();

/** Per person: bamboo offered so far, battles, and when a wild panda last had a chance to turn up. */
export const buddyStats = pgTable("buddy_stats", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  bambooSpent: integer("bamboo_spent").notNull().default(0),
  caught: integer("caught").notNull().default(0),
  won: integer("won").notNull().default(0),
  lastWildAt: timestamp("last_wild_at", { withTimezone: true }),
}).enableRLS();

/**
 * What the buddies keep track of: a flashcard answered ("review") or a to-do
 * card moved into a board's last column ("task"). Tasks carry a `ref`
 * (drawing and card id) so moving the same card back and forth counts once.
 */
export const studyEvents = pgTable(
  "study_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: text("kind").$type<"review" | "task">().notNull(),
    ref: text("ref"),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("study_events_user_id_at_idx").on(t.userId, t.at),
    uniqueIndex("study_events_once_idx").on(t.userId, t.kind, t.ref).where(sql`${t.ref} is not null`),
  ],
).enableRLS();
