import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  readResponseFile, mergeImport, summarize, EMPTY_WORKSPACE, FILE_STATUS,
} from "../../src/lib/responses/importSessions.js";

/* Real AFAIK session exports, gitignored — see README.md in this
 * folder. Checks invariants only: the count of files and sessions is
 * whatever was exported, never a fixed expectation. */
const DIR = path.dirname(fileURLToPath(import.meta.url));
const names = fs.existsSync(DIR)
  ? fs.readdirSync(DIR).filter((n) => /\.(csv|xlsx)$/i.test(n)).sort()
  : [];

describe.skipIf(names.length === 0)("real AFAIK session exports (local only)", () => {
  const load = async () => {
    const parsed = await Promise.all(names.map((name) => {
      const buf = fs.readFileSync(path.join(DIR, name));
      return readResponseFile({ name, arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) });
    }));
    return { parsed, ...mergeImport(EMPTY_WORKSPACE, parsed, "2026-01-01T00:00:00.000Z") };
  };

  it("imports every file without rejection", async () => {
    const { workspace } = await load();
    const bad = workspace.files.filter((f) => f.status === FILE_STATUS.REJECTED).map((f) => `${f.filename}: ${f.message}`);
    expect(bad).toEqual([]);
  });

  it("accounts for every row: each is a session or an occurrence of one", async () => {
    const { parsed, workspace } = await load();
    const imported = new Set(workspace.files.filter((f) => f.status === FILE_STATUS.IMPORTED).map((f) => f.filename));
    const rows = parsed.filter((p) => imported.has(p.filename)).reduce((n, p) => n + p.rows.length, 0);
    const occurrences = workspace.sessions.reduce((n, s) => n + s.occurrences.length, 0);
    expect(occurrences).toBe(rows);
    const s = summarize(workspace);
    console.info(`[real exports] ${s.files} files, ${s.rows} rows, ${s.sessions} unique sessions, ${s.multiSourceSessions} in more than one file, ${s.conflicts} conflicting`);
  });

  it("keeps every transcript byte-for-byte as exported", async () => {
    const { workspace } = await load();
    for (const s of workspace.sessions) {
      const raw = s.occurrences[0].raw;
      const header = Object.keys(raw).find((h) => h.toLowerCase().replace(/[^a-z]/g, "") === "chattranscript");
      expect(s.transcript, s.id).toBe(raw[header]);
    }
  });

  it("reads a timestamp for every session that has one", async () => {
    const { workspace } = await load();
    const unread = workspace.sessions.filter((s) => s.timestampRaw.trim() && !s.timestamp).map((s) => s.timestampRaw);
    expect(unread).toEqual([]);
  });
});
