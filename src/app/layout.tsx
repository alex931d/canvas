import type { Metadata } from "next";
import "@fontsource-variable/public-sans/wght.css";
import "@fontsource/caveat/500.css";
import "./globals.css";
import { TipProvider, Toaster } from "@/components/kit";
import { MotionProvider } from "@/components/motion/provider";

export const metadata: Metadata = {
  title: "canvas",
  description: "An infinite canvas for notes and math, saved to Postgres as you draw.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full">
      <body className="flex min-h-full flex-col">
        <MotionProvider>
          <TipProvider>{children}</TipProvider>
        </MotionProvider>
        <Toaster />
      </body>
    </html>
  );
}
