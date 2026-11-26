import { getCurrentSession } from "@/lib/auth/session";
import { SignedInLinks, SignedOutLinks } from "./site-chrome";

/** The public pages' header buttons: back into the app when signed in, else Log in and Open canvas (no account needed). */
export async function HeaderAccount() {
  const { user } = await getCurrentSession();
  return user ? <SignedInLinks /> : <SignedOutLinks />;
}
