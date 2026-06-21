import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
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

export const metadata: Metadata = {
  title: "Repath — Progressive Delivery for AI",
  description: "Canary deployments, quality evaluation, and instant rollback for LLM systems.",
  icons: {
    icon: [
      { url: "/repath.ico", type: "image/x-icon" },
      { url: "/repath.png", type: "image/png" },
    ],
    apple: "/repath.png",
    shortcut: "/repath.ico",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${jetbrains.variable}`} suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
