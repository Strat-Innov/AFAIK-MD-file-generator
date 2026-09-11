/* ------------------------------------------------------------------ *
 * QUESTION SET — the third artifact of a snapshot.
 *
 * A corpus snapshot produces three things: the Master file (fidelity),
 * the AI-optimized file (retrieval), and this — the question set the
 * other two are measured with. All three are generated from the same
 * frozen pages, so all three carry the same snapshot identity.
 *
 * This module is the generator, shared by the CLI
 * (scripts/build-question-set.mjs) and the app's Test Question Generator
 * panel, exactly as src/lib/benchmarkExport.js is shared. That sharing
 * is not tidiness: it is the only way the browser and the command line
 * are guaranteed to emit the same bytes, and therefore the same
 * CORE_SHA. A second implementation would be a second answer.
 *
 * WHAT IT WILL NOT DO. It never invents a fact. Every expected answer is
 * a source value copied verbatim, and every question carries a locator
 * for the structure it came from, so "why does this question expect this
 * answer" is answerable from the record without reconstructing anything
 * later. No model is consulted anywhere in this file; the set is a pure
 * function of the corpus, which is what makes it reproducible.
 *
 * IT CONSUMES, IT NEVER PRODUCES. Question generation reads parsed pages
 * and writes nothing back. The Master file, the AI file, the extraction
 * and the validation are untouched by anything here.
 * ------------------------------------------------------------------ */

import { sha256 } from "./digest.js";

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
export const EXCLUDED_PAGES = [
  // Left Unsorted and excluded by intent since the August snapshot.
  "Page.aspx",
  "Lost-Page.aspx",
  "THE-SIGNATURE.aspx",
  "FORTUNE-HILL.aspx",
  "STUDIO-CITY.aspx",
  // Added in the September snapshot as a placeholder: its third line is
  // literally "Placeholder" and the body beneath is Finance department
  // content under an Internal Audit title. Questions built from it would
  // attribute Finance's responsibilities to Internal Audit — scoring
  // agents on a mis-association the source itself contains. Revisit when
  // the page has real content.
  "Internal-Audit.aspx",
];

// Command-line `unzip` escapes the en dash in one corpus filename as
// "#U2013" while the browser keeps it, so scope matching normalizes.
// This affects name comparison only — nothing about page content.
export const normalizeName = (n) => n.replace(/#U2013/g, "\u2013");
const excluded = new Set(EXCLUDED_PAGES.map(normalizeName));
export const inScope = (name) => !excluded.has(normalizeName(name));

/** Which declared exclusions are not actually present? A page that was
 *  deleted at source should be removed from the list, not left asserting
 *  something the corpus no longer contains. */
export const missingExclusions = (corpusNames) =>
  EXCLUDED_PAGES.filter((n) => !corpusNames.some((c) => normalizeName(c) === normalizeName(n)));

/** Filter a corpus listing to the benchmark scope, in canonical order. */
export const scopeOf = (corpusNames) => [...corpusNames].sort().filter(inScope);

/* ---- the generator ---- */

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

/** The page's own headline — the subject of every question about it. */
export const titleOf = (page) => {
  for (const s of page.sections) {
    if (s.kind !== "text") continue;
    const h = s.blocks.find((b) => b.type === "heading");
    if (h) return h.text;
  }
  return page.name.replace(/\.aspx$/i, "");
};

export function generateQuestions(scopedPages) {
  const questions = [];
  let id = 0;
  // `evidence` is the source text a question was built from; `locator` is
  // where that text sits in the parsed page — section index, then block or
  // record index within it. Both come from the iteration itself, so the
  // locator points at real structure rather than asserting metadata the
  // page does not carry.
  // Ids are minted HERE, in extraction order, and never reassigned. The
  // ambiguity filter then removes records, so the surviving sequence has
  // gaps — q0127, q0129, q0132 and so on. That is deliberate: an id names
  // one extraction from one page, so renumbering after a filter would
  // silently move every question's identity and change the CORE_SHA
  // without any question changing. Filename ranges in the CSV export
  // refer to row position, not to id.
  const add = (page, kind, question, answer, evidence, locator) => {
    if (!answer || !String(answer).trim()) return;
    questions.push({
      id: `q${String(++id).padStart(4, "0")}`,
      page, kind, question, answer: String(answer).trim(), evidence, locator,
    });
  };

  for (const { name, page } of scopedPages) {
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

  return questions;
}

/**
 * A question with more than one answer on the same page cannot score an
 * answer as right or wrong, so it is not usable as ground truth.
 * Credits.aspx repeats "description" and "special ability" for each of
 * its several subjects, which is exactly this case.
 */
export function dropAmbiguous(input) {
  const questions = [...input];
  let removed = { dropped: 0, ambiguous: 0 };
  const seen = new Map();
  for (const q of questions) {
    const key = `${q.page}|${q.question}`;
    (seen.get(key) ?? seen.set(key, []).get(key)).push(q);
  }
  const keep = new Set();
  let dropped = 0;
  for (const group of seen.values()) {
    const answers = new Set(group.map((q) => q.answer));
    if (answers.size === 1) keep.add(group[0]);
    else dropped += group.length;
  }
  const before = questions.length;
  const kept = questions.filter((q) => keep.has(q));
  removed = { dropped: before - kept.length, ambiguous: dropped };
  return { kept, removed };
}

/* ------------------------------------------------------------------ *
 * Canonical identity.
 *
 * CORE_SHA is over id, page, kind, question and answer — the fields that
 * decide what is being asked and what counts as right. Everything else
 * on a record (category, entity, difficulty, warnings) is derived or
 * descriptive, so enriching a record cannot move the checksum, and the
 * same corpus always yields the same hash. This is the SAME definition
 * test/benchmark.test.js and the CSV exporter use; there is exactly one.
 * ------------------------------------------------------------------ */

export const coreText = (questions) =>
  questions.map((q) => [q.id, q.page, q.kind, q.question, q.answer].join(" | ")).join("\n");

export const questionSetSha = (questions) => sha256(coreText(questions));

/* ---- presentation vocabulary ----
 * `kind` is what the extractor found. `category` is how a reviewer reads
 * it. The mapping is fixed so a category can never drift from its kind.
 */
export const CATEGORY_OF_KIND = {
  "labelled-fact": "PROJECT / PROPERTY FACTS",
  "unit-area": "UNIT / PRICING",
  "unit-price": "UNIT / PRICING",
  "amenity": "AMENITIES",
  "contact-by-role": "CONTACT / ROLE",
  "contact-email": "CONTACT / EMAIL",
  "external-link": "LINKS / NAVIGATION",
  "absence": "NEGATIVE / NOT-AVAILABLE",
};

const ANSWER_TYPE = {
  "labelled-fact": "value",
  "unit-area": "measurement",
  "unit-price": "money",
  "amenity": "boolean-with-evidence",
  "contact-by-role": "person",
  "contact-email": "email",
  "external-link": "url",
  "absence": "refusal",
};

// Difficulty is structural, not a guess: a question answerable from one
// labelled line is easier than one requiring a role-to-person mapping
// held in a web part, which is easier than one whose answer is a URL the
// page stores separately from its label.
const DIFFICULTY = {
  "labelled-fact": "easy",
  "amenity": "easy",
  "contact-email": "easy",
  "unit-area": "medium",
  "unit-price": "medium",
  "contact-by-role": "medium",
  "external-link": "hard",
  "absence": "hard",
};

/** The section index a question's evidence sits in, when it has one. */
const sectionOf = (locator) =>
  locator?.section ?? locator?.people?.[0]?.section ?? null;

/**
 * Add the descriptive fields a reviewer needs, without touching any
 * field the checksum covers. Enrichment is therefore SHA-neutral, which
 * a test asserts.
 */
export function enrich(questions, { entityOf = () => null } = {}) {
  return questions.map((q) => ({
    ...q,
    category: CATEGORY_OF_KIND[q.kind] ?? "GENERAL KNOWLEDGE-BASE FACTS",
    answerType: ANSWER_TYPE[q.kind] ?? "value",
    difficulty: DIFFICULTY[q.kind] ?? "medium",
    entity: entityOf(q.page),
    sourceSection: sectionOf(q.locator),
  }));
}

/* ------------------------------------------------------------------ *
 * Negative / entity-grounding questions.
 *
 * These ask whether a page lists something it demonstrably does not —
 * "Does X list residential unit pricing?" for a page that has no unit
 * rows at all — and the expected behaviour is a refusal. They test the
 * failure mode the September V1 audit turned on: an agent that answers
 * from whatever content is nearby rather than from the entity asked
 * about.
 *
 * OFF BY DEFAULT, deliberately. Turning them on changes the question
 * population and therefore the CORE_SHA, and the current V2 set is the
 * candidate we intend to evaluate. Enable explicitly, review the
 * resulting set, and register it as a new snapshot identity.
 * ------------------------------------------------------------------ */
export function negativeQuestions(scopedPages, generated, { titleOf: title = titleOf } = {}) {
  const kindsByPage = new Map();
  for (const q of generated) {
    (kindsByPage.get(q.page) ?? kindsByPage.set(q.page, new Set()).get(q.page)).add(q.kind);
  }
  const out = [];
  for (const { name, page } of scopedPages) {
    const kinds = kindsByPage.get(name) ?? new Set();
    const subject = title(page);
    // Only where the page yielded facts of some sort — a page that
    // produced nothing at all may simply not have been extracted, which
    // is not evidence of absence.
    if (kinds.size === 0) continue;
    if (!kinds.has("unit-price") && !kinds.has("unit-area")) {
      out.push({
        page: name,
        kind: "absence",
        question: `Does ${subject} list residential unit pricing?`,
        answer: `No — ${subject} lists no residential unit pricing.`,
        evidence: "no unit-price or unit-area rows extracted from this page",
        locator: { absence: "unit-pricing" },
      });
    }
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * The whole set, from parsed pages.
 *
 * `scopedPages` are [{ name, page }] already filtered to the benchmark
 * scope by the caller — `inScope()` above says what that means, and it
 * lives here so the CLI and the app cannot disagree about it.
 * ------------------------------------------------------------------ */
export async function buildQuestionSet(scopedPages, {
  includeNegative = false,
  targetQuestions = null,
  perPage = null,
  entityOf,
} = {}) {
  let questions = generateQuestions(scopedPages);
  const { kept, removed } = dropAmbiguous(questions);
  questions = kept;

  if (includeNegative) {
    questions = questions.concat(negativeQuestions(scopedPages, questions));
  }

  // Optional shaping. Neither is applied by default: the canonical set
  // is everything the corpus supports, and a cap would make the set
  // depend on a number rather than on the pages.
  const capped = applyTargets(questions, { targetQuestions, perPage });

  const enriched = enrich(capped, { entityOf });

  return {
    questions: enriched,
    sha256: await questionSetSha(capped),
    removed,
    pages: scopedPages.length,
  };
}

/**
 * Shaping, applied in canonical order so it is deterministic.
 * `perPage` keeps the first N of each page; `targetQuestions` then
 * trims round-robin across pages so a cap cannot silently delete one
 * page's entire coverage.
 */
export function applyTargets(questions, { targetQuestions = null, perPage = null } = {}) {
  let out = questions;
  if (perPage != null) {
    const seen = new Map();
    out = out.filter((q) => {
      const n = (seen.get(q.page) ?? 0) + 1;
      seen.set(q.page, n);
      return n <= perPage;
    });
  }
  if (targetQuestions != null && out.length > targetQuestions) {
    const byPage = new Map();
    for (const q of out) (byPage.get(q.page) ?? byPage.set(q.page, []).get(q.page)).push(q);
    const lanes = [...byPage.values()];
    const picked = [];
    for (let i = 0; picked.length < targetQuestions; i++) {
      let progressed = false;
      for (const lane of lanes) {
        if (i >= lane.length) continue;
        picked.push(lane[i]);
        progressed = true;
        if (picked.length === targetQuestions) break;
      }
      if (!progressed) break;
    }
    const keep = new Set(picked);
    out = out.filter((q) => keep.has(q));   // canonical order preserved
  }
  return out;
}
