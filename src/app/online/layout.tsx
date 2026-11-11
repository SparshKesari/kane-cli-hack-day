import type { Metadata } from "next";
import { onlineEvent } from "@/data/online";
import OnlineShell from "./Shell";

export const metadata: Metadata = {
  title: { absolute: onlineEvent.name, template: `%s · ${onlineEvent.name}` },
  description: onlineEvent.tagline,
  metadataBase: new URL("https://www.kaneclihack.sh"),
  // og:image comes from ./opengraph-image.tsx; X needs its own tag to show the large card.
  openGraph: { siteName: onlineEvent.name, type: "website" },
  twitter: { card: "summary_large_image", images: ["/online/opengraph-image"] },
};

export default function OnlineLayout({ children }: LayoutProps<"/online">) {
  return <OnlineShell>{children}</OnlineShell>;
}
