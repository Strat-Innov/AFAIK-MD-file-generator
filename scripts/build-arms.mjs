/* ------------------------------------------------------------------ *
 * Builds the two knowledge artifacts the retrieval benchmark compares.
 *
 *   npm run benchmark:arms [outDir]
 *
 * Arm B  the consolidated master file the app shipped before this work
 * Arm C  the AI-optimized file this work added
 *
 * The recipe itself lives in src/lib/benchmarkExport.js and is shared
 * with the app's Benchmark Export panel, so the CLI and the UI produce
 * identical bytes by construction. This script only supplies the corpus
 * from disk and writes the results out; it adds no extraction,
 * rendering or packaging logic of its own.
 *
 * Output goes to benchmark-artifacts/, which is gitignored: these files
 * reproduce the corpus, employee names and addresses included.
 * ------------------------------------------------------------------ */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><html><body></body></html>");
global.window = dom.window;
global.document = dom.window.document;
global.DOMParser = dom.window.DOMParser;

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const { buildBenchmarkArtifacts, compareToCanonical } = await import(path.join(root, "src/lib/benchmarkExport.js"));
const { formatBucketReport } = await import(path.join(root, "src/lib/generate.js"));

const corpusDir = path.join(root, "test/corpus");
const outDir = process.argv[2] || path.join(root, "benchmark-artifacts");

if (!fs.existsSync(corpusDir) || !fs.readdirSync(corpusDir).some((f) => f.endsWith(".aspx"))) {
  console.error(`No corpus found in ${corpusDir}. See test/corpus/README.md — the .aspx exports are gitignored and must be supplied locally.`);
  process.exit(1);
}

const names = fs.readdirSync(corpusDir).filter((f) => f.endsWith(".aspx")).sort();
const files = names.map((name) => ({ name, path: name, raw: fs.readFileSync(path.join(corpusDir, name), "utf8") }));

const built = await buildBenchmarkArtifacts(files);
const { armB, armC, optimized, manifest } = built;

if (armC.validation.status !== "PASS") {
  console.error(`Arm C blocked by the validation gate — ${optimized.failed.length} page(s) failed.`);
  console.error(formatBucketReport(manifest.snapshot, optimized));
  process.exit(2);
}

const write = (relative, body) => {
  const full = path.join(outDir, relative);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, body);
  return full;
};

write(armB.file, armB.md);
write(armC.file, armC.md);
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, "manifest.json"), JSON.stringify(manifest, null, 2));

const match = compareToCanonical(built);
const kb = (n) => (n / 1024).toFixed(0).padStart(7) + " KB";
const mark = (ok) => (ok ? "= verified artifact" : "≠ verified artifact");
console.log(`snapshot        ${manifest.snapshot}   generator v${manifest.generatorVersion}   pages ${files.length}`);
console.log(`Arm B  ${kb(armB.bytes)}  ${armB.sha256.slice(0, 16)}…  ${armB.file}  ${mark(match.armB)}`);
console.log(`Arm C  ${kb(armC.bytes)}  ${armC.sha256.slice(0, 16)}…  ${armC.file}  ${mark(match.armC)}`);
console.log(`Arm C validation ${armC.validation.status} — ${armC.validation.representedUnits}/${armC.validation.sourceUnits} units, ${armC.validation.untraceableUnits} untraceable`);
console.log(`corpus file set ${manifest.filesSha256.slice(0, 16)}…  ${mark(match.files)}`);
console.log(`manifest        ${path.join(outDir, "manifest.json")}`);
