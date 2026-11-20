/** Colours for other people's cursors: dark enough for white name labels. */
const PEER_COLORS = ["#277c78", "#c94736", "#3f82b2", "#826cb0", "#a85a3a", "#626070", "#8a6d1f", "#2e6b4f"];

/** The same person gets the same colour in every tab and on every device. */
export function peerColor(userId: string): string {
  let h = 0;
  for (let i = 0; i < userId.length; i++) h = (h * 31 + userId.charCodeAt(i)) >>> 0;
  return PEER_COLORS[h % PEER_COLORS.length];
}

export type Peer = {
  clientId: string;
  userId: string;
  name: string;
  /** Profile picture URL, or null for initials. */
  avatarUrl: string | null;
  color: string;
  /** World coordinates, or null when their pointer is off the canvas. */
  cursor: { x: number; y: number } | null;
  selection: string[];
  seenAt: number;
};
