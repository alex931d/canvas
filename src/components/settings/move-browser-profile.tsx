"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { BrowserProfile } from "@/lib/profile/browser-profile";

/**
 * For members: a picture or effect choices kept in this browser from before
 * they joined go into their account (and leave the browser). Renders nothing.
 */
export function MoveBrowserProfile({ userId }: { userId: string }) {
  const router = useRouter();
  useEffect(() => {
    let cancelled = false;
    void BrowserProfile.moveToAccount(userId).then((moved) => {
      if (moved && !cancelled) router.refresh(); // the menus show the account's picture now
    });
    return () => {
      cancelled = true;
    };
  }, [userId, router]);
  return null;
}
