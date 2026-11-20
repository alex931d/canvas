"use client";

import { Avatar, Tip } from "@/components/kit";
import type { Peer } from "@/lib/collab/peers";

/** Who else has this drawing open right now (one face per person). */
export function PeerAvatars({ peers }: { peers: Peer[] }) {
  const people = [...new Map(peers.map((p) => [p.userId, p])).values()];
  if (people.length === 0) return null;
  const shown = people.slice(0, 4);
  const more = people.length - shown.length;
  const names = people.map((p) => p.name).join(", ");
  return (
    <Tip content={`Also here: ${names}`}>
      <div
        className="flex shrink-0 items-center -space-x-2 max-sm:hidden"
        role="group"
        aria-label={`Also here: ${names}`}
        data-testid="peers"
      >
        {shown.map((p) => (
          <Avatar
            key={p.userId}
            name={p.name}
            src={p.avatarUrl}
            className="text-xs ring-[3px] ring-background"
            style={{ backgroundColor: p.color }}
          />
        ))}
        {more > 0 ? (
          <span className="grid size-9 place-items-center rounded-full bg-grey-900 text-xs font-bold text-white ring-[3px] ring-background">
            +{more}
          </span>
        ) : null}
      </div>
    </Tip>
  );
}
