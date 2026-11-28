import { getCurrentSession } from "@/lib/auth/session";
import { getAiAllowance } from "@/lib/billing/ai-quota";
import { getMembership } from "@/lib/billing/membership";

/** GET -> this month's AI allowance { used, limit, left, resetsAt }, for members. */
export async function GET() {
  const { user } = await getCurrentSession();
  if (!user) return Response.json({ error: "Sign in first." }, { status: 401 });
  if (!(await getMembership(user.id)).isMember) return Response.json({ error: "The AI tools are part of the membership." }, { status: 402 });
  return Response.json(await getAiAllowance(user.id), { headers: { "Cache-Control": "no-store" } });
}
