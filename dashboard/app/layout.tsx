import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";

// Fonts ship with the app (app/fonts, OFL-1.1, latin variable weights from
// Fontsource). next/font/google downloads them from Google at *build* time,
// and that download failed twice in two days — an Amplify build on
// 2026-10-02 and the CI dashboard check on 2026-10-03 — each time blocking a
// release that had nothing to do with fonts. Local files make the build
// independent of fonts.gstatic.com; next/font still self-hosts and preloads
// them, so a late webfont never shifts the landing headline after paint.
const inter = localFont({
  src: "./fonts/inter-latin-wght-normal.woff2",
  variable: "--font-inter",
  weight: "100 900",
  display: "swap",
});
const jetbrains = localFont({
  src: "./fonts/jetbrains-mono-latin-wght-normal.woff2",
  variable: "--font-jetbrains",
  weight: "100 800",
  display: "swap",
});
// Geist carries the marketing pages.
const geist = localFont({
  src: "./fonts/geist-latin-wght-normal.woff2",
  variable: "--font-geist",
  weight: "100 900",
  display: "swap",
});
const geistMono = localFont({
  src: "./fonts/geist-mono-latin-wght-normal.woff2",
  variable: "--font-geist-mono",
  weight: "100 900",
  display: "swap",
});

const DESCRIPTION = "Canary rollouts for prompts and models: real traffic, judged quality, automatic rollback.";

export const metadata: Metadata = {
  metadataBase: new URL("https://tryrepath.com"),
  title: { default: "Repath — Progressive Delivery for AI", template: "%s — Repath" },
  description: DESCRIPTION,
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    siteName: "Repath",
    url: "https://tryrepath.com",
    title: "Repath — Progressive Delivery for AI",
    description: DESCRIPTION,
  },
  twitter: { card: "summary_large_image", title: "Repath — Progressive Delivery for AI", description: DESCRIPTION },
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
