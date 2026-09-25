import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createZip } from "../src/lib/zip.js";
import { buildBenchmarkArtifacts, packageEntries, buildBucketPackage, compareToCanonical } from "../src/lib/benchmarkExport.js";
import { snapshotIdentityOf, detectSnapshot, ACTIVE_SNAPSHOT, newSourceName } from "../src/lib/snapshots.js";
import { sha256 } from "../src/lib/digest.js";
import { BANDED_COLUMN_BY_TOP, DOM } from "../src/lib/canvasOrder.js";
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

const page = (h, b) => textControl(`<h2>${h}</h2><p>${b}</p>`);
const corpus = () => [
  { name: "a.aspx", path: "a.aspx", raw: makeAspx(page("Alpha", "Alpha is a development.")) },
  { name: "b.aspx", path: "b.aspx", raw: makeAspx(page("Beta", "Beta is a development.")) },
];

/* Minimal central-directory reader, so the assertions are made against
 * the archive as a browser would see it rather than against the inputs. */
function entriesOf(zipBytes) {
  const u8 = new Uint8Array(zipBytes);
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  let eocd = -1;
  for (let i = u8.length - 22; i >= 0; i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error("not a zip: no end-of-central-directory record");
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const out = [];
  const dec = new TextDecoder();
  for (let n = 0; n < count; n++) {
    const nameLen = dv.getUint16(p + 28, true);
    const extraLen = dv.getUint16(p + 30, true);
    const commentLen = dv.getUint16(p + 32, true);
    const method = dv.getUint16(p + 10, true);
    const compSize = dv.getUint32(p + 20, true);
    const lho = dv.getUint32(p + 42, true);
    const name = dec.decode(u8.subarray(p + 46, p + 46 + nameLen));
    const nLen = dv.getUint16(lho + 26, true);
    const xLen = dv.getUint16(lho + 28, true);
    const start = lho + 30 + nLen + xLen;
    out.push({ name, method, bytes: u8.subarray(start, start + compSize) });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

/* node:zlib rather than DecompressionStream: the suite runs under jsdom,
 * whose Blob does not expose a usable stream, and inflating is incidental
 * to what is being asserted. */
const textOf = async (entry) => {
  if (entry.method === 0) return new TextDecoder().decode(entry.bytes);
  const { inflateRawSync } = await import("node:zlib");
  return new TextDecoder().decode(inflateRawSync(Buffer.from(entry.bytes)));
};

/* ------------------------------------------------------------------ *
 * Download Both produced no file at all. The handler asked for
 * `detection.snapshot.clock` to timestamp the archive, and
 * detection.snapshot is null for every corpus the registry has not seen
 * — which, since the source-corpus gate was removed, is the ordinary
 * case. The throw landed in a catch that set an error string, so the
 * click looked like it did nothing. Verification kept passing because it
 * never touched that field.
 *
 * These tests build the archive the way the handler does and assert
 * against the bytes a browser would receive.
 * ------------------------------------------------------------------ */

describe("PART A — the artifact archive", () => {
  const zipFor = async (built) =>
    createZip(
      [
        { name: built.armB.filename, text: built.armB.md },
        { name: built.armC.filename, text: built.armC.md },
      ],
      { modifiedAt: new Date(built.manifest.snapshotClock) }   // what the handler now uses
    );

  it("1 — builds a non-empty archive for a corpus the registry has never seen", async () => {
    const built = await buildBenchmarkArtifacts(corpus());
    expect(built.detection.snapshot).toBeNull();               // the case that used to throw
    const zip = await zipFor(built);
    expect(zip.byteLength).toBeGreaterThan(0);
  });

  it("the old expression is exactly what threw", async () => {
    const built = await buildBenchmarkArtifacts(corpus());
    expect(() => new Date(built.detection.snapshot.clock)).toThrow(TypeError);
    // ...and the replacement is defined for the same input
    expect(new Date(built.manifest.snapshotClock).getTime()).not.toBeNaN();
    expect(snapshotIdentityOf(built.detection).clock.getTime()).not.toBeNaN();
  });

  it("2 — contains exactly two Markdown files and nothing else", async () => {
    const built = await buildBenchmarkArtifacts(corpus());
    const names = entriesOf(await zipFor(built)).map((e) => e.name).sort();
    expect(names).toHaveLength(2);
    expect(names.every((n) => n.endsWith(".md"))).toBe(true);
    expect(names).toEqual([built.armC.filename, built.armB.filename].sort());
  });

  it("3 — the archived bytes are the Arm B and Arm C bytes exactly", async () => {
    const built = await buildBenchmarkArtifacts(corpus());
    const byName = new Map(entriesOf(await zipFor(built)).map((e) => [e.name, e]));
    expect(await textOf(byName.get(built.armB.filename))).toBe(built.armB.md);
    expect(await textOf(byName.get(built.armC.filename))).toBe(built.armC.md);
  });

  it("4 — SHA-256 of the extracted files equals what the UI displays", async () => {
    const built = await buildBenchmarkArtifacts(corpus());
    const byName = new Map(entriesOf(await zipFor(built)).map((e) => [e.name, e]));
    expect(await sha256(await textOf(byName.get(built.armB.filename)))).toBe(built.armB.sha256);
    expect(await sha256(await textOf(byName.get(built.armC.filename)))).toBe(built.armC.sha256);
  });

  it("5 & 6 — the individual Arm B and Arm C downloads carry the same bytes", async () => {
    // Each arm downloads `built.armX.md` under `built.armX.filename`; the
    // archive must not be a different rendering of the same artifact.
    const built = await buildBenchmarkArtifacts(corpus());
    const byName = new Map(entriesOf(await zipFor(built)).map((e) => [e.name, e]));
    for (const arm of [built.armB, built.armC]) {
      expect(await textOf(byName.get(arm.filename))).toBe(arm.md);
      expect(await sha256(arm.md)).toBe(arm.sha256);
    }
  });

  it("the archive is named after the build it contains, not the active snapshot", async () => {
    const built = await buildBenchmarkArtifacts(corpus());
    const name = `${built.snapshot}_Consolidated-Arms.zip`;
    expect(name).toContain(built.snapshot);
    expect(name).not.toContain(ACTIVE_SNAPSHOT.name);
    const src = fs.readFileSync(path.join(root, "src/components/BenchmarkExport.jsx"), "utf8");
    expect(src).toContain("`${built.snapshot}_Consolidated-Arms.zip`");
  });

  it("7 — the manifest serialises to valid JSON and names both arms", async () => {
    const built = await buildBenchmarkArtifacts(corpus());
    const json = JSON.parse(JSON.stringify(built.manifest, null, 2));
    expect(json.arms.B.sha256).toBe(built.armB.sha256);
    expect(json.arms.C.sha256).toBe(built.armC.sha256);
    expect(typeof json.snapshotClock).toBe("string");
  });

  it("the bucket package archive survives the same null snapshot", async () => {
    const pkg = await buildBucketPackage({
      "PROJECT PLAYBOOK": [corpus()[0]],
      "LOCATORS": [corpus()[1]],
    });
    const detection = await detectSnapshot(corpus());
    expect(detection.snapshot).toBeNull();
    const zip = await createZip(packageEntries(pkg), { modifiedAt: snapshotIdentityOf(detection).clock });
    expect(entriesOf(zip).length).toBe(packageEntries(pkg).length);
  });

  it("a known corpus still timestamps from its own snapshot clock", async () => {
    if (!has(V2)) return;
    const built = await buildBenchmarkArtifacts(load(V2));
    expect(built.manifest.snapshotClock).toBe(new Date(ACTIVE_SNAPSHOT.clock).toISOString());
  }, 900000);
});

/* ------------------------------------------------------------------ *
 * The benchmark panel and the question generator are sibling tabs, so
 * only one is mounted at a time. The build lived inside the benchmark
 * panel, so it died on every tab switch, and the question generator
 * never saw it at all — it reported dashes for Master and AI while
 * artifacts sat freshly built one tab away.
 * ------------------------------------------------------------------ */

describe("PART B — one current build, shared", () => {
  const appSrc = fs.readFileSync(path.join(root, "src/App.jsx"), "utf8");
  const panelSrc = fs.readFileSync(path.join(root, "src/components/BenchmarkExport.jsx"), "utf8");
  const tqgSrc = fs.readFileSync(path.join(root, "src/components/TestQuestionGenerator.jsx"), "utf8");

  it("8 — the parent owns the build and clears it when the corpus moves", () => {
    expect(appSrc).toMatch(/const \[currentBuild, setCurrentBuild\] = useState\(null\)/);
    expect(appSrc).toMatch(/useEffect\(\(\) => \{ setCurrentBuild\(null\); \}, \[corpusKey\]\)/);
  });

  it("9 — both panels receive the same build", () => {
    expect(appSrc).toMatch(/currentBuild=\{currentBuild\}/);
    expect(appSrc).toMatch(/onBuild=\{setCurrentBuild\}/);
    expect(appSrc).toContain("build={currentBuild?.build ?? null}");
  });

  it("10 — the generator reads Master and AI from the build, not the registry", () => {
    expect(tqgSrc).toContain("build?.masterSha256");
    expect(tqgSrc).toContain("build.aiSha256");
    expect(tqgSrc).toContain('build = null');
  });

  it("the panel writes through to the parent rather than keeping its own copy", () => {
    expect(panelSrc).toContain("const built = onBuild ? currentBuild : localBuild;");
    expect(panelSrc).toContain("const setBuilt = onBuild ?? setLocalBuild;");
  });

  it("15 — a failed build leaves no stale current build", () => {
    // generate() clears before building and never restores on error.
    // There are two generate handlers; take the one that builds artifacts.
    const at = panelSrc.indexOf("const generate = async () => {", panelSrc.indexOf("export default function BenchmarkExport"));
    const body = panelSrc.slice(at, panelSrc.indexOf("const verify = async () =>", at));
    expect(body).toContain("buildBenchmarkArtifacts");
    expect(body).toContain("setBuilt(null)");
    expect(body.indexOf("setBuilt(null)")).toBeLessThan(body.indexOf("buildBenchmarkArtifacts"));
    // the catch restores nothing, so a failure cannot leave the old build current
    expect(body.slice(body.indexOf("} catch"))).not.toContain("setBuilt(");

    // ...and the package handler clears its own result the same way
    const pkgAt = panelSrc.indexOf("const generate = async () => {");
    const pkgBody = panelSrc.slice(pkgAt, panelSrc.indexOf("const downloadPackage", pkgAt));
    expect(pkgBody.indexOf("setPkg(null)")).toBeLessThan(pkgBody.indexOf("buildBucketPackage"));
  });
});

/* ------------------------------------------------------------------ *
 * Lineage. A question set generated under one ordering while the
 * artifacts beside it were built under another describes a different
 * reading of the same corpus, and nothing on screen would say so.
 * ------------------------------------------------------------------ */

describe("PART C — question generation is bound to the build", () => {
  const tqgSrc = fs.readFileSync(path.join(root, "src/components/TestQuestionGenerator.jsx"), "utf8");

  it("11 — parses under the build's own order policy", () => {
    expect(tqgSrc).toContain("const orderPolicy = build?.orderPolicy ?? undefined;");
    expect(tqgSrc).toContain("path: byName.get(name).path ?? name, orderPolicy }");
  });

  it("13 — stamps the result with the build it came from", () => {
    expect(tqgSrc).toContain("buildId: build.snapshotId");
    expect(tqgSrc).toContain("contentSha256: build.contentSha256");
    expect(tqgSrc).toContain("orderPolicy: build.orderPolicy");
  });

  it("says so plainly when there is no build to bind to", () => {
    expect(tqgSrc).toContain("artifacts and questions are not bound");
    expect(tqgSrc).toContain("No current knowledge build");
  });

  it("12 — the two order policies really do produce different question sets", async () => {
    if (!has(V2)) return;
    const { parsePage } = await import("../src/lib/aspxDocument.js");
    const { buildQuestionSet, scopeOf, titleOf } = await import("../src/lib/questionSet.js");
    const files = load(V2);
    const build = async (policy) => {
      const names = scopeOf(files.map((f) => f.name));
      const byName = new Map(files.map((f) => [f.name, f]));
      const pages = names.map((name) => ({
        name, page: parsePage(byName.get(name).raw, { name, path: name, orderPolicy: policy }),
      }));
      const entity = new Map(pages.map(({ name, page }) => [name, titleOf(page)]));
      return buildQuestionSet(pages, { entityOf: (p) => entity.get(p) ?? null });
    };
    const dom = await build(DOM);
    const banded = await build(BANDED_COLUMN_BY_TOP);
    expect(dom.sha256).toBe(ACTIVE_SNAPSHOT.questionSetSha256);
    expect(dom.questions).toHaveLength(607);
    expect(banded.sha256).not.toBe(dom.sha256);
    expect(banded.questions).toHaveLength(636);
  }, 900000);
});

describe("PART F — no authorization language in the build workflow", () => {
  for (const f of ["src/components/BenchmarkExport.jsx", "src/components/TestQuestionGenerator.jsx"]) {
    it(`${path.basename(f)} shows no UNREGISTERED gate`, () => {
      const src = fs.readFileSync(path.join(root, f), "utf8");
      expect(src).not.toMatch(/UNREGISTERED SNAPSHOT/);
      expect(src).not.toMatch(/generation is blocked/);
      expect(src).not.toMatch(/matches no registered snapshot/);
    });
  }

  it("— generate to identify is gone from the generator", () => {
    const src = fs.readFileSync(path.join(root, "src/components/TestQuestionGenerator.jsx"), "utf8");
    expect(src).not.toContain("generate to identify");
  });
});

describe("PART E — V2 is untouched by any of this", () => {
  it("16 — still reproduces its registered artifacts", async () => {
    if (!has(V2)) return;
    const built = await buildBenchmarkArtifacts(load(V2));
    expect(built.snapshot).toBe("SEPTEMBER-2026-V2-CORPUS");
    expect(built.armB.sha256).toBe("bb5f8eda7f364c8868ba5fe7827d26cef6b135dd3cea108be080815674f14aea");
    expect(built.armC.sha256).toBe("65e8001fae11179d2e0808d7b48964f1702f6f31898535fc21b1faf4eb112c75");
  }, 900000);

  it("the registry entry is unchanged", () => {
    expect(ACTIVE_SNAPSHOT.questions).toBe(607);
    expect(ACTIVE_SNAPSHOT.questionSetSha256).toBe("1f93c4a5d9d927c1044498df09fec5d7fa141a613da3993c8fd27fb5200f2990");
    expect(ACTIVE_SNAPSHOT.evaluation.status).toBe("not-run");
  });
});

/* ------------------------------------------------------------------ *
 * The corpus grows. Pages are added at SharePoint over time, so any
 * build after the first will have a page count that is not V2's. The
 * panel used to call that out in amber — "139 files loaded, not 133 …
 * a different page set than the pre-flight was verified against" — and
 * scored it as a failed row in the readiness checklist. Both framed
 * ordinary growth as a deviation, and both would have been wrong on
 * every future build.
 *
 * Comparison against the frozen V2 file set stays, because reproducing
 * a known lineage is a real thing to check. It just stops being a
 * verdict on corpora that are not claiming to be that lineage.
 * ------------------------------------------------------------------ */

describe("the page count is descriptive, not an expectation", () => {
  const ui = fs.readFileSync(path.join(root, "src/components/BenchmarkExport.jsx"), "utf8");

  it("nothing blocks generation on a page count", () => {
    for (const d of [...ui.matchAll(/disabled=\{([^}]*)\}/g)].map((m) => m[1])) {
      expect(d, `a control gates on the page count: ${d}`).not.toMatch(/CANONICAL\.pages|sourceFiles/);
    }
  });

  it("a different count is not reported in the warning tone", () => {
    const at = ui.indexOf("staged.length !== CANONICAL.pages");
    const block = ui.slice(at, at + 600);
    expect(block).not.toContain("text-amber-700");
    expect(block).toContain("text-slate-500");
    expect(block).toMatch(/expected rather than a problem/);
  });

  it("the empty state does not name a fixed number of pages", () => {
    const at = ui.indexOf("Nothing loaded this session");
    const block = ui.slice(at, ui.indexOf("</p>", at));     // that paragraph only
    expect(block).not.toContain("CANONICAL.pages");
    expect(block).toContain("the pages, or the .zip");
  });

  it("the canonical file-set pill appears only where a lineage is claimed", () => {
    expect(ui).toMatch(/\{built && detection\?\.snapshot && \(/);
    expect(ui).not.toContain('no={`not the canonical ${SNAPSHOT} file set`}');
  });

  it("the readiness checklist does not score a new knowledge source as failing", () => {
    const at = ui.indexOf("Benchmark status");
    const list = ui.slice(at, ui.indexOf("Arm C coverage", at));
    expect(list).not.toContain("canonicalCorpus, \"Canonical snapshot\"");
    expect(list).toContain("new knowledge source — no earlier build shares these bytes");
  });

  it("a corpus larger than V2 still builds, and records its own count", async () => {
    const grown = [
      ...corpus(),
      { name: "c.aspx", path: "c.aspx", raw: makeAspx(page("Gamma", "Gamma is a new development.")) },
    ];
    const built = await buildBenchmarkArtifacts(grown);
    expect(built.armB.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(built.build.pageCount).toBe(3);
    expect(built.manifest.corpusPages).toBe(3);
  });

  it("comparison against the frozen artifacts is still reported, just not enforced", async () => {
    const built = await buildBenchmarkArtifacts(corpus());
    const cmp = compareToCanonical(built);
    expect(cmp.files).toBe(false);
    expect(cmp.pages).toBe(false);
    // ...and the build happened anyway
    expect(built.build.snapshotId).toMatch(/^build-[0-9a-f]{16}$/);
  });
});
