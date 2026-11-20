import { isRole, type Role } from "@/lib/auth/roles";

/**
 * The admin dashboard keeps all of its state in the URL, so a reload, the
 * Back button or a pasted link all show the same thing:
 *
 *   /admin?q=ada&role=support&status=members&page=3&user=<id>
 *
 * q       search over names and emails
 * role    user | support | admin
 * status  members | unconfirmed | staff
 * page    1-based
 * user    the account open in the edit panel
 *
 * Shared by the server (parsing) and the browser (building links).
 */

export const STATUSES = ["members", "unconfirmed", "staff"] as const;
export type Status = (typeof STATUSES)[number];

export type AdminQuery = {
  q: string;
  role: Role | null;
  status: Status | null;
  page: number;
  user: string | null;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Params = Record<string, string | string[] | undefined> | URLSearchParams;

/** Reads the URL's search params, ignoring anything that doesn't make sense. */
export function parseAdminQuery(params: Params): AdminQuery {
  const one = (k: string) => {
    const v = params instanceof URLSearchParams ? params.get(k) : params[k];
    return typeof v === "string" ? v : "";
  };
  const page = Number.parseInt(one("page"), 10);
  const status = one("status");
  return {
    q: one("q").trim().slice(0, 100),
    role: isRole(one("role")) ? (one("role") as Role) : null,
    status: (STATUSES as readonly string[]).includes(status) ? (status as Status) : null,
    page: Number.isFinite(page) && page > 0 ? page : 1,
    user: UUID.test(one("user")) ? one("user").toLowerCase() : null,
  };
}

/**
 * The dashboard's address for `query` with `changes` applied. Changing the
 * search or a filter goes back to page 1 unless a page is given; defaults
 * are left out so addresses stay short.
 */
export function adminHref(query: AdminQuery, changes: Partial<AdminQuery> = {}): string {
  const filtersChanged = "q" in changes || "role" in changes || "status" in changes;
  const next: AdminQuery = { ...query, ...(filtersChanged && !("page" in changes) ? { page: 1 } : {}), ...changes };
  const params = new URLSearchParams();
  if (next.q) params.set("q", next.q);
  if (next.role) params.set("role", next.role);
  if (next.status) params.set("status", next.status);
  if (next.page > 1) params.set("page", String(next.page));
  if (next.user) params.set("user", next.user);
  const search = params.toString();
  return search ? `/admin?${search}` : "/admin";
}

/** Up to five page numbers around `page`: ← 1 2 3 4 5 →, sliding along as you go. */
export function pageWindow(page: number, pageCount: number, size = 5): number[] {
  const start = Math.max(1, Math.min(page - Math.floor(size / 2), pageCount - size + 1));
  const end = Math.min(pageCount, start + size - 1);
  return Array.from({ length: end - start + 1 }, (_, i) => start + i);
}
