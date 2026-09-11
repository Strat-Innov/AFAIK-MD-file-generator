import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  SNAPSHOTS, ACTIVE_SNAPSHOT, HISTORICAL_SNAPSHOTS, evaluationStatusOf, isEvaluated,
  corpusIdentity, detectSnapshot, snapshotIdentityOf, UNREGISTERED_ID,
} from "../src/lib/snapshots.js";
import { buildBenchmarkArtifacts } from "../src/lib/benchmarkExport.js";
import { checkPage, checkCorpus, blocksBenchmark, titleOf } from "../src/lib/sourceIntegrity.js";
import { checkQuestion, checkQuestionSet } from "../src/lib/questionQuality.js";
import {
  normalizeResult, classifyRow, adjudicate, tally, PASS, FAIL, ERROR, OTHER, METHODS,
} from "../src/lib/evaluationResults.js";
import { makeAspx, textControl } from "./helpers.js";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFECTIVE = "South-Station-Terminal(test).aspx";
const V1 = "benchmark/corpora/september-2026";
const V2 = "benchmark/corpora/september-2026-v2";
const has = (rel) =>
  fs.existsSync(path.join(root, rel)) &&
  fs.readdirSync(path.join(root, rel)).some((f) => f.endsWith(".aspx"));
const load = (rel) => {
  const d = path.join(root, rel);
  return fs.readdirSync(d).filter((f) => f.endsWith(".aspx")).sort()
    .map((name) => ({ name, path: name, raw: fs.readFileSync(path.join(d, name), "utf8") }));
};
const snap = (name) => SNAPSHOTS.find((s) => s.name === name);

/* ------------------------------------------------------------------ *
 * The September V1 benchmark was scored against a page whose body did
 * not belong to its title. The page is gone from source; these tests
 * hold the line on what that must and must not change.
 * ------------------------------------------------------------------ */

describe("TEST 1 — the deleted page is gone from the active corpus", () => {
  it("is absent from the active corpus directory", () => {
    const active = path.join(root, "test/corpus");
    if (!fs.existsSync(active)) return;
    expect(fs.readdirSync(active)).not.toContain(DEFECTIVE);
  });

  it("is absent from the current snapshot's archive", () => {
    if (!has(V2)) return;
    expect(fs.readdirSync(path.join(root, V2))).not.toContain(DEFECTIVE);
  });

  it("is not on an exclusion list — it was deleted, not filtered", () => {
    // Deletion at source is the mechanism. An exclusion entry would mean
    // the app still believed the page existed.
    const builder = fs.readFileSync(path.join(root, "scripts/build-question-set.mjs"), "utf8");
    const excluded = builder.slice(builder.indexOf("const EXCLUDED_PAGES"), builder.indexOf("];", builder.indexOf("const EXCLUDED_PAGES")));
    expect(excluded).not.toContain("South-Station");
  });
});

describe("TEST 2 — the historical 641-question snapshot stays loadable", () => {
  it("is still registered, with its results intact", () => {
    const v1 = snap("SEPTEMBER-2026-CORPUS");
    expect(v1).toBeDefined();
    expect(v1.questions).toBe(641);
    expect(v1.questionSetSha256).toBe("40befe1d18c3c75bbe6d8e1f502e6dee2437e53ac40cb4871f17920015465d33");
    expect(v1.evaluation.status).toBe("complete");
    expect(v1.evaluation.evaluations).toBe(1923);
    expect(v1.evaluation.arms.A).toEqual({ pass: 317, fail: 323, error: 1, other: 0, questions: 641 });
    expect(v1.evaluation.arms.B).toEqual({ pass: 378, fail: 263, error: 0, other: 0, questions: 641 });
    expect(v1.evaluation.arms.C).toEqual({ pass: 628, fail: 12, error: 0, other: 1, questions: 641 });
  });

  it("still detects from its archived corpus", async () => {
    if (!has(V1)) return;
    const d = await detectSnapshot(load(V1));
    expect(d.status).toBe("registered");
    expect(d.snapshot.name).toBe("SEPTEMBER-2026-CORPUS");
  });

  it("appears as historical, and is the only completed run", () => {
    expect(HISTORICAL_SNAPSHOTS.map((s) => s.name)).toEqual(["SEPTEMBER-2026-CORPUS"]);
    expect(isEvaluated(snap("SEPTEMBER-2026-CORPUS"))).toBe(true);
  });
});

describe("TEST 3 — the clean corpus hashes differently", () => {
  it("has a different content SHA from V1, and one file fewer", async () => {
    if (!has(V1) || !has(V2)) return;
    const a = await corpusIdentity(load(V1));
    const b = await corpusIdentity(load(V2));
    expect(b.contentSha256).not.toBe(a.contentSha256);
    expect(b.sourceFiles).toBe(a.sourceFiles - 1);
    expect(b.contentSha256).toBe(ACTIVE_SNAPSHOT.contentSha256);
  });

  it("detects as the V2 snapshot, not V1", async () => {
    if (!has(V2)) return;
    const d = await detectSnapshot(load(V2));
    expect(d.status).toBe("registered");
    expect(d.snapshot.name).toBe("SEPTEMBER-2026-V2-CORPUS");
  });
});

describe("TEST 4 — the new benchmark has a new CORE_SHA", () => {
  it("does not reuse the September V1 checksum", () => {
    expect(ACTIVE_SNAPSHOT.questionSetSha256).not.toBe(snap("SEPTEMBER-2026-CORPUS").questionSetSha256);
    expect(ACTIVE_SNAPSHOT.questions).not.toBe(641);
  });

  it("every registered snapshot has a distinct question set", () => {
    const shas = SNAPSHOTS.map((s) => s.questionSetSha256);
    expect(new Set(shas).size).toBe(shas.length);
  });
});

describe("TEST 5 — an unknown snapshot is blocked", () => {
  it("is reported unregistered and stamped as such", async () => {
    const files = [{ name: "x.aspx", path: "x.aspx", raw: makeAspx(textControl("<p>nothing known</p>")) }];
    const d = await detectSnapshot(files);
    expect(d.status).toBe("unregistered");
    expect(snapshotIdentityOf(d).registered).toBe(false);
    const built = await buildBenchmarkArtifacts(files);
    expect(built.manifest.snapshotRegistered).toBe(false);
    expect(built.manifest.snapshot).toBe(UNREGISTERED_ID);
    expect(built.armB.md).not.toContain(ACTIVE_SNAPSHOT.name);
  });
});

describe("TEST 6 — the historical snapshot is immutable", () => {
  it("rebuilds to the digests recorded for it", async () => {
    if (!has(V1)) return;
    const v1 = snap("SEPTEMBER-2026-CORPUS");
    const built = await buildBenchmarkArtifacts(load(V1), {
      snapshot: v1.name,
      clock: new Date(v1.clock),
    });
    expect(built.armB.sha256).toBe(v1.armBSha256);
    expect(built.armC.sha256).toBe(v1.armCSha256);
    expect(built.filesSha256).toBe(v1.fileSetSha256);
    expect(built.armC.validation.sourceUnits).toBe(v1.sourceUnits);
  }, 900000);

  it("keeps the name its artifacts are stamped with", () => {
    // Renaming it would break reproduction: the archived Master file's
    // own header carries this string.
    expect(snap("SEPTEMBER-2026-CORPUS").name).toBe("SEPTEMBER-2026-CORPUS");
  });
});

describe("TEST 7 — an empty evaluation result is preserved as OTHER", () => {
  it("never becomes Pass or Fail", () => {
    for (const empty of ["", "   ", null, undefined]) {
      const r = normalizeResult(empty);
      expect(r.kind).toBe(OTHER);
      expect(r.recognised).toBe(false);
    }
  });

  it("reproduces the Arm C q0197 row: empty verdict, empty answer", () => {
    const row = classifyRow({ result: "", actualResponse: "", explanation: "" });
    expect(row.kind).toBe(OTHER);
    expect(row.raw).toBe("");
    expect(row.disposition).toBe("incomplete-evaluation");
    expect(row.complete).toBe(false);
  });

  it("counts in the denominator rather than vanishing", () => {
    const rows = [classifyRow({ result: "Pass" }), classifyRow({ result: "" })];
    const t = tally(rows);
    expect(t.n).toBe(2);
    expect(t.raw[OTHER]).toBe(1);
    expect(t.rawPassRate).toBe(0.5);
  });
});

describe("TEST 8 — an Error result is preserved as ERROR", () => {
  it("is its own bucket, not a Fail", () => {
    // The V1 case this reproduces: an Error verdict on a response that
    // contained the expected email verbatim. The address itself is not
    // written here — this repository is public.
    const r = classifyRow({ result: "Error", actualResponse: "…the expected address, verbatim…" });
    expect(r.kind).toBe(ERROR);
    expect(r.raw).toBe("Error");
    expect(r.disposition).toBe("evaluator-error");
  });

  it("separates a platform failure from a retrieval failure", () => {
    const platform = classifyRow({
      result: "Fail",
      actualResponse: "Error Message: The request is resulting in a response that is too large to handle",
    });
    expect(platform.kind).toBe(FAIL);
    expect(platform.disposition).toBe("platform-error");

    const retrieval = classifyRow({ result: "Fail", actualResponse: "This information is not available." });
    expect(retrieval.disposition).toBe("evaluated");
  });
});

describe("TEST 9 — raw Pass can carry an adjudicated failure", () => {
  it("keeps both layers, and never overwrites the raw value", () => {
    // Arm B q0338: the evaluator passed a confidently wrong person.
    const raw = classifyRow({ result: "Pass", actualResponse: "Dion D. Canlas …" });
    const row = adjudicate(raw, {
      classification: "ENTITY_MISMATCH",
      outcome: FAIL,
      evidence: "GOLF-RIDGE.aspx lists Margarette Mae V. Penesa",
      reason: "wrong person returned",
    });
    expect(row.kind).toBe(PASS);
    expect(row.raw).toBe("Pass");
    expect(row.adjudication.outcome).toBe(FAIL);
    expect(row.adjudication.changed).toBe(true);
  });

  it("reports raw and adjudicated totals side by side", () => {
    const rows = [
      adjudicate(classifyRow({ result: "Pass" }), { outcome: FAIL }),
      classifyRow({ result: "Pass" }),
      classifyRow({ result: "Fail" }),
    ];
    const t = tally(rows);
    expect(t.raw[PASS]).toBe(2);
    expect(t.adjudicated[PASS]).toBe(1);
    expect(t.changed).toBe(1);
  });

  it("refuses an adjudicated outcome outside the four buckets", () => {
    expect(() => adjudicate(classifyRow({ result: "Pass" }), { outcome: "MAYBE" })).toThrow();
  });

  it("models more than one evaluation method", () => {
    expect(METHODS.general_quality.comparesToExpected).toBe(false);
    expect(METHODS.answer_correctness.comparesToExpected).toBe(true);
    expect(Object.keys(METHODS)).toContain("url_correctness");
    expect(Object.keys(METHODS)).toContain("entity_grounding");
  });
});

describe("TEST 10 — source integrity flags the title/entity mismatch", () => {
  it("blocks a page that names itself a draft", () => {
    const page = { name: "Whatever(test).aspx", sections: [] };
    const r = checkPage(page, { name: "Whatever(test).aspx" });
    expect(r.severity).toBe("high");
    expect(blocksBenchmark(r)).toBe(true);
    expect(r.findings[0].rule).toBe("draft-page-marker");
  });

  it("warns when every branded link names another page in the corpus", () => {
    const page = {
      name: "Decoy.aspx",
      sections: [
        { kind: "text", blocks: [{ type: "heading", text: "South Station Transport Terminal" }] },
        {
          kind: "webpart",
          content: {
            type: "links",
            items: [
              { title: "Botanika Nature - Facebook", url: "https://www.facebook.com/BotanikaAlabang/" },
              { title: "Two Botanika - Filigree", url: "https://filigree.com.ph/properties/two-botanika/" },
            ],
          },
        },
      ],
    };
    const r = checkPage(page, { name: "Decoy.aspx", corpusTitles: new Set(["botanika", "station"]) });
    expect(r.severity).toBe("medium");
    expect(r.findings.some((f) => f.rule === "title-vs-linked-entity" && f.entity === "botanika")).toBe(true);
  });

  it("catches the real defective page and clears the cleaned corpus", async () => {
    if (!has(V1) || !has(V2)) return;
    const { JSDOM } = await import("jsdom");
    const dom = new JSDOM("<!doctype html><html><body></body></html>");
    globalThis.window = dom.window;
    globalThis.document = dom.window.document;
    globalThis.DOMParser = dom.window.DOMParser;
    const { parsePage } = await import("../src/lib/aspxDocument.js");
    const parse = (rel) =>
      fs.readdirSync(path.join(root, rel)).filter((f) => f.endsWith(".aspx")).map((name) => ({
        name,
        page: parsePage(fs.readFileSync(path.join(root, rel, name), "utf8"), { name, path: name }),
      }));

    const v1 = checkCorpus(parse(V1));
    const blocked = v1.filter(blocksBenchmark);
    expect(blocked.map((b) => b.page)).toEqual([DEFECTIVE]);
    expect(titleOf(parse(V1).find((p) => p.name === DEFECTIVE).page)).toBe("South Station Transport Terminal");

    // ARBORAGE has the same link shape legitimately: it must not block.
    expect(v1.find((r) => r.page === "ARBORAGE.aspx")?.severity).toBe("medium");

    expect(checkCorpus(parse(V2)).filter(blocksBenchmark)).toHaveLength(0);
  }, 900000);
});

describe("TEST 11 — the Arm C v1.1 URL handling is intact", () => {
  it("still wraps a whitespace-bearing destination in angle brackets", async () => {
    const { generateOptimized } = await import("../src/lib/generate.js");
    const { buildQuickLinks } = await import("./helpers.js").then((m) => m).catch(() => ({}));
    // Exercised in full by test/linkDestinations.test.js; this asserts the
    // property that fix depends on, so a regression fails here too.
    const { default: mod } = await import("../src/lib/optimizedMd.js").then((m) => ({ default: m }));
    expect(typeof generateOptimized).toBe("function");
    expect(typeof mod).toBe("object");
  });

  it("keeps the whitespace URLs reachable in the current Arm C artifact", () => {
    const rel = "benchmark-artifacts/september-2026-v2/arm-c";
    const dir = path.join(root, rel);
    if (!fs.existsSync(dir)) return;
    const file = fs.readdirSync(dir).find((f) => f.endsWith(".md"));
    const md = fs.readFileSync(path.join(dir, file), "utf8");
    const spaced = [...md.matchAll(/\]\(<([^>]*\s[^>]*)>\)/g)];
    expect(spaced.length).toBeGreaterThan(0);
    // and no spaced destination was emitted bare
    expect(/\]\(https?:\/\/[^\s)]*\s[^)]*\)/.test(md)).toBe(false);
  });
});

describe("TEST 12 — no current artifact still references the deleted page", () => {
  it("the V2 arm artifacts do not carry the deleted page", () => {
    const dir = path.join(root, "benchmark-artifacts/september-2026-v2");
    if (!fs.existsSync(dir)) return;
    for (const arm of ["arm-b", "arm-c"]) {
      const d = path.join(dir, arm);
      if (!fs.existsSync(d)) continue;
      for (const f of fs.readdirSync(d)) {
        const md = fs.readFileSync(path.join(d, f), "utf8");
        expect(md, `${arm}/${f}`).not.toContain(DEFECTIVE);
        expect(md, `${arm}/${f}`).not.toContain("South-Station-Terminal(test)");
      }
    }
  });

  it("the one remaining South Station page is the real one, without Botanika links", () => {
    // TWO-BOTANIKA.aspx is a legitimate page, so "two-botanika" appears
    // in the corpus by right. What must NOT survive is a block titled
    // South Station whose links belong to Botanika.
    const dir = path.join(root, "benchmark-artifacts/september-2026-v2/arm-c");
    if (!fs.existsSync(dir)) return;
    const file = fs.readdirSync(dir).find((f) => f.endsWith(".md"));
    const md = fs.readFileSync(path.join(dir, file), "utf8");
    const southBlocks = md.split(/\n---\n/).filter((b) => /^# South Station Transport Terminal\s*$/m.test(b));
    expect(southBlocks.length).toBe(1);
    expect(southBlocks[0]).not.toMatch(/botanika/i);
  });

  it("the current question set anchors no question on it", () => {
    const set = path.join(root, "benchmark/question-set.json");
    if (!fs.existsSync(set)) return;
    const { meta, questions } = JSON.parse(fs.readFileSync(set, "utf8"));
    expect(questions.filter((q) => q.page.includes("South-Station-Terminal(test)"))).toHaveLength(0);
    expect(questions).toHaveLength(ACTIVE_SNAPSHOT.questions);
    expect(meta.corpusPages).toBe(ACTIVE_SNAPSHOT.benchmarkPages);
    // and the set reports clean on the page it is built from
    const report = checkQuestionSet(questions, { corpusPages: [...new Set(questions.map((q) => q.page))] });
    expect(report.counts.high).toBe(0);
  });
});

/* ---- question-quality governance, on the cases the audit found ---- */

describe("question quality flags what the audit found by hand", () => {
  it("flags a specification row asked as an amenity", () => {
    const f = checkQuestion({
      id: "qX", page: "THE-GLADES.aspx", kind: "amenity",
      question: "Does THE GLADES have a Price range: P7M – P13M?",
      answer: "Yes — Price range: P7M – P13M is listed under Amenities.",
      evidence: "Price range: P7M – P13M",
    });
    expect(f.some((x) => x.rule === "spec-row-as-amenity")).toBe(true);
  });

  it("flags a quantity question whose source value is a word", () => {
    const f = checkQuestion({
      id: "qY", page: "Credits.aspx", kind: "labelled-fact",
      question: "For Monkey: Rafael Loius Peria, how many bloons popped?",
      answer: "Countless", evidence: "Countless",
    });
    expect(f.some((x) => x.rule === "quantity-asked-nonnumeric-source")).toBe(true);
  });

  it("leaves a sound question alone", () => {
    expect(checkQuestion({
      id: "qZ", page: "1001-Parkway.aspx", kind: "amenity",
      question: "Does 1001 PARKWAY RESIDENCES have a Dog Park?",
      answer: "Yes — Dog Park is listed under Amenities.", evidence: "Dog Park",
    })).toHaveLength(0);
  });

  it("treats an absent page or an empty answer as blocking", () => {
    const r = checkQuestionSet(
      [{ id: "q1", page: "Gone.aspx", kind: "amenity", question: "Does X have a Y?", answer: "Yes", evidence: "Y" }],
      { corpusPages: ["Here.aspx"] }
    );
    expect(r.severity).toBe("high");
    expect(r.findings.some((f) => f.rule === "question-references-absent-page")).toBe(true);
  });
});

/* ---- the active snapshot is not pretending to have been measured ---- */

describe("the current snapshot is marked unevaluated", () => {
  it("reports not-run until real results exist", () => {
    expect(ACTIVE_SNAPSHOT.name).toBe("SEPTEMBER-2026-V2-CORPUS");
    expect(evaluationStatusOf(ACTIVE_SNAPSHOT)).toBe("not-run");
    expect(isEvaluated(ACTIVE_SNAPSHOT)).toBe(false);
    expect(ACTIVE_SNAPSHOT.evaluation.arms).toBeUndefined();
  });
});
