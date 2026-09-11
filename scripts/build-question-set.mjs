/* ------------------------------------------------------------------ *
 * Builds a retrieval-benchmark question set from the August corpus.
 *
 * Every question is generated from a fact the source actually states,
 * and its ground-truth answer is the source value verbatim — no
 * paraphrase, no invention, nothing an LLM wrote. That is what makes
 * the set usable as a yardstick: a wrong answer is wrong against the
 * page, not against an opinion.
 *
 *   node scripts/build-question-set.mjs [outDir]
 *
 * Reads test/corpus/*.aspx (gitignored) and writes question-set.json
 * plus a readable .md alongside it. The output carries employee names
 * and email addresses, so it is gitignored too — see benchmark/README.
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
const { parsePage } = await import(path.join(root, "src/lib/aspxDocument.js"));
const { GENERATOR_VERSION } = await import(path.join(root, "src/lib/version.js"));
const { checkCorpus, formatReport, blocksBenchmark } = await import(path.join(root, "src/lib/sourceIntegrity.js"));
const { checkQuestionSet, formatQuestionReport, blocksFreeze } = await import(path.join(root, "src/lib/questionQuality.js"));
const {
  buildQuestionSet, scopeOf, missingExclusions, EXCLUDED_PAGES, titleOf,
} = await import(path.join(root, "src/lib/questionSet.js"));
const { buildRunManifest } = await import(path.join(root, "src/lib/generationRun.js"));
const { ACTIVE_SNAPSHOT } = await import(path.join(root, "src/lib/snapshots.js"));

const corpusDir = path.join(root, "test/corpus");
const outDir = process.argv[2] || path.join(root, "benchmark");

/* ---- scope, from the corpus on disk ----
 * The generator itself lives in src/lib/questionSet.js and is shared
 * with the app's Test Question Generator panel, so the CLI and the
 * browser cannot drift into producing different sets. This file only
 * supplies pages and writes results.
 */
const corpusNames = fs.readdirSync(corpusDir).filter((f) => f.endsWith(".aspx")).sort();
const scopedNames = scopeOf(corpusNames);
const absent = missingExclusions(corpusNames);
if (absent.length) {
  console.error(
    `Excluded page(s) not present in the corpus: ${absent.join(", ")}\n` +
    `A page deleted at source should be removed from EXCLUDED_PAGES, not left asserting it exists.`
  );
  process.exit(1);
}

const scopedPages = scopedNames.map((name) => ({
  name,
  page: parsePage(fs.readFileSync(path.join(corpusDir, name), "utf8"), { name, path: name }),
}));
const entityByPage = new Map(scopedPages.map(({ name, page }) => [name, titleOf(page)]));

const includeNegative = process.argv.includes("--include-negative");
const targetArg = process.argv.find((a) => a.startsWith("--target="));
const perPageArg = process.argv.find((a) => a.startsWith("--per-page="));

const built = await buildQuestionSet(scopedPages, {
  includeNegative,
  targetQuestions: targetArg ? Number(targetArg.split("=")[1]) : null,
  perPage: perPageArg ? Number(perPageArg.split("=")[1]) : null,
  entityOf: (p) => entityByPage.get(p) ?? null,
});
const questions = built.questions;
console.log(
  `dropped ${built.removed.dropped} ambiguous or duplicate question(s) ` +
  `(${built.removed.ambiguous} genuinely ambiguous)`
);

/* ---- source-integrity governance ----
 * A page whose body does not belong to its title produces ground truth
 * that is wrong at source, and no downstream check can see it: the
 * generator is a faithful transform, so it faithfully reproduces the
 * error. September V1 lost 34 questions to exactly that. High-confidence
 * findings stop the build; everything else is reported and proceeds.
 * Override with --allow-source-warnings when a finding has been reviewed. */
const allowOverride = process.argv.includes("--allow-source-warnings");
const integrity = checkCorpus(
  scopedNames.map((name) => ({
    name,
    page: parsePage(fs.readFileSync(path.join(corpusDir, name), "utf8"), { name, path: name }),
  }))
);
if (integrity.length) {
  console.log("\n" + formatReport(integrity) + "\n");
}
const blocking = integrity.filter(blocksBenchmark);
if (blocking.length && !allowOverride) {
  console.error(
    `Refusing to build: ${blocking.length} page(s) flagged at high confidence — ` +
    blocking.map((b) => b.page).join(", ") +
    `\nFix the source, or re-run with --allow-source-warnings if this has been reviewed.`
  );
  process.exit(3);
}
if (blocking.length) {
  console.warn(`proceeding past ${blocking.length} high-confidence source finding(s) by explicit override\n`);
}

/* ---- question-quality governance ----
 * Reported, never applied: a generated question is evidence of what the
 * page says, so repairing it silently would break the one property that
 * makes the set usable as ground truth. */
const quality = checkQuestionSet(questions, { corpusPages: scopedNames });
if (quality.findings.length) console.log(formatQuestionReport(quality) + "\n");
if (blocksFreeze(quality)) {
  console.error("Refusing to build: question-quality findings at high severity. See the report above.");
  process.exit(4);
}

fs.mkdirSync(outDir, { recursive: true });
const meta = {
  generatorVersion: GENERATOR_VERSION,
  builtAt: new Date().toISOString(),
  scope: `${scopedNames.length}-page benchmark scope — see benchmark/SCOPE.md`,
  snapshotPages: corpusNames.length,
  corpusPages: scopedNames.length,
  excludedPages: [...EXCLUDED_PAGES].sort(),
  questionCount: questions.length,
  sourceIntegrity: {
    checked: scopedNames.length,
    findings: integrity.map((r) => ({ page: r.page, severity: r.severity, rules: r.findings.map((f) => f.rule) })),
    blocked: blocking.map((b) => b.page),
    overridden: blocking.length > 0 && allowOverride,
  },
  questionQuality: { counts: quality.counts, findings: quality.findings.length },
  questionSetSha256: built.sha256,
};
fs.writeFileSync(path.join(outDir, "question-set.json"), JSON.stringify({ meta, questions }, null, 1));

/* ---- the run manifest ----
 * Ties this question set to the snapshot it came from. The arm builder
 * writes its own digests against the same snapshot, so a reader can
 * confirm all three artifacts describe the same pages. Nothing here is
 * inside the canonical question content, so regenerating is still
 * byte-stable. */
const manifest = await buildRunManifest({
  snapshot: ACTIVE_SNAPSHOT.name,
  snapshotSha256: ACTIVE_SNAPSHOT.contentSha256,
  generatorVersion: GENERATOR_VERSION,
  masterSha: ACTIVE_SNAPSHOT.armBSha256,
  aiSha: ACTIVE_SNAPSHOT.armCSha256,
  questionSetSha: built.sha256,
  questions: questions.length,
  corpusPages: scopedNames.length,
  sourceIntegrity: meta.sourceIntegrity,
  questionQuality: meta.questionQuality,
});
fs.writeFileSync(path.join(outDir, "generation-run.json"), JSON.stringify(manifest, null, 1));

const byKind = {};
for (const q of questions) (byKind[q.kind] ??= []).push(q);
let md = `# Retrieval question set\n\nGenerated from the active corpus by \`scripts/build-question-set.mjs\` against generator v${meta.generatorVersion}.\nEvery answer is a verbatim source value.\n\n- Pages in scope: ${meta.corpusPages} of ${meta.snapshotPages} (see benchmark/SCOPE.md)\n- Excluded by intent: ${meta.excludedPages.join(", ")}\n- Questions: ${meta.questionCount}\n\n`;
for (const [kind, qs] of Object.entries(byKind).sort((a, b) => b[1].length - a[1].length)) {
  md += `## ${kind} (${qs.length})\n\n`;
  for (const q of qs.slice(0, 5)) md += `- **${q.question}**\n  - expected: \`${q.answer}\`\n  - page: \`${q.page}\`\n`;
  if (qs.length > 5) md += `- …and ${qs.length - 5} more\n`;
  md += `\n`;
}
fs.writeFileSync(path.join(outDir, "question-set.md"), md);

console.log(`pages: ${meta.corpusPages} of ${meta.snapshotPages} in scope   questions: ${meta.questionCount}`);
for (const [kind, qs] of Object.entries(byKind).sort((a, b) => b[1].length - a[1].length)) {
  console.log(`  ${kind.padEnd(20)} ${String(qs.length).padStart(5)}`);
}
console.log(`\nquestion set SHA  ${built.sha256}`);
console.log(`generation run    ${manifest.generationRunId}   snapshot ${manifest.snapshot}`);
console.log(`\nwrote ${path.join(outDir, "question-set.json")}, .md and generation-run.json`);
