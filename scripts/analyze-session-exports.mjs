#!/usr/bin/env node
/* ------------------------------------------------------------------ *
 * Real-export validation and transcript-structure analysis.
 *
 *   npm run responses:analyze -- [dir] [--expect-files N] [--expect-sessions N]
 *
 * Reads every .csv/.xlsx in `dir` (default test/responses/) through the
 * app's own import layer — the same code the browser runs — and prints:
 *
 *   1. Import validation: files, sessions, rows, missing IDs/transcripts,
 *      timestamp failures, skipped files, duplicate/conflicting IDs.
 *   2. Field preservation: every recognised field compared, value for
 *      value, with the cell it came from.
 *   3. Transcript structure: every speaker marker actually present,
 *      sequence shapes, multi-question sessions, "not found" and
 *      "agent unavailable" signals.
 *
 * It is evidence for designing the Phase 5 transcript parser, and it is
 * deliberately NOT that parser: marker discovery here is permissive and
 * reports what it finds, so the parser's rules come from the data.
 *
 * Privacy. The exports are real conversations. By default the output
 * is counts only, plus shortened session IDs: no message text at all,
 * because user questions name people and pattern-based redaction cannot
 * reliably find names. `--show-text` adds short excerpts (e-mails, long
 * numbers and URLs redacted, NOT names) for local inspection only.
 * Nothing is written to disk or sent anywhere.
 * ------------------------------------------------------------------ */

import fs from "node:fs";
import path from "node:path";
import { JSDOM } from "jsdom";
import {
  readResponseFile, mergeImport, summarize, mapHeaders, EMPTY_WORKSPACE, FILE_STATUS, SESSION_FLAGS,
} from "../src/lib/responses/importSessions.js";

// The XLSX reader parses XML with DOMParser, which Node lacks.
globalThis.DOMParser ??= new JSDOM().window.DOMParser;

/* ---------------- arguments ---------------- */

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  if (i < 0) return null;
  const v = Number(args[i + 1]);
  args.splice(i, 2);
  return Number.isFinite(v) ? v : null;
};
const expectFiles = flag("--expect-files");
const expectSessions = flag("--expect-sessions");
const showText = args.includes("--show-text");
if (showText) args.splice(args.indexOf("--show-text"), 1);
const dir = path.resolve(args[0] ?? "test/responses");

/* ---------------- masking ---------------- */

const maskId = (id) => (!id ? "(none)" : id.length <= 10 ? id.slice(0, 3) + "…" : `${id.slice(0, 4)}…${id.slice(-4)}`);
const redact = (s) => s
  .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, "[email]")
  .replace(/\d{6,}/g, "[number]")
  .replace(/https?:\/\/\S+/g, "[url]");
const excerpt = (s, n = 60) => {
  const flat = redact(s.replace(/\s+/g, " ").trim());
  return flat.length > n ? flat.slice(0, n) + "…" : flat;
};

/* ---------------- output helpers ---------------- */

const out = [];
const print = (s = "") => out.push(s);
const table = (headers, rows) => {
  print(`| ${headers.join(" | ")} |`);
  print(`|${headers.map(() => "---").join("|")}|`);
  for (const r of rows) print(`| ${r.map((c) => String(c).replace(/\|/g, "\\|")).join(" | ")} |`);
  print();
};
const status = (ok) => (ok === null ? "—" : ok ? "PASS" : "FAIL");

/* ---------------- load through the app's import layer ---------------- */

if (!fs.existsSync(dir)) {
  console.error(`No such directory: ${dir}`);
  process.exit(2);
}
const names = fs.readdirSync(dir).filter((n) => /\.(csv|xlsx|xls)$/i.test(n)).sort();
if (names.length === 0) {
  console.error(`No .csv/.xlsx/.xls files in ${dir}. Put the session exports there (they are gitignored).`);
  process.exit(2);
}

const parsed = await Promise.all(names.map((name) => {
  const buf = fs.readFileSync(path.join(dir, name));
  return readResponseFile({ name, arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) });
}));
const { workspace } = mergeImport(EMPTY_WORKSPACE, parsed, new Date().toISOString());
const sessions = workspace.sessions;
const summary = summarize(workspace);
const importedFiles = workspace.files.filter((f) => f.status === FILE_STATUS.IMPORTED);
const skipped = workspace.files.filter((f) => f.status !== FILE_STATUS.IMPORTED);

/* ---------------- 1. import validation ---------------- */

const rowsRead = parsed.filter((p) => !p.error).reduce((n, p) => n + p.rows.length, 0);
const occurrences = sessions.reduce((n, s) => n + s.occurrences.length, 0);
const missingIds = sessions.filter((s) => s.flags.includes(SESSION_FLAGS.MISSING_SESSION_ID)).length;
const missingTranscripts = sessions.filter((s) => s.transcript.trim() === "").length;
const tsFailures = sessions.filter((s) => s.flags.includes(SESSION_FLAGS.UNPARSED_TIMESTAMP)).length;
const idCounts = new Map();
for (const s of sessions) if (s.sessionId) idCounts.set(s.sessionId, (idCounts.get(s.sessionId) ?? 0) + s.occurrences.length);
const duplicateIds = [...idCounts.values()].filter((n) => n > 1).length;
const conflictingIds = new Set(sessions.filter((s) => s.flags.includes(SESSION_FLAGS.DUPLICATE_ID_CONFLICT)).map((s) => s.sessionId)).size;

print(`# Real-export validation`);
print();
print(`Directory: ${path.relative(process.cwd(), dir) || "."}  ·  files found: ${names.length}`);
print();
print(`## 1. Import`);
print();
table(["Check", "Expected", "Actual", "Status"], [
  ["Files imported", expectFiles ?? "all found", importedFiles.length, status(expectFiles == null ? importedFiles.length === names.length : importedFiles.length === expectFiles)],
  ["Sessions (unique)", expectSessions ?? "—", summary.sessions, status(expectSessions == null ? null : summary.sessions === expectSessions)],
  ["Rows read", "—", rowsRead, "—"],
  ["Rows accounted for (sessions + merged repeats)", rowsRead, occurrences, status(occurrences === rowsRead)],
  ["Missing Session IDs", 0, missingIds, status(missingIds === 0)],
  ["Missing transcripts", "reported", missingTranscripts, "—"],
  ["Timestamp parse failures", 0, tsFailures, status(tsFailures === 0)],
  ["Unexpected skipped files", 0, skipped.length, status(skipped.length === 0)],
]);
for (const f of skipped) print(`- Skipped ${f.filename}: ${f.message}`);
for (const f of importedFiles) {
  if (f.unmappedHeaders.length) print(`- ${f.filename}: extra columns kept as-is: ${f.unmappedHeaders.join(", ")}`);
  if (f.missingFields.length) print(`- ${f.filename}: missing columns: ${f.missingFields.join(", ")}`);
  for (const w of f.warnings) print(`- ${f.filename}: ${w}`);
}
table(["Session ID measure", "Count"], [
  ["Unique SessionIds", idCounts.size],
  ["SessionIds appearing in more than one row", duplicateIds],
  ["SessionIds with conflicting content", conflictingIds],
]);

/* ---------------- 2. field preservation ---------------- */

// Every recognised field must equal the exact cell it was read from.
const FIELD_CHECKS = [
  ["SessionId", "sessionId"], ["ChatTranscript", "transcript"], ["InitialUserMessage", "initialUserMessage"],
  ["StartDateTime(UTC) — raw text", "timestampRaw"], ["Turns — raw text", "turnsRaw"], ["SessionOutcome", "outcome"],
  ["OutcomeReason", "outcomeReason"], ["IsResolvedImplied — raw text", "resolvedRaw"], ["Channel", "channel"],
  ["CSAT", "csat"], ["Comments", "comments"], ["TopicName", "topicName"], ["TopicId", "topicId"],
];
const headerFor = new Map();
for (const f of importedFiles) {
  const { mapping } = mapHeaders(f.headers);
  headerFor.set(f.id, Object.fromEntries(Object.entries(mapping).map(([h, k]) => [k, h])));
}
const RAW_KEY = { timestampRaw: "startDateTime", turnsRaw: "turns", resolvedRaw: "resolvedImplied" };
const preservation = FIELD_CHECKS.map(([label, field]) => {
  let compared = 0;
  let mismatched = 0;
  for (const s of sessions) {
    const o = s.occurrences[0];
    const header = headerFor.get(o.fileId)?.[RAW_KEY[field] ?? field];
    if (!header) continue;
    compared++;
    if (s[field] !== o.raw[header]) mismatched++;
  }
  return [label, compared, mismatched, status(mismatched === 0)];
});
const fileNameOk = sessions.every((s) => s.occurrences.every((o) => workspace.files.find((f) => f.id === o.fileId)?.filename === o.filename && names.includes(o.filename)));
preservation.push(["Source filename", occurrences, fileNameOk ? 0 : "≥1", status(fileNameOk)]);
const turnsOk = sessions.filter((s) => s.turnsRaw.trim() !== "").every((s) => s.turns !== null && String(s.turns) === s.turnsRaw.trim());
preservation.push(["Turns — numeric reading equals raw", sessions.filter((s) => s.turnsRaw.trim()).length, turnsOk ? 0 : "≥1", status(turnsOk)]);
const tsOk = sessions.filter((s) => s.timestamp).length;
preservation.push(["StartDateTime(UTC) — read as a UTC instant", sessions.filter((s) => s.timestampRaw.trim()).length, sessions.filter((s) => s.timestampRaw.trim()).length - tsOk, status(tsFailures === 0)]);

print(`## 2. Field preservation (value-for-value against the source cell)`);
print();
table(["Field", "Sessions compared", "Mismatches", "Status"], preservation);
const tsSamples = [...new Set(sessions.map((s) => s.timestampRaw))].slice(0, 3);
print(`Timestamp format samples (raw → read as): ${tsSamples.map((r) => `\`${r}\` → \`${sessions.find((s) => s.timestampRaw === r).timestamp}\``).join(", ")}`);
print();

/* ---------------- 3. transcript structure ---------------- */

/* Discovery, not parsing. A candidate marker is a short label ending in
 * a colon at the start of the transcript or right after a semicolon or
 * line break. Labels whose last word is a speech verb are speaker
 * markers; anything else is counted so nothing is silently ignored. */
const SPEECH = /\b(says|said|writes|wrote|replies|replied|asks|asked|responds|responded)$/i;
const CANDIDATE = /(^|;|\n)[ \t]*([A-Za-z][A-Za-z0-9 _-]{0,30}?)[ \t]*:/g;

const speakerCounts = new Map();
const speakerSessions = new Map();
const otherLabels = new Map();
const boundaryCounts = new Map();

function tokenize(transcript) {
  const turns = [];
  let m;
  CANDIDATE.lastIndex = 0;
  while ((m = CANDIDATE.exec(transcript))) {
    const label = m[2].trim();
    if (!SPEECH.test(label)) {
      otherLabels.set(label, (otherLabels.get(label) ?? 0) + 1);
      continue;
    }
    const boundary = m[1] === "" ? "start of transcript" : m[1] === ";" ? "after ';'" : "after line break";
    boundaryCounts.set(boundary, (boundaryCounts.get(boundary) ?? 0) + 1);
    turns.push({ label, at: m.index + m[1].length, textStart: CANDIDATE.lastIndex });
  }
  return turns.map((t, i) => ({
    label: t.label,
    text: transcript.slice(t.textStart, i + 1 < turns.length ? turns[i + 1].at : transcript.length),
    leading: i === 0 ? transcript.slice(0, t.at) : "",
  }));
}

// Agent-side conditions seen in real exports. The exporter caps each
// message at ~500 characters and appends "..."; answers are replaced
// wholesale by "[REDACTED]"; and a greeting can carry an inner
// "Bot said:" prefix inside the Agent entry (not a speaker of its own).
const TRUNCATION_MIN = 480;
const clean = (t) => t.text.replace(/;\s*$/, "").trim();
const isTruncated = (t) => clean(t).endsWith("...") && clean(t).length >= TRUNCATION_MIN;
const isRedacted = (t) => clean(t).includes("[REDACTED]");
const NESTED_PREFIX = /^([A-Za-z][A-Za-z ]{0,20}?\s+(?:says|said))\s*:/i;

const roleOf = (label) => (/^user\b/i.test(label) ? "U" : /^(agent|bot)\b/i.test(label) ? "A" : "?");

const NOT_FOUND = [
  /not (?:be )?available in (?:the|my|our)?\s*(?:configured )?knowledge/i, /couldn['’]t find/i, /could not find/i,
  /unable to find/i, /(?:don['’]t|do not) have (?:any )?(?:specific )?information/i, /no (?:specific )?information (?:is )?available/i,
  /(?:does not|doesn['’]t) (?:contain|include|provide|mention)/i, /information (?:is )?not (?:available|found)/i, /not found/i,
];
const UNAVAILABLE = [/currently unavailable/i, /usage limit/i, /reached its (?:usage )?limit/i];

const analysed = sessions.map((s) => {
  const turns = tokenize(s.transcript);
  for (const t of turns) {
    speakerCounts.set(t.label, (speakerCounts.get(t.label) ?? 0) + 1);
    (speakerSessions.get(t.label) ?? speakerSessions.set(t.label, new Set()).get(t.label)).add(s.id);
  }
  const roles = turns.map((t) => roleOf(t.label));
  const agentText = turns.filter((t) => roleOf(t.label) === "A").map((t) => t.text).join("\n");
  const users = turns.filter((t) => roleOf(t.label) === "U");
  const firstUser = users[0]?.text.replace(/;\s*$/, "").trim() ?? "";
  return {
    s, turns, roles,
    users: roles.filter((r) => r === "U").length,
    agents: roles.filter((r) => r === "A").length,
    unknown: roles.filter((r) => r === "?").length,
    leading: turns[0]?.leading.trim() ?? s.transcript.trim(),
    emptyTurns: turns.filter((t) => t.text.replace(/;\s*$/, "").trim() === "").length,
    consecutiveUsers: roles.some((r, i) => r === "U" && roles[i - 1] === "U"),
    notFound: NOT_FOUND.filter((re) => re.test(agentText)).map((re) => re.source),
    unavailable: UNAVAILABLE.some((re) => re.test(agentText)),
    initialMatchesFirstUser: !s.initialUserMessage ? null : firstUser === s.initialUserMessage.trim(),
    truncated: turns.filter((t) => roleOf(t.label) === "A" && isTruncated(t)).length,
    redacted: turns.filter(isRedacted).length,
    nested: turns.map((t) => NESTED_PREFIX.exec(clean(t))?.[1]).filter(Boolean),
    turnsMatchEntries: s.turns === null ? null : s.turns === turns.length,
  };
});

print(`## 3. Transcript structure`);
print();
print(`### Speaker markers found`);
print();
table(["Marker", "Occurrences", "Sessions", "Read as"], [...speakerCounts].sort((a, b) => b[1] - a[1])
  .map(([label, n]) => [`\`${label}:\``, n, speakerSessions.get(label).size, { U: "User", A: "Agent", "?": "UNKNOWN" }[roleOf(label)]]));
table(["Marker position", "Occurrences"], [...boundaryCounts].sort((a, b) => b[1] - a[1]));
const nestedCounts = new Map();
for (const a of analysed) for (const n of a.nested) nestedCounts.set(n, (nestedCounts.get(n) ?? 0) + 1);
if (nestedCounts.size) {
  print(`Speaker-like prefixes found INSIDE an entry's text (not speakers — part of the message):`);
  print();
  table(["Inner prefix", "Entries"], [...nestedCounts].map(([l, n]) => [`\`${l}:\``, n]));
}
const frequentOther = [...otherLabels].filter(([, n]) => n >= 3).sort((a, b) => b[1] - a[1]).slice(0, 15);
print(`Other "Label:" patterns at a boundary that are not speaker markers: ${[...otherLabels.values()].reduce((a, b) => a + b, 0)} occurrences, ${otherLabels.size} distinct.` +
  (frequentOther.length ? ` Recurring (≥3): ${frequentOther.map(([l, n]) => `\`${l}:\` ×${n}`).join(", ")}.` : ""));
print();

const shapeOf = (a) => {
  if (a.turns.length === 0) return "E. Other — no speaker marker at all";
  if (a.unknown > 0) return "E. Other — contains an unrecognised speaker";
  if (a.users === 0) return "C. Agent-only";
  if (a.agents === 0) return "D. User-only";
  if (a.users === 1) return a.roles[0] === "A" ? "A. Agent → User → Agent (one question)" : "A′. User → Agent (one question, no greeting)";
  return "B. Multi-question (≥2 user messages)";
};
const shapes = new Map();
for (const a of analysed) shapes.set(shapeOf(a), (shapes.get(shapeOf(a)) ?? 0) + 1);
print(`### Structure classes`);
print();
table(["Structure", "Sessions"], [...shapes].sort());

const sequences = new Map();
for (const a of analysed) {
  const seq = a.roles.join(" ") || "(none)";
  sequences.set(seq, (sequences.get(seq) ?? 0) + 1);
}
print(`### Exact speaker sequences (U = user, A = agent)`);
print();
table(["Sequence", "Sessions"], [...sequences].sort((a, b) => b[1] - a[1]));

print(`### Counts requested`);
print();
table(["Measure", "Sessions"], [
  ["Multiple User messages", analysed.filter((a) => a.users > 1).length],
  ["Multiple Agent responses", analysed.filter((a) => a.agents > 1).length],
  ["Both User and Agent messages", analysed.filter((a) => a.users > 0 && a.agents > 0).length],
  ["Only Agent messages", analysed.filter((a) => a.agents > 0 && a.users === 0).length],
  ["Only User messages", analysed.filter((a) => a.users > 0 && a.agents === 0).length],
  ["No recognised speaker", analysed.filter((a) => a.turns.length === 0).length],
  ['"Not found" wording in an agent response', analysed.filter((a) => a.notFound.length > 0).length],
  ['"Agent unavailable" wording', analysed.filter((a) => a.unavailable).length],
  ["Both not-found and unavailable wording", analysed.filter((a) => a.notFound.length && a.unavailable).length],
]);
const nfPatterns = new Map();
for (const a of analysed) for (const p of a.notFound) nfPatterns.set(p, (nfPatterns.get(p) ?? 0) + 1);
if (nfPatterns.size) {
  print(`"Not found" wordings that matched (calibration for Phase 9 — heuristic, not a verdict):`);
  print();
  table(["Pattern", "Sessions"], [...nfPatterns].sort((a, b) => b[1] - a[1]).map(([p, n]) => [`\`${p}\``, n]));
}

print(`### Edge cases`);
print();
table(["Edge case", "Sessions"], [
  ["Text before the first speaker marker", analysed.filter((a) => a.turns.length && a.leading).length],
  ["A speaker turn with empty text", analysed.filter((a) => a.emptyTurns > 0).length],
  ["Turns column = number of transcript entries", analysed.filter((a) => a.turnsMatchEntries === true).length],
  ["Turns column ≠ number of transcript entries", analysed.filter((a) => a.turnsMatchEntries === false).length],
  ["Agent message truncated by the export (≥480 chars ending \"...\")", `${analysed.filter((a) => a.truncated).length} (${analysed.reduce((n, a) => n + a.truncated, 0)} messages)`],
  ["Message replaced by [REDACTED]", `${analysed.filter((a) => a.redacted).length} (${analysed.reduce((n, a) => n + a.redacted, 0)} messages)`],
  ["Two user messages in a row (no agent reply between)", analysed.filter((a) => a.consecutiveUsers).length],
  ["Session ends on a user message (no reply)", analysed.filter((a) => a.roles.at(-1) === "U").length],
  ["InitialUserMessage = first user message (exact, trimmed)", analysed.filter((a) => a.initialMatchesFirstUser === true).length],
  ["InitialUserMessage ≠ first user message", analysed.filter((a) => a.initialMatchesFirstUser === false).length],
  ["InitialUserMessage empty", analysed.filter((a) => a.initialMatchesFirstUser === null).length],
  ["Agent answer containing a Markdown table", analysed.filter((a) => a.turns.some((t) => roleOf(t.label) === "A" && /\n\s*\|.*\|/.test(t.text))).length],
  ["Agent answer containing a URL", analysed.filter((a) => a.turns.some((t) => roleOf(t.label) === "A" && /https?:\/\//.test(t.text))).length],
  ["Agent answer containing ';' inside its own text", analysed.filter((a) => a.turns.some((t) => roleOf(t.label) === "A" && t.text.replace(/;\s*$/, "").includes(";"))).length],
]);

print(`### Multi-question sessions`);
print();
const multi = analysed.filter((a) => a.users > 1).sort((a, b) => b.users - a.users);
if (multi.length === 0) print("None found.");
else table(["Session (masked)", "User msgs", "Agent msgs", "Sequence", ...(showText ? ["User messages (excerpts)"] : [])], multi.map((a) => [
  maskId(a.s.sessionId), a.users, a.agents, a.roles.join(" "),
  ...(showText ? [a.turns.filter((t) => roleOf(t.label) === "U").map((t) => `“${excerpt(clean(t), 45)}”`).join(" → ")] : []),
]));

const seen = new Set();
if (showText) print(`### One example per structure class (excerpts — names are NOT redacted)`), print();
for (const a of showText ? analysed : []) {
  const shape = shapeOf(a);
  if (seen.has(shape)) continue;
  seen.add(shape);
  print(`**${shape}** — ${maskId(a.s.sessionId)}`);
  for (const t of a.turns.slice(0, 6)) print(`- \`${t.label}:\` ${excerpt(t.text.replace(/;\s*$/, ""), 70)}`);
  if (a.turns.length > 6) print(`- … ${a.turns.length - 6} more turn(s)`);
  if (a.turns.length === 0) print(`- (no marker) ${excerpt(a.s.transcript, 70)}`);
  print();
}

console.log(out.join("\n"));
