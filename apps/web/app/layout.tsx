import type { Metadata, Viewport } from "next";
import "./globals.css";
import { INPUT_MODE_SCRIPT } from "./play/input-mode";

// Fonts load at runtime from Google Fonts (non-blocking). Builds no longer need network
// access (next/font/google fails offline); the CSS variables fall back to local cursive/sans.
export const metadata: Metadata = {
  title: "Notebook Fighters",
  description: "Draw a fighter in the notebook and fight: the computer, a friend on the same device, or online.",
};

// phones and tablets: no pinch / double-tap zoom while fighting, draw under the notch safely
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
  themeColor: "#f4efe2",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* touch pads or keyboard legend, decided before first paint (see play/input-mode.ts) */}
        <script dangerouslySetInnerHTML={{ __html: INPUT_MODE_SCRIPT }} />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Patrick+Hand&family=Source+Sans+3:wght@400;600;700&display=swap"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
