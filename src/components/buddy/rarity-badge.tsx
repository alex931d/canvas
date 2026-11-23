import { RARITY, type Rarity } from "@/lib/buddy/kinds";
import { cn } from "@/lib/utils";

/** How rare a panda is, as a small pill in its rarity's colours (super rare gets a shimmer). */
export function RarityBadge({ rarity, className }: { rarity: Rarity; className?: string }) {
  const { label, badge } = RARITY[rarity];
  return (
    <span
      data-ui="rarity"
      data-rarity={rarity}
      className={cn(
        "inline-flex h-5 shrink-0 items-center rounded-full px-2 text-[11px] font-bold whitespace-nowrap",
        rarity === "superRare" && "buddy-shimmer",
        className,
      )}
      style={{ backgroundColor: badge.bg, color: badge.fg }}
    >
      {label}
    </span>
  );
}
