import { Suspense, type ReactNode } from "react";
import Link from "next/link";
import PageHeader from "@/components/ui/PageHeader";
import { getStaff, hasRole, type Staff } from "@/server/auth";
import type { StaffRole } from "@/server/core";
import { AdminLogin } from "../parts";

// Shared layout bits for the admissions-ops pages: the page frame, the role
// gate (signed out → staff sign-in, wrong role → plain refusal), hairline
// stat cells and section labels. Server components only.

export function OpsPage({ eyebrow, dim, bright, intro, children }: { eyebrow: string; dim: string; bright: string; intro?: ReactNode; children: ReactNode }) {
  return (
    <main>
      <PageHeader eyebrow={`Ops / ${eyebrow}`} dim={dim} bright={bright} intro={intro} />
      <section className="py-10 sm:py-14">
        <div className="container-page">
          <Suspense fallback={<p className="font-plex text-sm text-lightgray">Loading…</p>}>{children}</Suspense>
        </div>
      </section>
    </main>
  );
}

/** A page meant for paper: a small screen-only header, no big title. */
export function PrintPage({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className="py-8">
      <div className="container-page">
        <h1 className="no-print mb-6 font-display text-2xl font-medium text-bright">{title}</h1>
        <Suspense fallback={<p className="font-plex text-sm text-lightgray">Loading…</p>}>{children}</Suspense>
      </div>
    </main>
  );
}

/** Render `children(staff)` only for staff with one of `roles` (admin passes). Pages still re-check in every action. */
export async function StaffGate({ roles, next, children }: { roles: StaffRole[]; next: string; children: (staff: Staff) => ReactNode | Promise<ReactNode> }) {
  const staff = await getStaff();
  if (!staff) return <AdminLogin next={next} />;
  if (!hasRole(staff, ...roles)) {
    return (
      <div className="max-w-xl space-y-3">
        <p className="font-plex text-sm text-bright">This section is for {roles.join(" / ")} staff.</p>
        <p className="font-plex text-sm text-lightgray">
          You&apos;re signed in as {staff.name} ({staff.role}). Ask an organizer if you need access.
        </p>
      </div>
    );
  }
  return <>{await children(staff)}</>;
}

export const labelCls = "font-pixel text-[10px] uppercase tracking-[0.2em] text-lightgray";

export function SectionLabel({ children, id, aside }: { children: ReactNode; id?: string; aside?: ReactNode }) {
  return (
    <div id={id} className="mb-4 flex scroll-mt-24 flex-wrap items-baseline justify-between gap-3 border-b border-dashed border-hairline pb-2">
      <h2 className="font-display text-lg font-medium text-bright sm:text-xl">{children}</h2>
      {aside && <div className="font-plex text-xs text-lightgray">{aside}</div>}
    </div>
  );
}

/** A grid of hairline stat cells. `value: null` renders "—" (unknown), never 0. */
export function Stats({ items, cols = "sm:grid-cols-3 lg:grid-cols-6" }: { items: { label: string; value: number | string | null; hint?: ReactNode; href?: string }[]; cols?: string }) {
  return (
    <dl className={`grid grid-cols-2 border-t border-l border-hairline ${cols}`}>
      {items.map((s) => {
        const body = (
          <>
            <dt className={labelCls}>{s.label}</dt>
            <dd className="mt-2 font-dots text-4xl leading-none font-black text-bright sm:text-5xl">{s.value ?? "—"}</dd>
            {s.hint && <dd className="mt-2 font-plex text-xs text-lightgray">{s.hint}</dd>}
          </>
        );
        return (
          <div key={s.label} className="border-r border-b border-hairline">
            {s.href ? (
              <Link href={s.href} className="block min-h-11 p-4 transition-colors hover:bg-surface">
                {body}
              </Link>
            ) : (
              <div className="p-4">{body}</div>
            )}
          </div>
        );
      })}
    </dl>
  );
}

/** A bracketed panel for a form or a block of related controls. */
export function Panel({ title, children, className = "", id }: { title?: ReactNode; children: ReactNode; className?: string; id?: string }) {
  return (
    <div id={id} className={`brackets scroll-mt-24 border border-hairline bg-surface p-4 sm:p-6 ${className}`}>
      {title && <p className={`${labelCls} mb-4`}>{title}</p>}
      {children}
    </div>
  );
}

/** Tab-like links between sibling ops pages. */
export function SubNav({ items, current }: { items: { href: string; label: string }[]; current: string }) {
  return (
    <nav aria-label="Section" className="mb-8 flex flex-wrap gap-2">
      {items.map((i) => (
        <Link
          key={i.href}
          href={i.href}
          aria-current={i.href === current ? "page" : undefined}
          className={`inline-flex min-h-11 items-center border px-3 font-plex text-xs transition-colors ${
            i.href === current ? "border-lime bg-lime-deep text-lime" : "border-hairline text-bright hover:border-lime hover:text-lime"
          }`}
        >
          {i.label}
        </Link>
      ))}
    </nav>
  );
}

export const fmtTime = (d: Date | string | null | undefined, tz = "America/Los_Angeles") =>
  d ? new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: tz, timeZoneName: "short" }).format(new Date(d)) : "—";
