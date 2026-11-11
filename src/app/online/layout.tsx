import type { Metadata } from "next";
import { onlineEvent } from "@/data/online";
import OnlineShell from "./Shell";

export const metadata: Metadata = {
  title: { absolute: onlineEvent.name, template: `%s · ${onlineEvent.name}` },
  description: onlineEvent.tagline,
};

export default function OnlineLayout({ children }: LayoutProps<"/online">) {
  return <OnlineShell>{children}</OnlineShell>;
}
