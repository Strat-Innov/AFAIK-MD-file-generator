import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildQuestionSet, generateQuestions, dropAmbiguous, applyTargets, negativeQuestions,
  questionSetSha, coreText, enrich, titleOf, scopeOf, inScope, missingExclusions,
  EXCLUDED_PAGES, CATEGORY_OF_KIND,
} from "../src/lib/questionSet.js";
import { buildRunManifest, newRunId, sameRun, runCompleteness } from "../src/lib/generationRun.js";
import { ACTIVE_SNAPSHOT, SNAPSHOTS } from "../src/lib/snapshots.js";
import { checkCorpus, blocksBenchmark } from "../src/lib/sourceIntegrity.js";
import { checkQuestionSet } from "../src/lib/questionQuality.js";
import { parsePage } from "../src/lib/aspxDocument.js";
import { makeAspx, textControl } from "./helpers.js";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const V1 = "benchmark/corpora/september-2026";
const V2 = "benchmark/corpora/september-2026-v2";
const ACTIVE = "test/corpus";
const has = (rel) =>
  fs.existsSync(path.join(root, rel)) &&
  fs.readdirSync(path.join(root, rel)).some((f) => f.endsWith(".aspx"));

function scopedPagesOf(rel) {
  const d = path.join(root, rel);
  const names = scopeOf(fs.readdirSync(d).filter((f) => f.endsWith(".aspx")));
  return names.map((name) => ({
    name,
    page: parsePage(fs.readFileSync(path.join(d, name), "utf8"), { name, path: name }),
  }));
}
const entityOfFor = (pages) => {
  const m = new Map(pages.map(({ name, page }) => [name, titleOf(page)]));
  return (p) => m.get(p) ?? null;
};

const page = (heading, body) =>
  makeAspx(textControl(`<h2>${heading}</h2>${body}`));

/* ------------------------------------------------------------------ *
 * The question set is a snapshot artifact like the Master and AI files.
 * These tests hold the properties that makes it usable as ground truth:
 * it comes from the corpus, it is reproducible, and its identity moves
 * only when the questions do.
 * ------------------------------------------------------------------ */

describe("TEST 1 — generation belongs to the active snapshot", () => {
  it("reproduces the active snapshot's question count and CORE_SHA", async () => {
    if (!has(ACTIVE)) return;
    const pages = scopedPagesOf(ACTIVE);
    const built = await buildQuestionSet(pages, { entityOf: entityOfFor(pages) });
    expect(built.questions).toHaveLength(ACTIVE_SNAPSHOT.questions);
    expect(built.sha256).toBe(ACTIVE_SNAPSHOT.questionSetSha256);
  }, 900000);

  it("ties the three artifacts together in one run manifest", async () => {
    const m = await buildRunManifest({
      snapshot: ACTIVE_SNAPSHOT.name,
      snapshotSha256: ACTIVE_SNAPSHOT.contentSha256,
      generatorVersion: ACTIVE_SNAPSHOT.generator,
      masterSha: ACTIVE_SNAPSHOT.armBSha256,
      aiSha: ACTIVE_SNAPSHOT.armCSha256,
      questionSetSha: ACTIVE_SNAPSHOT.questionSetSha256,
      questions: ACTIVE_SNAPSHOT.questions,
    });
    expect(runCompleteness(m).complete).toBe(true);
    expect(m.generationRunId).toMatch(/^run-[0-9a-f]{16}$/);
    expect(m.snapshot).toBe(ACTIVE_SNAPSHOT.name);
  });

  it("gives the same run id for the same inputs and a different one otherwise", async () => {
    const base = { snapshot: "S", generatorVersion: "1.1.0", masterSha: "a", aiSha: "b", questionSetSha: "c" };
    expect(await newRunId(base)).toBe(await newRunId({ ...base }));
    expect(await newRunId(base)).not.toBe(await newRunId({ ...base, questionSetSha: "d" }));
  });

  it("will not treat artifacts from different corpora as one run", () => {
    expect(sameRun({ snapshot: "A", snapshotSha256: "1", generatorVersion: "1" },
                   { snapshot: "A", snapshotSha256: "2", generatorVersion: "1" })).toBe(false);
  });
});

describe("TEST 2 — a deleted page produces zero questions", () => {
  it("asks nothing about a page that is not in the corpus", async () => {
    if (!has(ACTIVE)) return;
    const pages = scopedPagesOf(ACTIVE);
    const built = await buildQuestionSet(pages, { entityOf: entityOfFor(pages) });
    expect(built.questions.filter((q) => q.page.includes("South-Station-Terminal(test)"))).toHaveLength(0);
    const names = new Set(pages.map((p) => p.name));
    for (const q of built.questions) expect(names.has(q.page)).toBe(true);
  }, 900000);

  it("does not carry the deleted page on the exclusion list", () => {
    expect(EXCLUDED_PAGES.join(" ")).not.toContain("South-Station");
  });

  it("reports an exclusion that no longer exists in the corpus", () => {
    expect(missingExclusions(["Home.aspx"])).toEqual(EXCLUDED_PAGES);
    expect(missingExclusions(EXCLUDED_PAGES)).toEqual([]);
  });
});

describe("TEST 3 — the historical V1 question set stays available", () => {
  it("keeps its own count and checksum on the registry", () => {
    const v1 = SNAPSHOTS.find((s) => s.name === "SEPTEMBER-2026-CORPUS");
    expect(v1.questions).toBe(641);
    expect(v1.questionSetSha256).toBe("40befe1d18c3c75bbe6d8e1f502e6dee2437e53ac40cb4871f17920015465d33");
  });

  it("regenerates from its archived corpus to its own recorded checksum", async () => {
    if (!has(V1)) return;
    const v1 = SNAPSHOTS.find((s) => s.name === "SEPTEMBER-2026-CORPUS");
    const pages = scopedPagesOf(V1);
    const built = await buildQuestionSet(pages, { entityOf: entityOfFor(pages) });
    expect(built.questions).toHaveLength(v1.questions);
    expect(built.sha256).toBe(v1.questionSetSha256);
  }, 900000);

  it("generating V2 cannot overwrite V1's identity", async () => {
    if (!has(V1) || !has(V2)) return;
    const a = await buildQuestionSet(scopedPagesOf(V1));
    const b = await buildQuestionSet(scopedPagesOf(V2));
    expect(a.sha256).not.toBe(b.sha256);
    expect(a.questions.length).not.toBe(b.questions.length);
  }, 900000);
});

describe("TEST 4 — the V2 set has its own SHA", () => {
  it("differs from V1's, and matches the registry", async () => {
    if (!has(V2)) return;
    const built = await buildQuestionSet(scopedPagesOf(V2));
    expect(built.sha256).toBe(ACTIVE_SNAPSHOT.questionSetSha256);
    expect(built.sha256).not.toBe("40befe1d18c3c75bbe6d8e1f502e6dee2437e53ac40cb4871f17920015465d33");
  }, 900000);
});

describe("TEST 5 — changing one question changes the set's SHA", () => {
  const qs = [
    { id: "q0001", page: "a.aspx", kind: "amenity", question: "Does A have a Pool?", answer: "Yes — Pool." },
    { id: "q0002", page: "a.aspx", kind: "amenity", question: "Does A have a Gym?", answer: "Yes — Gym." },
  ];

  it("moves when the question text changes", async () => {
    const before = await questionSetSha(qs);
    const after = await questionSetSha([{ ...qs[0], question: "Does A have a Lap Pool?" }, qs[1]]);
    expect(after).not.toBe(before);
  });

  it("moves when the expected answer changes", async () => {
    const before = await questionSetSha(qs);
    expect(await questionSetSha([{ ...qs[0], answer: "No." }, qs[1]])).not.toBe(before);
  });

  it("moves when the canonical order changes", async () => {
    const before = await questionSetSha(qs);
    expect(await questionSetSha([qs[1], qs[0]])).not.toBe(before);
  });

  it("does NOT move when only descriptive metadata is added", async () => {
    // Category, entity, difficulty and warnings are derived. Enriching a
    // record must never look like changing the benchmark.
    const before = await questionSetSha(qs);
    const after = await questionSetSha(enrich(qs, { entityOf: () => "A" }));
    expect(after).toBe(before);
    expect(enrich(qs)[0].category).toBe(CATEGORY_OF_KIND.amenity);
  });
});

describe("TEST 6 — an identical rebuild keeps the same SHA", () => {
  it("is stable across repeated generation from the same pages", async () => {
    if (!has(V2)) return;
    const one = await buildQuestionSet(scopedPagesOf(V2));
    const two = await buildQuestionSet(scopedPagesOf(V2));
    expect(two.sha256).toBe(one.sha256);
    expect(coreText(two.questions)).toBe(coreText(one.questions));
  }, 900000);

  it("carries no timestamp inside the canonical content", async () => {
    if (!has(V2)) return;
    const built = await buildQuestionSet(scopedPagesOf(V2));
    expect(coreText(built.questions)).not.toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:/);
  }, 900000);
});

describe("TEST 7 — duplicate questions are detected", () => {
  it("drops a question that has two different answers on one page", () => {
    const dupes = [
      { id: "q1", page: "p.aspx", kind: "labelled-fact", question: "For P, what is the class?", answer: "One" },
      { id: "q2", page: "p.aspx", kind: "labelled-fact", question: "For P, what is the class?", answer: "Two" },
    ];
    const { kept, removed } = dropAmbiguous(dupes);
    expect(kept).toHaveLength(0);
    expect(removed.ambiguous).toBe(2);
  });

  it("keeps one copy when the answer agrees", () => {
    const same = [
      { id: "q1", page: "p.aspx", kind: "amenity", question: "Does P have a Gym?", answer: "Yes — Gym." },
      { id: "q2", page: "p.aspx", kind: "amenity", question: "Does P have a Gym?", answer: "Yes — Gym." },
    ];
    const { kept, removed } = dropAmbiguous(same);
    expect(kept).toHaveLength(1);
    expect(removed.dropped).toBe(1);
  });

  it("flags a duplicate id as blocking", () => {
    const r = checkQuestionSet([
      { id: "q1", page: "p.aspx", kind: "amenity", question: "a?", answer: "Yes", evidence: "x" },
      { id: "q1", page: "p.aspx", kind: "amenity", question: "b?", answer: "Yes", evidence: "y" },
    ]);
    expect(r.severity).toBe("high");
    expect(r.findings.some((f) => f.rule === "duplicate-question-id")).toBe(true);
  });
});

describe("TEST 8 — a missing source page blocks questions", () => {
  it("is a high-severity finding", () => {
    const r = checkQuestionSet(
      [{ id: "q1", page: "Gone.aspx", kind: "amenity", question: "Does X have a Y?", answer: "Yes", evidence: "Y" }],
      { corpusPages: ["Here.aspx"] }
    );
    expect(r.severity).toBe("high");
  });

  it("every generated question names a page that exists", async () => {
    if (!has(ACTIVE)) return;
    const pages = scopedPagesOf(ACTIVE);
    const built = await buildQuestionSet(pages, { entityOf: entityOfFor(pages) });
    const r = checkQuestionSet(built.questions, { corpusPages: pages.map((p) => p.name) });
    expect(r.counts.high).toBe(0);
  }, 900000);
});

describe("TEST 9 — high source-integrity blocks question generation", () => {
  it("the generator runs only on pages that cleared the check", () => {
    const pages = [
      { name: "Good.aspx", page: parsePage(page("GOOD PAGE", "<p>Units: 4</p>"), { name: "Good.aspx", path: "Good.aspx" }) },
      { name: "Bad(test).aspx", page: parsePage(page("BAD PAGE", "<p>Units: 9</p>"), { name: "Bad(test).aspx", path: "Bad(test).aspx" }) },
    ];
    const blocked = checkCorpus(pages).filter(blocksBenchmark);
    expect(blocked.map((b) => b.page)).toEqual(["Bad(test).aspx"]);

    // The caller withholds blocked pages; questions then exist only for
    // the clean one.
    const clean = pages.filter((p) => !blocked.some((b) => b.page === p.name));
    const qs = generateQuestions(clean);
    expect(qs.every((q) => q.page === "Good.aspx")).toBe(true);
  });

  it("the real defective page would have been blocked before generating anything", () => {
    if (!has(V1)) return;
    const blocked = checkCorpus(scopedPagesOf(V1)).filter(blocksBenchmark);
    expect(blocked.map((b) => b.page)).toEqual(["South-Station-Terminal(test).aspx"]);
  }, 900000);
});

describe("TEST 10 — medium source-integrity produces warnings, not a block", () => {
  it("ARBORAGE warns and still generates", () => {
    if (!has(V2)) return;
    const pages = scopedPagesOf(V2);
    const reports = checkCorpus(pages);
    const arborage = reports.find((r) => r.page === "ARBORAGE.aspx");
    expect(arborage?.severity).toBe("medium");
    expect(blocksBenchmark(arborage)).toBe(false);
    expect(reports.filter(blocksBenchmark)).toHaveLength(0);
  }, 900000);
});

describe("TEST 11 — question-quality warnings survive into the set", () => {
  it("finds the spec-row and non-numeric cases in the live set", async () => {
    if (!has(ACTIVE)) return;
    const pages = scopedPagesOf(ACTIVE);
    const built = await buildQuestionSet(pages, { entityOf: entityOfFor(pages) });
    const r = checkQuestionSet(built.questions, { corpusPages: pages.map((p) => p.name) });
    expect(r.counts.high).toBe(0);
    expect(r.counts.medium + r.counts.low).toBeGreaterThan(0);
    expect(r.findings.some((f) => f.rule === "spec-row-as-amenity")).toBe(true);
  }, 900000);
});

describe("TEST 12/13 — the exporter follows the canonical set", () => {
  const exporter = fs.readFileSync(path.join(root, "scripts/export-question-csv.mjs"), "utf8");

  it("reads the pinned checksum from the registry", () => {
    expect(exporter).toContain("ACTIVE_SNAPSHOT.questionSetSha256");
    expect(exporter).not.toMatch(/const CORE_SHA = "[0-9a-f]{64}"/);
  });

  it("derives its batch sizes rather than assuming a final batch", () => {
    // 607 questions is 6 x 100 + 7; 641 was 6 x 100 + 41. Neither may be
    // written down anywhere.
    expect(exporter).not.toMatch(/\b41\b/);
    expect(exporter).toContain("Math.ceil(questions.length / CHUNK)");
  });
});

describe("TEST 14 — no hard-coded population sizes remain", () => {
  const files = [
    "src/lib/questionSet.js",
    "src/lib/snapshots.js",
    "src/components/TestQuestionGenerator.jsx",
    "src/components/BenchmarkExport.jsx",
    "scripts/export-question-csv.mjs",
    "scripts/build-question-set.mjs",
  ];

  it("does not bake 641, 607 or 41 into application logic", () => {
    for (const f of files) {
      const src = fs.readFileSync(path.join(root, f), "utf8");
      // The registry legitimately RECORDS each snapshot's counts and its
      // historical results; that is data, not logic. Strip those numeric
      // fields before checking that no COUNT is baked into behaviour.
      const logic = f.endsWith("snapshots.js")
        ? src.replace(
            /\b(questions|sourceFiles|benchmarkPages|sourceUnits|evaluations|pass|fail|error|other)\s*:\s*\d+/g,
            "$1: N"
          )
        : src;
      for (const n of ["641", "607", " 41 "]) {
        expect(logic.includes(n), `${f} contains ${n.trim()}`).toBe(false);
      }
    }
  });
});

describe("configurable targets, never a fixed number", () => {
  const q = (id, page) => ({ id, page, kind: "amenity", question: `${id}?`, answer: "Yes" });
  const many = [q("q1", "a"), q("q2", "a"), q("q3", "a"), q("q4", "b"), q("q5", "b"), q("q6", "c")];

  it("caps per page while keeping canonical order", () => {
    const out = applyTargets(many, { perPage: 2 });
    expect(out.map((x) => x.id)).toEqual(["q1", "q2", "q4", "q5", "q6"]);
  });

  it("hits a total target round-robin, so no page loses all coverage", () => {
    const out = applyTargets(many, { targetQuestions: 3 });
    expect(out).toHaveLength(3);
    expect(new Set(out.map((x) => x.page)).size).toBe(3);
    // canonical order preserved
    expect(out.map((x) => x.id)).toEqual([...out].sort((a, b) => many.indexOf(a) - many.indexOf(b)).map((x) => x.id));
  });

  it("is a no-op when no target is given — the corpus decides the size", () => {
    expect(applyTargets(many, {})).toEqual(many);
  });
});

describe("negative / entity-grounding questions are opt-in", () => {
  const pages = () => [
    { name: "Res.aspx", page: parsePage(page("RES TOWER", "<p>1-BR Unit</p><p>45 sqm</p><p>₱5.0M</p>"), { name: "Res.aspx", path: "Res.aspx" }) },
    { name: "Hub.aspx", page: parsePage(page("TRANSIT HUB", "<p>Total Number of units: 0</p>"), { name: "Hub.aspx", path: "Hub.aspx" }) },
  ];

  it("is off by default, so the canonical set is unchanged", async () => {
    const p = pages();
    const off = await buildQuestionSet(p);
    expect(off.questions.some((q) => q.kind === "absence")).toBe(false);
  });

  it("asks about absence only where the page yielded facts but no pricing", async () => {
    const p = pages();
    const on = await buildQuestionSet(p, { includeNegative: true });
    const neg = on.questions.filter((q) => q.kind === "absence");
    expect(neg.length).toBeGreaterThan(0);
    expect(neg.every((q) => /^No — /.test(q.answer))).toBe(true);
    expect(neg.every((q) => q.category === "NEGATIVE / NOT-AVAILABLE")).toBe(true);
  });

  it("changes the checksum when enabled, so it cannot be turned on silently", async () => {
    const p = pages();
    const off = await buildQuestionSet(p);
    const on = await buildQuestionSet(pages(), { includeNegative: true });
    expect(on.sha256).not.toBe(off.sha256);
  });

  it("never invents a fact — every answer states an absence", () => {
    const p = pages();
    const generated = generateQuestions(p);
    for (const q of negativeQuestions(p, generated)) {
      expect(q.answer).toMatch(/lists no residential unit pricing/);
      expect(q.evidence).toContain("no unit-price");
    }
  });
});

describe("every question is traceable to its source", () => {
  it("carries page, evidence and a locator", async () => {
    if (!has(ACTIVE)) return;
    const pages = scopedPagesOf(ACTIVE);
    const built = await buildQuestionSet(pages, { entityOf: entityOfFor(pages) });
    for (const q of built.questions) {
      expect(q.page, q.id).toBeTruthy();
      expect(q.evidence, q.id).toBeTruthy();
      expect(q.locator, q.id).toBeTruthy();
      expect(q.answer.trim(), q.id).not.toBe("");
    }
  }, 900000);

  it("enriches without losing the canonical fields", async () => {
    if (!has(ACTIVE)) return;
    const pages = scopedPagesOf(ACTIVE);
    const built = await buildQuestionSet(pages, { entityOf: entityOfFor(pages) });
    const q = built.questions[0];
    expect(q).toHaveProperty("category");
    expect(q).toHaveProperty("answerType");
    expect(q).toHaveProperty("difficulty");
    expect(q).toHaveProperty("entity");
    expect(q).toHaveProperty("sourceSection");
    expect(q.entity).toBeTruthy();
  }, 900000);
});

describe("scope lives in one place", () => {
  it("is applied by the shared helper, not by each caller", () => {
    expect(inScope("Page.aspx")).toBe(false);
    expect(inScope("Internal-Audit.aspx")).toBe(false);
    expect(inScope("1001-Parkway.aspx")).toBe(true);
    expect(scopeOf(["b.aspx", "a.aspx", "Page.aspx"])).toEqual(["a.aspx", "b.aspx"]);
  });
});
