import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { ServiceWorkerRegister } from "@/components/sw-register";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: { default: "Aimplifi", template: "%s · Aimplifi" },
  description:
    "Know exactly how much money you need, and by when, to pay every card in full.",
  manifest: "/manifest.webmanifest",
  icons: { icon: "/icon.svg", apple: "/icon-192.png" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#10b981",
  // draw into the iOS safe areas so the fixed bottom tab bar can extend behind
  // the home indicator (its contents are padded back up via .pb-safe-bottom)
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    // font variables live on <html> — globals.css applies font-sans at the
    // html level, and CSS custom properties don't inherit upward (cycle-2 UI H1)
    <html lang="en" className={`dark ${geistSans.variable} ${geistMono.variable}`}>
      <body className="min-h-screen bg-background text-foreground antialiased">
        {children}
        <ServiceWorkerRegister />
      </body>
    </html>
  );
}
