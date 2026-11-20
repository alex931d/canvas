/** Only same-site paths, so ?next= can't send people to another website. */
export function safeNext(raw: unknown): string {
  const next = typeof raw === "string" ? raw : "";
  return next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/\\") ? next : "/";
}

/** Where to send someone who still has to confirm their email, keeping where they were headed. */
export function verifyEmailPath(next: string): string {
  if (next.startsWith("/verify-email")) return next; // they followed the link in the email
  return next === "/" ? "/verify-email" : `/verify-email?next=${encodeURIComponent(next)}`;
}
