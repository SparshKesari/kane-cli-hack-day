import type { Metadata } from "next";
import { Doto, IBM_Plex_Mono, Inter_Tight, Silkscreen } from "next/font/google";
import "./globals.css";
import { Suspense } from "react";
import Account, { SignedOut } from "@/components/Account";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import KaneCta from "@/components/KaneCta";
import { event } from "@/data/hackday";

// Wordmark and large display type.
const display = Inter_Tight({
  variable: "--font-display",
  subsets: ["latin"],
  weight: ["400", "500", "700"],
});

// Dot-matrix section headings and big numbers.
const dots = Doto({
  variable: "--font-dots",
  subsets: ["latin"],
  weight: ["700", "900"],
});

// Body copy, labels and code.
const plex = IBM_Plex_Mono({
  variable: "--font-plex-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
});

// Small uppercase eyebrows.
const pixel = Silkscreen({
  variable: "--font-pixel-mono",
  subsets: ["latin"],
  weight: "400",
});

export const metadata: Metadata = {
  title: { default: `${event.name} ${event.city}`, template: `%s · ${event.name}` },
  description: event.tagline,
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${display.variable} ${dots.variable} ${plex.variable} ${pixel.variable} h-full scroll-smooth antialiased`}
    >
      <body className="flex min-h-full flex-col">
        <Navbar
          account={
            <Suspense fallback={<SignedOut />}>
              <Account />
            </Suspense>
          }
        />
        <div className="flex-1">{children}</div>
        <Footer />
        <Suspense fallback={null}>
          <KaneCta />
        </Suspense>
      </body>
    </html>
  );
}
