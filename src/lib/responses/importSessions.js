/* ------------------------------------------------------------------ *
 * Response Consolidator — Layer 1: RAW SESSIONS.
 *
 * Reads AFAIK Agent session exports (CSV, XLSX) into one combined,
 * read-only dataset. This layer is the audit record of what actually
 * happened; everything later (extracted Q&A, AI candidates) is derived
 * from it and never writes back into it.
 *
 * Guarantees:
 *  - Every imported row is kept verbatim (`occurrences[].raw`), with its
 *    source file and row number, including columns this module does not
 *    recognise.
 *  - Nothing is trimmed, rewritten or dropped from a cell value. The
 *    typed fields (timestamp, turns, resolved) are *readings* kept
 *    beside the original text, never instead of it.
 *  - Records are frozen. Merging a new import returns a new workspace;
 *    it never mutates the previous one.
 *  - A session that appears in two exports (overlapping date ranges) is
 *    one session with two occurrences. The same SessionId with different
 *    content is kept twice and flagged — never silently resolved.
 *
 * Kept in memory only. Nothing here touches localStorage or the network.
 * ------------------------------------------------------------------ */

import { parseCsv } from "./csv.js";
import { readXlsx } from "./xlsx.js";

export const LEGACY_XLS_MESSAGE =
  "Legacy .xls files are not supported in this version. Please save the file as .xlsx or .csv and upload it again.";

export const SUPPORTED_EXTENSIONS = [".csv", ".xlsx"];
export const ACCEPT_ATTRIBUTE = ".csv,.xlsx,.xls";

export const FILE_STATUS = Object.freeze({
  IMPORTED: "IMPORTED",
  DUPLICATE_FILE: "DUPLICATE_FILE",
  REJECTED: "REJECTED",
});

export const SESSION_FLAGS = Object.freeze({
  MISSING_SESSION_ID: "MISSING_SESSION_ID",
  DUPLICATE_ID_CONFLICT: "DUPLICATE_ID_CONFLICT",
  UNPARSED_TIMESTAMP: "UNPARSED_TIMESTAMP",
});

/* Internal schema. `aliases` are compared after normalizeHeader(), so
 * "StartDateTime(UTC)", "Start Date Time (UTC)" and "startdatetime_utc"
 * all land on the same field. Kept to names seen in AFAIK exports and
 * their obvious spellings — no guessing from column content. */
export const SESSION_FIELDS = Object.freeze([
  { key: "sessionId", header: "SessionId", aliases: ["sessionid", "conversationid"] },
  { key: "startDateTime", header: "StartDateTime(UTC)", aliases: ["startdatetimeutc", "startdatetime", "starttimeutc", "starttime"] },
  { key: "outcome", header: "SessionOutcome", aliases: ["sessionoutcome", "outcome"] },
  { key: "outcomeReason", header: "OutcomeReason", aliases: ["outcomereason"] },
  { key: "resolvedImplied", header: "IsResolvedImplied", aliases: ["isresolvedimplied", "resolvedimplied", "isresolved"] },
  { key: "turns", header: "Turns", aliases: ["turns", "turncount", "numberofturns"] },
  { key: "transcript", header: "ChatTranscript", aliases: ["chattranscript", "transcript"] },
  { key: "initialUserMessage", header: "InitialUserMessage", aliases: ["initialusermessage"] },
  { key: "topicName", header: "TopicName", aliases: ["topicname", "topic"] },
  { key: "topicId", header: "TopicId", aliases: ["topicid"] },
  { key: "channel", header: "Channel", aliases: ["channel", "channelid"] },
  { key: "csat", header: "CSAT", aliases: ["csat"] },
  { key: "comments", header: "Comments", aliases: ["comments", "comment"] },
]);

export const normalizeHeader = (h) => String(h ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");

const ALIAS_TO_KEY = new Map(SESSION_FIELDS.flatMap((f) => f.aliases.map((a) => [a, f.key])));

export function extensionOf(filename) {
  const m = /\.[^.]+$/.exec(filename.toLowerCase());
  return m ? m[0] : "";
}

async function sha256Bytes(bytes) {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function deepFreeze(obj) {
  for (const v of Object.values(obj)) if (v && typeof v === "object" && !Object.isFrozen(v)) deepFreeze(v);
  return Object.freeze(obj);
}

/* ---------------- reading one file ---------------- */

/* Unique header names per file. A duplicated column header would
 * otherwise overwrite its twin in the row object and lose a value. */
function uniqueHeaders(headers) {
  const seen = new Map();
  return headers.map((h) => {
    const n = (seen.get(h) ?? 0) + 1;
    seen.set(h, n);
    return n === 1 ? h : `${h} (${n})`;
  });
}

/**
 * Reads a File (or anything with `name` and `arrayBuffer()`) into a
 * ParsedFile. Never throws for bad input — a problem becomes `error`,
 * so one bad file in a drop of twelve cannot sink the other eleven.
 *
 * @returns {Promise<{ filename, fileType, sha256, headers, rows, warnings, error }>}
 *   rows: [{ rowNumber, values: { [header]: string } }]  (rowNumber is
 *   the 1-based spreadsheet row, header = row 1)
 */
export async function readResponseFile(file) {
  const filename = file.name;
  const ext = extensionOf(filename);
  const base = { filename, fileType: ext.slice(1).toUpperCase() || "UNKNOWN", sha256: null, headers: [], rows: [], warnings: [], error: null };

  if (ext === ".xls") return { ...base, error: LEGACY_XLS_MESSAGE };
  if (!SUPPORTED_EXTENSIONS.includes(ext)) {
    return { ...base, error: `Unsupported file type "${ext || filename}". Upload .csv or .xlsx session exports.` };
  }

  try {
    const buffer = await file.arrayBuffer();
    const sha256 = await sha256Bytes(buffer);
    let grid;
    const warnings = [];
    if (ext === ".csv") {
      const text = new TextDecoder("utf-8").decode(buffer);
      const parsed = parseCsv(text);
      grid = parsed.rows;
      warnings.push(...parsed.errors);
    } else {
      grid = (await readXlsx(buffer)).rows;
    }
    if (grid.length === 0) return { ...base, sha256, error: "The file is empty." };

    const headers = uniqueHeaders(grid[0].map((h) => String(h)));
    const rows = [];
    for (let i = 1; i < grid.length; i++) {
      const cells = grid[i];
      if (cells.every((c) => c === "")) continue;
      if (cells.length > headers.length && cells.slice(headers.length).some((c) => c !== "")) {
        warnings.push(`Row ${i + 1} has more cells than there are headers; the extra cells are kept as "Column N".`);
      }
      const values = {};
      const width = Math.max(headers.length, cells.length);
      for (let c = 0; c < width; c++) values[headers[c] ?? `Column ${c + 1}`] = cells[c] ?? "";
      rows.push({ rowNumber: i + 1, values });
    }
    return { ...base, sha256, headers, rows, warnings };
  } catch (e) {
    return { ...base, error: `Could not read the file: ${e.message || e}` };
  }
}

/* ---------------- interpreting a row ---------------- */

/** header -> field key, plus the headers that map to nothing. */
export function mapHeaders(headers) {
  const mapping = {};
  const unmapped = [];
  const taken = new Set();
  for (const h of headers) {
    const key = ALIAS_TO_KEY.get(normalizeHeader(h));
    if (key && !taken.has(key)) { mapping[h] = key; taken.add(key); }
    else unmapped.push(h);
  }
  const missing = SESSION_FIELDS.filter((f) => !taken.has(f.key)).map((f) => f.header);
  return { mapping, unmapped, missing };
}

const pad = (n) => String(n).padStart(2, "0");

/* Exports are labelled UTC, so every reading is UTC. Returns an ISO
 * string or null — null means "could not read", and the original text
 * is always kept beside it for display. */
export function parseTimestamp(raw) {
  const s = String(raw ?? "").trim();
  if (!s) return null;

  // Excel serial date (days since 1899-12-30), as an XLSX cell stores it.
  if (/^\d+(\.\d+)?$/.test(s)) {
    const serial = Number(s);
    if (serial < 20000 || serial > 80000) return null; // not a plausible 1954–2119 date
    return new Date(Math.round((serial - 25569) * 86400000)).toISOString();
  }

  // ISO-like: 2026-09-23T03:14:05Z, 2026-09-23 03:14:05, with or without offset.
  let m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{1,2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?)?\s*(Z|[+-]\d{2}:?\d{2})?$/i.exec(s);
  if (m) {
    const [, y, mo, d, h = "0", mi = "0", sec = "0", zone] = m;
    const iso = `${y}-${mo}-${d}T${pad(h)}:${mi}:${pad(sec)}${zone ? (zone.toUpperCase() === "Z" ? "Z" : zone.length === 5 ? zone.slice(0, 3) + ":" + zone.slice(3) : zone) : "Z"}`;
    const t = Date.parse(iso);
    return Number.isNaN(t) ? null : new Date(t).toISOString();
  }

  // US export format: 9/23/2026 3:14:05 AM (seconds and meridiem optional).
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?)?$/i.exec(s);
  if (m) {
    const [, mo, d, y, h = "0", mi = "0", sec = "0", ap] = m;
    let hour = Number(h);
    if (ap) {
      if (hour < 1 || hour > 12) return null;
      hour = (hour % 12) + (ap.toUpperCase() === "PM" ? 12 : 0);
    }
    const t = Date.UTC(Number(y), Number(mo) - 1, Number(d), hour, Number(mi), Number(sec));
    const date = new Date(t);
    if (date.getUTCMonth() !== Number(mo) - 1 || date.getUTCDate() !== Number(d)) return null;
    return date.toISOString();
  }
  return null;
}

export function parseResolved(raw) {
  const s = String(raw ?? "").trim().toLowerCase();
  if (["true", "yes", "1", "y"].includes(s)) return true;
  if (["false", "no", "0", "n"].includes(s)) return false;
  return null;
}

export function parseTurns(raw) {
  const s = String(raw ?? "").trim();
  return /^\d+$/.test(s) ? Number(s) : null;
}

/* The fields that decide whether two rows describe the same session.
 * Compared as exported text, so a re-export that only differs in an
 * unrecognised column is still the same session. */
const IDENTITY_FIELDS = SESSION_FIELDS.map((f) => f.key);
const fingerprint = (fields) => JSON.stringify(IDENTITY_FIELDS.map((k) => fields[k] ?? ""));

function readFields(values, mapping) {
  const fields = {};
  const extra = {};
  for (const [header, value] of Object.entries(values)) {
    const key = mapping[header];
    if (key) fields[key] = value;
    else extra[header] = value;
  }
  return { fields, extra };
}

function buildSession(id, fields, extra, occurrence) {
  const timestamp = parseTimestamp(fields.startDateTime);
  const flags = [];
  if (!String(fields.sessionId ?? "").trim()) flags.push(SESSION_FLAGS.MISSING_SESSION_ID);
  if (String(fields.startDateTime ?? "").trim() && !timestamp) flags.push(SESSION_FLAGS.UNPARSED_TIMESTAMP);
  return {
    id,
    sessionId: fields.sessionId ?? "",
    timestamp,
    timestampRaw: fields.startDateTime ?? "",
    outcome: fields.outcome ?? "",
    outcomeReason: fields.outcomeReason ?? "",
    resolved: parseResolved(fields.resolvedImplied),
    resolvedRaw: fields.resolvedImplied ?? "",
    turns: parseTurns(fields.turns),
    turnsRaw: fields.turns ?? "",
    transcript: fields.transcript ?? "",
    initialUserMessage: fields.initialUserMessage ?? "",
    topicName: fields.topicName ?? "",
    topicId: fields.topicId ?? "",
    channel: fields.channel ?? "",
    csat: fields.csat ?? "",
    comments: fields.comments ?? "",
    extra,
    occurrences: [occurrence],
    flags,
  };
}

/* ---------------- the workspace ---------------- */

export const EMPTY_WORKSPACE = deepFreeze({ files: [], sessions: [] });

const fileId = (n) => `F-${String(n).padStart(3, "0")}`;
const sessionRecordId = (n) => `S-${String(n).padStart(4, "0")}`;

/**
 * Adds parsed files to a workspace. Pure: returns a new frozen
 * workspace and a report of this import; the input is untouched.
 *
 * @param workspace   { files, sessions } — EMPTY_WORKSPACE to start
 * @param parsedFiles results of readResponseFile()
 * @param importedAt  ISO timestamp stamped on each file (caller's clock)
 */
export function mergeImport(workspace, parsedFiles, importedAt) {
  const files = [...workspace.files];
  // Sessions are replaced, never edited, when a merge adds an occurrence.
  const sessions = [...workspace.sessions];
  const bySessionId = new Map();
  sessions.forEach((s, i) => {
    if (!s.sessionId) return;
    (bySessionId.get(s.sessionId) ?? bySessionId.set(s.sessionId, []).get(s.sessionId)).push(i);
  });
  const knownHashes = new Map(files.filter((f) => f.status === FILE_STATUS.IMPORTED).map((f) => [f.sha256, f.filename]));
  const report = { imported: 0, duplicateFiles: 0, rejected: 0, sessionsAdded: 0, sessionsMerged: 0, conflicts: 0 };

  for (const pf of parsedFiles) {
    const id = fileId(files.length + 1);
    const entry = {
      id,
      filename: pf.filename,
      fileType: pf.fileType,
      sha256: pf.sha256,
      importedAt,
      rowCount: pf.rows.length,
      headers: pf.headers,
      unmappedHeaders: [],
      missingFields: [],
      sessionsAdded: 0,
      sessionsMerged: 0,
      warnings: pf.warnings,
      status: FILE_STATUS.IMPORTED,
      message: "",
    };

    if (pf.error) {
      files.push({ ...entry, status: FILE_STATUS.REJECTED, message: pf.error });
      report.rejected++;
      continue;
    }
    if (knownHashes.has(pf.sha256)) {
      files.push({ ...entry, status: FILE_STATUS.DUPLICATE_FILE, message: `Identical to "${knownHashes.get(pf.sha256)}", already imported — skipped.` });
      report.duplicateFiles++;
      continue;
    }

    const { mapping, unmapped, missing } = mapHeaders(pf.headers);
    const mapped = new Set(Object.values(mapping));
    if (!mapped.has("sessionId") && !mapped.has("transcript")) {
      files.push({
        ...entry,
        status: FILE_STATUS.REJECTED,
        unmappedHeaders: unmapped,
        message: "Not an AFAIK session export: it has neither a SessionId nor a ChatTranscript column.",
      });
      report.rejected++;
      continue;
    }
    entry.unmappedHeaders = unmapped;
    entry.missingFields = missing;

    for (const row of pf.rows) {
      const { fields, extra } = readFields(row.values, mapping);
      const occurrence = { fileId: id, filename: pf.filename, rowNumber: row.rowNumber, raw: { ...row.values } };
      const sid = String(fields.sessionId ?? "");
      const existing = sid ? bySessionId.get(sid) ?? [] : [];
      const fp = fingerprint(fields);
      const same = existing.find((i) => fingerprint(sessionFields(sessions[i])) === fp);

      if (same !== undefined) {
        const s = sessions[same];
        sessions[same] = { ...s, occurrences: [...s.occurrences, occurrence] };
        entry.sessionsMerged++;
        continue;
      }

      const session = buildSession(sessionRecordId(sessions.length + 1), fields, extra, occurrence);
      if (existing.length) {
        session.flags.push(SESSION_FLAGS.DUPLICATE_ID_CONFLICT);
        for (const i of existing) {
          const s = sessions[i];
          if (!s.flags.includes(SESSION_FLAGS.DUPLICATE_ID_CONFLICT)) {
            sessions[i] = { ...s, flags: [...s.flags, SESSION_FLAGS.DUPLICATE_ID_CONFLICT] };
          }
        }
        report.conflicts++;
      }
      sessions.push(session);
      if (sid) (bySessionId.get(sid) ?? bySessionId.set(sid, []).get(sid)).push(sessions.length - 1);
      entry.sessionsAdded++;
    }

    files.push(entry);
    knownHashes.set(pf.sha256, pf.filename);
    report.imported++;
    report.sessionsAdded += entry.sessionsAdded;
    report.sessionsMerged += entry.sessionsMerged;
  }

  return { workspace: deepFreeze({ files, sessions }), report };
}

// The exported text of a session's recognised fields, for comparison.
function sessionFields(s) {
  return {
    sessionId: s.sessionId, startDateTime: s.timestampRaw, outcome: s.outcome, outcomeReason: s.outcomeReason,
    resolvedImplied: s.resolvedRaw, turns: s.turnsRaw, transcript: s.transcript, initialUserMessage: s.initialUserMessage,
    topicName: s.topicName, topicId: s.topicId, channel: s.channel, csat: s.csat, comments: s.comments,
  };
}

/** Headline numbers for the import summary, derived — never stored. */
export function summarize(workspace) {
  const imported = workspace.files.filter((f) => f.status === FILE_STATUS.IMPORTED);
  const sessions = workspace.sessions;
  return {
    files: imported.length,
    filesSkipped: workspace.files.length - imported.length,
    rows: imported.reduce((n, f) => n + f.rowCount, 0),
    sessions: sessions.length,
    multiSourceSessions: sessions.filter((s) => s.occurrences.length > 1).length,
    conflicts: sessions.filter((s) => s.flags.includes(SESSION_FLAGS.DUPLICATE_ID_CONFLICT)).length,
    resolved: sessions.filter((s) => s.resolved === true).length,
    unresolved: sessions.filter((s) => s.resolved === false).length,
    withTranscript: sessions.filter((s) => s.transcript.trim() !== "").length,
  };
}
