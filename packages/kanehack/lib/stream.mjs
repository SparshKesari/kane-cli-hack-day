// Just enough NDJSON reading for the CLI to print a summary and pick an
// execution id. The server re-parses the stream and is the authority on what
// it means; the exit code decides success, never the stream alone.

const TERMINAL = new Set(["run_end", "test_md_done", "testrun_done", "remote_done", "done"]);

export function scan(text) {
  const out = { family: "unknown", terminal: null, executionId: null, sessionId: null, status: null, oneLiner: null, totals: null, failures: [] };
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line.startsWith("{")) continue;
    let ev;
    try {
      ev = JSON.parse(line);
    } catch {
      continue;
    }
    const t = typeof ev.type === "string" ? ev.type : null;
    if (!t) continue;
    if (t.startsWith("testrun_")) out.family = "testrun";
    else if (t.startsWith("test_md_") && out.family !== "testrun") out.family = "testmd";
    else if ((t === "run_start" || t === "run_end") && out.family === "unknown") out.family = "run";
    // A run's own coverage event (Kane CLI 0.10.0-rc.3+, before run_end) doesn't make it a cover stream: run_start came first.
    else if ((t === "coverage" || t === "gaps") && out.family === "unknown") out.family = "assurance";

    if (t === "testrun_start" && ev.execution_id) out.executionId = String(ev.execution_id);
    if (t === "testrun_done") {
      out.executionId ??= ev.execution_id ? String(ev.execution_id) : null;
      out.status = ev.overall_status ?? null;
    }
    if (t === "test_md_done") {
      out.sessionId = ev.session_id ? String(ev.session_id) : out.sessionId;
      out.status = ev.overall_status ?? null;
    }
    if (t === "run_end" && (out.family === "run" || out.family === "unknown")) {
      out.status = ev.status ?? null;
      out.oneLiner = ev.one_liner ?? ev.summary ?? null;
      const dir = typeof ev.session_dir === "string" ? ev.session_dir : "";
      const m = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i.exec(dir);
      if (m) out.sessionId = m[1];
    }
    if (t === "testrun_summary" && ev.totals) out.totals = ev.totals;
    if ((t === "testrun_member_end" || t === "testrun_authored_member_end") && ev.status !== "passed") {
      out.failures.push({ path: String(ev.path ?? "").split(/[\\/]/).pop(), status: ev.status, message: ev.failure?.message ?? null });
    }
    if (TERMINAL.has(t) && (t !== "run_end" || out.family === "run")) out.terminal = t;
  }
  return out;
}
