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

const corpusDir = path.join(root, "test/corpus");
const outDir = process.argv[2] || path.join(root, "benchmark");

/* ---- benchmark scope ----
 * The benchmark runs over 128 of the snapshot's 133 pages: the six
 * production buckets as tagged. Five pages were left Unsorted and are
 * excluded BY INTENT — see benchmark/SCOPE.md. Questions anchored on
 * them would ask Arms B and C about pages they do not contain, while
 * Arm A (live SharePoint) still holds all 133, so an excluded page
 * reads as an Arm A win that has nothing to do with representation.
 *
 * Exclusion happens at intake, before any question is generated. No
 * generated question is edited or filtered afterwards, so the
 * deterministic generation rules are exactly what they were. */
const EXCLUDED_PAGES = [
  "Page.aspx",
  "Lost-Page.aspx",
  "THE-SIGNATURE.aspx",
  "FORTUNE-HILL.aspx",
  "STUDIO-CITY.aspx",
];

// Command-line `unzip` escapes the en dash in one corpus filename as
// "#U2013" while the browser keeps it, so scope matching normalizes.
// This affects name comparison only — nothing about page content.
const normalizeName = (n) => n.replace(/#U2013/g, "\u2013");
const excluded = new Set(EXCLUDED_PAGES.map(normalizeName));
const inScope = (name) => !excluded.has(normalizeName(name));

const corpusNames = fs.readdirSync(corpusDir).filter((f) => f.endsWith(".aspx")).sort();
const scopedNames = corpusNames.filter(inScope);
const missingExclusions = EXCLUDED_PAGES.filter(
  (n) => !corpusNames.some((c) => normalizeName(c) === normalizeName(n))
);
if (missingExclusions.length) {
  console.error(`Excluded page(s) not present in the corpus: ${missingExclusions.join(", ")}`);
  process.exit(1);
}

const PRICE = /[₱$]\s?[\d.,]+\s*[MK]?/;
const AREA = /\b[\d.,]+\s*(?:–|-|to)?\s*[\d.,]*\s*sqm\b/i;
// A "Label: value" line, where the label reads like a field name.
// The label may not end in a digit and the value may not continue a
// clock time: "Sun - Sat 05:00 AM to 08:00 PM" splits at its first colon
// into the nonsense label "Sun - Sat 05". An ALL-CAPS label is a section
// header ("TOWER 1: PLATINUM"), not a field.
const LABELLED = /^([A-Za-z][A-Za-z0-9 &/'()-]{2,44}?)\s*:\s*(\S.*)$/;
const isFieldLabel = (label, value) =>
  !/\d$/.test(label.trim()) &&
  !/^\d{1,2}\s*(?::\d{2})?\s*(?:AM|PM)\b/i.test(value.trim()) &&
  label.trim() !== label.trim().toUpperCase();

const questions = [];
let id = 0;
// `evidence` is the source text a question was built from; `locator` is
// where that text sits in the parsed page — section index, then block or
// record index within it. Both come from the iteration itself, so the
// locator points at real structure rather than asserting metadata the
// page does not carry.
const add = (page, kind, question, answer, evidence, locator) => {
  if (!answer || !String(answer).trim()) return;
  questions.push({ id: `q${String(++id).padStart(4, "0")}`, page, kind, question, answer: String(answer).trim(), evidence, locator });
};

const titleOf = (page) => {
  for (const s of page.sections) {
    if (s.kind !== "text") continue;
    const h = s.blocks.find((b) => b.type === "heading");
    if (h) return h.text;
  }
  return page.name.replace(/\.aspx$/i, "");
};

for (const name of scopedNames) {
  const page = parsePage(fs.readFileSync(path.join(corpusDir, name), "utf8"), { name, path: name });
  const subject = titleOf(page);
  let heading = "";
  // Roles are collected across the whole page: the same role can appear
  // in two different People web parts, and asking about it once with all
  // the answers beats asking twice with contradictory ones.
  const rolesOnPage = new Map();

  for (const [sectionIndex, section] of page.sections.entries()) {
    if (section.kind === "text") {
      for (const [blockIndex, block] of section.blocks.entries()) {
        if (block.type === "heading") { heading = block.text.replace(/:$/, "").trim(); continue; }

        if (block.type === "paragraph") {
          // "Total Number of units: 94" -> a directly answerable fact.
          for (const [lineIndex, line] of block.lines.entries()) {
            const m = line.match(LABELLED);
            if (m && !/^https?$/i.test(m[1]) && isFieldLabel(m[1], m[2])) {
              add(name, "labelled-fact", `For ${subject}, what is the ${m[1].trim().toLowerCase()}?`, m[2], line,
                { section: sectionIndex, block: blockIndex, line: lineIndex });
            }
          }
          // A unit type followed by its floor area and its price. This is
          // the association the ordering checks exist to protect, so it is
          // exactly what a retrieval test should probe.
          const ls = block.lines;
          for (let i = 0; i < ls.length - 1; i++) {
            const unit = ls[i].trim();
            if (PRICE.test(unit) || AREA.test(unit)) continue;
            if (unit.includes(":")) continue;                       // a labelled field or a tower header
            if (unit === unit.toUpperCase()) continue;              // a section header
            if (unit.length < 3 || unit.length > 60) continue;
            // The very next line must be the area or the price. Allowing a
            // gap let "TOWER 1: PLATINUM" adopt the following unit's price.
            const next = ls[i + 1].trim();
            const after = (ls[i + 2] || "").trim();
            const area = AREA.test(next) && !PRICE.test(next) ? next : null;
            const price = PRICE.test(next) ? next : area && PRICE.test(after) ? after : null;
            if (area) add(name, "unit-area", `At ${subject}, what is the floor area of a ${unit}?`, area, `${unit} / ${area}`,
              { section: sectionIndex, block: blockIndex, line: ls.indexOf(area), unitLine: i });
            if (price) add(name, "unit-price", `At ${subject}, how much does a ${unit} cost?`, price, `${unit} / ${price}`,
              { section: sectionIndex, block: blockIndex, line: ls.indexOf(price), unitLine: i });
          }
        }

        if (block.type === "list" && /amenit|feature|inclusion/i.test(heading)) {
          for (const [itemIndex, item] of block.items.entries()) {
            if (item.length > 60) continue;
            add(name, "amenity", `Does ${subject} have ${/^(a|an|the)\b/i.test(item) ? "" : "a "}${item}?`, `Yes — ${item} is listed under ${heading}.`, item,
              { section: sectionIndex, block: blockIndex, item: itemIndex });
          }
        }
      }
    }

    if (section.kind === "webpart" && section.content.type === "people") {
      // Several people can share a role on one page. Asking "who is the
      // Project Development Manager" then has more than one correct
      // answer, so the question carries all of them rather than becoming
      // two contradictory items.
      for (const [personIndex, p] of section.content.persons.entries()) {
        if (p.role) (rolesOnPage.get(p.role) ?? rolesOnPage.set(p.role, []).get(p.role)).push({ ...p, section: sectionIndex, personIndex });
        if (p.name && p.email) add(name, "contact-email", `What is the email address for ${p.name} at ${subject}?`, p.email, `${p.name} — ${p.email}`,
          { section: sectionIndex, person: personIndex, field: "email" });
      }
    }

    if (section.kind === "webpart" && section.content.type === "links") {
      for (const [itemIndex, item] of section.content.items.entries()) {
        if (!item.url || !/^https?:\/\//i.test(item.url)) continue;
        if (!item.title) continue;
        // Phrased around the label as it appears, because a page's link
        // list can legitimately name a different project (ARBORAGE lists
        // a Brentville page). The ground truth is still exact.
        add(name, "external-link", `On the ${subject} page, what URL is listed for "${item.title}"?`, item.url, `${item.title} -> ${item.url}`,
          { section: sectionIndex, item: itemIndex, field: "url" });
      }
    }
  }

  for (const [role, people] of rolesOnPage) {
    const unique = [...new Map(people.map((p) => [p.email || p.name, p])).values()];
    const answer = unique.map((p) => `${p.name}${p.email ? ` (${p.email})` : ""}`).join("; ");
    const q = unique.length > 1
      ? `Who are the people listed as ${role} for ${subject}?`
      : `Who is the ${role} for ${subject}?`;
    add(name, "contact-by-role", q, answer, unique.map((p) => p.name).join("; "),
      { people: unique.map((p) => ({ section: p.section, person: p.personIndex })) });
  }
}

// A question with more than one answer on the same page cannot score an
// answer as right or wrong, so it is not usable as ground truth.
// Credits.aspx repeats "description" and "special ability" for each of
// its several subjects, which is exactly this case.
{
  const seen = new Map();
  for (const q of questions) {
    const key = `${q.page}|${q.question}`;
    (seen.get(key) ?? seen.set(key, []).get(key)).push(q);
  }
  const keep = new Set();
  let dropped = 0;
  for (const group of seen.values()) {
    const answers = new Set(group.map((q) => q.answer));
    if (answers.size === 1) keep.add(group[0].id);
    else dropped += group.length;
  }
  const before = questions.length;
  for (let i = questions.length - 1; i >= 0; i--) if (!keep.has(questions[i].id)) questions.splice(i, 1);
  console.log(`dropped ${before - questions.length} ambiguous or duplicate question(s) (${dropped} genuinely ambiguous)`);
}

fs.mkdirSync(outDir, { recursive: true });
const meta = {
  generatorVersion: GENERATOR_VERSION,
  builtAt: new Date().toISOString(),
  scope: "128-page benchmark scope — see benchmark/SCOPE.md",
  snapshotPages: corpusNames.length,
  corpusPages: scopedNames.length,
  excludedPages: [...excluded].sort(),
  questionCount: questions.length,
};
fs.writeFileSync(path.join(outDir, "question-set.json"), JSON.stringify({ meta, questions }, null, 1));

const byKind = {};
for (const q of questions) (byKind[q.kind] ??= []).push(q);
let md = `# Retrieval question set\n\nGenerated from the August corpus by \`scripts/build-question-set.mjs\` against generator v${meta.generatorVersion}.\nEvery answer is a verbatim source value.\n\n- Pages in scope: ${meta.corpusPages} of ${meta.snapshotPages} (see benchmark/SCOPE.md)\n- Excluded by intent: ${meta.excludedPages.join(", ")}\n- Questions: ${meta.questionCount}\n\n`;
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
console.log(`\nwrote ${path.join(outDir, "question-set.json")} and .md`);
