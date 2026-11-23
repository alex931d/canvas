import type { Metadata } from "next";
import "@fontsource-variable/public-sans/wght.css";
import "@fontsource/caveat/500.css";
import "./globals.css";
import { SIDEBAR_KEY } from "@/components/app-sidebar-key";
import { TipProvider, Toaster } from "@/components/kit";
import { MotionProvider } from "@/components/motion/provider";

export const metadata: Metadata = {
  title: "canvas",
  description: "An infinite canvas for notes and math, saved to Postgres as you draw.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // data-sidebar is set before the first paint (below), so React leaves it be.
    <html lang="en" className="h-full" suppressHydrationWarning>
      <head>
        {/* A minimized menu (src/components/app-sidebar.tsx) applies before anything is drawn. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `try{if(localStorage.getItem("${SIDEBAR_KEY}")==="1")document.documentElement.dataset.sidebar="collapsed"}catch(e){}`,
          }}
        />
      </head>
      <body className="flex min-h-full flex-col">
        <MotionProvider>
          <TipProvider>{children}</TipProvider>
        </MotionProvider>
        <Toaster />
      </body>
    </html>
  );
}
