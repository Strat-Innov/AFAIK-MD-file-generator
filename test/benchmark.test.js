import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { normalizeAnswer, tokens, matchAnswer, hasCitation } from "../scripts/lib/equivalence.mjs";
import { HAS_CORPUS } from "./helpers.js";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const sha = (s) => crypto.createHash("sha256").update(s, "utf8").digest("hex");
const run = (script, outDir) => execFileSync("node", [path.join(root, script), outDir], { cwd: root, encoding: "utf8" });
const tmp = (label) => fs.mkdtempSync(path.join(os.tmpdir(), `bench-${label}-`));

/* ---- equivalence rules: permissive about format, strict about values ---- */

describe("answer equivalence", () => {
  const same = [
    ["₱25.5M – ₱27.3M", "P25.5M - P27.3M", "peso written as P, hyphen for en-dash"],
    ["₱25.5M – ₱27.3M", "PHP 25.5M - PHP 27.3M", "peso spelled out with a space"],
    ["Shared Documents/Memo", "Shared%20Documents/Memo", "URL encoding"],
    ["Starts at PHP 1,000 per SQM", "starts at ₱1000 per sqm", "thousands separator and case"],
    ["97–120 sqm", "The floor area is 97-120 sqm.", "answer embedded in prose"],
    ["₱28.8M", "**₱28.8M**", "Markdown decoration"],
  ];
  for (const [expected, actual, why] of same) {
    it(`same answer: ${why}`, () => {
      expect(matchAnswer(expected, actual)).toMatchObject({ correct: true, partial: false });
    });
  }

  const different = [
    ["₱28.8M", "₱28.9M", "a different digit"],
    ["94", "The project has 84 units", "a different number"],
    ["LEASING", "subleasing/assignment is strictly not allowed", "a substring inside a longer word"],
  ];
  for (const [expected, actual, why] of different) {
    it(`different answer: ${why}`, () => {
      expect(matchAnswer(expected, actual).correct).toBe(false);
    });
  }

  it("scores half of a range as partial, never correct", () => {
    const r = matchAnswer("₱25.5M – ₱27.3M", "It costs ₱25.5M.");
    expect(r).toMatchObject({ correct: false, partial: true });
    expect(r.coverage).toBeLessThan(1);
  });

  it("does not equate different units", () => {
    expect(matchAnswer("97–120 sqm", "97–120 sqft").correct).toBe(false);
  });

  it("does not strip trailing zeros", () => {
    expect(matchAnswer("25.5", "25.50").correct).toBe(false);
  });

  it("never reports correct and partial together", () => {
    for (const [e, a] of [...same, ...different]) {
      const r = matchAnswer(e, a);
      expect(r.correct && r.partial).toBe(false);
    }
  });

  it("survives a malformed percent escape without throwing", () => {
    expect(() => normalizeAnswer("100% sure")).not.toThrow();
    expect(tokens("100% sure")).toContain("sure");
  });

  it("detects a citation only when a source is named", () => {
    expect(hasCitation("See FORTUNE-HILL.aspx")).toBe(true);
    expect(hasCitation("https://example.com/x")).toBe(true);
    expect(hasCitation("The price is ₱28.8M.")).toBe(false);
  });
});

/* ---- the benchmark inputs, built from the corpus without a browser ---- */

describe.skipIf(!HAS_CORPUS)("benchmark artifacts", () => {
  it("builds both arms from the corpus with no browser", () => {
    const out = tmp("arms");
    const log = run("scripts/build-arms.mjs", out);
    expect(log).toMatch(/Arm B/);
    expect(log).toMatch(/Arm C validation PASS/);
    const m = JSON.parse(fs.readFileSync(path.join(out, "manifest.json"), "utf8"));
    expect(m.corpusPages).toBeGreaterThanOrEqual(133);
    expect(fs.existsSync(path.join(out, m.arms.B.file))).toBe(true);
    expect(fs.existsSync(path.join(out, m.arms.C.file))).toBe(true);
  }, 300000);

  it("produces byte-identical artifacts on a rebuild", () => {
    const a = tmp("det-a"), b = tmp("det-b");
    run("scripts/build-arms.mjs", a);
    run("scripts/build-arms.mjs", b);
    const ma = JSON.parse(fs.readFileSync(path.join(a, "manifest.json"), "utf8"));
    const mb = JSON.parse(fs.readFileSync(path.join(b, "manifest.json"), "utf8"));
    expect(ma.arms.B.sha256).toBe(mb.arms.B.sha256);
    expect(ma.arms.C.sha256).toBe(mb.arms.C.sha256);
    expect(ma.filesSha256).toBe(mb.filesSha256);
    // and the checksums describe the files actually written
    expect(sha(fs.readFileSync(path.join(a, ma.arms.B.file), "utf8"))).toBe(ma.arms.B.sha256);
    expect(sha(fs.readFileSync(path.join(a, ma.arms.C.file), "utf8"))).toBe(ma.arms.C.sha256);
  }, 600000);

  it("stamps the generator version and snapshot on the artifacts", () => {
    const out = tmp("stamp");
    run("scripts/build-arms.mjs", out);
    const m = JSON.parse(fs.readFileSync(path.join(out, "manifest.json"), "utf8"));
    expect(m.generatorVersion).toMatch(/^\d+\.\d+\.\d+$/);
    expect(m.snapshot).toBe("AUGUST-2026-CORPUS");
    expect(m.snapshotClock).toBe("2026-08-31T00:00:00.000Z");
    expect(fs.readFileSync(path.join(out, m.arms.C.file), "utf8")).toContain(`- Generator: ${m.generatorVersion}`);
  }, 300000);

  it("emits non-empty arms that differ in representation, not merely in size", () => {
    const out = tmp("shape");
    run("scripts/build-arms.mjs", out);
    const m = JSON.parse(fs.readFileSync(path.join(out, "manifest.json"), "utf8"));
    const B = fs.readFileSync(path.join(out, m.arms.B.file), "utf8");
    const C = fs.readFileSync(path.join(out, m.arms.C.file), "utf8");
    expect(B.length).toBeGreaterThan(1000);
    expect(C.length).toBeGreaterThan(1000);
    // Arm B carries the SharePoint serialization; Arm C must not.
    expect(B).toContain("```aspx");
    expect(C).not.toContain("```aspx");
    expect(C).not.toContain("data-sp-");
    expect(C.length).toBeLessThan(B.length * 0.1);
    // Both arms cover the same pages.
    expect(m.arms.B.pages).toBe(m.arms.C.pages);
  }, 300000);
});

/* ---- the question set is frozen until a curation decision is taken ---- */

describe.skipIf(!HAS_CORPUS)("question set", () => {
  const setPath = path.join(root, "benchmark/question-set.json");
  const load = () => JSON.parse(fs.readFileSync(setPath, "utf8"));

  // Pinned so a change to the builder cannot silently alter the benchmark.
  // See benchmark/CURATION.md — curation is proposed, not applied.
  const CORE_SHA = "e6e49d2fad996278a915f3d112be5c5cd5282d2cf3a32617c1deebee025a9be4";
  const core = (qs) => qs.map((q) => [q.id, q.page, q.kind, q.question, q.answer].join(" | ")).join("\n");

  it("still holds exactly the 742 verified questions", () => {
    const { questions } = load();
    expect(questions).toHaveLength(742);
    expect(sha(core(questions))).toBe(CORE_SHA);
  });

  it("rebuilds to the same 742 questions", () => {
    const out = tmp("qs");
    run("scripts/build-question-set.mjs", out);
    const rebuilt = JSON.parse(fs.readFileSync(path.join(out, "question-set.json"), "utf8")).questions;
    expect(sha(core(rebuilt))).toBe(CORE_SHA);
  }, 300000);

  it("carries full provenance on every record", () => {
    const { questions } = load();
    for (const q of questions) {
      for (const f of ["id", "page", "kind", "question", "answer", "evidence", "locator"]) {
        expect(q[f], `${q.id} missing ${f}`).toBeTruthy();
      }
    }
    expect(new Set(questions.map((q) => q.id)).size).toBe(questions.length);
    expect(new Set(questions.map((q) => q.question)).size).toBe(questions.length);
  });

  it("locates every question in real page structure", () => {
    const { questions } = load();
    for (const q of questions) {
      const l = q.locator;
      const ok = typeof l.section === "number" || Array.isArray(l.people);
      expect(ok, `${q.id} locator=${JSON.stringify(l)}`).toBe(true);
    }
  });
});

/* ---- nothing sensitive may reach a tracked file ---- */

describe("security", () => {
  it("keeps corpus, question set and arm artifacts out of git", () => {
    const tracked = execFileSync("git", ["ls-files"], { cwd: root, encoding: "utf8" }).split("\n");
    expect(tracked.filter((f) => f.endsWith(".aspx"))).toEqual([]);
    expect(tracked.filter((f) => /^benchmark\/question-set\.(json|md)$/.test(f))).toEqual([]);
    expect(tracked.filter((f) => f.startsWith("benchmark-artifacts/"))).toEqual([]);
  });

  it("has never committed any of them, in any commit", () => {
    const added = execFileSync("git", ["log", "--all", "--diff-filter=A", "--name-only", "--pretty=format:"], { cwd: root, encoding: "utf8" }).split("\n");
    expect(added.filter((f) => f.endsWith(".aspx"))).toEqual([]);
    expect(added.filter((f) => f.startsWith("benchmark-artifacts/"))).toEqual([]);
  });

  it("hard-codes no employee address in any tracked file", () => {
    const files = execFileSync("git", ["ls-files"], { cwd: root, encoding: "utf8" }).split("\n").filter(Boolean);
    const offenders = [];
    for (const f of files) {
      const full = path.join(root, f);
      if (!fs.existsSync(full) || fs.statSync(full).size > 2_000_000) continue;
      const text = fs.readFileSync(full, "utf8");
      if (/@filinvestcity\.com/i.test(text)) offenders.push(f);
    }
    expect(offenders).toEqual([]);
  });
});
