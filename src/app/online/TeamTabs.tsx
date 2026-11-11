import Link from "next/link";

// The switch a team sees on top of both of its pages: edit the submission, or
// look at the public showcase page it produces.
export default function TeamTabs({ slug, current }: { slug: string; current: "submission" | "showcase" }) {
  const tabs = [
    { id: "submission", label: "Submission", href: "/online/submit" },
    { id: "showcase", label: "Showcase page", href: `/online/p/${slug}` },
  ] as const;
  return (
    <nav aria-label="Your project" className="inline-flex border border-hairline font-plex text-sm">
      {tabs.map((t) => (
        <Link
          key={t.id}
          href={t.href}
          aria-current={t.id === current ? "page" : undefined}
          className={`px-4 py-2 transition-colors ${t.id === current ? "bg-lime text-ink" : "text-lightgray hover:text-bright"}`}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
