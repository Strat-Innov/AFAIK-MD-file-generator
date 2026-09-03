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

// The set this export is allowed to describe. Same value as CORE_SHA in
// test/benchmark.test.js; if the two ever disagree, the export refuses
// rather than shipping questions nobody pinned.
const CORE_SHA = "ed410946f7dc284c9693cf9a2925b508e2f22140ec9b7d3722ddbe8d8d9507b6";
const CHUNK = 100;

if (!fs.existsSync(setPath)) {
  console.error(`No question set at ${setPath}. Build it with: npm run benchmark:questions`);
  process.exit(1);
}
const { meta, questions } = JSON.parse(fs.readFileSync(setPath, "utf8"));

const core = questions.map((q) => [q.id, q.page, q.kind, q.question, q.answer].join(" | ")).join("\n");
const sha = crypto.createHash("sha256").update(core, "utf8").digest("hex");
if (sha !== CORE_SHA) {
  console.error(`Question set checksum mismatch.\n  expected ${CORE_SHA}\n  found    ${sha}\nRefusing to export a set that is not the pinned one.`);
  process.exit(2);
}

/* ---- scope and integrity, re-checked at the point of export ---- */
const normalize = (n) => n.replace(/#U2013/g, "–");
const excluded = new Set((meta.excludedPages || []).map(normalize));
const problems = [];
if (meta.corpusPages !== 128) problems.push(`meta.corpusPages is ${meta.corpusPages}, expected 128`);
if (excluded.size !== 5) problems.push(`${excluded.size} excluded pages recorded, expected 5`);
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
console.log(`scope         ${meta.corpusPages} of ${meta.snapshotPages} pages   excluded: ${[...excluded].sort().join(", ")}`);
console.log(`questions     ${questions.length}\n`);
for (const w of written) console.log(`  ${w.name.padEnd(38)} ${String(w.rows).padStart(3)} rows   ${String(w.bytes).padStart(7)} bytes`);
console.log(`\n  ${"TOTAL".padEnd(38)} ${String(written.reduce((n, w) => n + w.rows, 0)).padStart(3)} rows`);
console.log(`\nwrote ${outDir}`);
