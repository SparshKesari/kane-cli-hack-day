"use client";

import { upload } from "@vercel/blob/client";
import { useRef, useState } from "react";
import { ACCEPT, ALLOWED, MAX_BYTES, MAX_FILES, TYPES_LABEL, extOf, formatBytes } from "@/lib/online/attachment-rules";
import { addAttachmentAction, removeAttachmentAction, type FileRow } from "./attachment-actions";

// Wireframes, decks, diagrams: files upload straight away (no need to save the
// form) and show on the team's showcase page once the project is submitted.
export default function Attachments({ initial, prefix, disabled }: { initial: FileRow[]; prefix: string; disabled: boolean }) {
  const [files, setFiles] = useState(initial);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const full = files.length >= MAX_FILES;

  async function add(list: FileList | null) {
    if (!list?.length) return;
    setError(null);
    let count = files.length;
    for (const file of Array.from(list)) {
      if (count >= MAX_FILES) return setError(`You can attach up to ${MAX_FILES} files.`);
      if (!ALLOWED[extOf(file.name)]) return setError(`${file.name}: that file type isn't allowed. Use ${TYPES_LABEL}.`);
      if (file.size > MAX_BYTES) return setError(`${file.name} is larger than ${formatBytes(MAX_BYTES)}.`);
      setBusy(file.name);
      try {
        const safe = file.name.replace(/[^A-Za-z0-9._-]/g, "_").slice(-100);
        const blob = await upload(`${prefix}${safe}`, file, { access: "private", handleUploadUrl: "/o/submit/upload", contentType: ALLOWED[extOf(file.name)] });
        const res = await addAttachmentAction(blob.pathname, file.name);
        if (res.error) return setError(res.error);
        setFiles(res.files);
        count = res.files.length;
      } catch (e) {
        return setError(e instanceof Error ? e.message : "Upload failed. Try again.");
      } finally {
        setBusy(null);
        if (input.current) input.current.value = "";
      }
    }
  }

  async function remove(id: number) {
    setError(null);
    const res = await removeAttachmentAction(id);
    if (res.error) return setError(res.error);
    setFiles(res.files);
  }

  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <label htmlFor="attachments" className="font-display text-base text-bright">
          Attachments
        </label>
        <span className="font-plex text-xs text-lightgray">
          Optional · {files.length}/{MAX_FILES}
        </span>
      </div>

      <label
        htmlFor="attachments"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          if (!disabled && !busy) void add(e.dataTransfer.files);
        }}
        className={`block border border-dashed border-hairline bg-surface p-6 text-center transition-colors ${disabled || full ? "opacity-60" : "cursor-pointer hover:border-lime"} has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-lime`}
      >
        <input ref={input} id="attachments" type="file" multiple accept={ACCEPT} disabled={disabled || full || busy !== null} onChange={(e) => void add(e.target.files)} className="sr-only" />
        <span className="block font-display text-lg text-bright">{busy ? `Uploading ${busy}…` : full ? "Attachment limit reached" : "Drop files here, or click to choose"}</span>
        <span className="mt-1 block font-plex text-sm text-lightgray">
          Wireframes, decks, diagrams, screenshots. {TYPES_LABEL}. Up to {formatBytes(MAX_BYTES)} each.
        </span>
      </label>

      {error && (
        <p role="alert" className="mt-2 font-plex text-sm text-danger">
          {error}
        </p>
      )}

      {files.length > 0 && (
        <ul className="mt-3 border-t border-dashed border-hairline">
          {files.map((f) => (
            <li key={f.id} className="flex items-center justify-between gap-4 border-b border-dashed border-hairline py-3 font-plex text-sm">
              <a href={`/o/files/${f.id}`} target="_blank" rel="noreferrer" className="min-w-0 truncate text-bright underline decoration-hairline underline-offset-4 hover:text-lime">
                {f.filename}
              </a>
              <span className="flex shrink-0 items-center gap-4 text-lightgray">
                {formatBytes(f.size_bytes)}
                {!disabled && (
                  <button type="button" onClick={() => void remove(f.id)} className="text-lightgray underline decoration-hairline underline-offset-4 hover:text-danger" aria-label={`Remove ${f.filename}`}>
                    Remove
                  </button>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-2 font-plex text-xs text-lightgray">Files upload right away and appear on your showcase page once you submit.</p>
    </div>
  );
}
