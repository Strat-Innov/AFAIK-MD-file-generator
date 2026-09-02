/* ------------------------------------------------------------------ *
 * Builds the two knowledge artifacts the retrieval benchmark compares.
 *
 *   npm run benchmark:arms
 *
 * Arm B  the consolidated master file the app shipped before this work
 * Arm C  the AI-optimized file this work added
 *
 * Both are produced by the FROZEN generator (src/lib), imported not
 * reimplemented, so the artifacts under test are the ones the app
 * actually emits. This script adds no extraction or rendering logic of
 * its own; it only supplies the corpus, fixes the clock, and writes the
 * results out.
 *
 * Determinism: buildMaster() stamps a generation time into its header,
 * which would make Arm B differ on every run and defeat checksum
 * comparison. It accepts an explicit date, so the snapshot below is
 * passed in and the output is byte-stable. Arm C carries no clock.
 *
 * Output goes to benchmark-artifacts/, which is gitignored: these files
 * reproduce the corpus, employee names and addresses included.
 * ------------------------------------------------------------------ */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><html><body></body></html>");
global.window = dom.window;
global.document = dom.window.document;
global.DOMParser = dom.window.DOMParser;

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const { buildMaster } = await import(path.join(root, "src/lib/masterMd.js"));
const { generateOptimized, formatBucketReport } = await import(path.join(root, "src/lib/generate.js"));
const { GENERATOR_VERSION } = await import(path.join(root, "src/lib/version.js"));

/* ---- the fixed knowledge snapshot ----
 * The benchmark uses the whole August corpus as ONE snapshot. The app
 * groups files by tag, but the corpus carries no tag assignment and
 * inventing one would add a second variable, so every arm is built from
 * the identical 133-file set under a single fixed name. */
const SNAPSHOT = "AUGUST-2026-CORPUS";
const SNAPSHOT_CLOCK = new Date(Date.UTC(2026, 7, 31, 0, 0, 0)); // fixed; see note above

const corpusDir = path.join(root, "test/corpus");
const outDir = process.argv[2] || path.join(root, "benchmark-artifacts");

if (!fs.existsSync(corpusDir) || !fs.readdirSync(corpusDir).some((f) => f.endsWith(".aspx"))) {
  console.error(`No corpus found in ${corpusDir}. See test/corpus/README.md — the .aspx exports are gitignored and must be supplied locally.`);
  process.exit(1);
}

const names = fs.readdirSync(corpusDir).filter((f) => f.endsWith(".aspx")).sort();
const files = names.map((name) => ({ name, path: name, raw: fs.readFileSync(path.join(corpusDir, name), "utf8") }));

const sha256 = (s) => crypto.createHash("sha256").update(s, "utf8").digest("hex");
const write = (arm, file, body) => {
  const dir = path.join(outDir, arm);
  fs.mkdirSync(dir, { recursive: true });
  const full = path.join(dir, file);
  fs.writeFileSync(full, body);
  return full;
};

/* ---- Arm B: consolidated master (the pre-existing representation) ---- */
const armB = buildMaster(SNAPSHOT, files, SNAPSHOT_CLOCK);
const armBPath = write("arm-b", `${SNAPSHOT}_Master_File.md`, armB);

/* ---- Arm C: AI-optimized (gated on validation) ---- */
const optimized = generateOptimized(SNAPSHOT, files);
if (optimized.status !== "PASS") {
  console.error(`Arm C blocked by the validation gate — ${optimized.failed.length} page(s) failed.`);
  console.error(formatBucketReport(SNAPSHOT, optimized));
  process.exit(2);
}
const armCPath = write("arm-c", `${SNAPSHOT}_AI_File.md`, optimized.md);

/* ---- manifest: what each arm supplies, and proof it is what it says ---- */
const manifest = {
  snapshot: SNAPSHOT,
  generatorVersion: GENERATOR_VERSION,
  snapshotClock: SNAPSHOT_CLOCK.toISOString(),
  builtAt: new Date().toISOString(), // informational only; not part of any checksum
  corpusPages: files.length,
  arms: {
    B: {
      description: "Consolidated master file — the representation the app shipped before this work",
      file: path.relative(outDir, armBPath),
      bytes: Buffer.byteLength(armB, "utf8"),
      sha256: sha256(armB),
      pages: files.length,
    },
    C: {
      description: "AI-optimized file — retrieval representation, published only on a validation PASS",
      file: path.relative(outDir, armCPath),
      bytes: Buffer.byteLength(optimized.md, "utf8"),
      sha256: sha256(optimized.md),
      pages: optimized.pages.length,
      validation: {
        status: optimized.status,
        sourceUnits: optimized.totals.sourceUnits,
        representedUnits: optimized.totals.representedUnits,
        untraceableUnits: optimized.totals.unmatched,
      },
    },
  },
  // Both arms are built from this exact file set. Arm A supplies none of
  // them; it is the live SharePoint site with no uploaded knowledge.
  files: names,
  filesSha256: sha256(names.join("\n")),
};
fs.writeFileSync(path.join(outDir, "manifest.json"), JSON.stringify(manifest, null, 2));

const kb = (n) => (n / 1024).toFixed(0).padStart(7) + " KB";
console.log(`snapshot        ${SNAPSHOT}   generator v${GENERATOR_VERSION}   pages ${files.length}`);
console.log(`Arm B  ${kb(manifest.arms.B.bytes)}  ${manifest.arms.B.sha256.slice(0, 16)}…  ${manifest.arms.B.file}`);
console.log(`Arm C  ${kb(manifest.arms.C.bytes)}  ${manifest.arms.C.sha256.slice(0, 16)}…  ${manifest.arms.C.file}`);
console.log(`Arm C validation ${optimized.status} — ${optimized.totals.representedUnits}/${optimized.totals.sourceUnits} units, ${optimized.totals.unmatched} untraceable`);
console.log(`manifest        ${path.join(outDir, "manifest.json")}`);
