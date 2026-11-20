import { SplitLayout } from "@/components/auth/split-layout";

/** Confirming an email and resetting a password: the login screens' frame, open whether or not you're signed in. */
export default function AccountLayout({ children }: { children: React.ReactNode }) {
  return <SplitLayout>{children}</SplitLayout>;
}
