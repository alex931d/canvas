import { getCurrentSession } from "@/lib/auth/session";
import { SignedInLinks, SignedOutLinks } from "./site-chrome";

/** The public pages' header buttons: back into the app when signed in, else Log in and Create account. */
export async function HeaderAccount() {
  const { user } = await getCurrentSession();
  return user ? <SignedInLinks /> : <SignedOutLinks />;
}
