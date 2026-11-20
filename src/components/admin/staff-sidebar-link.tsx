import { ShieldCheck } from "lucide-react";
import { SidebarLink } from "@/components/app-sidebar";
import { can } from "@/lib/auth/roles";
import { getCurrentSession } from "@/lib/auth/session";

/** "Admin" in the sidebar, for support and admin roles only. Reads the session, so render it inside <Suspense>. */
export async function StaffSidebarLink() {
  const { user } = await getCurrentSession();
  if (!user || !can(user.role, "admin:open")) return null;
  return <SidebarLink href="/admin" icon={<ShieldCheck />} label="Admin" />;
}
