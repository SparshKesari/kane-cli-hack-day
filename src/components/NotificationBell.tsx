"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { event } from "@/data/hackday";
import { apiFetch } from "@/lib/api-client";

// The bell next to your avatar: someone asked to join your team, wants to team
// up, invited you, or answered you. Polls while the tab is visible; anything
// new pops a toast and plays a short chime (mute with the speaker button).

type Item = { id: number; kind: string; title: string; body: string; href: string | null; created_at: string; unread: boolean };
type Feed = { items: Item[]; unread: number };

const POLL_MS = 10_000;
const MUTE_KEY = "kh-bell-muted";
const time = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: event.timezone });

let audio: AudioContext | null = null;
/** Two soft notes. Browsers only allow sound after the person has clicked or typed on the page once. */
function chime() {
  try {
    audio ??= new AudioContext();
    if (audio.state === "suspended") void audio.resume();
    const now = audio.currentTime;
    [880, 1318.5].forEach((freq, i) => {
      const osc = audio!.createOscillator();
      const gain = audio!.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      const t = now + i * 0.14;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.18, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.45);
      osc.connect(gain).connect(audio!.destination);
      osc.start(t);
      osc.stop(t + 0.5);
    });
  } catch {
    /* no audio: the toast still shows */
  }
}

const readMuted = () => {
  try {
    return localStorage.getItem(MUTE_KEY) === "1";
  } catch {
    return false;
  }
};

export default function NotificationBell() {
  const [data, setData] = useState<Feed | null>(null);
  const [open, setOpen] = useState(false);
  const [toast, setToast] = useState<Item | null>(null);
  const [muted, setMuted] = useState(false);
  const known = useRef<Set<number> | null>(null);
  const box = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    const r = await apiFetch("/api/v1/me/notifications", { cache: "no-store" }).catch(() => null);
    if (!r?.ok) return;
    const next = (await r.json()) as Feed;
    if (known.current) {
      const fresh = next.items.find((n) => n.unread && !known.current!.has(n.id));
      if (fresh) {
        setToast(fresh);
        if (!readMuted()) chime();
      }
    }
    known.current = new Set(next.items.map((n) => n.id));
    setData(next);
  }, []);

  useEffect(() => {
    const first = setTimeout(() => {
      setMuted(readMuted());
      void load();
    }, 0);
    const id = setInterval(() => document.visibilityState === "visible" && load(), POLL_MS);
    const onVis = () => document.visibilityState === "visible" && load();
    document.addEventListener("visibilitychange", onVis);
    // Unlock sound on the first interaction, so the first chime can play.
    const unlock = () => {
      try {
        audio ??= new AudioContext();
        void audio.resume();
      } catch {}
    };
    window.addEventListener("pointerdown", unlock, { once: true });
    window.addEventListener("keydown", unlock, { once: true });
    return () => {
      clearTimeout(first);
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
  }, [load]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 8000);
    return () => clearTimeout(t);
  }, [toast]);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !box.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);

  const toggle = async () => {
    const next = !open;
    setOpen(next);
    if (next && data?.unread) {
      await apiFetch("/api/v1/me/notifications", { method: "POST" }).catch(() => null);
      setData((d) => (d ? { unread: 0, items: d.items } : d));
    }
  };

  const toggleMute = () => {
    const next = !muted;
    setMuted(next);
    try {
      localStorage.setItem(MUTE_KEY, next ? "1" : "0");
    } catch {}
    if (!next) chime();
  };

  const unread = data?.unread ?? 0;
  return (
    <div ref={box} className="relative">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        aria-label={unread ? `Notifications, ${unread} new` : "Notifications"}
        className="relative inline-flex h-9 w-9 items-center justify-center border border-hairline text-bright transition-colors hover:border-lime hover:text-lime"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
          <path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
          <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
        </svg>
        {unread > 0 && (
          <span className="absolute -top-1.5 -right-1.5 min-w-5 rounded-full bg-lime px-1 text-center font-plex text-[11px] leading-5 font-semibold text-ink">{unread > 9 ? "9+" : unread}</span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 z-50 mt-2 w-[min(22rem,calc(100vw-2rem))] border border-hairline bg-surface-2 shadow-xl">
          <div className="flex items-center justify-between border-b border-hairline px-4 py-3">
            <p className="font-pixel text-[10px] uppercase tracking-[0.2em] text-lightgray">Notifications</p>
            <button type="button" onClick={toggleMute} className="font-plex text-xs text-lightgray underline underline-offset-4 hover:text-lime">
              {muted ? "Sound off · turn on" : "Sound on · mute"}
            </button>
          </div>
          {!data?.items.length ? (
            <p className="px-4 py-6 font-plex text-sm text-lightgray">Nothing yet. Requests to join your team, intros and invites show up here.</p>
          ) : (
            <ul className="max-h-96 overflow-auto">
              {data.items.map((n) => (
                <li key={n.id} className="border-b border-dashed border-hairline last:border-0">
                  <Link href={n.href ?? "#"} onClick={() => setOpen(false)} className="block px-4 py-3 transition-colors hover:bg-lime-deep">
                    <p className={`font-plex text-sm ${n.unread ? "text-bright" : "text-lightgray"}`}>
                      {n.unread && <span className="mr-1.5 inline-block h-2 w-2 rounded-full bg-lime align-middle" aria-hidden="true" />}
                      {n.title}
                    </p>
                    {n.body && <p className="mt-1 font-plex text-xs text-lightgray">{n.body}</p>}
                    <p className="mt-1 font-plex text-[11px] text-lightgray/70">{time.format(new Date(n.created_at))}</p>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {toast && (
        <div role="status" className="fixed right-4 bottom-4 z-[60] w-[min(22rem,calc(100vw-2rem))] border border-lime bg-surface-2 p-4 shadow-2xl">
          <p className="font-pixel text-[10px] uppercase tracking-[0.2em] text-lime">New</p>
          <p className="mt-1 font-plex text-sm text-bright">{toast.title}</p>
          {toast.body && <p className="mt-1 font-plex text-xs text-lightgray">{toast.body}</p>}
          <div className="mt-3 flex gap-3">
            {toast.href && (
              <Link href={toast.href} onClick={() => setToast(null)} className="font-plex text-sm text-bright underline underline-offset-4 hover:text-lime">
                Open →
              </Link>
            )}
            <button type="button" onClick={() => setToast(null)} className="font-plex text-sm text-lightgray hover:text-bright">
              Dismiss
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
