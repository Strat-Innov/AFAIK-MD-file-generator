import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildMaster } from "../src/lib/masterMd.js";
import { EXCLUDED_PAGES, normalizeName, scopeOf } from "../src/lib/questionSet.js";
import { corpusIdentity, ACTIVE_SNAPSHOT } from "../src/lib/snapshots.js";
import { makeAspx, textControl } from "./helpers.js";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const V2 = "benchmark/corpora/september-2026-v2";
const has = (rel) =>
  fs.existsSync(path.join(root, rel)) &&
  fs.readdirSync(path.join(root, rel)).some((f) => f.endsWith(".aspx"));
const load = (rel) => {
  const d = path.join(root, rel);
  return fs.readdirSync(d).filter((f) => f.endsWith(".aspx")).sort()
    .map((name) => ({ name, path: name, raw: fs.readFileSync(path.join(d, name), "utf8") }));
};

const EXCLUDED = new Set(EXCLUDED_PAGES.map(normalizeName));
const isExcludedByPolicy = (f) => EXCLUDED.has(normalizeName(f.name));
const EVIDENCE_CLOCK = new Date(0);

/**
 * Recover the raw .aspx bytes a Master file carries.
 *
 * This is the reader for the transport, and it is the thing actually
 * under test: the export is only useful if what comes out equals what
 * went in, byte for byte, for every page.
 */
export function rawPagesFrom(master) {
  const out = new Map();
  for (const block of master.split(/\n## /).slice(1)) {
    const name = block.slice(0, block.indexOf("\n")).trim();
    const open = block.indexOf("```aspx\n");
    if (open < 0) continue;                         // the Table of Contents block
    const start = open + "```aspx\n".length;
    const end = block.indexOf("\n```", start);
    out.set(name, block.slice(start, end));
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * The six policy exclusions are part of the source corpus and therefore
 * part of its identity, but no view in the app could download them. The
 * 127 in-scope pages were recoverable from the bucket Master files and
 * these six were not, so the app could not emit the whole corpus at all.
 * This export closes that gap; these tests hold it to being lossless.
 * ------------------------------------------------------------------ */

describe("the excluded-pages Master export is lossless", () => {
  it("round-trips all six policy exclusions byte-for-byte", () => {
    if (!has(V2)) return;
    const corpus = load(V2);
    const excluded = corpus.filter(isExcludedByPolicy);
    expect(excluded).toHaveLength(6);

    const md = buildMaster("EXCLUDED PAGES", excluded, EVIDENCE_CLOCK);
    const recovered = rawPagesFrom(md);

    expect(recovered.size).toBe(6);
    for (const f of excluded) {
      expect(recovered.has(f.name), `${f.name} missing from the export`).toBe(true);
      expect(recovered.get(f.name), `${f.name} did not round-trip`).toBe(f.raw);
    }
  }, 300000);

  it("contains the six source filenames and nothing else", () => {
    if (!has(V2)) return;
    const corpus = load(V2);
    const excluded = corpus.filter(isExcludedByPolicy);
    const md = buildMaster("EXCLUDED PAGES", excluded, EVIDENCE_CLOCK);
    const recovered = [...rawPagesFrom(md).keys()].sort();

    expect(recovered).toEqual([...EXCLUDED_PAGES].sort());
    // no in-scope page leaked in
    for (const name of scopeOf(corpus.map((f) => f.name))) {
      expect(recovered).not.toContain(name);
    }
  }, 300000);

  it("is deterministic — same corpus, same bytes", () => {
    if (!has(V2)) return;
    const excluded = load(V2).filter(isExcludedByPolicy);
    const a = buildMaster("EXCLUDED PAGES", excluded, EVIDENCE_CLOCK);
    const b = buildMaster("EXCLUDED PAGES", [...excluded].reverse(), EVIDENCE_CLOCK);
    expect(b).toBe(a);                              // buildMaster sorts by name
    expect(a).not.toMatch(/Generated on: \d\d\/\d\d\/20(2[6-9]|[3-9])/); // fixed clock, not wall time
  }, 300000);

  it("names every excluded page in its table of contents", () => {
    if (!has(V2)) return;
    const excluded = load(V2).filter(isExcludedByPolicy);
    const md = buildMaster("EXCLUDED PAGES", excluded, EVIDENCE_CLOCK);
    const toc = md.slice(md.indexOf("## Table of Contents"), md.indexOf("\n## ", md.indexOf("## Table of Contents") + 5));
    for (const name of EXCLUDED_PAGES) expect(toc).toContain(name);
    expect(md).toContain("Total Files: 6");
  }, 300000);
});

describe("the whole corpus is now recoverable from app exports", () => {
  it("bucket Master files plus the excluded export reconstruct all 133 pages exactly", async () => {
    if (!has(V2)) return;
    const corpus = load(V2);
    const inScopeNames = new Set(scopeOf(corpus.map((f) => f.name)));
    const inScope = corpus.filter((f) => inScopeNames.has(f.name));
    const excluded = corpus.filter(isExcludedByPolicy);
    expect(inScope.length + excluded.length).toBe(corpus.length);

    // what the app hands over: the in-scope pages via bucket Masters
    // (one stand-in here — the serialization is identical per bucket),
    // and the six via the new export.
    const recovered = new Map([
      ...rawPagesFrom(buildMaster("IN SCOPE", inScope, EVIDENCE_CLOCK)),
      ...rawPagesFrom(buildMaster("EXCLUDED PAGES", excluded, EVIDENCE_CLOCK)),
    ]);

    expect(recovered.size).toBe(133);
    for (const f of corpus) expect(recovered.get(f.name), f.name).toBe(f.raw);

    // ...and the reconstruction carries the corpus's identity
    const rebuilt = [...recovered.entries()].map(([name, raw]) => ({ name, path: name, raw }));
    const id = await corpusIdentity(rebuilt);
    expect(id.sourceFiles).toBe(ACTIVE_SNAPSHOT.sourceFiles);
    expect(id.fileSetSha256).toBe(ACTIVE_SNAPSHOT.fileSetSha256);
    expect(id.contentSha256).toBe(ACTIVE_SNAPSHOT.contentSha256);
  }, 900000);

  it("survives a page whose content would otherwise break the fence", () => {
    // No corpus page contains a ``` line today, but the transport should
    // fail loudly rather than silently truncate if one ever did.
    const tricky = { name: "t.aspx", path: "t.aspx", raw: makeAspx(textControl("<p>plain</p>")) };
    const md = buildMaster("X", [tricky], EVIDENCE_CLOCK);
    expect(rawPagesFrom(md).get("t.aspx")).toBe(tricky.raw);
    expect(tricky.raw).not.toMatch(/^```/m);
  });
});

describe("the export changes nothing else", () => {
  it("leaves the in-scope bucket exports untouched", () => {
    if (!has(V2)) return;
    const corpus = load(V2);
    const inScopeNames = new Set(scopeOf(corpus.map((f) => f.name)));
    const inScope = corpus.filter((f) => inScopeNames.has(f.name));
    const before = buildMaster("PROJECT PLAYBOOK", inScope.slice(0, 10), EVIDENCE_CLOCK);
    const after = buildMaster("PROJECT PLAYBOOK", inScope.slice(0, 10), EVIDENCE_CLOCK);
    expect(after).toBe(before);
    expect(before).not.toContain("EXCLUDED PAGES");
  }, 300000);

  it("does not register anything or move the frozen identity", () => {
    expect(ACTIVE_SNAPSHOT.name).toBe("SEPTEMBER-2026-V2-CORPUS");
    expect(ACTIVE_SNAPSHOT.contentSha256).toBe("212e998c36baa92d4413d626403eb16cefc0a045352dbcd7f176ca6065b46e2f");
    expect(ACTIVE_SNAPSHOT.questionSetSha256).toBe("1f93c4a5d9d927c1044498df09fec5d7fa141a613da3993c8fd27fb5200f2990");
    expect(ACTIVE_SNAPSHOT.questions).toBe(607);
    expect(ACTIVE_SNAPSHOT.evaluation.status).toBe("not-run");
    const src = fs.readFileSync(path.join(root, "src/lib/snapshots.js"), "utf8");
    for (const seen of ["fd2b26", "17ac2b", "15b06ec"]) expect(src).not.toContain(seen);
  });
});
