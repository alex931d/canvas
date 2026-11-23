import { Skeleton } from "@/components/kit";

/**
 * Holds the place of the account button in a page header (phones) while the
 * session is read, so the header doesn't shift when it arrives.
 */
export function HeaderUserSlot() {
  return <Skeleton aria-hidden className="size-10 shrink-0 rounded-full md:hidden" />;
}
