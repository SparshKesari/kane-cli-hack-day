"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { inputCls } from "@/components/forms/fields";
import StatusPill from "@/components/ui/StatusPill";
import ActionForm, { TextField } from "../_kit/ActionForm";
import { activationCodeAction, admitMemberAction, checkInAction, signInCodeAction, walkInAction } from "./actions";
import { admissionLabel } from "./labels";

// Check-in desk client pieces: search box with an optional camera scanner,
// one row per person with the right action, and the walk-in form.

export function SearchBox({ q }: { q: string }) {
  const router = useRouter();
  const [value, setValue] = useState(q);
  const [scanning, setScanning] = useState(false);
  const go = (s: string) => router.push(`/ops/checkin?q=${encodeURIComponent(s.trim())}`);
  return (
    <div className="space-y-3">
      <form
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          go(value);
        }}
        className="flex flex-col gap-2 sm:flex-row"
      >
        <label htmlFor="checkin-q" className="sr-only">
          Search by name, P-code, Luma guest id or email
        </label>
        <input
          id="checkin-q"
          name="q"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Name, P-1234, Luma id or exact email"
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          inputMode="search"
          // The desk's main input: focus it so staff can type straight away.
          autoFocus
          className={`${inputCls} min-h-12 text-base`}
        />
        <div className="flex gap-2">
          <button type="submit" className="inline-flex min-h-12 flex-1 items-center justify-center bg-bright px-5 font-plex text-sm text-ink hover:bg-lime sm:flex-none">
            Search
          </button>
          <button
            type="button"
            onClick={() => setScanning((s) => !s)}
            aria-pressed={scanning}
            className="inline-flex min-h-12 flex-1 items-center justify-center border border-hairline px-4 font-plex text-sm text-bright hover:border-lime hover:text-lime sm:flex-none"
          >
            {scanning ? "Stop scan" : "Scan QR"}
          </button>
        </div>
      </form>
      {scanning && (
        <Scanner
          onCode={(raw) => {
            setScanning(false);
            const code = extractCode(raw);
            setValue(code);
            go(code);
          }}
        />
      )}
    </div>
  );
}

/** A badge QR holds a check-in URL (…/ops/checkin?q=P-1234); a plain code works too. */
function extractCode(raw: string) {
  try {
    const u = new URL(raw);
    return u.searchParams.get("q") ?? raw;
  } catch {
    return raw.trim().slice(0, 120);
  }
}

type Detector = { detect: (src: HTMLVideoElement) => Promise<{ rawValue: string }[]> };

/**
 * Camera QR scan with the browser's BarcodeDetector (Chrome/Android, recent
 * Safari). Where it's missing, say so: the phone's own camera app opens the
 * badge URL directly, and typing the P-code always works.
 */
function Scanner({ onCode }: { onCode: (s: string) => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const handler = useRef(onCode);
  useEffect(() => {
    handler.current = onCode;
  }, [onCode]);
  const [error, setError] = useState<string | null>(() =>
    typeof window !== "undefined" && !("BarcodeDetector" in window) ? "This browser can't scan in-page. Use the phone's camera app on the badge, or type the P-code." : null,
  );
  useEffect(() => {
    if (error) return;
    let stream: MediaStream | null = null;
    let stop = false;
    const Ctor = (window as unknown as { BarcodeDetector: new (o: { formats: string[] }) => Detector }).BarcodeDetector;
    const detector = new Ctor({ formats: ["qr_code"] });
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
        if (!video.current) return;
        video.current.srcObject = stream;
        await video.current.play();
        while (!stop) {
          const found = await detector.detect(video.current).catch(() => []);
          if (found[0]?.rawValue) {
            handler.current(found[0].rawValue);
            return;
          }
          await new Promise((r) => setTimeout(r, 250));
        }
      } catch {
        setError("Camera unavailable or permission denied. Type the P-code instead.");
      }
    })();
    return () => {
      stop = true;
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [error]);
  if (error) {
    return (
      <p role="status" className="border-l-2 border-warning pl-3 font-plex text-sm text-warning">
        {error}
      </p>
    );
  }
  return (
    <div className="max-w-sm border border-hairline bg-surface p-2">
      <video ref={video} playsInline muted className="aspect-square w-full object-cover" aria-label="Camera preview for scanning a badge QR" />
      <p className="mt-2 font-plex text-xs text-lightgray">Point at the badge QR. Nothing is recorded.</p>
    </div>
  );
}

export type Hit = {
  key: string;
  guestId: number | null;
  memberId: number | null;
  name: string;
  displayName: string | null;
  publicCode: string | null;
  teamName: string | null;
  source: string;
  approval: string | null;
  admission: string | null;
  memberAdmission: string | null;
  emailHint: string | null;
  checkedInAt: string | null;
  checkedInLabel: string | null;
  activated: boolean;
  checklist?: string | null;
  admissionBasis: string | null;
  admittedByName: string | null;
  admittedAt: string | null;
  admittedLabel: string | null;
  admissionReason: string | null;
  checkedInByName: string | null;
  checkinSource: string | null;
  checkinRef: string | null;
  checkinEnteredAt: string | null;
  enteredLabel: string | null;
};

/** Admission and attendance as two lines: who let them in and why, then when they checked in and how. */
function Provenance({ hit }: { hit: Hit }) {
  if (!hit.guestId) return null;
  return (
    <dl className="mt-2 grid gap-1 font-plex text-xs text-lightgray sm:grid-cols-[auto_1fr] sm:gap-x-3">
      <dt className="font-pixel text-[10px] uppercase tracking-[0.2em]">Admission</dt>
      <dd data-admission-basis={hit.admissionBasis ?? "roster"}>
        <span className={hit.admissionBasis ? "text-warning" : "text-bright"}>{admissionLabel(hit.admissionBasis, hit.source)}</span>
        {hit.admissionBasis && (
          <>
            {" "}
            · by {hit.admittedByName ?? "staff"}
            {hit.admittedLabel && <time dateTime={hit.admittedAt ?? undefined}> at {hit.admittedLabel}</time>}
            {hit.admissionReason && <> · “{hit.admissionReason}”</>}
          </>
        )}
      </dd>
      <dt className="font-pixel text-[10px] uppercase tracking-[0.2em]">Attendance</dt>
      <dd data-checkin-source={hit.checkinSource ?? (hit.checkedInAt ? "unknown" : "none")}>
        {hit.checkedInAt ? (
          <>
            <span className="text-bright">Checked in</span> <time dateTime={hit.checkedInAt}>{hit.checkedInLabel}</time>
            {hit.checkinSource === "offline_ledger"
              ? ` · paper slip ${hit.checkinRef ?? ""}, entered ${hit.enteredLabel ?? "later"} by ${hit.checkedInByName ?? "staff"}`
              : hit.checkedInByName
                ? ` · at the desk by ${hit.checkedInByName}`
                : ""}
          </>
        ) : (
          "Not checked in yet"
        )}
      </dd>
    </dl>
  );
}

const SOURCE_LABEL: Record<string, string> = { luma_csv: "Luma", walk_in: "Walk-in", manual_offline: "Paper", api: "Added by API", registration: "Site only" };

export function HitRow({ hit, canOverride }: { hit: Hit; canOverride: boolean }) {
  const [overriding, setOverriding] = useState(false);
  const status = hit.checkedInAt ? (
    // A paper slip entered later is a staff record, not a desk-verified scan.
    hit.checkinSource === "offline_ledger" ? (
      <StatusPill tone="unverified">Paper · in {hit.checkedInLabel}</StatusPill>
    ) : (
      <StatusPill tone="verified">Verified · in {hit.checkedInLabel}</StatusPill>
    )
  ) : hit.source === "registration" ? (
    <StatusPill tone="pending">No roster match</StatusPill>
  ) : hit.admission === "admitted" ? (
    <StatusPill tone="accent">Admitted · check in</StatusPill>
  ) : hit.admission === "needs_reconciliation" ? (
    <StatusPill tone="pending">Needs reconciliation</StatusPill>
  ) : (
    <StatusPill tone="danger">Not admitted · {hit.approval?.replace("_", " ") ?? hit.admission}</StatusPill>
  );

  return (
    <li className="border-b border-dashed border-hairline py-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-display text-lg text-bright">
            {hit.name}
            {hit.displayName && hit.displayName !== hit.name && <span className="text-lightgray"> · “{hit.displayName}”</span>}
          </p>
          <p className="mt-1 font-plex text-xs break-words text-lightgray">
            {[hit.publicCode, hit.teamName ? `team ${hit.teamName}` : "no team yet", SOURCE_LABEL[hit.source] ?? hit.source, hit.guestId ? `source ${hit.source}` : null, hit.emailHint].filter(Boolean).join(" · ")}
          </p>
          <Provenance hit={hit} />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {status}
          {hit.publicCode && (
            <Link href={`/ops/checkin/badge/${encodeURIComponent(hit.publicCode)}`} className="inline-flex min-h-11 items-center px-2 font-plex text-xs text-lightgray underline-offset-4 hover:text-lime hover:underline">
              Badge
            </Link>
          )}
        </div>
      </div>

      {!hit.checkedInAt && hit.guestId && hit.admission === "admitted" && (
        <ActionForm
          action={checkInAction}
          submit={`Check in ${hit.name.split(" ")[0]} →`}
          pending="Checking in…"
          className="mt-3"
          render={(s) => (
            <div className="space-y-1 border-l-2 border-verified pl-3 font-plex text-sm">
              <p className="text-bright">{s.message}</p>
              <ActivationSlip activation={(s.data as { activation?: Activation } | undefined)?.activation} />
            </div>
          )}
        >
          <input type="hidden" name="guest_id" value={hit.guestId} />
        </ActionForm>
      )}

      {!hit.checkedInAt && hit.guestId && hit.admission !== "admitted" && (
        <div className="mt-3">
          {canOverride ? (
            overriding ? (
              <ActionForm action={checkInAction} submit="Admit and check in" pending="Admitting…" variant="secondary" className="max-w-lg">
                <input type="hidden" name="guest_id" value={hit.guestId} />
                <input type="hidden" name="override" value="on" />
                <TextField id={`reason-${hit.key}`} name="reason" label="Why admit?" hint="required · audited" required placeholder="e.g. on Luma waitlist, venue has space" maxLength={300} />
              </ActionForm>
            ) : (
              <button type="button" onClick={() => setOverriding(true)} className="inline-flex min-h-11 items-center border border-hairline px-3 font-plex text-xs text-bright hover:border-lime hover:text-lime">
                Organizer: admit anyway…
              </button>
            )
          ) : (
            <p className="font-plex text-xs text-warning">Ask an organizer: this guest isn&apos;t approved on the roster.</p>
          )}
        </div>
      )}

      {!hit.checkedInAt && !hit.guestId && hit.memberId && (
        <ActionForm
          action={admitMemberAction}
          submit="Admit as walk-in and check in"
          pending="Admitting…"
          variant="secondary"
          className="mt-3"
          render={(s) => (
            <div className="space-y-1 border-l-2 border-verified pl-3 font-plex text-sm">
              <p className="text-bright">{s.message}</p>
              <ActivationSlip activation={(s.data as { activation?: Activation } | undefined)?.activation} />
            </div>
          )}
        >
          <input type="hidden" name="member_id" value={hit.memberId} />
        </ActionForm>
      )}

      {hit.checklist && <p className="mt-2 font-plex text-xs text-lightgray" data-checklist>{hit.checklist}</p>}

      {hit.checkedInAt && !hit.activated && (hit.memberId || hit.guestId) && (
        <ActionForm
          action={activationCodeAction}
          submit="Activation code"
          pending="Making code…"
          className="mt-3"
          render={(s) => <ActivationSlip activation={(s.data as { activation?: Activation } | undefined)?.activation} />}
        >
          {hit.memberId ? <input type="hidden" name="member_id" value={hit.memberId} /> : <input type="hidden" name="guest_id" value={hit.guestId ?? ""} />}
        </ActionForm>
      )}

      {hit.memberId && hit.activated && (
        <ActionForm
          action={signInCodeAction}
          submit="One-time sign-in code"
          pending="Making code…"
          variant="secondary"
          className="mt-3"
          render={(s) => (
            <div className="space-y-1 border-l-2 border-verified pl-3 font-plex text-sm">
              <p className="font-dots text-3xl tracking-[0.1em] text-bright">{(s.data as { code?: string } | undefined)?.code}</p>
              <p className="text-xs text-lightgray">{s.message}</p>
            </div>
          )}
        >
          <input type="hidden" name="member_id" value={hit.memberId} />
        </ActionForm>
      )}
    </li>
  );
}

type Activation = { code: string; url: string; expires_at: string } | null | undefined;

/** The code a participant types at kaneclihack.sh/activate: it signs them in as themselves. */
function ActivationSlip({ activation }: { activation: Activation }) {
  if (!activation) return null;
  return (
    <div className="mt-2 space-y-1 border border-dashed border-hairline p-3">
      <p className="font-pixel text-[10px] uppercase tracking-[0.2em] text-lightgray">Activation code · give it to them</p>
      <p className="font-dots text-4xl tracking-[0.1em] text-bright">{activation.code}</p>
      <p className="text-xs text-lightgray">
        On their laptop: kaneclihack.sh/activate, this code and their Luma email. Signs them in as themselves; works once, for 24 hours.
      </p>
    </div>
  );
}

export function WalkInForm() {
  return (
    <ActionForm
      action={walkInAction}
      submit="Admit walk-in →"
      pending="Admitting…"
      render={(s) => {
        const d = s.data as { publicCode?: string | null; name?: string } | undefined;
        return (
          <div className="space-y-2 border-l-2 border-verified pl-3 font-plex text-sm">
            <p className="text-bright">{s.message}</p>
            <p className="text-xs text-lightgray">Admission: staff walk-in exception · source walk_in. Attendance: checked in now, recorded separately.</p>
            {d?.publicCode && (
              <p>
                <span className="font-dots text-4xl font-black text-bright">{d.publicCode}</span>
                <Link href={`/ops/checkin/badge/${encodeURIComponent(d.publicCode)}`} className="ml-4 inline-flex min-h-11 items-center underline underline-offset-4 hover:text-lime">
                  Print or show badge →
                </Link>
                <Link href={`/ops/checkin?q=${encodeURIComponent(d.publicCode)}`} className="ml-4 inline-flex min-h-11 items-center underline underline-offset-4 hover:text-lime">
                  Open their roster row →
                </Link>
              </p>
            )}
            <ActivationSlip activation={(s.data as { activation?: Activation } | undefined)?.activation} />
            {s.receipt && <p className="text-xs text-lightgray">Receipt {s.receipt.id}</p>}
          </div>
        );
      }}
    >
      {(state) => (
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField id="wi-name" name="name" label="Full name" required maxLength={120} defaultValue={state?.ok ? "" : state?.values?.name} autoComplete="off" />
          <TextField id="wi-email" name="email" type="email" inputMode="email" label="Email" hint="matched by hash · not shown" required maxLength={200} defaultValue={state?.ok ? "" : state?.values?.email} />
          <TextField id="wi-display" name="display_name" label="Name on badge" hint="optional" maxLength={60} defaultValue={state?.ok ? "" : state?.values?.display_name} />
          <TextField id="wi-note" name="note" label="Note" hint="optional · audited" maxLength={200} placeholder="e.g. friend of team X, ID checked" defaultValue={state?.ok ? "" : state?.values?.note} />
        </div>
      )}
    </ActionForm>
  );
}
