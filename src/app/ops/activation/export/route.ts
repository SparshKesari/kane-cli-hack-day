import { getStaff, hasRole } from "@/server/auth";
import { csvHeaders } from "@/server/csv";
import { exportCodexCodes } from "@/server/event-activation";

// Codex credit code pool as CSV, with full codes and who has each one.
// Organizer only; every export is audited (codex_code.export).

const cell = (v: unknown) => {
  const s = v == null ? "" : v instanceof Date ? v.toISOString() : String(v);
  // Neutralise spreadsheet formulas and quote everything.
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return `"${safe.replace(/"/g, '""')}"`;
};

export async function GET() {
  const staff = await getStaff();
  if (!staff || !hasRole(staff, "organizer")) return new Response("Unauthorized", { status: 401 });
  const rows = await exportCodexCodes(staff);
  const head = ["code", "batch", "status", "assigned_to", "email", "team", "assigned_at", "assigned_by", "emailed_at", "email_count", "revoked_reason"];
  const lines = [head.join(","), ...rows.map((r) => [r.code, r.batch, r.status, r.name, r.email, r.team, r.assigned_at, r.assigned_by, r.emailed_at, r.email_count, r.revoked_reason].map(cell).join(","))];
  const stamp = new Date().toISOString().replace(/[:.]/g, "").slice(0, 15);
  return new Response(lines.join("\n") + "\n", { headers: csvHeaders(`codex-codes-${stamp}.csv`) });
}
