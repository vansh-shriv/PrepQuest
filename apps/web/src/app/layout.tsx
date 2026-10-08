import type { Metadata } from "next";
import { Inter, JetBrains_Mono, Press_Start_2P, Silkscreen, VT323 } from "next/font/google";
import type { ReactNode } from "react";
import { THEME_INIT_SCRIPT } from "@prepquest/ui";
import { AuthProvider } from "@/lib/auth-context";
import "./globals.css";

const display = Press_Start_2P({ weight: "400", subsets: ["latin"], variable: "--nf-display" });
const ui = Silkscreen({ weight: ["400", "700"], subsets: ["latin"], variable: "--nf-ui" });
const pixel = VT323({ weight: "400", subsets: ["latin"], variable: "--nf-pixel" });
const read = Inter({ subsets: ["latin"], variable: "--nf-read" });
const code = JetBrains_Mono({ subsets: ["latin"], variable: "--nf-code" });

export const metadata: Metadata = {
  title: "PrepQuest",
  description: "Level up for placements.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  const fonts = [display, ui, pixel, read, code].map((f) => f.variable).join(" ");
  return (
    <html lang="en" data-theme="cream" suppressHydrationWarning className={fonts}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body>
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
