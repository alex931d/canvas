/**
 * Roles and what each may do. Safe to import anywhere (the account menu and
 * the admin dashboard use it to decide what to show); the server checks the
 * same rules before doing anything (src/lib/auth/session.ts requirePermission,
 * src/app/admin/actions.ts).
 *
 * To add a role: add it to ROLES and ROLE_INFO, list it under the permissions
 * it should have, and add a migration that allows the new value in the
 * users_role_check constraint.
 */

export const ROLES = ["user", "support", "admin"] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_INFO: Record<Role, { label: string; description: string }> = {
  user: {
    label: "User",
    description: "Uses canvas. No access to the admin dashboard.",
  },
  support: {
    label: "Support",
    description:
      "Opens the admin dashboard to help people: edits names, confirms emails, gives complimentary memberships, sends reset links and signs accounts out. Can't change emails or roles, or edit staff.",
  },
  admin: {
    label: "Admin",
    description:
      "Everything support can do, for every account, plus changing emails and roles, the site's seasonal theme and how wild pandas turn up.",
  },
};

const PERMISSIONS = {
  /** Open /admin, search accounts, and see their details and history. */
  "admin:open": ["support", "admin"],
  /** Change names, confirm emails, send reset links, sign accounts out everywhere. */
  "users:edit": ["support", "admin"],
  /** Give and end complimentary memberships. */
  "memberships:comp": ["support", "admin"],
  /** Change an account's email address. */
  "users:email": ["admin"],
  /** Change roles, and edit staff (support and admin) accounts. */
  "users:roles": ["admin"],
  /** Site-wide settings: the seasonal theme and the wild pandas' rules. */
  "site:settings": ["admin"],
} as const satisfies Record<string, readonly Role[]>;

export type Permission = keyof typeof PERMISSIONS;

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}

export function can(role: Role, permission: Permission): boolean {
  return (PERMISSIONS[permission] as readonly Role[]).includes(role);
}

type Account = { id: string; role: Role };

/**
 * Whether `actor` may edit `target` at all. Staff accounts can only be
 * edited by admins, so support can't, say, sign an admin out.
 */
export function canManage(actor: Account, target: Account): boolean {
  if (!can(actor.role, "users:edit")) return false;
  return target.role === "user" || can(actor.role, "users:roles");
}

/** Why `actor` can't set `target`'s role, or null if they can. Nobody changes their own (so there's always an admin). */
export function roleChangeBlocked(actor: Account, target: Account): string | null {
  if (!can(actor.role, "users:roles")) return "Only admins can change roles.";
  if (actor.id === target.id) return "You can't change your own role. Ask another admin.";
  return null;
}
