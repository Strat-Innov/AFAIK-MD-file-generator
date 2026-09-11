/* ------------------------------------------------------------------ *
 * Exports the finalized question set to import-ready CSVs.
 *
 *   node scripts/export-question-csv.mjs [outDir]
 *
 * Reads benchmark/question-set.json and writes chunks of 100 rows with
 * the two columns a Copilot Studio evaluation import expects:
 *
 *   Question,Expected response
 *
 * This is a transport format, nothing more. It reads the set, it does
 * not build one: no question is generated, reordered, reworded or
 * dropped here, and the set's checksum is verified before a byte is
 * written so an export can never describe a set other than the one
 * pinned in test/benchmark.test.js.
 *
 * Output is gitignored. Answers to the contact questions are employee
 * names and work email addresses — the same reason question-set.json
 * itself is gitignored. See benchmark/README.md.
 * ------------------------------------------------------------------ */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const setPath = path.join(root, "benchmark/question-set.json");
const outDir = process.argv[2] || path.join(root, "benchmark/csv");

// The set this export is allowed to describe comes from the snapshot
// registry, not from a constant here. Pinning it by hand is how this
// exporter came to be stuck on August's checksum and August's exclusion
// count while the active snapshot had moved on twice: it refused the
// September set outright. The registry is the single source of truth
// for what is active, so the check reads it.
const { ACTIVE_SNAPSHOT } = await import(path.join(root, "src/lib/snapshots.js"));
const CORE_SHA = ACTIVE_SNAPSHOT.questionSetSha256;
const CHUNK = 100;

if (!fs.existsSync(setPath)) {
  console.error(`No question set at ${setPath}. Build it with: npm run benchmark:questions`);
  process.exit(1);
}
const { meta, questions } = JSON.parse(fs.readFileSync(setPath, "utf8"));

const core = questions.map((q) => [q.id, q.page, q.kind, q.question, q.answer].join(" | ")).join("\n");
const sha = crypto.createHash("sha256").update(core, "utf8").digest("hex");
if (sha !== CORE_SHA) {
  console.error(
    `Question set checksum mismatch.\n` +
    `  active snapshot ${ACTIVE_SNAPSHOT.name}\n` +
    `  expected        ${CORE_SHA}\n` +
    `  found           ${sha}\n` +
    `Refusing to export a set the registry does not pin. Rebuild the question set, or\n` +
    `register the snapshot in src/lib/snapshots.js once its identity is confirmed.`
  );
  process.exit(2);
}

/* ---- scope and integrity, re-checked at the point of export ---- */
const normalize = (n) => n.replace(/#U2013/g, "–");
const excluded = new Set((meta.excludedPages || []).map(normalize));
const problems = [];
// Derived, never hard-coded: the exporter simply exports whatever set
// the registry currently pins, whatever its size and exclusions.
if (meta.corpusPages !== ACTIVE_SNAPSHOT.benchmarkPages) {
  problems.push(`meta.corpusPages is ${meta.corpusPages}, registry says ${ACTIVE_SNAPSHOT.benchmarkPages}`);
}
if (questions.length !== ACTIVE_SNAPSHOT.questions) {
  problems.push(`${questions.length} questions, registry says ${ACTIVE_SNAPSHOT.questions}`);
}
for (const q of questions) {
  if (excluded.has(normalize(q.page))) problems.push(`${q.id} is anchored on the excluded page ${q.page}`);
}
const dupeIds = questions.length - new Set(questions.map((q) => q.id)).size;
const dupeText = questions.length - new Set(questions.map((q) => `${q.page}|${q.question}`)).size;
if (dupeIds) problems.push(`${dupeIds} duplicate question id(s)`);
if (dupeText) problems.push(`${dupeText} duplicate page+question pair(s)`);
for (const q of questions) {
  if (!q.question?.trim() || !q.answer?.trim()) problems.push(`${q.id} has an empty question or answer`);
}
if (problems.length) {
  console.error("Refusing to export:");
  for (const p of problems.slice(0, 20)) console.error("  -", p);
  process.exit(3);
}

/* ---- RFC 4180: quote every field, double any embedded quote ---- */
const cell = (s) => `"${String(s).replace(/"/g, '""')}"`;
const row = (a, b) => `${cell(a)},${cell(b)}`;
const EOL = "\r\n";

fs.mkdirSync(outDir, { recursive: true });
const chunks = [];
for (let i = 0; i < questions.length; i += CHUNK) chunks.push(questions.slice(i, i + CHUNK));

const written = [];
chunks.forEach((chunk, i) => {
  const from = i * CHUNK + 1;
  const to = from + chunk.length - 1;
  const name = `benchmark_${String(i + 1).padStart(3, "0")}_Q${String(from).padStart(3, "0")}-Q${String(to).padStart(3, "0")}.csv`;
  const body = ["Question,Expected response", ...chunk.map((q) => row(q.question, q.answer))].join(EOL) + EOL;
  const full = path.join(outDir, name);
  fs.writeFileSync(full, body, "utf8");
  written.push({ name, rows: chunk.length, bytes: Buffer.byteLength(body, "utf8"), from, to, full });
});

console.log(`source        ${path.relative(root, setPath)}`);
console.log(`checksum      ${sha}  (verified)`);
console.log(`snapshot      ${ACTIVE_SNAPSHOT.name}  (${ACTIVE_SNAPSHOT.label ?? "unlabelled"})`);
console.log(`scope         ${meta.corpusPages} of ${meta.snapshotPages} pages   excluded: ${[...excluded].sort().join(", ") || "none"}`);
console.log(`questions     ${questions.length}   batches: ${Math.ceil(questions.length / CHUNK)} (last ${questions.length % CHUNK || CHUNK})\n`);
for (const w of written) console.log(`  ${w.name.padEnd(38)} ${String(w.rows).padStart(3)} rows   ${String(w.bytes).padStart(7)} bytes`);
console.log(`\n  ${"TOTAL".padEnd(38)} ${String(written.reduce((n, w) => n + w.rows, 0)).padStart(3)} rows`);
console.log(`\nwrote ${outDir}`);
