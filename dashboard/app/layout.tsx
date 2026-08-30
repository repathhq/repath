import type { Metadata } from "next";
import { Inter, JetBrains_Mono, Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});
const jetbrains = JetBrains_Mono({
  variable: "--font-jetbrains",
  subsets: ["latin"],
  display: "swap",
});
// Geist carries the marketing pages. Loaded through next/font rather than a
// Google Fonts <link> so it is self-hosted and preloaded — a webfont that
// arrives late on a landing page shifts the headline after paint.
const geist = Geist({
  variable: "--font-geist",
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
  display: "swap",
});
const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Repath — Progressive Delivery for AI",
  description: "Canary deployments, quality evaluation, and instant rollback for LLM systems.",
  icons: {
    icon: "/favicon.ico",
    apple: "/repath.png",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${jetbrains.variable} ${geist.variable} ${geistMono.variable}`} suppressHydrationWarning>
      <head>
        {/*
          Applies the saved landing-page theme before first paint.

          This has to be a blocking inline script: doing it in an effect means
          the browser paints the light theme, hydrates, then repaints dark —
          a flash on every load for anyone who chose dark. Only sets an
          attribute; the CSS in landing.css reads it, and nothing else does.
        */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('repath-landing-theme');if(t!=='dark'&&t!=='light'){t=window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'}document.documentElement.dataset.lpTheme=t}catch(e){document.documentElement.dataset.lpTheme='light'}})()`,
          }}
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
