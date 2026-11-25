import "server-only";

import { connection } from "next/server";

/**
 * The address people can write to: CONTACT_EMAIL, else the one in EMAIL_FROM
 * ("canvas <hello@…>") unless it's a no-reply address, else null (set
 * CONTACT_EMAIL in production). Read when the page is served, so a Docker
 * image built without .env shows it.
 */
export async function contactEmail(): Promise<string | null> {
  await connection();
  const explicit = process.env.CONTACT_EMAIL?.trim();
  if (explicit) return explicit;
  const from = process.env.EMAIL_FROM?.trim() ?? "";
  const address = from.match(/<([^>]+)>/)?.[1] ?? (from.includes("@") ? from : "");
  return address && !/^no-?reply@/i.test(address) && !address.endsWith("@localhost") ? address : null;
}
