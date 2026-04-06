import type { Metadata } from "next";
import { Inter, Syne } from "next/font/google";
import "./globals.css";

/**
 * Inter — Apple's closest web-safe equivalent to SF Pro.
 * Used for all body text, captions, and UI labels.
 */
const inter = Inter({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
  variable: "--font-inter-var",
});

/**
 * Syne — Used only for the dashboard title / display text.
 */
const syne = Syne({
  subsets: ["latin"],
  weight: ["600", "700", "800"],
  variable: "--font-syne-var",
});

export const metadata: Metadata = {
  title: "Life Dashboard",
  description: "Your personal life command center",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${syne.variable} h-full antialiased`}
      /* System font stack: SF Pro on Apple devices, Inter everywhere else */
      style={{
        fontFamily:
          "-apple-system, BlinkMacSystemFont, var(--font-inter-var), 'Helvetica Neue', sans-serif",
      }}
    >
      <body className="min-h-full">{children}</body>
    </html>
  );
}
