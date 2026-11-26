"use client";

import { Check } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Button, Dialog, DialogClose, DialogContent, DialogFooter } from "@/components/kit";
import { MEMBER_FEATURES, MEMBERSHIP, MEMBERSHIP_INCLUDES, type MemberFeature } from "@/lib/billing/plan";

/**
 * What someone on the free plan sees when they reach for a member feature:
 * what it does, what the membership includes, and the way to it.
 */
export function UpgradeDialog({
  feature,
  onClose,
}: {
  /** The feature they reached for; null keeps it closed. */
  feature: MemberFeature | null;
  onClose: () => void;
}) {
  // Keep showing the last feature while the dialog animates closed.
  const [shown, setShown] = useState(feature);
  if (feature && feature !== shown) setShown(feature);
  const info = shown ? MEMBER_FEATURES[shown] : null;

  return (
    <Dialog open={feature !== null} onOpenChange={(open) => !open && onClose()}>
      {info ? (
        <DialogContent title={info.title} description={info.text} data-testid="upgrade-dialog" data-feature={shown}>
          <div className="rounded-xl bg-grey-900 p-5 text-white">
            <p className="flex items-baseline gap-2">
              <span className="text-[34px] leading-none font-extrabold tracking-[-0.03em]">{MEMBERSHIP.price}</span>
              <span className="text-grey-300">{MEMBERSHIP.per}</span>
            </p>
            <ul className="mt-4 space-y-2 text-sm">
              {MEMBERSHIP_INCLUDES.map((item) => (
                <li key={item} className="flex items-start gap-2.5">
                  <Check className="mt-0.5 size-4 shrink-0 text-cyan" aria-hidden />
                  {item}
                </li>
              ))}
            </ul>
          </div>
          <p className="text-sm leading-relaxed text-grey-500">
            When you join, the drawings saved in this browser move into your account, pictures and all.
          </p>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="secondary" size="lg">
                Not now
              </Button>
            </DialogClose>
            <Button asChild size="lg">
              <Link href="/pricing">See the membership</Link>
            </Button>
          </DialogFooter>
        </DialogContent>
      ) : null}
    </Dialog>
  );
}
