import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { Geist_Mono } from "next/font/google";
import localFont from "next/font/local";
import { ThemeProvider } from "next-themes";
import "./globals.css";
import { SettingsProvider } from "@/contexts/settings-context";
import { Toaster } from "@/components/ui/sonner";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { DesktopWindowControls } from "@/components/desktop/window-controls";
import { DesktopAppReady } from "@/components/desktop/app-ready";
import { InputModality } from "@/components/input-modality";
import { BrowserConnectionSync } from "@/components/browser-connection-sync";

const sunghyunSans = localFont({
    src: [
        { path: "./fonts/sunghyun-sans/SunghyunSans-Thin.woff2", weight: "100", style: "normal" },
        { path: "./fonts/sunghyun-sans/SunghyunSans-ExtraLight.woff2", weight: "200", style: "normal" },
        { path: "./fonts/sunghyun-sans/SunghyunSans-Light.woff2", weight: "300", style: "normal" },
        { path: "./fonts/sunghyun-sans/SunghyunSans-Regular.woff2", weight: "400", style: "normal" },
        { path: "./fonts/sunghyun-sans/SunghyunSans-Medium.woff2", weight: "500", style: "normal" },
        { path: "./fonts/sunghyun-sans/SunghyunSans-SemiBold.woff2", weight: "600", style: "normal" },
        { path: "./fonts/sunghyun-sans/SunghyunSans-Bold.woff2", weight: "700", style: "normal" },
        { path: "./fonts/sunghyun-sans/SunghyunSans-ExtraBold.woff2", weight: "800", style: "normal" },
        { path: "./fonts/sunghyun-sans/SunghyunSans-Black.woff2", weight: "900", style: "normal" },
    ],
    variable: "--font-sunghyun-sans",
    display: "swap",
    preload: false,
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  interactiveWidget: "resizes-content",
};

export const metadata: Metadata = {
  title: "Navigator",
  description: "A modern streaming client powered by Stremio",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: ReactNode;
}>) {
  const enableVercelTelemetry =
    process.env.ELECTRON !== "true" && process.env.VERCEL === "1";

  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${sunghyunSans.variable} ${geistMono.variable} ${sunghyunSans.className}`}
    >
      <head>
        <meta name="apple-mobile-web-app-title" content="Navigator" />
      </head>
      <body
        className={`${sunghyunSans.className} antialiased`}
      >
        <ThemeProvider
          attribute={["class", "data-theme"]}
          defaultTheme="dark"
          enableSystem
          disableTransitionOnChange
        >
          <InputModality />
          <DesktopAppReady />
          <DesktopWindowControls />
          <BrowserConnectionSync />
          <SettingsProvider>{children}</SettingsProvider>
          <Toaster />
        </ThemeProvider>
        {enableVercelTelemetry ? <Analytics /> : null}
        {enableVercelTelemetry ? <SpeedInsights /> : null}
      </body>
    </html>
  );
}
