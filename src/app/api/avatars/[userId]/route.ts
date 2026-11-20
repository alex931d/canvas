import { connection } from "next/server";
import { z } from "zod";
import { getCurrentSession } from "@/lib/auth/session";
import { getAvatar } from "@/lib/profile/server";

/**
 * Someone's profile picture, for anyone signed in (it shows next to their
 * name in shared drawings and in the admin dashboard). The URL carries the
 * picture's version (?v=), so the browser may keep it for good, privately.
 */
export async function GET(request: Request, ctx: RouteContext<"/api/avatars/[userId]">) {
  await connection();
  const { user } = await getCurrentSession();
  if (!user) return new Response("Sign in to see profile pictures", { status: 401 });

  const { userId } = await ctx.params;
  if (!z.uuid().safeParse(userId).success) return new Response("Not found", { status: 404 });
  const avatar = await getAvatar(userId);
  if (!avatar) return new Response("Not found", { status: 404 });

  // Only cache for good when the URL names this exact version.
  const v = new URL(request.url).searchParams.get("v");
  const current = v === avatar.updatedAt.getTime().toString(36);
  return new Response(new Uint8Array(avatar.bytes), {
    headers: {
      "Content-Type": avatar.mimeType,
      "Content-Length": String(avatar.bytes.byteLength),
      "Cache-Control": current ? "private, max-age=31536000, immutable" : "private, no-cache",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
    },
  });
}
